/**
 * Parity check: the TypeScript engine must reproduce the Go program's log
 * exactly, byte for byte, for every canonical scenario.
 *
 * The fixtures are generated from the Go repository:
 *
 *   cd ../aegis && go run ./cmd/aegis run --scenario node-crash --format jsonl
 *   cd ../aegis && go run ./cmd/aegis run --scenario one-way-partition --format jsonl
 *   cd ../aegis && go run ./cmd/aegis run --scenario recovered-crash --format jsonl
 *   cd ../aegis && go run ./cmd/aegis run --scenario lone-witness --format jsonl
 *
 * Run: npm run parity
 *
 * The first pass runs the Go program again and compares it with the committed
 * fixture, because "the two logs disagree" has two causes that need opposite
 * repairs. If the implementation moved, the fixture is a stale copy and has to be
 * recopied; if it did not, the port drifted and the fixture is right. Checking the
 * implementation first is the only way to tell a reader which of the two they are
 * looking at — and if both moved, the stale fixture is still the first thing to
 * fix, since comparing the port against yesterday's log proves nothing.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CausalIndex, countOf, depthOf } from "../src/engine/causal";
import { toJsonl } from "../src/engine/recorder";
import { differences, gatePath, goRepo, measureGate, type GateFacts } from "./gate-lib";
import { runnableScenarios } from "./go-scenarios";
import {
  DEFAULT_PARAMS,
  runLab,
  runLoneWitness,
  runPartition,
  runRecoveredCrash,
  type RunResult,
} from "../src/engine/scenario";
import { verifyAction, verifyActions } from "../src/engine/verify";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "src", "engine", "fixtures");

const fail = (message: string): never => {
  console.error(`\n✗ parity failed\n\n${message}\n`);
  process.exit(1);
};

interface World {
  name: string;
  fixture: string;
  run: () => RunResult;
}

const worlds: World[] = [
  { name: "node-crash", fixture: "node-crash.jsonl", run: () => runLab(DEFAULT_PARAMS, 0) },
  { name: "one-way-partition", fixture: "one-way-partition.jsonl", run: () => runPartition(0) },
  { name: "recovered-crash", fixture: "recovered-crash.jsonl", run: () => runRecoveredCrash(0) },
  { name: "lone-witness", fixture: "lone-witness.jsonl", run: () => runLoneWitness(0) },
];

/** Where a fixture lives, as a reader of the message would type it. */
const fixturePath = (fixture: string) => `src/engine/fixtures/${fixture}`;

