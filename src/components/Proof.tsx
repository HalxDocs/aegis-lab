import { useEffect, useState } from "react";

import crashRaw from "../engine/fixtures/node-crash.jsonl?raw";
import refusedRaw from "../engine/fixtures/lone-witness.jsonl?raw";
import partitionRaw from "../engine/fixtures/one-way-partition.jsonl?raw";
import repairedRaw from "../engine/fixtures/recovered-crash.jsonl?raw";
// Measured, not typed: `npm run gate` writes this file, and `npm run parity`
// fails when it no longer agrees with the Go repository.
import gate from "../engine/gate.json";
import { toJsonl } from "../engine/recorder";
import {
  DEFAULT_PARAMS,
  runLab,
  runLoneWitness,
  runPartition,
  runRecoveredCrash,
  type RunResult,
} from "../engine/scenario";

interface World {
  id: string;
  label: string;
  raw: string;
  run: () => RunResult;
}

const WORLDS: World[] = [
  { id: "node-crash", label: "a crash", raw: crashRaw, run: () => runLab(DEFAULT_PARAMS, 0) },
  { id: "one-way-partition", label: "a cut path", raw: partitionRaw, run: () => runPartition(0) },
  { id: "recovered-crash", label: "a repair", raw: repairedRaw, run: () => runRecoveredCrash(0) },
  { id: "lone-witness", label: "a refusal", raw: refusedRaw, run: () => runLoneWitness(0) },
];

interface WorldProof {
  id: string;
  events: number;
  same: boolean;
  /** The shared digest when both sides agree, or both of them when they do not. */
  hash: string;
}

const countEvents = (raw: string): number => raw.trimEnd().split("\n").length;
const totalEvents = WORLDS.reduce((total, world) => total + countEvents(world.raw), 0);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The bytes, compared in the browser, for every canonical world.
 *
 * The crash log was the only one hashed when this section was written, because
 * it was the only one the page could run. The two recovery worlds are compared
 * the same way now — and they matter more, because a decision that is only
 * described is not evidence that the engine agrees with the Go program about
 * what it decided.
 */
export function Proof() {
  const [rows, setRows] = useState<WorldProof[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      WORLDS.map(async (world) => {
        const typescript = toJsonl(world.run().events);
        const [go, ts] = await Promise.all([sha256(world.raw), sha256(typescript)]);
        return {
          id: world.id,
          events: countEvents(world.raw),
          same: world.raw === typescript,
          hash: go === ts ? go : `${go} ≠ ${ts}`,
        };
      }),
    )
      .then((computed) => {
        if (!cancelled) setRows(computed);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const identical = rows?.filter((row) => row.same).length ?? 0;
  const allSame = rows !== null && identical === WORLDS.length;
  const verdict = failed ? "hash unavailable" : rows === null ? "comparing…" : allSame ? "identical" : "different";

  return (
    <div>
      <div className="proof">
        <div className="proof__main">
          <div className="proof__verdict">
            {rows === null ? "— / —" : `${identical} / ${WORLDS.length}`} <span>logs {verdict}</span>
          </div>
          <p className="proof__desc">
            The TypeScript engine on this page runs all four canonical worlds and prints the same JSONL as the Go
            program. Every pair is hashed in your browser, right now, and compared. Same bytes, not just the same
            outcome.
          </p>

          <div className="proof__rows">
            {WORLDS.map((world) => {
              const row = rows?.find((candidate) => candidate.id === world.id);
              return (
                <div className="proof__row" key={world.id}>
                  <span className="proof__key">{world.label}</span>
                  <span className="proof__val">
                    {row ? (
                      <>
                        {row.events} events · <b>{row.same ? "identical" : "different"}</b>
                        <span className="hash" title={row.hash}>
                          {row.hash.slice(0, 32)}…
                        </span>
                      </>
                    ) : (
                      "…"
                    )}
                  </span>
                </div>
              );
            })}
            <div className="proof__row">
              <span className="proof__key">decisions</span>
              <span className="proof__val">
                action 1 <b>granted</b> for B at 620 ms and applied at 720 ms · action 1 <b>refused</b> with{" "}
                <b>insufficient_witnesses</b>, and the world never moved
              </span>
            </div>
            <div className="proof__row">
              <span className="proof__key">total</span>
              <span className="proof__val">
                <b>{totalEvents}</b> recorded events across four histories, every one of them hashed here
              </span>
            </div>
          </div>

          <p className="panel-note">
            The comparison covers the canonical numbers only. Moving the sliders runs the same engine, but there is
            no Go fixture for a world you invented.
          </p>
        </div>

        <aside className="proof__side">
          <h4>reproduce it</h4>
          <div className="cmd">cd aegis-lab</div>
          <div className="cmd">npm run sync-fixture</div>
          <div className="cmd">npm run parity</div>

          <h4>the rest of the gate</h4>
          <div className="code">
            <b>go test ./...</b> {gate.packages} packages {gate.test ? "ok" : "FAILING"}{"\n"}
            <b>go test -race ./...</b> {gate.packages} packages {gate.race ? "ok" : "FAILING"}{"\n"}
            <b>go vet ./...</b> {gate.vet ? "clean" : "FAILING"}{"\n"}
            <b>make replay</b> {gate.replay.scenarios.length} scenarios{" "}
            {gate.replay.ok ? "identical" : "FAILING"}{"\n"}
            <b>coverage</b> {gate.coverage.toFixed(1)}% of statements
          </div>
          <span className="panel-note" title={gate.replay.scenarios.join(", ")}>
            measured by <b>npm run gate</b>; <b>npm run parity</b> fails when this card disagrees with the repository
          </span>

          <h4>explain it</h4>
          <div className="cmd">go run ./cmd/aegis explain -ref 14</div>
          <div className="cmd">go run ./cmd/aegis explain -ref 18</div>
          <span className="panel-note">
            The same graph this page walks. The crash appears in no belief&apos;s chain; the restart does, because a
            decision this log contains in full put the node back.
          </span>

          <a
            className="map__link"
            href="https://github.com/HalxDocs/aegis/blob/main/doc_m4.md"
            target="_blank"
            rel="noreferrer"
          >
            read doc_m4.md ↗
          </a>
          <a
            className="map__link"
            href="https://github.com/HalxDocs/aegis/blob/main/doc_m1.md"
            target="_blank"
            rel="noreferrer"
          >
            read doc_m1.md ↗
          </a>
        </aside>
      </div>
    </div>
  );
}
