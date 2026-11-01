import { Detector } from "./detector";
import { Engine } from "./engine";
import type { LinkConfig } from "./network";
import type { NodeConfig } from "./nodes";
import { Gate, type Decision, type Policy, type Witness } from "./recovery";
import type { Action, Event, FailureReport, NodeId, Ref, Tick } from "./types";
import { ms } from "./types";

export interface LabParams {
  /** Heartbeat interval, in milliseconds. */
  intervalMs: number;
  /** Link latency B → A, in milliseconds. */
  latencyAMs: number;
  /** Link latency B → C, in milliseconds. */
  latencyCMs: number;
  /** How long each observer waits before it stops trusting B. */
  timeoutMs: number;
  /** When B crashes, in milliseconds. */
  crashMs: number;
  /** Loss, in parts per million, applied to both links. */
  dropPpm: number;
  /** When the run stops. */
  horizonMs: number;
}

/** The Milestone 1 fixture, exactly as it exists in the Go scenario. */
export const DEFAULT_PARAMS: LabParams = {
  intervalMs: 100,
  latencyAMs: 20,
  latencyCMs: 25,
  timeoutMs: 350,
  crashMs: 215,
  dropPpm: 0,
  horizonMs: 1200,
};

export interface ObserverSpec {
  observer: NodeId;
  target: NodeId;
  timeout: Tick;
}

export interface PartitionSpec {
  from: NodeId;
  to: NodeId;
  at: Tick;
  until: Tick;
}

export interface RecoverySpec {
  policy: Policy;
}

export interface ScenarioSpec {
  name: string;
  nodes: NodeConfig[];
  links: LinkConfig[];
  observers: ObserverSpec[];
  crash: { node: NodeId; at: Tick } | null;
  partitions: PartitionSpec[];
  horizon: Tick;
  /** Null in a world that only observes: no policy, no recovery machinery. */
  recovery: RecoverySpec | null;
}

export interface RunResult {
  events: Event[];
  reports: FailureReport[];
  /**
   * What the loop decided, kept beside the log rather than derived from it: the
   * log is what a later reader has, and these are what this run believes it
   * wrote, so the page can compare the two.
   */
  decisions: Decision[];
  actions: Action[];
  spec: ScenarioSpec;
  params: LabParams;
}

/**
 * The canonical world as data. Changing a parameter changes the world; nothing
 * about the engine changes.
 */
export function buildScenario(params: LabParams): ScenarioSpec {
  return {
    name: "node-crash",
    nodes: [
      { id: "A", heartbeatEvery: 0, peers: [] },
      { id: "B", heartbeatEvery: ms(params.intervalMs), peers: ["A", "C"] },
      { id: "C", heartbeatEvery: 0, peers: [] },
    ],
    links: [
      { from: "B", to: "A", latency: ms(params.latencyAMs), dropPpm: params.dropPpm },
      { from: "B", to: "C", latency: ms(params.latencyCMs), dropPpm: params.dropPpm },
    ],
    observers: [
      { observer: "A", target: "B", timeout: ms(params.timeoutMs) },
      { observer: "C", target: "B", timeout: ms(params.timeoutMs) },
    ],
    crash: params.crashMs < params.horizonMs ? { node: "B", at: ms(params.crashMs) } : null,
    partitions: [],
    horizon: ms(params.horizonMs),
    recovery: null,
  };
}

/**
 * The Milestone 2 world, exactly as `scenario.OneWayPartition` defines it.
 *
 * Nobody crashes. Instead the road from B to A is cut for 600 ms, so A stops
 * hearing B while B keeps hearing A. The repair at 900 ms changes nothing on
 * its own: A trusts B again at 920 ms, when a message arrives.
 */
export const PARTITION_PARAMS: LabParams = {
  intervalMs: 100,
  latencyAMs: 20,
  latencyCMs: 25,
  timeoutMs: 350,
  crashMs: 0,
  dropPpm: 0,
  horizonMs: 1150,
};