/** What the Go program produces for a scenario right now. */
const runGo = (name: string): { ok: boolean; out: string } => {
  try {
    const out = execFileSync(
      "go",
      ["run", "./cmd/aegis", "run", "--scenario", name, "--format", "jsonl"],
      { cwd: goRepo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 },
    );
    return { ok: true, out };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/**
 * Where the Go repository defines a scenario, as `path:line`.
 *
 * The page and the implementation each decide what a scenario is: the Go spec
 * says it, and the fixture is the log of it. Naming the Go side is the
 * difference between "this file is stale" and "somewhere over there something
 * moved", and it is discovered by reading the repository rather than hardcoded,
 * so a scenario that migrates to its own file is still found.
 */
const scenarioSource = (name: string): string | null => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Both spellings occur: a struct literal (`Name: "x"`) and a spec built by
  // mutation (`spec.Name = "x"`), and gofmt may pad either one.
  const declared = new RegExp(`\\bName\\s*[:=]\\s*"${escaped}"`);
  const mentioned = new RegExp(`"${escaped}"`);

  let files: string[];
  try {
    files = readdirSync(goRepo, { recursive: true, encoding: "utf8" }).sort();
  } catch {
    return null;
  }

  // A declaration is the definition. A bare mention is only a guess, so it is
  // ranked: a registry or table inside the scenario package first, then anything
  // else — which keeps the flag parser in cmd/ from answering for a scenario it
  // merely knows the name of.
  let loose: { where: string; rank: number } | null = null;
  for (const file of files) {
    if (!file.endsWith(".go") || file.endsWith("_test.go")) continue;
    let text: string;
    try {
      text = readFileSync(join(goRepo, file), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    const at = lines.findIndex((line) => declared.test(line));
    if (at >= 0) return `${file}:${at + 1}`;

    const rank = file.startsWith("internal/scenario/") ? 0 : 1;
    if (loose === null || rank < loose.rank) {
      const line = lines.findIndex((candidate) => mentioned.test(candidate));
      if (line >= 0) loose = { where: `${file}:${line + 1}`, rank };
    }
  }
  return loose?.where ?? null;
};

/** The implementation's half of the copy, as a line a reader can act on. */
const provenanceNote = (name: string): string[] => {
  const source = scenarioSource(name);
  return source === null ? [] : [`defined in ${source}`];
};

/** Indents every line after the first, leaving blank lines blank. */
const indentLines = (lines: string[]): string =>
  lines.map((line, i) => (i === 0 || line === "" ? line : `    ${line}`)).join("\n");

/** The index of the first line that differs, or -1 when one list is a prefix. */
const firstDifference = (a: string[], b: string[]): number => {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) if (a[i] !== b[i]) return i;
  return -1;
};

/** A parsed event, or null when the line is not JSON. */
const parseRow = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const kindOf = (row: Record<string, unknown>): string =>
  typeof row.kind === "string" ? row.kind : "?";

/** A tick, in the milliseconds the log is written in. */
const asMs = (value: unknown): string =>
  typeof value === "number" ? `${value / 1_000_000}ms` : JSON.stringify(value);

const signed = (value: number): string => `${value > 0 ? "+" : ""}${value / 1_000_000}ms`;

/** `link_restored ×2 (#17, #18)` — a multiset with the seqs it came from. */
const tally = (rows: Record<string, unknown>[], indices: number[]): string => {
  const groups = new Map<string, number[]>();
  for (const index of indices) {
    const seq = rows[index].seq;
    const kind = kindOf(rows[index]);
    groups.set(kind, [...(groups.get(kind) ?? []), typeof seq === "number" ? seq : index + 1]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([kind, seqs]) =>
      seqs.length === 1
        ? `${kind} (#${seqs[0]})`
        : `${kind} ×${seqs.length} (#${seqs.join(", #")})`,
    )
    .join(", ");
};

/**
 * The longest common subsequence of two kind sequences, as the indices that were
 * added and removed.
 *
 * A log is an ordered list, so one event inserted in the middle shifts every seq
 * after it: comparing index by index would report half the file as changed and
 * say nothing about the single event that was added.
 */
const alignKinds = (before: string[], after: string[]): { added: number[]; removed: number[] } => {
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const added: number[] = [];
  const removed: number[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      removed.push(i);
      i += 1;
    } else {
      added.push(j);
      j += 1;
    }
  }
  while (i < before.length) {
    removed.push(i);
    i += 1;
  }
  while (j < after.length) {
    added.push(j);
    j += 1;
  }
  return { added, removed };
};

/** Everything about an event except its timestamp, independently of key order. */
const shapeOf = (row: Record<string, unknown>): string =>
  JSON.stringify(
    Object.keys(row)
      .filter((key) => key !== "at")
      .sort()
      .map((key) => [key, row[key]]),
  );

/** How many field names a content summary lists before summarising the rest. */
const DETAIL_FIELDS = 4;

/**
 * How each field differs across a set of aligned event pairs, `at` excepted.
 *
 * A struct that gains one field changes every event in the file, and "16 events
 * changed" is true and useless: the reader wants the field's name, once. The
 * timestamp is left out here because it is counted separately as timing, and a
 * field that merely moved with it is not a content change.
 */
const tallyFields = (
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
  indices: number[],
): Map<string, { added: number; removed: number; changed: number }> => {
  const counts = new Map<string, { added: number; removed: number; changed: number }>();
  const bump = (field: string, kind: "added" | "removed" | "changed") => {
    const entry = counts.get(field) ?? { added: 0, removed: 0, changed: 0 };
    entry[kind] += 1;
    counts.set(field, entry);
  };

  for (const index of indices) {
    const a = before[index];
    const b = after[index];
    for (const key of Object.keys(b)) {
      if (key === "at") continue;
      if (!(key in a)) bump(key, "added");
      else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) bump(key, "changed");
    }
    for (const key of Object.keys(a)) {
      if (key !== "at" && !(key in b)) bump(key, "removed");
    }
  }
  return counts;
};

/** The largest count for one field, so the loudest field is listed first. */
const weight = (counts: { added: number; removed: number; changed: number }): number =>
  Math.max(counts.added, counts.removed, counts.changed);

const describeField = (counts: { added: number; removed: number; changed: number }): string =>
  (["added", "removed", "changed"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${kind} on ${counts[kind]} event${counts[kind] === 1 ? "" : "s"}`)
    .join(", ");

/** The first field two events disagree on, timestamp included. */
const firstField = (a: Record<string, unknown>, b: Record<string, unknown>): string | null => {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return key;
  }
  return null;
};

/**
 * What changed between the fixture and what the implementation produces now.
 *
 * The first differing line is already what the port check prints, and alone it
 * says very little: `heartbeat_sent` against `heartbeat_sent`, one digit apart,
 * does not tell the reader whether a number moved or an event appeared. So the
 * difference is classified — events added, removed, retimed, or changed in some
 * other field — and only then is one example given.
 */
const describeDrift = (fixtureLines: string[], liveLines: string[]): string[] => {
  const before = fixtureLines.map(parseRow);
  const after = liveLines.map(parseRow);

  // A log that will not parse is a different problem, and guessing at it would
  // hide the parse error rather than report it.
  if (before.includes(null) || after.includes(null)) {
    const index = firstDifference(fixtureLines, liveLines);
    return [
      `${fixtureLines.length} events before, ${liveLines.length} now; first difference at ${index < 0 ? "the end" : `#${index + 1}`}`,
    ];
  }

  const rowsBefore = before as Record<string, unknown>[];
  const rowsAfter = after as Record<string, unknown>[];
  const { added, removed } = alignKinds(rowsBefore.map(kindOf), rowsAfter.map(kindOf));

  if (added.length > 0 || removed.length > 0) {
    const out = [`${rowsAfter.length} events now, ${rowsBefore.length} before`];
    if (added.length > 0) out.push(`added: ${tally(rowsAfter, added)}`);
    if (removed.length > 0) out.push(`removed: ${tally(rowsBefore, removed)}`);
    const firstAdded = added[0];
    if (firstAdded !== undefined) {
      const row = rowsAfter[firstAdded];
      out.push(`first added: #${row.seq} ${kindOf(row)} at ${asMs(row.at)}`);
    }
    return out;
  }

  // Same events in the same order, so the differences can be counted per event.
  const retimed: number[] = [];
  const reshaped: number[] = [];
  let first = -1;
  for (let index = 0; index < rowsBefore.length; index += 1) {
    if (fixtureLines[index] === liveLines[index]) continue;
    if (first < 0) first = index;
    if (rowsBefore[index].at !== rowsAfter[index].at) retimed.push(index);
    if (shapeOf(rowsBefore[index]) !== shapeOf(rowsAfter[index])) reshaped.push(index);
  }

  const out = [`${rowsAfter.length} events in both, ${retimed.length + reshaped.length - overlap(retimed, reshaped)} differ`];

  if (retimed.length > 0) {
    const deltas = retimed.map(
      (index) => (rowsAfter[index].at as number) - (rowsBefore[index].at as number),
    );
    const low = Math.min(...deltas);
    const high = Math.max(...deltas);
    const moved =
      low === high ? `every one by ${signed(low)}` : `by ${signed(low)} to ${signed(high)}`;
    out.push(`timing: ${retimed.length} retimed, ${moved}`);
  }
  if (reshaped.length > 0) {
    out.push(`content: ${reshaped.length} changed beyond their timestamp`);
    const entries = [...tallyFields(rowsBefore, rowsAfter, reshaped).entries()].sort(
      (a, b) => weight(b[1]) - weight(a[1]) || a[0].localeCompare(b[0]),
    );
    for (const [field, counts] of entries.slice(0, DETAIL_FIELDS)) {
      out.push(`  ${field}: ${describeField(counts)}`);
    }
    if (entries.length > DETAIL_FIELDS) {
      out.push(`  and ${entries.length - DETAIL_FIELDS} more fields`);
    }
  }

  const field = first < 0 ? null : firstField(rowsBefore[first], rowsAfter[first]);
  if (first >= 0 && field !== null) {
    const a = rowsBefore[first];
    const b = rowsAfter[first];
    const show = (value: unknown): string => {
      // A field the other side does not have is the difference, not an absence
      // of one: printing `undefined` here would read as a bug in the check.
      if (value === undefined) return "(absent)";
      return field === "at" ? asMs(value) : JSON.stringify(value);
    };
    out.push(`first: #${a.seq} ${kindOf(a)} ${field} ${show(a[field])} → ${show(b[field])}`);
  }

  return out.length === 0 ? ["the bytes differ but no field does: check trailing whitespace"] : out;
};

