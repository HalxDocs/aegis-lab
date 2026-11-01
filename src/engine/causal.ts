import type { Event, Ref } from "./types";

/**
 * The history read as a graph of reasons.
 *
 * A port of `internal/causal`. It imports nothing but the vocabulary, so an
 * explanation here is made of exactly what the log contains — no simulator, no
 * ground truth, no second guess about what "must have" happened.
 *
 * Every cause points backwards, so a walk always terminates at the root and a
 * cycle cannot exist. That is a consequence of the recorder's rule, not a
 * property this class checks: a forward reference is refused at write time.
 */
export class CausalIndex {
  private readonly events = new Map<Ref, Event>();
  private readonly order: Ref[] = [];
  private readonly children = new Map<Ref, Ref[]>();
  private readonly rootRef: Ref;

  constructor(events: readonly Event[]) {
    if (events.length === 0) throw new Error("history is empty");

    events.forEach((event, i) => {
      if (event.seq !== i + 1) {
        throw new Error(
          `history is not numbered from one without gaps: position ${i + 1} holds ${event.seq}`,
        );
      }
      this.events.set(event.seq, event);
      this.order.push(event.seq);
    });

    this.rootRef = this.order[0];
    if (this.events.get(this.rootRef)?.kind !== "scenario_started") {
      throw new Error("history does not open with scenario_started");
    }

    for (const ref of this.order.slice(1)) {
      const event = this.events.get(ref);
      if (!event) continue;
      if (!event.causes || event.causes.length === 0) {
        throw new Error(`event cites no cause: ${event.kind} at ${event.at}`);
      }
      let previous = 0;
      for (const cause of event.causes) {
        if (cause <= previous) {
          throw new Error(`causes are not in increasing order: ${event.kind} cites ${event.causes}`);
        }
        previous = cause;
        const target = this.events.get(cause);
        if (!target) throw new Error(`cause names an event outside the history: ${event.kind} cites ${cause}`);
        if (cause >= ref) throw new Error(`cause is not recorded before its effect: ${event.kind} cites ${cause}`);
        if (target.at > event.at) {
          throw new Error(`cause happens after its effect: ${event.kind} at ${event.at} cites ${target.kind}`);
        }
        const list = this.children.get(cause) ?? [];
        list.push(ref);
        this.children.set(cause, list);
      }
    }
  }

  get root(): Ref {
    return this.rootRef;
  }

  get length(): number {
    return this.order.length;
  }

  event(ref: Ref): Event | null {
    return this.events.get(ref) ?? null;
  }

  /** Every event `ref` descends from, in increasing order. */
  ancestors(ref: Ref): Ref[] {
    this.require(ref);
    const seen = new Set<Ref>();
    const walk = (at: Ref) => {
      for (const cause of this.events.get(at)?.causes ?? []) {
        if (seen.has(cause)) continue;
        seen.add(cause);
        walk(cause);
      }
    };
    walk(ref);
    return [...seen].sort((a, b) => a - b);
  }

  /** Every event that cites `ref`, directly or through others. */
  descendants(ref: Ref): Ref[] {
    this.require(ref);
    const seen = new Set<Ref>();
    const walk = (at: Ref) => {
      for (const child of this.children.get(at) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        walk(child);
      }
    };
    walk(ref);
    return [...seen].sort((a, b) => a - b);
  }

  /** Whether `ancestor` is one of the events `ref` rests on. */
  hasAncestor(ref: Ref, ancestor: Ref): boolean {
    return this.ancestors(ref).includes(ancestor);
  }

  /** Walks backwards from `ref` and returns the whole chain of reasons. */
  explain(ref: Ref): Explanation {
    const event = this.events.get(ref);
    if (!event) throw new Error(`no such event in the history: ${ref}`);
    return { event, causes: (event.causes ?? []).map((cause) => this.explain(cause)) };
  }

  private require(ref: Ref): void {
    if (!this.events.has(ref)) throw new Error(`no such event in the history: ${ref}`);
  }
}

/** One event together with the explanations of its causes. */
export interface Explanation {
  event: Event;
  causes: Explanation[];
}

/** The number of edges on the longest path back to the root. */
export function depthOf(explanation: Explanation): number {
  let depth = 0;
  for (const cause of explanation.causes) depth = Math.max(depth, depthOf(cause) + 1);
  return depth;
}

/** How many events an explanation is made of, including its own. */
export function countOf(explanation: Explanation): number {
  return 1 + explanation.causes.reduce((total, cause) => total + countOf(cause), 0);
}

/**
 * Flattens a chain into rows for rendering: the event first, then each cause
 * indented under the row it explains.
 */
export interface ChainRow {
  explanation: Explanation;
  level: number;
}

export function chainRows(explanation: Explanation, level = 0): ChainRow[] {
  const rows: ChainRow[] = [{ explanation, level }];
  for (const cause of explanation.causes) rows.push(...chainRows(cause, level + 1));
  return rows;
}
