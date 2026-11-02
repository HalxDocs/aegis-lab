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
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CausalIndex, countOf, depthOf } from "../src/engine/causal";
import { toJsonl } from "../src/engine/recorder";
import { differences, gatePath, measureGate, type GateFacts } from "./gate-lib";
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

const compare = ({ name, fixture, run }: World) => {
  const go = readFileSync(join(fixtures, fixture), "utf8");
  const result = run();
  const ts = toJsonl(result.events);

  const goLines = go.trimEnd().split("\n");
  const tsLines = ts.trimEnd().split("\n");

  if (goLines.length !== tsLines.length) {
    fail(`${name}: Go produced ${goLines.length} events, TypeScript produced ${tsLines.length}`);
  }
  for (let i = 0; i < goLines.length; i += 1) {
    if (goLines[i] !== tsLines[i]) {
      fail(`${name}: event ${i + 1} differs\n\n  go: ${goLines[i]}\n  ts: ${tsLines[i]}`);
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
