import { useEffect, useMemo, useState } from "react";

import crashRaw from "../engine/fixtures/node-crash.jsonl?raw";
import refusedRaw from "../engine/fixtures/lone-witness.jsonl?raw";
import partitionRaw from "../engine/fixtures/one-way-partition.jsonl?raw";
import repairedRaw from "../engine/fixtures/recovered-crash.jsonl?raw";
import { CausalIndex } from "../engine/causal";
import { describe, fmt } from "../engine/trace";
import type { Event, Kind } from "../engine/types";
import { ChainPanel } from "./ChainPanel";

/**
 * One committed history, exactly as the Go CLI wrote it.
 *
 * The table used to show only the crash. The recovery worlds are worth reading
 * line by line too — a refusal is eleven lines, and what it does *not* contain
 * is the point — so every fixture the parity check compares is selectable here.
 */
interface Fixture {
  id: string;
  label: string;
  raw: string;
  note: string;
}

const FIXTURES: Fixture[] = [
  { id: "node-crash", label: "a crash", raw: crashRaw, note: "a belief outlives the truth" },
  { id: "one-way-partition", label: "a cut path", raw: partitionRaw, note: "a repair explains nothing yet" },
  { id: "recovered-crash", label: "a repair", raw: repairedRaw, note: "a decision puts the node back" },
  { id: "lone-witness", label: "a refusal", raw: refusedRaw, note: "one witness, and nobody acts" },
];

const parse = (raw: string): Event[] =>
  raw
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Event);

const tagFor = (kind: Kind): { label: string; className: string } => {
  switch (kind) {
    case "node_started":
    case "node_crashed":
    case "node_restarted":
      return { label: "truth", className: "tag--truth" };
    case "heartbeat_received":
    case "suspicion_raised":
    case "suspicion_cleared":
      return { label: "belief", className: "tag--belief" };
    case "recovery_proposed":
    case "recovery_started":
      return { label: "decision", className: "tag--truth" };
    case "recovery_refused":
      return { label: "refused", className: "tag--belief" };
    case "heartbeat_sent":
    case "message_dropped":
    case "link_partitioned":
    case "link_restored":
      return { label: "wire", className: "" };
    default:
      return { label: "run", className: "" };
  }
};

const KEY_KINDS: Kind[] = [
  "node_crashed",
  "node_restarted",
  "suspicion_raised",
  "heartbeat_received",
  "recovery_proposed",
  "recovery_refused",
  "recovery_started",
];

export function EventTable() {
  const [world, setWorld] = useState(FIXTURES[0].id);
  const [showRaw, setShowRaw] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const fixture = FIXTURES.find((candidate) => candidate.id === world) ?? FIXTURES[0];
  const events = useMemo(() => parse(fixture.raw), [fixture]);

  // The committed fixture is the Go program's own output, causes included, so
  // the same index the live lab uses can read it here.
  const index = useMemo(() => new CausalIndex(events), [events]);
  const crashSeq = useMemo(
    () => events.find((event) => event.kind === "node_crashed")?.seq ?? null,
    [events],
  );
  const repairSeq = useMemo(
    () => events.find((event) => event.kind === "link_restored")?.seq ?? null,
    [events],
  );
  const restartSeq = useMemo(
    () => events.find((event) => event.kind === "node_restarted")?.seq ?? null,
    [events],
  );

  // A reference only means something inside the history that issued it.
  useEffect(() => setSelected(null), [fixture]);

  return (
    <div>
      <div className="table__worlds">
        <div className="lab__worlds" role="group" aria-label="Which history to show">
          {FIXTURES.map((candidate) => (
            <button
              key={candidate.id}
              aria-pressed={world === candidate.id}
              onClick={() => setWorld(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        <span className="table__note">
          {events.length} events · {fixture.note}
        </span>
      </div>

      <div className="table" role="table" aria-label={`Recorded events for ${fixture.id}`}>
        <div className="table__row table__row--head" role="row">
          <span className="table__cell table__cell--num">#</span>
          <span className="table__cell">at</span>
          <span className="table__cell table__cell--kind">event</span>
          <span className="table__cell">what happened</span>
          <span className="table__cell table__cell--tag">source</span>
        </div>
        {events.map((event) => {
          const tag = tagFor(event.kind);
          const key = KEY_KINDS.includes(event.kind);
          const open = selected === event.seq;
          return (
            <button
              key={event.seq}
              type="button"
              className={[
                "table__row",
                key ? "table__row--key" : "",
                open ? "table__row--open" : "",
              ].join(" ")}
              onClick={() => setSelected(open ? null : event.seq)}
              title={`why did #${event.seq} happen?`}
            >
              <span className="table__cell table__cell--num">{event.seq}</span>
              <span className="table__cell">{fmt(event.at)}</span>
              <span className="table__cell table__cell--kind">{event.kind}</span>
              <span className="table__cell">{describe(event)}</span>
              <span className="table__cell table__cell--tag">
                <span className={`tag ${tag.className}`}>{tag.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {selected !== null && (
        <div style={{ marginTop: 16 }}>
          <ChainPanel
            index={index}
            selected={selected}
            crashSeq={crashSeq}
            repairSeq={repairSeq}
            restartSeq={restartSeq}
            onSelect={setSelected}
            onClose={() => setSelected(null)}
          />
        </div>
      )}

      <div className="table__foot">
        <button className="btn btn--ghost" style={{ height: 34 }} onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? "Hide the raw JSONL" : "Show the raw JSONL"}
        </button>
        <span className="panel-note" style={{ marginTop: 0 }}>
          This table is not a mock: it is the Go program&apos;s log, imported as{" "}
          <code>src/engine/fixtures/{fixture.id}.jsonl</code>. Click a line to see what caused it.
        </span>
      </div>

      {showRaw && (
        <pre className="code" style={{ marginTop: 14 }}>
          {fixture.raw.trimEnd()}
        </pre>
      )}
    </div>
  );
}
