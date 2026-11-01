import type { Tick } from "./types";

/**
 * Work classes. At one instant, ordinary work runs before deadline expiry, so a
 * message that lands exactly on a deadline still counts as evidence. This is
 * the one ordering decision the whole simulation depends on.
 */
export const CLASS_NORMAL = 0 as const;
export const CLASS_END = 1 as const;
export type TaskClass = typeof CLASS_NORMAL | typeof CLASS_END;

interface Task {
  at: Tick;
  cls: TaskClass;
  seq: number;
  fn: () => void;
  dead: boolean;
}

export interface Timer {
  cancel(): void;
}

const MAX_STEPS = 1_000_000;

/**
 * A discrete-event queue over virtual time.
 *
 * Ordering key: (at, class, seq). `seq` is assigned when work is scheduled,
 * never when it runs, so work queued during execution at the same instant joins
 * the back of that instant's queue.
 */
export class Scheduler {
  now: Tick = 0;
  private tasks: Task[] = [];
  private seq = 0;
  private executed = 0;

  at(at: Tick, fn: () => void): Timer {
    return this.schedule(at, CLASS_NORMAL, fn);
  }

  atEnd(at: Tick, fn: () => void): Timer {
    return this.schedule(at, CLASS_END, fn);
  }

  private schedule(at: Tick, cls: TaskClass, fn: () => void): Timer {
    if (at < this.now) {
      throw new Error(`task scheduled in the past: at ${at}, now ${this.now}`);
    }
    const task: Task = { at, cls, seq: ++this.seq, fn, dead: false };
    this.tasks.push(task);
    return {
      cancel: () => {
        task.dead = true;
      },
    };
  }

  /** The earliest live task, or null. Cancelled work is discarded on the way. */
  peek(): Task | null {
    let best: Task | null = null;
    for (const task of this.tasks) {
      if (task.dead) continue;
      if (best === null || earlier(task, best)) best = task;
    }
    return best;
  }

  /** Executes the earliest live task and advances the clock to its instant. */
  step(): Task | null {
    const task = this.peek();
    if (task === null) return null;
    this.tasks = this.tasks.filter((candidate) => candidate !== task);
    this.now = task.at;
    if (++this.executed > MAX_STEPS) {
      throw new Error(`step limit exceeded after ${this.executed} tasks`);
    }
    task.fn();
    return task;
  }

  /** Number of tasks still expected to run. */
  get pending(): number {
    return this.tasks.reduce((count, task) => count + (task.dead ? 0 : 1), 0);
  }
}

function earlier(a: Task, b: Task): boolean {
  if (a.at !== b.at) return a.at < b.at;
  if (a.cls !== b.cls) return a.cls < b.cls;
  return a.seq < b.seq;
}
