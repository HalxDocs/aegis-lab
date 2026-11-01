import type { ActionId, Event, Kind, NodeId, Ref, Tick } from "./types";

export interface EventInput {
  at: Tick;
  kind: Kind;
  node?: NodeId;
  peer?: NodeId;
  round?: number;
  reason?: string;
  scenario?: string;
  /** The decision this event belongs to, on the recovery kinds. */
  action?: ActionId;
  /** Events that caused this one. Must already be in the log. */
  causes?: Ref[];
}

/**
 * The append-only history.
 *
 * It assigns every sequence number itself, exactly like the Go recorder, so no
 * caller can renumber or reorder the log. It returns the reference it assigned,
 * which is what lets a caller cite its own write as somebody else's cause.
 *
 * Causes are checked here rather than when the graph is read. A log that can be
 * written with a forward reference is a log whose explanations depend on when
 * you look at them.
 */
export class Recorder {
  readonly events: Event[] = [];

  record(input: EventInput): Ref {
    const seq = this.events.length + 1;
    const causes = input.causes === undefined ? undefined : [...input.causes];

    if (causes !== undefined) {
      if (causes.length === 0) {
        throw new Error(`event ${seq}: causes must be omitted, not empty`);
      }
      if (input.kind === "scenario_started") {
        throw new Error("scenario_started cannot cite a cause: it opens the history");
      }
      let previous = 0;
      for (const cause of causes) {
        if (!Number.isInteger(cause) || cause <= 0) {
          throw new Error(`event ${seq}: cause ${cause} is not a reference`);
        }
        if (cause <= previous) {
          throw new Error(`event ${seq}: causes ${causes.join(",")} are not strictly increasing`);
        }
        previous = cause;
        if (cause >= seq) {
          throw new Error(`event ${seq} cites ${cause}, which has not been recorded yet`);
        }
        const target = this.events[cause - 1];
        if (!target) {
          throw new Error(`event ${seq} cites ${cause}, which is not in the history`);
        }
        if (target.at > input.at) {
          throw new Error(
            `event ${seq} at ${input.at} cites ${target.kind} at ${target.at}, which happens later`,
          );
        }
      }
    }

    const event: Event = {
      seq,
      at: input.at,
      kind: input.kind,
    };
    if (input.node !== undefined) event.node = input.node;
    if (input.peer !== undefined) event.peer = input.peer;
    if (input.round !== undefined && input.round !== 0) event.round = input.round;
    if (input.reason !== undefined && input.reason !== "") event.reason = input.reason;
    if (input.scenario !== undefined && input.scenario !== "") event.scenario = input.scenario;
    if (input.action !== undefined && input.action !== 0) event.action = input.action;
    if (causes !== undefined) event.causes = causes;
    this.events.push(event);
    return seq;
  }

  /** The most recently recorded event, or null before the run opens. */
  last(): Event | null {
    return this.events.at(-1) ?? null;
  }
}

/**
 * Serializes one event exactly as Go's encoding/json does for the struct:
 * struct order, omitted empty fields, no whitespace.
 */
export function serializeEvent(event: Event): string {
  return JSON.stringify(event);
}

/** The canonical JSONL rendering of a run. */
export function toJsonl(events: readonly Event[]): string {
  return events.map(serializeEvent).join("\n") + (events.length > 0 ? "\n" : "");
}