export function buildPartitionScenario(): ScenarioSpec {
  return {
    name: "one-way-partition",
    nodes: [
      { id: "A", heartbeatEvery: ms(100), peers: ["B"] },
      { id: "B", heartbeatEvery: ms(100), peers: ["A", "C"] },
      { id: "C", heartbeatEvery: 0, peers: [] },
    ],
    links: [
      { from: "A", to: "B", latency: ms(20), dropPpm: 0 },
      { from: "B", to: "A", latency: ms(20), dropPpm: 0 },
      { from: "B", to: "C", latency: ms(25), dropPpm: 0 },
    ],
    observers: [
      { observer: "A", target: "B", timeout: ms(350) },
      { observer: "B", target: "A", timeout: ms(350) },
      { observer: "C", target: "B", timeout: ms(350) },
    ],
    crash: null,
    partitions: [{ from: "B", to: "A", at: ms(300), until: ms(900) }],
    horizon: ms(1150),
    recovery: null,
  };
}

/**
 * Builds the world, runs it to the horizon and returns the history together
 * with the evidence each observer produced.
 *
 * The order of operations is the same as `internal/scenario/run.go`: nothing is
 * recorded until the whole world is configured, so a configuration error can
 * never leave a half-written log.
 */
/** The evidence gathered about one target between the first report and its review. */
interface RecoveryCase {
  target: NodeId;
  witnesses: Witness[];
  closed: boolean;
}

/**
 * Turns failure reports into decisions and carries out the ones that are granted.
 *
 * A port of `internal/scenario/recovery.go`. It holds the only stateful part of
 * recovery: which cases are open. What counts as enough evidence belongs to the
 * policy and the gate, which are pure.
 *
 * A case is opened by a report and closed by its review, exactly once. Reports
 * that arrive after the review open a new case: evidence cannot be added to a
 * decision that has already been made, or the log would show a decision
 * supported by events later in the file than the decision itself.
 */
class RecoveryLoop {
  readonly decisions: Decision[] = [];
  readonly actions: Action[] = [];

  private readonly gate: Gate;
  private readonly policy: Policy;
  private readonly sched: Engine["sched"];
  private readonly recorder: Engine["recorder"];
  private readonly world: (action: Action, cause: Ref) => void;
  private readonly cases = new Map<NodeId, RecoveryCase>();
  private nextId = 0;

  constructor(spec: RecoverySpec, engine: Engine) {
    this.gate = new Gate(spec.policy);
    this.policy = spec.policy;
    this.sched = engine.sched;
    this.recorder = engine.recorder;
    this.world = (action, cause) => engine.restart(action, cause);
  }

  reportFailed(report: FailureReport, ref: Ref): void {
    let current = this.cases.get(report.target);
    if (current?.closed) current = undefined;

    if (!current) {
      const opened: RecoveryCase = { target: report.target, witnesses: [], closed: false };
      this.cases.set(opened.target, opened);
      current = opened;
      // The review is armed from the report's own suspicion instant rather than
      // from the clock, so patience is measured against the evidence instead of
      // against whenever the loop happened to run.
      const at = report.suspectedAt + this.policy.patience;
      this.sched.at(at, () => this.decide(opened, at));
    }
    current.witnesses.push({ report, ref });
  }

  /**
   * Weighs the case's evidence and writes the outcome.
   *
   * Both outcomes are written at the instant of the review, before anything
   * happens to the world. A refusal is therefore as reviewable as a grant: it
   * names the witnesses it declined to act on and the reason it declined.
   */
  private decide(current: RecoveryCase, at: Tick): void {
    current.closed = true;

    const decision = this.gate.decide(current.witnesses);
    const id = ++this.nextId;
    this.decisions.push(decision);

    if (!decision.granted) {
      this.recorder.record({
        at,
        kind: "recovery_refused",
        node: current.target,
        reason: decision.reason,
        action: id,
        causes: decision.witnesses,
      });
      return;
    }

    const proposed = this.recorder.record({
      at,
      kind: "recovery_proposed",
      node: current.target,
      action: id,
      causes: decision.witnesses,
    });
    const action: Action = {
      id,
      kind: this.policy.kind,
      target: current.target,
      at: at + this.policy.delay,
    };
    this.actions.push(action);
    this.world(action, proposed);
  }
}