/** How many indices the two lists share, without counting them twice. */
const overlap = (a: number[], b: number[]): number => {
  const seen = new Set(b);
  return a.filter((value) => seen.has(value)).length;
};

// --- pass one: is the fixture still a copy of the implementation? -----------
//
// This runs before any comparison with the port, and it runs for every world so
// that a change touching three scenarios names all three at once, rather than
// making the reader regenerate, re-run and discover the next one.
const stale: string[] = [];
// A world whose scenario no longer runs is stale in a way recopying cannot
// repair, so the advice has to differ for it.
let unrunnable = false;
for (const { name, fixture } of worlds) {
  const path = fixturePath(fixture);
  const live = runGo(name);
  if (!live.ok) {
    unrunnable = true;
    stale.push(
      indentLines([
        `${path} cannot be checked: \`go run ./cmd/aegis run --scenario ${name}\` failed.`,
        ...provenanceNote(name),
        "",
        ...live.out.trim().split("\n"),
        "",
        "If the scenario was renamed or removed in the implementation, the fixture named after it is now a fixture for nothing.",
      ]),
    );
    continue;
  }

  const fixtureLines = readFileSync(join(fixtures, fixture), "utf8").trimEnd().split("\n");
  const liveLines = live.out.trimEnd().split("\n");
  if (fixtureLines.join("\n") === liveLines.join("\n")) continue;

  stale.push(indentLines([path, ...provenanceNote(name), ...describeDrift(fixtureLines, liveLines)]));
}

