import type { Recorder } from "./recorder";
import type { Scheduler, Timer } from "./scheduler";
import {
  REASON_HEARTBEAT_TIMEOUT,
  type Belief,
  type FailureReport,
  type NodeId,
  type Observation,
  type Ref,
  type Tick,
} from "./types";

interface Monitor {
  obs: Observation;
  epoch: number;
  timer: Timer | null;
  deadline: Tick | null;
  /** The receipt this deadline was armed by; the root before any evidence. */
  evidence: Ref;
}

export interface DetectorConfig {
  observer: NodeId;
  timeout: Tick;
  scheduler: Scheduler;
  recorder: Recorder;
  /** The event that opened the history, cited by a first deadline. */
  root: Ref;
  /**
   * Told about every report as it is written, with the reference of the line
   * that holds it.
   *
   * A consumer can act while the run is still going without this detector
   * learning what it decided: the detector states what it observed and
   * continues watching, and never reads the answer.
   */
  failures?: (report: FailureReport, ref: Ref) => void;
}

/**
 * One observer's beliefs.
 *
 * Its inputs are messages that actually arrived, a scheduler and a recorder.
 * It has no reference to the simulator, so a crashed node is indistinguishable
 * from a silent one — which is the point: it reports only what it can justify.
 *
 * Every belief change cites the evidence behind it: a suspicion cites the
 * receipt its deadline counted from, and a recovery cites the arrival that
 * ended the silence.
 */
export class Detector {
  private readonly monitors = new Map<NodeId, Monitor>();
  private readonly order: NodeId[] = [];
  readonly reports: FailureReport[] = [];

  private readonly config: DetectorConfig;

  constructor(config: DetectorConfig) {
    this.config = config;
  }

  get observer(): NodeId {
    return this.config.observer;
  }

  get timeout(): Tick {
    return this.config.timeout;
  }

  /** Starts watching a target, with a deadline one timeout from now. */
  watch(target: NodeId): void {
    if (target === this.observer) throw new Error(`detector ${this.observer}: cannot watch itself`);
    if (this.monitors.has(target)) {
      throw new Error(`observer ${this.observer} already watches ${target}`);
    }
    const monitor: Monitor = {
      obs: {
        observer: this.observer,
        target,
        belief: "healthy",
        lastSeen: 0,
        suspectedAt: 0,
        heard: 0,
      },
      epoch: 0,
      timer: null,
      deadline: null,
      evidence: this.config.root,
    };
    this.monitors.set(target, monitor);
    this.order.push(target);
    this.order.sort();
    this.arm(target, monitor, this.config.scheduler.now);
  }

  /** The simulator's delivery callback. `cause` is the send that arrived. */
  heartbeatReceived(at: Tick, from: NodeId, to: NodeId, round: number, cause: Ref): void {
    if (to !== this.observer) return;

    const receipt = this.config.recorder.record({
      at,
      kind: "heartbeat_received",
      node: from,
      peer: to,
      round,
      causes: [cause],
    });

    const monitor = this.monitors.get(from);
    if (!monitor) return;

    const wasSuspected = monitor.obs.belief === "suspected";
    if (at < monitor.obs.lastSeen) {
      throw new Error(
        `detector ${this.observer}: message at ${at} precedes last seen ${monitor.obs.lastSeen}`,
      );
    }
    monitor.obs = {
      observer: monitor.obs.observer,
      target: monitor.obs.target,
      belief: "healthy",
      lastSeen: at,
      suspectedAt: 0,
      heard: monitor.obs.heard + 1,
    };
    if (wasSuspected) {
      // The path came back earlier, maybe. What ended the suspicion was this
      // arrival, so that is what the recovery cites.
      this.config.recorder.record({
        at,
        kind: "suspicion_cleared",
        node: from,
        peer: to,
        causes: [receipt],
      });
    }
    // This receipt re-arms the deadline, so it is the evidence a later
    // suspicion will cite.
    monitor.evidence = receipt;
    this.arm(from, monitor, at);
  }

  /**
   * Replaces the monitor's deadline with one timeout after `from`.
   *
   * The epoch is a second lock. Cancellation is enough for a scheduler that
   * never runs dead work, but a phantom timeout is the one bug in a heartbeat
   * detector that looks exactly like a real failure, so it gets two locks.
   */
  private arm(target: NodeId, monitor: Monitor, from: Tick): void {
    monitor.epoch += 1;
    const epoch = monitor.epoch;
    monitor.timer?.cancel();
    monitor.timer = null;

    const deadline = from + this.config.timeout;
    monitor.deadline = deadline;
    monitor.timer = this.config.scheduler.atEnd(deadline, () => this.evaluate(target, epoch, deadline));
  }

  /** Raises suspicion when a deadline passes with no fresh evidence. */
  private evaluate(target: NodeId, epoch: number, at: Tick): void {
    const monitor = this.monitors.get(target);
    if (!monitor || monitor.epoch !== epoch) return;
    if (monitor.obs.belief === "suspected") return;

    if (at <= monitor.obs.lastSeen) {
      throw new Error(`detector ${this.observer}: suspicion at ${at} is not after last seen`);
    }
    const next: Observation = {
      ...monitor.obs,
      belief: "suspected" as Belief,
      suspectedAt: at,
    };
    const silence = at - next.lastSeen;
    if (silence < this.config.timeout) {
      throw new Error(
        `detector ${this.observer}: suspected after ${silence} of silence, before its ${this.config.timeout} timeout`,
      );
    }

    const raised = this.config.recorder.record({
      at,
      kind: "suspicion_raised",
      node: target,
      peer: this.observer,
      reason: REASON_HEARTBEAT_TIMEOUT,
      causes: [monitor.evidence],
    });
    monitor.obs = next;
    monitor.timer = null;
    const report: FailureReport = {
      observer: this.observer,
      target,
      suspectedAt: at,
      lastSeenAt: next.lastSeen,
      timeout: this.config.timeout,
      silence,
    };
    this.reports.push(report);

    // The report is handed on after it is written, and with the reference of the
    // line that holds it. A consumer acting on evidence the history does not
    // contain would be acting on something no reader could check.
    this.config.failures?.(report, raised);
  }

  observation(target: NodeId): Observation | null {
    const monitor = this.monitors.get(target);
    return monitor ? { ...monitor.obs } : null;
  }

  /** The next instant this observer will stop trusting a target, if any. */
  deadlineFor(target: NodeId): Tick | null {
    const monitor = this.monitors.get(target);
    if (!monitor || monitor.obs.belief === "suspected") return null;
    return monitor.deadline;
  }

  targets(): NodeId[] {
    return [...this.order];
  }
}
