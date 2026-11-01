import type { CausalIndex } from "./causal";
import type { ActionId, Ref } from "./types";

/**
 * Answers "was this action carried out" by walking the finished log.
 *
 * A port of `internal/verify`. Verification here is a query, not a stage:
 * nothing is written when an action succeeds, because a `recovery_verified`
 * event would be a claim by the same run that performed the action. The proof is
 * already in the history — the action was proposed citing its evidence, started
 * citing the proposal, and followed by a restart citing the start.
 *
 * The search is by identifier and by edge, never by timestamp: three events in
 * one millisecond is normal, and an action is proved by which event cites which.
 */
export interface Proof {
  action: ActionId;
  /** Cites the evidence. */
  proposed: Ref;
  /** Carries the action out. */
  started: Ref;
  /** The change in ground truth that followed. */
  applied: Ref;
}

export interface Verdict {
  proof: Proof;
  /** Whether the chain reaches the restart. A partial chain is not a proof. */
  complete: boolean;
}

export function verifyAction(index: CausalIndex, id: ActionId): Verdict {
  const proposed = find(index, (event) => event.kind === "recovery_proposed" && event.action === id);
  if (proposed === null) return { proof: { action: id, proposed: 0, started: 0, applied: 0 }, complete: false };

  const started = find(
    index,
    (event) => event.kind === "recovery_started" && event.action === id && cites(event, proposed),
  );
  if (started === null) {
    return { proof: { action: id, proposed, started: 0, applied: 0 }, complete: false };
  }

  const applied = find(
    index,
    (event) => event.kind === "node_restarted" && cites(event, started),
  );
  if (applied === null) {
    return { proof: { action: id, proposed, started, applied: 0 }, complete: false };
  }
  return { proof: { action: id, proposed, started, applied }, complete: true };
}

/** Every action a history proposes, in the order the proposals were recorded. */
export function verifyActions(index: CausalIndex): Verdict[] {
  const out: Verdict[] = [];
  const seen = new Set<ActionId>();
  for (let seq = 1; seq <= index.length; seq += 1) {
    const event = index.event(seq);
    if (!event || event.kind !== "recovery_proposed" || event.action === undefined) continue;
    if (seen.has(event.action)) continue;
    seen.add(event.action);
    out.push(verifyAction(index, event.action));
  }
  return out;
}

function find(index: CausalIndex, match: (event: NonNullable<ReturnType<CausalIndex["event"]>>) => boolean): Ref | null {
  for (let seq = 1; seq <= index.length; seq += 1) {
    const event = index.event(seq);
    if (event && match(event)) return seq;
  }
  return null;
}

function cites(event: { causes?: Ref[] }, ref: Ref): boolean {
  return (event.causes ?? []).includes(ref);
}
