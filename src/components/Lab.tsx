import { useEffect, useMemo, useRef, useState } from "react";

import { CausalIndex } from "../engine/causal";
import {
  DEFAULT_PARAMS,
  RECOVERY_POLICY,
  runLab,
  runLoneWitness,
  runPartition,
  runRecoveredCrash,
  type LabParams,
} from "../engine/scenario";
import { describe, fmt, frameAt, transmissions } from "../engine/trace";
import { toMs } from "../engine/types";
import { verifyAction } from "../engine/verify";
import { usePlayback } from "../hooks/usePlayback";
import { ChainPanel } from "./ChainPanel";

const WIDTH = 760;
const HEIGHT = 322;

const POINT = {
  A: { x: 128, y: 232 },
  B: { x: 380, y: 92 },
  C: { x: 632, y: 232 },
} as const;

type World = "crash" | "partition" | "repair" | "refusal";

const WORLDS: { id: World; label: string; head: string }[] = [
  { id: "crash", label: "a crash", head: "change the world" },
  { id: "partition", label: "a cut path", head: "a cut path" },
  { id: "repair", label: "a repair", head: "a repair" },
  { id: "refusal", label: "a refusal", head: "a refusal" },
];

/** One decision as the page shows it: the row, plus the proof the log holds. */
interface DecisionView {
  ref: number;
  at: number;
  id: number;
  target: string;
  granted: boolean;
  reason: string;
  evidence: number[];
  proof: ReturnType<typeof verifyAction> | null;
}

