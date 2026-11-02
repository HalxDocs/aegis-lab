import type { RunResult } from "./scenario";
import type { Belief, Event, FailureReport, NodeId, NodeState, Tick } from "./types";

export type Outcome = "received" | "dropped" | "inflight";

export interface Transmission {
  from: NodeId;
  to: NodeId;
  round: number;
  sentAt: Tick;
  arrivesAt: Tick;
  outcome: Outcome;
}

export interface BeliefView {
  observer: NodeId;
  target: NodeId;
  belief: Belief;
  lastSeen: Tick;
  suspectedAt: Tick;
  heard: number;
  deadline: Tick | null;
  timeout: Tick;
}

export interface ActiveTransmission extends Transmission {
  /** 0 at the sender, 1 at the receiver. */
  progress: number;
}

export interface Frame {
  at: Tick;
  truth: Record<NodeId, NodeState>;
  beliefs: BeliefView[];
  reports: FailureReport[];
  events: Event[];
  active: ActiveTransmission[];
  lastEvent: Event | null;
}

const keyOf = (round: number, from: NodeId, to: NodeId): string => `${round}|${from}|${to}`;

/**
 * Pairs every sent heartbeat with what happened to it.
 *
 * The pairing is derived from the log, not from a second simulation, so what
 * the page draws is the same evidence the engine recorded.
 */
export function transmissions(run: RunResult): Transmission[] {
  const byKey = new Map<string, Transmission>();
  const ordered: Transmission[] = [];

  for (const event of run.events) {
    if (event.kind === "heartbeat_sent") {
      const latency =
        run.spec.links.find((link) => link.from === event.node && link.to === event.peer)?.latency ?? 0;
      const transmission: Transmission = {
        from: event.node ?? "",
        to: event.peer ?? "",
        round: event.round ?? 0,
        sentAt: event.at,
        arrivesAt: event.at + latency,
        outcome: "inflight",
      };
      byKey.set(keyOf(transmission.round, transmission.from, transmission.to), transmission);
      ordered.push(transmission);
    } else if (event.kind === "heartbeat_received" || event.kind === "message_dropped") {
      const transmission = byKey.get(keyOf(event.round ?? 0, event.node ?? "", event.peer ?? ""));
      if (!transmission) continue;
      if (event.kind === "heartbeat_received") {
        transmission.outcome = "received";
        transmission.arrivesAt = event.at;
      } else {
        transmission.outcome = "dropped";
        transmission.arrivesAt = event.at;
      }
    }
  }

  return ordered;
}

/** Folds the log up to an instant into truth, belief, reports and live packets. */
export function frameAt(run: RunResult, at: Tick, all?: Transmission[]): Frame {
  const truth: Record<NodeId, NodeState> = {};
  for (const node of run.spec.nodes) truth[node.id] = "running";

  const beliefs: BeliefView[] = run.spec.observers.map((observer) => ({
    observer: observer.observer,
    target: observer.target,
    belief: "healthy",
    lastSeen: 0,
    suspectedAt: 0,
    heard: 0,
    deadline: observer.timeout,
    timeout: observer.timeout,
  }));

  const reports: FailureReport[] = [];
  const events: Event[] = [];
  let lastEvent: Event | null = null;

  for (const event of run.events) {
    if (event.at > at) break;
    events.push(event);

    if (event.kind === "node_crashed" && event.node) {
      truth[event.node] = "crashed";
    } else if (event.kind === "node_restarted" && event.node) {
      // The only way out of crashed, and only on behalf of a granted action.
      truth[event.node] = "running";
    } else if (event.kind === "heartbeat_received") {
      const view = beliefs.find((b) => b.observer === event.peer && b.target === event.node);
      if (view) {
        view.belief = "healthy";
        view.suspectedAt = 0;
        view.lastSeen = event.at;
        view.heard += 1;
        view.deadline = event.at + view.timeout;
      }
    } else if (event.kind === "suspicion_raised") {
      const view = beliefs.find((b) => b.observer === event.peer && b.target === event.node);
      if (view) {
        view.belief = "suspected";
        view.suspectedAt = event.at;
        view.deadline = null;
        reports.push({
          observer: view.observer,
          target: view.target,
          suspectedAt: event.at,
          lastSeenAt: view.lastSeen,
          timeout: view.timeout,
          silence: event.at - view.lastSeen,
        });
      }
    } else if (event.kind === "suspicion_cleared") {
      const view = beliefs.find((b) => b.observer === event.peer && b.target === event.node);
      if (view) {
        view.belief = "healthy";
        view.suspectedAt = 0;
        view.deadline = event.at + view.timeout;
      }
    }

    lastEvent = event;
  }

  const active: ActiveTransmission[] = [];
  for (const transmission of all ?? transmissions(run)) {
    if (transmission.sentAt > at) continue;
    if (transmission.outcome === "received") {
      if (at >= transmission.arrivesAt) continue;
    } else if (transmission.outcome === "inflight") {
      if (at >= transmission.arrivesAt) continue;
    } else if (transmission.outcome === "dropped") {
      // A lost message is drawn for a moment at the sender, then gone.
      if (at - transmission.sentAt > run.params.intervalMs / 2) continue;
    }
    const span = Math.max(1, transmission.arrivesAt - transmission.sentAt);
    active.push({
      ...transmission,
      progress: Math.min(1, Math.max(0, (at - transmission.sentAt) / span)),
    });
  }

  return { at, truth, beliefs, reports, events, active, lastEvent };
}

/** Formats a tick for display: 1200000000 → "1200 ms". */
export function fmt(tick: Tick): string {
  const value = tick / 1_000_000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ms`;
}

/** A one-line, plain-English description of an event. */
export function describe(event: Event): string {
  switch (event.kind) {
    case "scenario_started":
      return `run starts: ${event.scenario}`;
    case "scenario_finished":
      return `run ends: ${event.scenario}`;
    case "node_started":
      return `${event.node} starts`;
    case "node_crashed":
      return `${event.node} crashes (truth changes)`;
    case "node_restarted":
      return `${event.node} restarted (truth changes)`;
    case "recovery_proposed":
      return `action ${event.action} granted for ${event.node}`;
    case "recovery_refused":
      return `action ${event.action} refused for ${event.node} (${event.reason})`;
    case "recovery_started":
      return `action ${event.action} carried out on ${event.node}`;
    case "heartbeat_sent":
      return `${event.node} sends round ${event.round} to ${event.peer}`;
    case "heartbeat_received":
      return `${event.peer} hears round ${event.round} from ${event.node}`;
    case "message_dropped":
      return event.reason === "partition"
        ? `round ${event.round} from ${event.node} to ${event.peer} is lost in the cut`
        : `round ${event.round} from ${event.node} to ${event.peer} is lost`;
    case "link_partitioned":
      return `${event.node}→${event.peer} path cut (one way)`;
    case "link_restored":
      return `${event.node}→${event.peer} path restored`;
    case "suspicion_raised":
      return `${event.peer} stops trusting ${event.node}`;
    case "suspicion_cleared":
      return `${event.peer} trusts ${event.node} again`;
    default:
      return event.kind;
  }
}