if (stale.length > 0) {
  fail(
    `the committed fixtures are stale — the Go repository no longer produces them.\n\n` +
      stale.map((entry) => `  ${entry}`).join("\n\n") +
      `\n\n  A fixture is a copy of the implementation's own output, so a scenario that` +
      `\n  changed leaves yesterday's log on the page. Recopy every fixture and commit` +
      `\n  the result:\n\n` +
      `    AEGIS_GO_REPO=${goRepo} npm run sync-fixture\n` +
      (unrunnable
        ? `\n  A scenario the implementation no longer runs cannot be recopied: either the` +
          `\n  name in the fixture and in src/engine/scenario.ts is stale and should follow` +
          `\n  the new one, or the scenario is gone and its fixture should go with it.\n`
        : "") +
      `\n  until then this check cannot say whether the port agrees with the code,` +
      `\n  because it is comparing both against a log neither side produces any more.`,
  );
}

// --- does a world exist for every scenario the implementation runs? ---------
//
// The worlds above are a hand-written list, so a scenario added in the Go
// repository is simply absent here: no fixture, no comparison, and a green page
// that says nothing about it. That is the failure mode worth checking for, since
// every other message in this file is about a scenario someone remembered.
// `fail` never returns, so this is total: the value is a list or the process is
// over, and the message below has no null to allow for.
const runnable =
  runnableScenarios(goRepo) ??
  fail(
    `could not read the runnable scenarios from cmd/aegis/main.go.\n\n` +
      `  This check compares the worlds against \`func lookup\`, whose case "name":` +
      `\n  arms are the set. If that moved or was reshaped, the check cannot tell which` +
      `\n  scenarios exist, and a coverage check that cannot see the list would pass` +
      `\n  whatever it was handed.`,
  );

