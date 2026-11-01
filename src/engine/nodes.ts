import type { Network } from "./network";
import type { Recorder } from "./recorder";
import type { Scheduler, Timer } from "./scheduler";
import type { NodeId, NodeState, Ref, Tick } from "./types";

export interface NodeConfig {
  id: NodeId;
  /** Interval between heartbeat rounds; 0 means the node never speaks. */
  heartbeatEvery: Tick;
  peers: NodeId[];
}

export interface NodeHost {
  readonly network: Network;
  readonly sched: Scheduler;
  readonly recorder: Recorder;
  /** The event that opened this history; a node's first cause. */
  root(): Ref;
}

/**
 * A simulated machine.
 *
 * Its state is ground truth. Nothing outside the simulator may read it except
 * through `Engine.truth`, and the detector is given no access at all.
 */
export class SimNode {
  state: NodeState = "running";
  private round = 0;
  private timer: Timer | null = null;
  /** The node's own start, which is the first round's cause. */
  private started: Ref = 0;
  /** The last send per direction, so each link has its own chain. */
  private readonly lastSent = new Map<NodeId, Ref>();
  /**
   * The restart that resumed this node, until the next round has gone out.
   *
   * A round sent after a restart could not have happened without it, so the
   * resumed chain names the event that revived the node instead of walking past
   * the crash to the original start.
   */
  private resumed: Ref = 0;

  readonly id: NodeId;
  private readonly every: Tick;
  private readonly peers: NodeId[];
  private readonly host: NodeHost;

  constructor(id: NodeId, every: Tick, peers: NodeId[], host: NodeHost) {
    this.id = id;
    this.every = every;
    this.peers = [...peers].sort();
    this.host = host;
  }

  get peerIds(): NodeId[] {
    return [...this.peers];
  }

  /** Records the node as running and arms its first round. */
  start(at: Tick): void {
    if (this.state !== "running") {
      throw new Error(`node ${this.id}: cannot start while ${this.state}`);
    }
    this.started = this.host.recorder.record({
      at,
      kind: "node_started",
      node: this.id,
      causes: [this.host.root()],
    });
    if (this.every === 0) return;
    this.arm(at);
  }

  /**
   * The event that caused the next heartbeat to a peer: the previous send on
   * that direction, or this node's start for the first round.
   *
   * Per peer rather than per node, because each direction keeps its own
   * schedule. One chain for the whole node would claim a link's round two was
   * caused by a send on a different link.
   */
  private causeFor(peer: NodeId): Ref {
    if (this.resumed !== 0) return this.resumed;
    return this.lastSent.get(peer) ?? this.started;
  }

  private arm(from: Tick): void {
    const at = from + this.every;
    this.timer = this.host.sched.at(at, () => this.beat(at));
  }

  /** Sends one round to every peer, in sorted order. */
  private beat(at: Tick): void {
    if (this.state !== "running") {
      throw new Error(`node ${this.id}: heartbeat at ${at} while ${this.state}`);
    }
    this.round += 1;
    for (const peer of this.peers) {
      const sent = this.host.network.send(at, { from: this.id, to: peer, round: this.round }, {
        cause: this.causeFor(peer),
      });
      this.lastSent.set(peer, sent);
    }
    // The restart has now been cited by every peer's next round, so later
    // rounds fall back to the per-direction chain.
    this.resumed = 0;
    this.arm(at);
  }

  /**
   * Brings a crashed node back on behalf of a granted action and resumes its
   * heartbeat where it stopped.
   *
   * The round counter is not reset: a restarted node that counted from one
   * again would send the same round number twice, and an observer comparing
   * rounds would read the second as a reordering rather than as a second life.
   *
   * The timer is armed from the restart instant rather than from the interrupted
   * schedule: the node was not executing while it was down, and resuming a timer
   * that would already have fired several times would backfill heartbeats the
   * node never sent.
   */
  restart(at: Tick, cause: Ref): void {
    if (this.state !== "crashed") {
      throw new Error(`node ${this.id}: cannot restart while ${this.state}`);
    }
    this.state = "running";
    this.timer?.cancel();
    this.timer = null;
    this.resumed = this.host.recorder.record({
      at,
      kind: "node_restarted",
      node: this.id,
      causes: [cause],
    });
    if (this.every === 0) return;
    this.arm(at);
  }

  /**
   * Moves the node to its terminal state and stops its own timers.
   *
   * Messages already inside the network keep travelling. The network cannot
   * retract what it accepted, and pretending otherwise would erase the window
   * this lab exists to show.
   */
  crash(at: Tick): void {
    if (this.state === "crashed") {
      throw new Error(`node ${this.id}: cannot crash while crashed`);
    }
    this.state = "crashed";
    this.timer?.cancel();
    this.timer = null;
    this.host.recorder.record({
      at,
      kind: "node_crashed",
      node: this.id,
      causes: [this.host.root()],
    });
  }
}
