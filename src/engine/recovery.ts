import {
  REASON_INSUFFICIENT_WITNESSES,
  type ActionKind,
  type FailureReport,
  type NodeId,
  type Ref,
  type Tick,
} from "./types";

/**
 * The bar an action has to clear, and nothing else.
 *
 * A port of `internal/recovery`. The three numbers answer three different
 * questions, and keeping them apart is the whole point of the type:
 *
 * - `minWitnesses`: how much evidence is enough. One observer that stopped
 *   hearing a node has proved only that it stopped hearing it.
 * - `patience`: how long to wait for corroboration before deciding with what it
 *   has. Without it, a threshold that is never reached waits forever and the run
 *   ends with no decision in the log.
 * - `delay`: how long between deciding and acting. Not decoration: it is the
 *   window in which the log shows the decision before the world changes.
 */
export interface Policy {
  kind: ActionKind;
  minWitnesses: number;
  patience: Tick;
  delay: Tick;
}

/** One observer's report together with the event that recorded it. */
export interface Witness {
  report: FailureReport;
  ref: Ref;
}

/**
 * What the gate concluded about one target.
 *
 * A refusal carries a reason and a grant does not, and both carry the references
 * that were weighed. That asymmetry is deliberate: "we acted" needs no excuse,
 * while "we did nothing" needs one.
 */
export interface Decision {
  granted: boolean;
  target: NodeId;
  witnesses: Ref[];
  reason: string;
}

export function validatePolicy(policy: Policy): void {
  if (policy.kind !== "restart_node") {
    throw new Error(`invalid recovery policy: unknown action kind ${policy.kind}`);
  }
  if (!Number.isInteger(policy.minWitnesses) || policy.minWitnesses < 1) {
    throw new Error(`invalid recovery policy: ${policy.minWitnesses} witnesses is not a threshold`);
  }
  if (policy.patience < 0) {
    throw new Error(`invalid recovery policy: patience ${policy.patience} is negative`);
  }
  if (policy.delay < 0) {
    throw new Error(`invalid recovery policy: delay ${policy.delay} is negative`);
  }
}

/**
 * Reads a set of reports and returns a decision.
 *
 * It holds no state and reads no clock. Given the same witnesses and the same
 * policy it always returns the same decision, which is what makes a run
 * replayable and a decision reviewable after the fact.
 *
 * A decision is not an action: a grant says the evidence is sufficient, and
 * something else has to carry it out. That separation is what lets a run record
 * the decision before the world changes.
 */
export class Gate {
  readonly policy: Policy;

  constructor(policy: Policy) {
    validatePolicy(policy);
    this.policy = policy;
  }

  decide(witnesses: readonly Witness[]): Decision {
    if (witnesses.length === 0) {
      throw new Error("a decision requires at least one witness");
    }

    const refs: Ref[] = [];
    const seen = new Set<NodeId>();
    let target: NodeId | null = null;

    witnesses.forEach((witness, i) => {
      if (witness.ref <= 0) {
        throw new Error(`witness ${i + 1}: reference is zero`);
      }
      if (target === null) {
        target = witness.report.target;
      } else if (witness.report.target !== target) {
        throw new Error(`witnesses name different targets: ${target} and ${witness.report.target}`);
      }
      // One observer, one vote. A node that grows suspicious, recovers and grows
      // suspicious again has proved its own silence twice, not somebody else's
      // failure.
      if (seen.has(witness.report.observer)) {
        throw new Error(
          `one observer cannot witness twice: ${witness.report.observer} reported on ${target} more than once`,
        );
      }
      seen.add(witness.report.observer);
      refs.push(witness.ref);
    });

    // The recorder refuses a cause list that is not strictly increasing, so the
    // gate hands back a canonical one rather than leaving each caller to sort.
    refs.sort((a, b) => a - b);

    const decision: Decision = {
      granted: refs.length >= this.policy.minWitnesses,
      target: target ?? "",
      witnesses: refs,
      reason: refs.length >= this.policy.minWitnesses ? "" : REASON_INSUFFICIENT_WITNESSES,
    };
    validateDecision(decision);
    return decision;
  }
}

export function validateDecision(decision: Decision): void {
  if (!decision.target) {
    throw new Error("invalid recovery decision: no target");
  }
  if (decision.witnesses.length === 0) {
    throw new Error("invalid recovery decision: no evidence");
  }
  let previous = 0;
  for (const ref of decision.witnesses) {
    if (ref <= 0) throw new Error("invalid recovery decision: a witness is the zero reference");
    if (ref <= previous) {
      throw new Error(`invalid recovery decision: witnesses ${decision.witnesses.join(",")} are not increasing`);
    }
    previous = ref;
  }
  if (decision.granted && decision.reason !== "") {
    throw new Error("invalid recovery decision: a grant carries no reason");
  }
  if (!decision.granted && decision.reason === "") {
    throw new Error("invalid recovery decision: a refusal must say why");
  }
}

/** One line, for a table or a test failure. */
export function describeDecision(decision: Decision): string {
  if (decision.granted) {
    return `granted for ${decision.target} on ${decision.witnesses.length} witnesses`;
  }
  return `refused for ${decision.target} on ${decision.witnesses.length} witnesses: ${decision.reason}`;
}