const covered = new Set(worlds.map(({ name }) => name));
const uncovered = runnable.filter((name) => !covered.has(name));
if (uncovered.length > 0) {
  fail(
    `the implementation runs ${runnable.length} scenarios; the page covers ${covered.size}.\n\n` +
      uncovered.map((name) => `  uncovered: ${name}`).join("\n") +
      `\n\n  A scenario is checked only if a world runs it: a fixture to compare against` +
      `\n  and a run of the port to compare it with. For each name above:` +
      `\n\n` +
      `    src/engine/scenario.ts  a run of the port for that scenario` +
      `\n    scripts/parity.ts       a world naming it and its fixture` +
      `\n    npm run sync-fixture    writes the fixture from the implementation` +
      `\n\n  Until then this check is green about a scenario it never exercises, which is` +
      `\n  worse than red: a page that omits one still reads as having checked them all.`,
  );
}

// --- pass two: does the port still produce the fixture? ----------------------

const compare = ({ name, fixture, run }: World) => {
  const go = readFileSync(join(fixtures, fixture), "utf8");
  const result = run();
  const ts = toJsonl(result.events);

  const goLines = go.trimEnd().split("\n");
  const tsLines = ts.trimEnd().split("\n");

  if (goLines.length !== tsLines.length) {
    fail(
      `${name}: the fixture has ${goLines.length} events, the TypeScript engine produces ${tsLines.length}` +
        `\n\n  The fixture is what the Go program produces (checked above), so the port has` +
        `\n  drifted. Fix src/engine/ until it reproduces ${fixturePath(fixture)}.`,
    );
  }
  for (let i = 0; i < goLines.length; i += 1) {
    if (goLines[i] !== tsLines[i]) {
      fail(
        `${name}: the port differs from the fixture at event ${i + 1}` +
          `\n\n    fixture: ${goLines[i]}` +
          `\n    engine:  ${tsLines[i]}` +
          `\n\n  The fixture matches the Go program, so the divergence is in the port:` +
          `\n  fix src/engine/ until it reproduces ${fixturePath(fixture)}.`,
      );
    }
  }

  const goHash = createHash("sha256").update(go).digest("hex");
  const tsHash = createHash("sha256").update(ts).digest("hex");
  if (goHash !== tsHash) fail(`${name}: hashes differ`);

  console.log(`✓ ${name}: ${goLines.length} events, byte for byte`);
  console.log(`  sha256 ${tsHash}`);
  return { result, goLines, index: new CausalIndex(result.events) };
};

const crashWorld = compare(worlds[0]);
const partitionWorld = compare(worlds[1]);
const repairedWorld = compare(worlds[2]);
const refusedWorld = compare(worlds[3]);

// The bytes agreeing is necessary, not sufficient: the page lets a reader walk
// the graph, so the graph has to make the same claims the Go code makes.
const crash = crashWorld.result.events.find((event) => event.kind === "node_crashed");
const suspicion = crashWorld.result.events.find(
  (event) => event.kind === "suspicion_raised" && event.peer === "A",
);
if (!crash || !suspicion) fail("the crash run is missing its crash or its suspicion");