function pointOn(from: { x: number; y: number }, to: { x: number; y: number }, t: number) {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export function Lab() {
  const [params, setParams] = useState<LabParams>(DEFAULT_PARAMS);
  const [world, setWorld] = useState<World>("crash");
  const [showWorld, setShowWorld] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const section = useRef<HTMLDivElement | null>(null);
  const autoplayed = useRef(false);

  const run = useMemo(() => {
    switch (world) {
      case "crash":
        return runLab(params, 0);
      case "partition":
        return runPartition(0);
      case "repair":
        return runRecoveredCrash(0);
      case "refusal":
        return runLoneWitness(0);
    }
  }, [world, params]);
  const index = useMemo(() => new CausalIndex(run.events), [run]);
  const crashSeq = useMemo(
    () => run.events.find((event) => event.kind === "node_crashed")?.seq ?? null,
    [run],
  );
  const repairSeq = useMemo(
    () => run.events.find((event) => event.kind === "link_restored")?.seq ?? null,
    [run],
  );
  const restartSeq = useMemo(
    () => run.events.find((event) => event.kind === "node_restarted")?.seq ?? null,
    [run],
  );
  // Every decision the run wrote, with the proof read back out of the log. A
  // proposal is proved by walking its edges; a refusal has nothing to prove.
  const decisions = useMemo(() => {
    const out: DecisionView[] = [];
    for (const event of run.events) {
      if (event.kind !== "recovery_proposed" && event.kind !== "recovery_refused") continue;
      const id = event.action ?? 0;
      out.push({
        ref: event.seq,
        at: event.at,
        id,
        target: event.node ?? "",
        granted: event.kind === "recovery_proposed",
        reason: event.reason ?? "",
        evidence: event.causes ?? [],
        proof: event.kind === "recovery_proposed" ? verifyAction(index, id) : null,
      });
    }
    return out;
  }, [run, index]);
  // A reference is only meaningful inside the history that issued it. Switching
  // worlds while a chain is open must not ask this index to explain a number
  // from another run, so the selection is validated before it is rendered.
  const activeSelected = selected !== null && index.event(selected) !== null ? selected : null;
  const packets = useMemo(() => transmissions(run), [run]);
  const horizon = run.spec.horizon;
  const playback = usePlayback(horizon);
  const frame = useMemo(() => frameAt(run, playback.time, packets), [run, playback.time, packets]);
  const { reset, play } = playback;

  useEffect(() => {
    reset();
    setSelected(null);
  }, [run, reset]);

  useEffect(() => {
    const node = section.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !autoplayed.current) {
          autoplayed.current = true;
          playback.play();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [play]);

  const canonical =
    world === "crash" &&
    params.timeoutMs === DEFAULT_PARAMS.timeoutMs &&
    params.latencyAMs === DEFAULT_PARAMS.latencyAMs &&
    params.latencyCMs === DEFAULT_PARAMS.latencyCMs &&
    params.crashMs === DEFAULT_PARAMS.crashMs &&
    params.dropPpm === DEFAULT_PARAMS.dropPpm &&
    params.intervalMs === DEFAULT_PARAMS.intervalMs;

  const crashedNode = run.spec.crash?.node ?? null;
  const crashed = crashedNode !== null && frame.truth[crashedNode] === "crashed";
  const watching = crashedNode ? frame.beliefs.filter((belief) => belief.target === crashedNode) : [];
  const gapBeliefs = watching.filter((belief) => belief.belief === "healthy");
  const showGap = crashed && gapBeliefs.length > 0;
  const allHealthy = watching.length > 0 && watching.every((belief) => belief.belief === "healthy");
  const notKnowing = showGap ? playback.time - (run.spec.crash?.at ?? 0) : 0;

  // The other half of the recovery story, and the one that is easy to get
  // wrong: the node is running again while an observer still distrusts it.
  const restartEvent = run.events.find((event) => event.kind === "node_restarted") ?? null;
  const restartedAt = restartEvent !== null && restartEvent.at <= playback.time ? restartEvent.at : null;
  const stillSuspect =
    crashedNode === null
      ? []
      : frame.beliefs.filter((view) => view.target === crashedNode && view.belief === "suspected");
  const showAfter = restartedAt !== null && stillSuspect.length > 0;

  const status = playback.playing ? "running" : playback.time >= horizon ? "ended" : "paused";

  const set = <K extends keyof LabParams>(key: K, value: LabParams[K]) =>
    setParams((current) => ({ ...current, [key]: value }));

  /**
   * Opens the chain behind a belief, using the last event that actually changed
   * it: a suspicion, a recovery, or the receipt that re-earned the trust. Any
   * earlier event would explain a belief the observer no longer holds.
   */
  const openBelief = (observer: string, target: string) => {
    const history = run.events.filter(
      (event) =>
        event.node === target &&
        event.peer === observer &&
        event.at <= playback.time &&
        (event.kind === "heartbeat_received" ||
          event.kind === "suspicion_raised" ||
          event.kind === "suspicion_cleared"),
    );
    const latest = history.at(-1);
    if (latest) setSelected(latest.seq);
  };

  return (
    <div className="lab" ref={section}>
      <div className="lab__bar">
        <span className="lab__title">
          <span className={`pill ${playback.playing ? "pill--live" : ""}`}>
            <span className="pill__dot" />
            {status}
          </span>
          {run.spec.name}
        </span>
        <div className="lab__worlds" role="group" aria-label="Which world to run">
          {WORLDS.map((candidate) => (
            <button
              key={candidate.id}
              aria-pressed={world === candidate.id}
              onClick={() => setWorld(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        <div className="lab__controls">
          <span className="lab__clock">{fmt(playback.time)}</span>
          <button
            className="btn btn--icon"
            aria-label="Previous event"
            onClick={() => {
              const previous = frame.events.at(-2);
              playback.seek(previous ? previous.at : 0);
            }}
          >
            ‹
          </button>
          <button
            className="btn btn--ghost"
            style={{ height: 34, padding: "0 16px", fontSize: 12 }}
            onClick={playback.toggle}
          >
            {playback.playing ? "Pause" : playback.time >= horizon ? "Replay" : "Play"}
          </button>
          <button
            className="btn btn--icon"
            aria-label="Next event"
            onClick={() => {
              const next = run.events.find((event) => event.at > playback.time);
              playback.seek(next ? next.at : horizon);
            }}
          >
            ›
          </button>
          <button className="btn btn--icon" aria-label="Reset" onClick={playback.reset}>
            ↺
          </button>
          <div className="lab__speed" role="group" aria-label="Playback speed">
            {[0.5, 1, 2, 4].map((value) => (
              <button
                key={value}
                aria-pressed={playback.speed === value}
                onClick={() => playback.setSpeed(value)}
              >
                {value}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lab__body">
        <div className="lab__stage">
          <Stage frame={frame} run={run} />

          {showGap && (
            <div className="gapbar">
              <span className="gapbar__tag">the gap</span>
              <span>
                {crashedNode} is <b>crashed</b>, and{" "}
                {allHealthy && watching.length > 1 ? (
                  <>both observers still call it <b>healthy</b>.</>
                ) : (
                  <>
                    {gapBeliefs.length} of {watching.length} still {gapBeliefs.length === 1 ? "calls" : "call"} it{" "}
                    <b>healthy</b>.
                  </>
                )}
              </span>
              <span className="gapbar__time">{fmt(notKnowing)} of not knowing</span>
            </div>
          )}

          {showAfter && (
            <div className="gapbar gapbar--after">
              <span className="gapbar__tag">after the restart</span>
              <span>
                {crashedNode} is <b>running</b> again, and {stillSuspect.map((view) => view.observer).join(" and ")}{" "}
                still call{stillSuspect.length === 1 ? "s" : ""} it <b>suspect</b>, until a message arrives.
              </span>
              <span className="gapbar__time">{fmt(playback.time - restartedAt)} since the action</span>
            </div>
          )}

          <div
            className={[
              "beliefs",
              frame.beliefs.length > 2 ? "beliefs--three" : "",
              frame.beliefs.length === 1 ? "beliefs--one" : "",
            ].join(" ")}
          >
            {frame.beliefs.map((view) => {
              const suspected = view.belief === "suspected";
              const remaining = view.deadline ? Math.max(0, view.deadline - playback.time) : 0;
              const fraction = suspected ? 1 : view.deadline ? remaining / view.timeout : 0;
              return (
                <button
                  key={`${view.observer}-${view.target}`}
                  type="button"
                  className={`belief belief--askable ${suspected ? "belief--alarm" : ""}`}
                  onClick={() => openBelief(view.observer, view.target)}
                  title="Open the chain behind this belief"
                >
                  <div className="belief__head">
                    <span className="belief__who">
                      {view.observer} watches {view.target} · {fmt(view.timeout)}
                    </span>
                    <span className="belief__state">
                      {suspected ? `suspects ${view.target}` : `trusts ${view.target}`}
                    </span>
                  </div>
                  <div className="belief__meter">
                    <div
                      className="belief__fill"
                      style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
                    />
                  </div>
                  <div className="belief__meta">
                    <span>
                      {view.heard === 0
                        ? `never heard ${view.target}`
                        : `last heard ${fmt(view.lastSeen)}`}
                    </span>
                    <span>
                      {suspected
                        ? `silent ${fmt(playback.time - view.lastSeen)}`
                        : `deadline in ${fmt(remaining)}`}
                    </span>
                  </div>
                  <span className="belief__why">why? →</span>
                </button>
              );
            })}
          </div>

          {decisions.length > 0 && (
            <DecisionTable rows={decisions.filter((row) => row.at <= playback.time)} onOpen={setSelected} />
          )}

          <Timeline
            horizon={horizon}
            time={playback.time}
            events={run.events}
            cut={run.spec.partitions[0] ? { at: run.spec.partitions[0].at, until: run.spec.partitions[0].until } : null}
            onSeek={playback.seek}
          />
        </div>

        <aside className="lab__side">
          <div className="lab__side-head">
            <span>event log</span>
            <span>{frame.events.length} / {run.events.length}</span>
          </div>
          <EventLog
            events={frame.events}
            latest={playback.time > 0 ? frame.lastEvent : null}
            remaining={run.events.length - frame.events.length}
            selected={activeSelected}
            onSelect={setSelected}
          />
          <div className="lab__outcome">
            {crashedNode !== null && (
              <span className="outcome">
                truth · {crashedNode} is {frame.truth[crashedNode]}
              </span>
            )}
            {run.reports.length === 0 && (
              <span className="outcome outcome--none">nobody ever suspects anyone</span>
            )}
            {run.reports.map((report) => (
              <span className="outcome" key={`${report.observer}-${report.suspectedAt}`}>
                {report.observer} suspects at {fmt(report.suspectedAt)} · silent {fmt(report.silence)}
              </span>
            ))}
          </div>
        </aside>
      </div>

      {activeSelected !== null && (
        <ChainPanel
          index={index}
          selected={activeSelected}
          crashSeq={crashSeq}
          repairSeq={repairSeq}
          restartSeq={restartSeq}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
        />
      )}

      <div className="params">
        <div className="params__head">
          <span>{WORLDS.find((candidate) => candidate.id === world)?.head ?? "change the world"}</span>
          <span className={`pill ${canonical || world !== "crash" ? "" : "pill--live"}`}>
            {world !== "crash" ? "go fixture" : canonical ? "canonical" : "custom"}
          </span>
          {world !== "crash" ? (
            <button onClick={() => setWorld("crash")}>back to the crash →</button>
          ) : (
            <button onClick={() => setParams(DEFAULT_PARAMS)}>reset to the go fixture</button>
          )}
        </div>
        {world === "partition" ? (
          <p className="params__note" style={{ paddingTop: 4 }}>
            Nobody crashes here. B→A is cut from <b>300 ms</b> to <b>900 ms</b>: A stops hearing B, while B keeps
            hearing A. A's belief returns at <b>920 ms</b>, when a message actually arrives — the repair at 900 ms
            explains nothing on its own, and its chain says so.
          </p>
        ) : world === "repair" ? (
          <p className="params__note" style={{ paddingTop: 4 }}>
            The same crash as the first world, and now something acts on it. {RECOVERY_POLICY.minWitnesses}{" "}
            witnesses, <b>{toMs(RECOVERY_POLICY.patience)} ms</b> of patience and{" "}
            <b>{toMs(RECOVERY_POLICY.delay)} ms</b> between deciding and acting: the gate grants at <b>620 ms</b>, B is
            back at <b>720 ms</b> on round three, and A still distrusts it until <b>840 ms</b>, when that round
            arrives. The recovery is not the news.
          </p>
        ) : world === "refusal" ? (
          <p className="params__note" style={{ paddingTop: 4 }}>
            Same crash, same policy, one observer: with C gone only A reports, so the gate refuses at <b>620 ms</b>{" "}
            with <b>insufficient_witnesses</b> and B stays down for the rest of the run. Nothing here restarts
            anything. Without this world, “two witnesses are required” would be an untested claim.
          </p>
        ) : showWorld ? (
          <>
            <div className="params__grid">
              <Param label="timeout" value={params.timeoutMs} display={`${params.timeoutMs} ms`} min={100} max={900} step={10} onChange={(value) => set("timeoutMs", value)} />
              <Param label="latency B→A" value={params.latencyAMs} display={`${params.latencyAMs} ms`} min={0} max={500} step={5} onChange={(value) => set("latencyAMs", value)} />
              <Param label="latency B→C" value={params.latencyCMs} display={`${params.latencyCMs} ms`} min={0} max={500} step={5} onChange={(value) => set("latencyCMs", value)} />
              <Param label="crash at" value={params.crashMs} display={`${params.crashMs} ms`} min={20} max={1150} step={5} onChange={(value) => set("crashMs", value)} />
              <Param label="heartbeat every" value={params.intervalMs} display={`${params.intervalMs} ms`} min={40} max={300} step={10} onChange={(value) => set("intervalMs", value)} />
              <Param label="loss" value={params.dropPpm} display={`${(params.dropPpm / 10000).toFixed(0)}%`} min={0} max={600000} step={10000} onChange={(value) => set("dropPpm", value)} />
            </div>
            <p className="params__note">
              {canonical
                ? "These are the exact numbers the Go program runs. The trace below is compared against its log, byte for byte."
                : "A custom world runs the same engine, but only the canonical numbers have a Go fixture to compare against."}
            </p>
          </>
        ) : (
          <div className="params__head" style={{ paddingTop: 0 }}>
            <button onClick={() => setShowWorld(true)}>open the controls →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stage({ frame, run }: { frame: ReturnType<typeof frameAt>; run: ReturnType<typeof runLab> }) {
  const role = (id: string): string => {
    const node = run.spec.nodes.find((candidate) => candidate.id === id);
    if (!node) return "";
    if (frame.truth[id] === "crashed") return "crashed";
    // A node can be both: B listens to nothing but is listened to, while in the
    // partition world A sends to B and is watched by B.
    const sends = node.heartbeatEvery > 0;
    const watched = run.spec.observers.some((observer) => observer.target === id);
    if (sends && watched) return "peer";
    return sends ? "sender" : "observer";
  };

  return (
    <div className="stage">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Three nodes with heartbeats in flight">
        <text className="svg-caption" x={8} y={16}>
          ground truth
        </text>
        <text className="svg-caption" x={WIDTH - 8} y={16} textAnchor="end">
          messages in flight
        </text>

        {run.spec.links.map((link) => {
          const from = POINT[link.from as keyof typeof POINT];
          const to = POINT[link.to as keyof typeof POINT];
          if (!from || !to) return null;
          return (
            <line
              key={`${link.from}-${link.to}`}
              className="svg-link"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          );
        })}

        {run.spec.links.map((link) => {
          const from = POINT[link.from as keyof typeof POINT];
          const to = POINT[link.to as keyof typeof POINT];
          if (!from || !to) return null;
          // Labels sit clear of the line they belong to, alternating sides so a
          // pair of directions is readable.
          const side = link.from < link.to ? -12 : 12;
          return (
            <text
              key={`${link.from}-${link.to}-latency`}
              className="svg-sub"
              x={(from.x + to.x) / 2 + side}
              y={(from.y + to.y) / 2 - 10}
              textAnchor="middle"
            >
              {link.from}→{link.to} {link.latency / 1_000_000} ms
            </text>
          );
        })}

        {run.spec.nodes.map((node) => {
          const id = node.id as keyof typeof POINT;
          if (!POINT[id]) return null;
          return (
            <Node key={node.id} id={id} crashed={frame.truth[node.id] === "crashed"} role={role(node.id)} />
          );
        })}

        {frame.active.map((packet) => {
          const from = POINT[packet.from as keyof typeof POINT];
          const to = POINT[packet.to as keyof typeof POINT];
          if (!from || !to) return null;
          if (packet.outcome === "dropped") {
            const spot = pointOn(from, to, 0.16);
            return (
              <g key={`${packet.round}-${packet.to}`} className="svg-packet--lost">
                <line x1={spot.x - 4} y1={spot.y - 4} x2={spot.x + 4} y2={spot.y + 4} />
                <line x1={spot.x - 4} y1={spot.y + 4} x2={spot.x + 4} y2={spot.y - 4} />
              </g>
            );
          }
          const spot = pointOn(from, to, packet.progress);
          return (
            <g key={`${packet.round}-${packet.to}`}>
              <circle className="svg-packet" cx={spot.x} cy={spot.y} r={3.4} />
              <text className="svg-round" x={spot.x + 8} y={spot.y + 3}>
                {packet.round}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Node({ id, crashed, role }: { id: "A" | "B" | "C"; crashed: boolean; role: string }) {
  const point = POINT[id];
  const radius = id === "B" ? 30 : 26;
  return (
    <g transform={`translate(${point.x} ${point.y})`}>
      <circle className={`svg-node ${crashed ? "svg-node--crashed" : ""}`} r={radius} />
      {id === "B" && !crashed && <circle r={radius + 6} fill="none" stroke="rgba(255,255,255,.08)" />}
      <text className="svg-label" textAnchor="middle" dy="4.5">
        {id}
      </text>
      <text className="svg-sub" textAnchor="middle" y={radius + 17}>
        {crashed ? "crashed" : role}
      </text>
    </g>
  );
}

/**
 * The decision, and the proof read back out of the log.
 *
 * `EVIDENCE` lists references, not observers: they are the report lines the
 * decision weighed, so `explain` prints exactly the branches that produced them.
 * `PROOF` is filled from `verifyAction` — the start cites the proposal, the
 * restart cites the start — and a grant whose chain is broken prints
 * "no complete chain" rather than pretending otherwise. A refusal has no proof
 * and needs none, because refusing is not carrying something out.
 */
function DecisionTable({ rows, onOpen }: { rows: DecisionView[]; onOpen: (ref: number) => void }) {
  return (
    <div className="decision">
      <div className="decision__head">
        <span>decision</span>
        <span>read back from the log</span>
      </div>
      {rows.map((row) => (
        <button
          key={row.ref}
          type="button"
          className="decision__row"
          onClick={() => onOpen(row.ref)}
          title="open the chain behind this decision"
        >
          <span className="decision__id">action {row.id}</span>
          <span className="decision__at">{fmt(row.at)}</span>
          <span className={`decision__outcome ${row.granted ? "" : "decision__outcome--refused"}`}>
            {row.granted ? `granted for ${row.target}` : `refused (${row.reason})`}
          </span>
          <span className="decision__evidence">evidence {row.evidence.join(" ")}</span>
          <span className="decision__proof">
            {row.proof?.complete
              ? `proposed ${row.proof.proof.proposed}, started ${row.proof.proof.started}, applied ${row.proof.proof.applied}`
              : "no complete chain"}
          </span>
        </button>
      ))}
    </div>
  );
}

function EventLog({
  events,
  latest,
  remaining,
  selected,
  onSelect,
}: {
  events: ReturnType<typeof frameAt>["events"];
  latest: ReturnType<typeof frameAt>["lastEvent"];
  remaining: number;
  selected: number | null;
  onSelect: (ref: number) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = box.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events.length]);

  return (
    <div className="log" ref={box}>
      {events.length === 0 && <div className="log__empty">press play to start the run</div>}
      {events.map((event) => {
        const isLatest = latest !== null && event.seq === latest.seq;
        return (
          <button
            key={event.seq}
            type="button"
            className={[
              "log__row",
              isLatest ? "log__row--latest" : "log__row--past",
              event.kind === "suspicion_raised" ? "log__row--raised" : "",
              event.kind === "recovery_proposed" ||
              event.kind === "recovery_refused" ||
              event.kind === "recovery_started" ||
              event.kind === "node_restarted"
                ? "log__row--decision"
                : "",
              selected === event.seq ? "log__row--open" : "",
            ].join(" ")}
            onClick={() => onSelect(event.seq)}
            title={`why did #${event.seq} happen?`}
          >
            <span className="log__seq">{event.seq}</span>
            <span className="log__time">{fmt(event.at)}</span>
            <span className="log__text">{describe(event)}</span>
          </button>
        );
      })}
      {remaining > 0 && <div className="log__empty">{remaining} more events to come</div>}
    </div>
  );
}

function Timeline({
  horizon,
  time,
  events,
  cut,
  onSeek,
}: {
  horizon: number;
  time: number;
  events: ReturnType<typeof frameAt>["events"];
  cut: { at: number; until: number } | null;
  onSeek: (value: number) => void;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const seekFrom = (clientX: number) => {
    const node = track.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * horizon);
  };

  const ticks = [];
  for (let value = 0; value <= toMs(horizon); value += 100) {
    ticks.push(value);
  }
  const sus = [...new Set(events.filter((e) => e.kind === "suspicion_raised").map((e) => e.at))];
  const restartEvent = events.find((e) => e.kind === "node_restarted");
  const suspicions =
    (sus.length > 0 ? `suspicion ${sus.map((at) => toMs(at)).join(" / ")} ms` : "no suspicion") +
    (restartEvent ? ` · restart ${toMs(restartEvent.at)} ms` : "");
  const crashEvent = events.find((e) => e.kind === "node_crashed");
  const turningPoint = crashEvent ? `crash ${toMs(crashEvent.at)} ms` : "";

  const seen = new Set<number>();
  const markers = events.filter((event) => {
    if (seen.has(event.at)) return false;
    seen.add(event.at);
    return true;
  });

  return (
    <div className="timeline">
      <div
        className="timeline__track"
        ref={track}
        role="slider"
        aria-label="Virtual time"
        aria-valuemin={0}
        aria-valuemax={toMs(horizon)}
        aria-valuenow={Math.round(toMs(time))}
        tabIndex={0}
        onPointerDown={(event) => {
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          seekFrom(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging) seekFrom(event.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") onSeek(time + 10_000_000);
          if (event.key === "ArrowLeft") onSeek(time - 10_000_000);
        }}
      >
        {ticks.map((value) => (
          <span
            key={value}
            className={`timeline__tick ${value % 500 === 0 ? "timeline__tick--major" : ""}`}
            style={{ left: `${(value / toMs(horizon)) * 100}%` }}
          />
        ))}
        {markers.map((event) => (
          <span
            key={event.seq}
            className={[
              "timeline__event",
              event.kind === "suspicion_raised" ? "timeline__event--raised" : "",
              event.kind === "recovery_proposed" ||
              event.kind === "recovery_refused" ||
              event.kind === "node_restarted"
                ? "timeline__event--decision"
                : "",
            ].join(" ")}
            style={{ left: `${(event.at / horizon) * 100}%` }}
            title={`${fmt(event.at)} · ${describe(event)}`}
          />
        ))}
        <span className="timeline__playhead" style={{ left: `${(time / horizon) * 100}%` }} />
      </div>
      <div className="timeline__labels">
        <span>0 ms</span>
        {cut ? (
          <span>
            cut {toMs(cut.at)}–{toMs(cut.until)} ms
          </span>
        ) : (
          <span>{turningPoint}</span>
        )}
        <span>{suspicions}</span>
        <span>{toMs(horizon)} ms</span>
      </div>
    </div>
  );
}

function Param({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="param">
      <span className="param__label">
        <span>{label}</span>
        <span className="param__value">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
