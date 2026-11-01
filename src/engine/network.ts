import { Recorder } from "./recorder";
import { Rng } from "./rng";
import { Scheduler } from "./scheduler";
import { REASON_DROP_PARTITION, REASON_DROP_POLICY, type NodeId, type Ref, type Tick } from "./types";

export interface LinkConfig {
  from: NodeId;
  to: NodeId;
  latency: Tick;
  /** Probability of loss, in parts per million. 0 means never. */
  dropPpm: number;
}

export interface Message {
  from: NodeId;
  to: NodeId;
  round: number;
}

const linkKey = (from: NodeId, to: NodeId): string => `${from}->${to}`;

/**
 * One outage on one direction of one link.
 *
 * `announced` is the reference of the `link_partitioned` event once the run
 * reaches the start of the cut. A message lost inside it cites that event,
 * which is how a drop explains itself.
 */
export interface Cut {
  from: Tick;
  until: Tick;
  announced: Ref;
}

/**
 * Whether a message that left at `start` and arrives at `end` was on the path
 * while it was cut.
 *
 * The intersection of the closed transit [start, end] with the **open** cut
 * (from, until). Open at both ends is what makes the boundary decidable without
 * a tie-break: a message that arrives exactly as the path dies still arrives,
 * and one that departs exactly as it heals is not delayed.
 */
export function crosses(cut: Cut, start: Tick, end: Tick): boolean {
  return cut.from < end && start < cut.until;
}

/**
 * One-way roads with travel time.
 *
 * Only declared links exist. An undeclared path is an error rather than an
 * instant delivery, so latency is never an accident of what someone forgot to
 * configure. Losses are decided at send time, which keeps "lost" and "late"
 * different observations.
 *
 * Every send returns its own reference, because the arrival, the policy loss
 * and any later drop all have to cite it. An event that cannot name what
 * produced it is an event nobody can explain afterwards.
 */
export class Network {
  private readonly links = new Map<string, { latency: Tick; dropPpm: number; cuts: Cut[] }>();

  private readonly sched: Scheduler;
  private readonly rng: Rng;
  private readonly recorder: Recorder;
  private readonly deliver: (at: Tick, message: Message, cause: Ref) => void;

  constructor(
    sched: Scheduler,
    rng: Rng,
    recorder: Recorder,
    deliver: (at: Tick, message: Message, cause: Ref) => void,
  ) {
    this.sched = sched;
    this.rng = rng;
    this.recorder = recorder;
    this.deliver = deliver;
  }

  addLink(config: LinkConfig): void {
    if (config.from === config.to) {
      throw new Error(`invalid link: ${config.from} cannot link to itself`);
    }
    const key = linkKey(config.from, config.to);
    if (this.links.has(key)) {
      throw new Error(`link ${key} is configured more than once`);
    }
    this.links.set(key, { latency: config.latency, dropPpm: config.dropPpm, cuts: [] });
  }

  /** Registers an outage, keeping each direction's cuts ordered by start. */
  addCut(from: NodeId, to: NodeId, at: Tick, until: Tick): Cut {
    const key = linkKey(from, to);
    const wire = this.links.get(key);
    if (!wire) throw new Error(`no link configured: ${key}`);
    if (until <= at) throw new Error(`cut ${key} ends at ${until}, at or before it begins at ${at}`);
    for (const existing of wire.cuts) {
      if (existing.from <= until && at <= existing.until) {
        throw new Error(`cut ${key} ${at}..${until} meets ${existing.from}..${existing.until}`);
      }
    }
    const fresh: Cut = { from: at, until, announced: 0 };
    const index = wire.cuts.findIndex((cut) => cut.from > at);
    if (index === -1) wire.cuts.push(fresh);
    else wire.cuts.splice(index, 0, fresh);
    return fresh;
  }

  private crossing(from: NodeId, to: NodeId, start: Tick, end: Tick): Cut | null {
    const wire = this.links.get(linkKey(from, to));
    if (!wire) return null;
    for (const cut of wire.cuts) {
      if (crosses(cut, start, end)) return cut;
    }
    return null;
  }

  latencyOf(from: NodeId, to: NodeId): Tick | null {
    return this.links.get(linkKey(from, to))?.latency ?? null;
  }

  send(at: Tick, message: Message, origin: { cause: Ref }): Ref {
    const key = linkKey(message.from, message.to);
    const wire = this.links.get(key);
    if (!wire) throw new Error(`no link configured: ${key}`);
    if (message.round === 0) throw new Error(`message ${key}: round must be positive`);

    const dropped = this.rng.hit(wire.dropPpm);
    if (!dropped) {
      const arrives = at + wire.latency;
      // A cut path loses the message in flight: it is accepted by the sender
      // and never reaches anyone. The loss is recorded at the arrival instant,
      // because that is when it fails to arrive and when an observer's silence
      // starts to mean something.
      const crossing = this.crossing(message.from, message.to, at, arrives);
      // `sent` is filled in by the record call below. The closure cannot run
      // before this task returns, so the arrival always sees the reference.
      let sent: Ref = 0;
      this.sched.at(arrives, () => {
        if (crossing === null) {
          this.deliver(arrives, message, sent);
          return;
        }
        const causes = [sent, crossing.announced].sort((a, b) => a - b);
        this.recorder.record({
          at: arrives,
          kind: "message_dropped",
          node: message.from,
          peer: message.to,
          round: message.round,
          reason: REASON_DROP_PARTITION,
          causes,
        });
      });
      const ref = this.recorder.record({
        at,
        kind: "heartbeat_sent",
        node: message.from,
        peer: message.to,
        round: message.round,
        causes: [origin.cause],
      });
      sent = ref;
      return ref;
    }

    const sent = this.recorder.record({
      at,
      kind: "heartbeat_sent",
      node: message.from,
      peer: message.to,
      round: message.round,
      causes: [origin.cause],
    });
    // A policy loss never enters the network: it is refused at the sender, so
    // the send is recorded first and the loss cites it.
    this.recorder.record({
      at,
      kind: "message_dropped",
      node: message.from,
      peer: message.to,
      round: message.round,
      reason: REASON_DROP_POLICY,
      causes: [sent],
    });
    return sent;
  }
}