const suspicionChain = crashWorld.index.explain(suspicion.seq);
if (suspicionChain.causes.length !== 1) {
  fail(`the suspicion cites ${suspicionChain.causes.length} causes, want exactly one receipt`);
}
const evidence = suspicionChain.causes[0].event;
if (evidence.kind !== "heartbeat_received" || evidence.at !== 220_000_000) {
  fail(`the suspicion rests on ${evidence.kind} at ${evidence.at}, want the 220ms receipt`);
}
if (crashWorld.index.hasAncestor(suspicion.seq, crash.seq)) {
  fail("the crash appears in the observer's reasoning; it was never delivered to anyone");
}
if (crashWorld.index.descendants(crash.seq).length !== 0) {
  fail(`the crash has ${crashWorld.index.descendants(crash.seq).length} descendants, want none`);
}
if (crashWorld.index.ancestors(suspicion.seq)[0] !== crashWorld.index.root) {
  fail("the suspicion's ancestry does not reach the opening event");
}

const recovery = partitionWorld.result.events.find((event) => event.kind === "suspicion_cleared");
const repair = partitionWorld.result.events.find((event) => event.kind === "link_restored");
if (!recovery || !repair) fail("the partition run is missing its recovery or its repair");
if (recovery.at !== 920_000_000) fail(`the recovery is at ${recovery.at}, want 920ms`);

const recoveryChain = partitionWorld.index.explain(recovery.seq);
const arrival = recoveryChain.causes[0]?.event;
if (!arrival || arrival.kind !== "heartbeat_received" || arrival.at !== 920_000_000) {
  fail("the recovery does not rest on the 920ms arrival");
}
if (partitionWorld.index.hasAncestor(recovery.seq, repair.seq)) {
  fail("the repair appears in the recovery's reasoning; a path coming back explains nothing yet");
}
if (partitionWorld.index.descendants(repair.seq).length !== 0) {
  fail("the repair has descendants, but it changed no belief on its own");
}

const drop = partitionWorld.result.events.find(
  (event) => event.kind === "message_dropped" && event.reason === "partition",
);
if (!drop || drop.causes?.length !== 2) fail("a drop inside the cut must cite two events");

// --- recovery: the grant -----------------------------------------------------

const proposed = repairedWorld.result.events.find((event) => event.kind === "recovery_proposed");
const started = repairedWorld.result.events.find((event) => event.kind === "recovery_started");
const restarted = repairedWorld.result.events.find((event) => event.kind === "node_restarted");
if (!proposed || !started || !restarted) fail("the repaired run is missing one of its three recovery events");

if (proposed.at !== 620_000_000) fail(`the review is at ${proposed.at}, want 620ms`);
if ((proposed.causes ?? []).length !== 2) {
  fail(`the proposal cites ${proposed.causes?.length} causes, want the two reports`);
}
if (!(restarted.causes ?? []).includes(started.seq)) {
  fail("the restart does not cite the action that was carried out");
}
if (!(started.causes ?? []).includes(proposed.seq)) {
  fail("the action does not cite the decision that granted it");
}
if (repairedWorld.index.descendants(crash.seq).length !== 0) {
  fail("the crash of the repaired run has descendants; the decision must cite reports, not the crash");
}

const repairWorldClear = repairedWorld.result.events.find((event) => event.kind === "suspicion_cleared");
if (!repairWorldClear || repairWorldClear.at !== 840_000_000) {
  fail("the repaired run does not clear the first belief at 840ms");
}
// The restart is the first change in ground truth that has descendants, and
// this is the assertion that says so: the belief descends from the restart, and
// the restart descends from a decision made on evidence two observers produced.
if (!repairedWorld.index.hasAncestor(repairWorldClear.seq, restarted.seq)) {
  fail("the cleared belief does not reach the restart it could not have happened without");
}
if (!repairedWorld.index.hasAncestor(restarted.seq, suspicion.seq)) {
  fail("the restart does not reach the suspicion, so the decision to act is not in its chain");
}

