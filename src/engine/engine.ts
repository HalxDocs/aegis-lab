import { Network, type Cut, type LinkConfig, type Message } from "./network";
import { SimNode, type NodeConfig, type NodeHost } from "./nodes";
import { Recorder } from "./recorder";
import { Rng } from "./rng";
import { Scheduler } from "./scheduler";
import type { Action, NodeId, NodeState, Ref, Tick } from "./types";

/** A component that observes delivered messages. */
export interface Receiver {
  heartbeatReceived(at: Tick, from: NodeId, to: NodeId, round: number, cause: Ref): void;
}

/**
 * The referee.
 *
 * It owns virtual time, the queue, the network and ground truth. Components are
 * given only the pieces they need: the detector receives `Scheduler` and
 * delivery callbacks, never `truth`.
 */
export class Engine implements NodeHost {
  readonly sched = new Scheduler();
  readonly recorder = new Recorder();
  readonly rng: Rng;
  readonly network: Network;

  private readonly nodes = new Map<NodeId, SimNode>();
  private readonly order: NodeId[] = [];
  private readonly receivers: Receiver[] = [];
  private started = false;
  private rootRef: Ref = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.network = new Network(this.sched, this.rng, this.recorder, (at, message, cause) =>
      this.deliver(at, message, cause),
    );
  }

  addNode(config: NodeConfig): void {
    if (this.started) throw new Error("simulator has already started");
    if (!config.id) throw new Error("node id is required");
    if (config.heartbeatEvery < 0) throw new Error(`node ${config.id}: negative heartbeat interval`);
    if (config.heartbeatEvery === 0 && config.peers.length > 0) {
      throw new Error(`node ${config.id}: peers configured without a heartbeat interval`);
    }
    if (config.heartbeatEvery > 0 && config.peers.length === 0) {
      throw new Error(`node ${config.id}: heartbeat interval configured without peers`);
    }
    if (config.peers.includes(config.id)) {
      throw new Error(`node ${config.id}: cannot heartbeat itself`);
    }
    if (new Set(config.peers).size !== config.peers.length) {
      throw new Error(`node ${config.id}: a peer is listed twice`);
    }
    if (this.nodes.has(config.id)) {
      throw new Error(`node ${config.id} is already configured`);
    }
    this.nodes.set(config.id, new SimNode(config.id, config.heartbeatEvery, config.peers, this));
    this.order.push(config.id);
    this.order.sort();
  }

  addLink(config: LinkConfig): void {
    if (this.started) throw new Error("simulator has already started");
    this.network.addLink(config);
  }

  addReceiver(receiver: Receiver): void {
    this.receivers.push(receiver);
  }

  /**
   * Cuts one direction of a link between two instants.
   *
   * The cut is a schedule on the wire, not a flag: the network keeps the
   * interval, and whether a message dies is a pure function of its transit. Both
   * ends of the outage are recorded, so a loss inside it can cite the
   * announcement and the repair can cite itself into existence.
   */
  cutAt(from: NodeId, to: NodeId, at: Tick, until: Tick): void {
    if (this.started) throw new Error("simulator has already started");
    if (at < this.sched.now) {
      throw new Error(`cut at ${at} is in the past; now is ${this.sched.now}`);
    }
    const outage: Cut = this.network.addCut(from, to, at, until);
    // Scheduled now, recorded later: the announcement must be in the queue
    // before any message at the same instant, which is guaranteed by being
    // configured first rather than by an ordering rule.
    this.sched.at(at, () => {
      outage.announced = this.recorder.record({
        at,
        kind: "link_partitioned",
        node: from,
        peer: to,
        causes: [this.root()],
      });
    });
    this.sched.at(until, () => {
      this.recorder.record({
        at: until,
        kind: "link_restored",
        node: from,
        peer: to,
        causes: [outage.announced],
      });
    });
  }

  get nodeIds(): NodeId[] {
    return [...this.order];
  }

  /** Ground truth. Used by the page and by assertions, never by a detector. */
  truth(id: NodeId): NodeState | null {
    return this.nodes.get(id)?.state ?? null;
  }

  /**
   * Opens the history and returns the reference of its first event.
   *
   * Nothing is recorded before this, so a configuration error cannot leave a
   * half-written log behind. Every event that has no other parent cites this.
   */
  open(name: string): Ref {
    if (this.rootRef !== 0) throw new Error("the history is already open");
    this.rootRef = this.recorder.record({
      at: this.sched.now,
      kind: "scenario_started",
      scenario: name,
    });
    return this.rootRef;
  }

  root(): Ref {
    if (this.rootRef === 0) throw new Error("the history is not open yet");
    return this.rootRef;
  }

  /** Records the closing event, which explains nothing but the run itself. */
  close(name: string): Ref {
    return this.recorder.record({
      at: this.sched.now,
      kind: "scenario_finished",
      scenario: name,
      causes: [this.root()],
    });
  }

  start(): void {
    if (this.started) throw new Error("simulator has already started");
    for (const id of this.order) {
      const node = this.nodes.get(id);
      if (!node) continue;
      for (const peer of node.peerIds) {
        if (!this.nodes.has(peer)) {
          throw new Error(`node ${id} heartbeats unknown peer ${peer}`);
        }
      }
    }
    for (const id of this.order) {
      this.nodes.get(id)?.start(this.sched.now);
    }
    this.started = true;
  }

  /** Schedules a change in ground truth. */
  crashAt(at: Tick, id: NodeId): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`unknown node: ${id}`);
    this.sched.at(at, () => node.crash(at));
  }

  /**
   * Performs a granted recovery action at the instant the action names.
   *
   * The simulator is the only component that can move a node out of the crashed
   * state, and it only does so on behalf of an action that already carries a
   * decision. The evidence is not re-read here: the action was granted in the
   * log, and this is the consequence of that grant rather than a second opinion
   * about it.
   *
   * `cause` is the reference of the proposal, which becomes the reason the
   * restart happened. A restart with nothing to cite would be a change in
   * ground truth that no observer's account explains.
   */
  restart(action: Action, cause: Ref): void {
    if (action.kind !== "restart_node") {
      throw new Error(`action ${action.id}: ${action.kind} has no path through the simulator`);
    }
    const node = this.nodes.get(action.target);
    if (!node) throw new Error(`unknown node: ${action.target}`);
    if (node.state !== "crashed") {
      throw new Error(`action ${action.id}: ${action.target} is ${node.state}`);
    }
    if (cause <= 0) throw new Error(`action ${action.id} cites no cause`);
    if (action.at < this.sched.now) {
      throw new Error(`action ${action.id}: restart at ${action.at}, now ${this.sched.now}`);
    }
    this.sched.at(action.at, () => {
      // The action is recorded before the node resumes, so the log shows the
      // decision being carried out before the world changes.
      const started = this.recorder.record({
        at: action.at,
        kind: "recovery_started",
        node: action.target,
        action: action.id,
        causes: [cause],
      });
      node.restart(action.at, started);
    });
  }

  /** Executes scheduled work up to and including the horizon. */
  run(horizon: Tick): void {
    if (!this.started) throw new Error("simulator has not been started");
    if (horizon < this.sched.now) {
      throw new Error(`run horizon ${horizon} precedes the current time ${this.sched.now}`);
    }
    for (;;) {
      const next = this.sched.peek();
      if (next === null || next.at > horizon) break;
      this.sched.step();
    }
    this.sched.now = horizon;
  }

  private deliver(at: Tick, message: Message, cause: Ref): void {
    if (this.receivers.length === 0) {
      throw new Error("simulator requires a message receiver");
    }
    for (const receiver of this.receivers) {
      receiver.heartbeatReceived(at, message.from, message.to, message.round, cause);
    }
  }
}
