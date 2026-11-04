/**
 * The vocabulary of the failure lab.
 *
 * This is a direct port of `internal/domain` from the Go implementation. The
 * names and the rules are the same on purpose: the page does not illustrate a
 * simulation, it runs one, and the result is compared against the Go program's
 * own log in `scripts/parity.ts`.
 */

/**
 * The format a log written by this engine declares.
 *
 * It matches `domain.EventLogSchema` in the Go implementation and is written on
 * the opening event, so a file says which rules read it.
 */
export const EVENT_LOG_SCHEMA = "aegis.eventlog/v1";

/** A point on the virtual timeline, in nanoseconds. */
export type Tick = number;

export type NodeId = string;

/** Ground truth about a node. Only the simulator sets this. */
export type NodeState = "running" | "crashed";

/**
 * What one observer currently thinks about one target.
 *
 * This is not a node state: a crashed node can be believed healthy, and a
 * running node can be suspected. Keeping the two apart is the whole point.
 */
export type Belief = "healthy" | "suspected";

export type Kind =
  | "scenario_started"
  | "node_started"
  | "node_crashed"
  | "node_restarted"
  | "heartbeat_sent"
  | "message_dropped"
  | "heartbeat_received"
  | "link_partitioned"
  | "link_restored"
  | "suspicion_raised"
  | "suspicion_cleared"
  | "recovery_proposed"
  | "recovery_refused"
  | "recovery_started"
  | "scenario_finished";

/** The identifier a decision and the action it grants share. Starts at one. */
export type ActionId = number;

/** The closed vocabulary of things recovery can do to the world. One entry. */
export type ActionKind = "restart_node";

/** A granted decision, with the instant it takes effect. */
export interface Action {
  id: ActionId;
  kind: ActionKind;
  target: NodeId;
  at: Tick;
}

/**
 * One entry in the append-only history. Field order matches the Go struct so
 * the JSONL bytes can be compared directly.
 */
/**
 * A reference to a recorded event: its sequence number.
 *
 * References are how one event names another, so a cause is a number rather
 * than a copy. Copies drift; numbers cannot.
 */
export type Ref = number;

export interface Event {
  seq: number;
  at: Tick;
  kind: Kind;
  node?: NodeId;
  peer?: NodeId;
  round?: number;
  reason?: string;
  scenario?: string;
  /**
   * The format this history is written in, on the opening event and nowhere
   * else.
   *
   * One place rather than every line: a version repeated on each event is a
   * version that can disagree with itself, and a reader has no rule for which
   * line wins.
   */
  schema?: string;
  /** The recovery decision this event belongs to, on the four recovery kinds. */
  action?: ActionId;
  /**
   * The events that caused this one, in strictly increasing order.
   *
   * Written by whoever writes the event, not reconstructed afterwards: only the
   * writer knows which evidence it actually acted on.
   */
  causes?: Ref[];
}

export interface Observation {
  observer: NodeId;
  target: NodeId;
  belief: Belief;
  /** When the observer last received a message, or 0 if it never has. */
  lastSeen: Tick;
  /** When suspicion was raised, or 0 while healthy. */
  suspectedAt: Tick;
  heard: number;
}

/** The evidence an observer holds when it stops trusting a target. */
export interface FailureReport {
  observer: NodeId;
  target: NodeId;
  suspectedAt: Tick;
  lastSeenAt: Tick;
  timeout: Tick;
  silence: Tick;
}

export const REASON_HEARTBEAT_TIMEOUT = "heartbeat_timeout";
export const REASON_DROP_POLICY = "drop_policy";
export const REASON_DROP_PARTITION = "partition";
/** The evidence never reached the policy's threshold before its patience ran out. */
export const REASON_INSUFFICIENT_WITNESSES = "insufficient_witnesses";

/** Milliseconds to virtual nanoseconds. Exact, because 1ms = 1e6ns. */
export const ms = (value: number): Tick => Math.round(value * 1_000_000);

/** Virtual nanoseconds to milliseconds, for display only. */
export const toMs = (tick: Tick): number => tick / 1_000_000;