const proof = verifyAction(repairedWorld.index, 1);
if (!proof.complete) fail("the granted action does not have a complete chain in the log");
if (proof.proof.proposed !== proposed.seq || proof.proof.applied !== restarted.seq) {
  fail(`the proof names ${proof.proof.proposed}/${proof.proof.applied}, want ${proposed.seq}/${restarted.seq}`);
}
if (verifyActions(repairedWorld.index).length !== 1) fail("the repaired run reports more than one action");

if (repairedWorld.result.decisions.length !== 1 || !repairedWorld.result.decisions[0].granted) {
  fail(`decisions = ${JSON.stringify(repairedWorld.result.decisions)}, want one grant`);
}

// --- recovery: the refusal ---------------------------------------------------

const refused = refusedWorld.result.events.find((event) => event.kind === "recovery_refused");
if (!refused) fail("the lone-witness run records no refusal");
if (refused.reason !== "insufficient_witnesses") fail(`the refusal reason is ${refused.reason}`);
if ((refused.causes ?? []).length !== 1) {
  fail(`the refusal cites ${refused.causes?.length} causes, want the one report it declined`);
}
for (const kind of ["recovery_proposed", "recovery_started", "node_restarted"] as const) {
  if (refusedWorld.result.events.some((event) => event.kind === kind)) {
    fail(`the refusal world contains a ${kind}: a refused action must not touch the world`);
  }
}
if (refusedWorld.result.actions.length !== 0) fail("the refusal world carries out an action");
if (refusedWorld.result.decisions[0]?.granted !== false) fail("the lone-witness decision was not a refusal");
if (verifyAction(refusedWorld.index, 1).complete) fail("a refusal must not produce a proof");
if (verifyActions(refusedWorld.index).length !== 0) fail("the refusal world reports a granted action");

// --- a world with no policy --------------------------------------------------

if (crashWorld.result.events.some((event) => event.kind.startsWith("recovery_"))) {
  fail("a run with no policy recorded a recovery event");
}

// The proof card states numbers about the Go repository. A card that is only
// typed once is a claim about the day it was typed, so the same measurement is
// re-run here and compared with the committed file.
const committed = JSON.parse(readFileSync(gatePath, "utf8")) as GateFacts;
const drift = differences(committed, measureGate());
if (drift.length > 0) {
  fail(`the proof card is stale (src/engine/gate.json):\n\n  ${drift.join("\n  ")}\n\n\n  run: npm run gate`);
}

console.log("");
console.log(
  `  crash run:      suspicion #${suspicion.seq} rests on ${countOf(suspicionChain) - 1} events, ${depthOf(suspicionChain)} deep, crash absent`,
);
console.log(`  partition:      recovery #${recovery.seq} rests on ${countOf(recoveryChain) - 1} events, repair absent`);
console.log(`  drop #${drop.seq}:          cites the cut and the send, in that order`);
console.log(
  `  repaired:       proposal #${proposed.seq} cites ${proposed.causes?.join(" ")}, restart #${restarted.seq} cites #${started.seq}, belief #${repairWorldClear.seq} descends from the restart`,
);
console.log(`  refused:        #${refused.seq} cites ${refused.causes?.join(" ")} and names why; the world never moved`);
console.log(
  `  reports:        ${crashWorld.result.reports.length} crash, ${partitionWorld.result.reports.length} cut, ${repairedWorld.result.reports.length} repaired, ${refusedWorld.result.reports.length} lone witness`,
);
console.log(
  `  gate card:      ${committed.packages} packages, ${committed.coverage.toFixed(1)}% coverage, ${committed.replay.scenarios.length} scenarios replayed — matches the repo`,
);