export function runScenario(
  spec: ScenarioSpec,
  seed = 0,
): { events: Event[]; reports: FailureReport[]; decisions: Decision[]; actions: Action[] } {
  const engine = new Engine(seed);

  for (const node of spec.nodes) engine.addNode(node);
  for (const link of spec.links) engine.addLink(link);
  // Cuts are scheduled before the history opens, so a rejected cut cannot
  // leave a half-written log behind.
  for (const cut of spec.partitions) engine.cutAt(cut.from, cut.to, cut.at, cut.until);

  // The history opens only once the whole world is configured, so a
  // configuration error cannot leave a half-written log behind.
  const root = engine.open(spec.name);

  // The loop is built before the observers because a report has to be handed on
  // the instant it is written, not collected afterwards.
  const loop = spec.recovery ? new RecoveryLoop(spec.recovery, engine) : null;

  // Observers are built after it because their first deadline is armed by the
  // scenario and cites the opening event as its cause.
  const detectors: Detector[] = [];
  for (const observer of spec.observers) {
    const detector = new Detector({
      observer: observer.observer,
      timeout: observer.timeout,
      scheduler: engine.sched,
      recorder: engine.recorder,
      root,
      failures: loop ? (report, ref) => loop.reportFailed(report, ref) : undefined,
    });
    detector.watch(observer.target);
    engine.addReceiver(detector);
    detectors.push(detector);
  }

  engine.start();
  if (spec.crash) engine.crashAt(spec.crash.at, spec.crash.node);
  engine.run(spec.horizon);
  engine.close(spec.name);

  return {
    events: engine.recorder.events,
    reports: detectors.flatMap((detector) => detector.reports),
    decisions: loop?.decisions ?? [],
    actions: loop?.actions ?? [],
  };
}

export function runLab(params: LabParams, seed = 0): RunResult {
  const spec = buildScenario(params);
  return { ...runScenario(spec, seed), spec, params };
}

/** Runs the partition world; it has no controls of its own, by design. */
export function runPartition(seed = 0): RunResult {
  const spec = buildPartitionScenario();
  return { ...runScenario(spec, seed), spec, params: PARTITION_PARAMS };
}

/**
 * Two witnesses, 50 ms of patience, 100 ms between deciding and acting.
 *
 * The policy is data and the only configuration recovery has. There is no
 * switch for "act" versus "only decide": a run that could be told to skip the
 * gate would be a run whose log cannot be compared with one that used it.
 */
export const RECOVERY_POLICY: Policy = {
  kind: "restart_node",
  minWitnesses: 2,
  patience: ms(50),
  delay: ms(100),
};

/**
 * The canonical recovery world, exactly as `scenario.RecoveredCrash` defines it.
 *
 * The same crash as the first milestone with a loop allowed to act on the
 * reports: A and C both stop trusting B at 570/575 ms, the gate reviews at
 * 620 ms, the action lands at 720 ms, and B's resumed round 3 at 820 ms is what
 * clears the belief at 840 ms — not the restart.
 */
export function buildRecoveredCrashScenario(): ScenarioSpec {
  return {
    ...buildScenario(DEFAULT_PARAMS),
    name: "recovered-crash",
    horizon: ms(1200),
    recovery: { policy: RECOVERY_POLICY },
  };
}

/**
 * The refusal world, exactly as `scenario.LoneWitness` defines it.
 *
 * The crash and the policy are unchanged; only the world is smaller. With C
 * gone, A is the single node that ever reports and the policy wants two, so the
 * gate refuses at 620 ms with `insufficient_witnesses` and B stays down.
 *
 * C is removed rather than left watching nothing: a receipt is written by the
 * observer that accepts it, so traffic to a node nobody watches would appear as
 * a send with no outcome — indistinguishable from a message still on the wire.
 */
export function buildLoneWitnessScenario(): ScenarioSpec {
  return {
    name: "lone-witness",
    nodes: [
      { id: "A", heartbeatEvery: 0, peers: [] },
      { id: "B", heartbeatEvery: ms(100), peers: ["A"] },
    ],
    links: [{ from: "B", to: "A", latency: ms(20), dropPpm: 0 }],
    observers: [{ observer: "A", target: "B", timeout: ms(350) }],
    crash: { node: "B", at: ms(215) },
    partitions: [],
    horizon: ms(1200),
    recovery: { policy: RECOVERY_POLICY },
  };
}

/** Runs the world where the action is carried out. */
export function runRecoveredCrash(seed = 0): RunResult {
  const spec = buildRecoveredCrashScenario();
  return { ...runScenario(spec, seed), spec, params: DEFAULT_PARAMS };
}

/** Runs the world where the action is refused. */
export function runLoneWitness(seed = 0): RunResult {
  const spec = buildLoneWitnessScenario();
  return { ...runScenario(spec, seed), spec, params: DEFAULT_PARAMS };
}
