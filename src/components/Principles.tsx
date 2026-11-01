const principles = [
  {
    title: "Facts are not beliefs",
    body: "Truth lives in NodeState. Belief lives in Observation, keyed by who is watching. A crashed node can be believed healthy; a running node can be suspected.",
    risk: "Without it: one status field, and every test can pass while the claim is false.",
  },
  {
    title: "Time is an input",
    body: "The clock is an integer count of virtual nanoseconds. Advancing 1.2 seconds costs microseconds, and nothing sleeps.",
    risk: "Without it: replay depends on how fast the machine happens to be.",
  },
  {
    title: "Deadlines hang from evidence",
    body: "A timeout starts at the last message actually received — not at the crash, and not at the last message the sender claims to have sent.",
    risk: "Without it: you assert crash + timeout, which is wrong whenever mail is in flight.",
  },
  {
    title: "Evidence at the deadline counts",
    body: "At one virtual instant, ordinary work runs before deadline expiry. A heartbeat that lands exactly on time is still evidence.",
    risk: "Without it: the tie is decided by whichever timer was armed first.",
  },
  {
    title: "Old timers must never fire",
    body: "Cancelled work is tombstoned in the queue, and every monitor carries an epoch. A stale callback returns without touching a belief.",
    risk: "Without it: a phantom suspicion that looks exactly like a real failure.",
  },
  {
    title: "Sent mail is not recalled",
    body: "A crash stops the node's own timers, not the messages already inside the network. Those arrive 5 ms after the node is gone.",
    risk: "Without it: the 216 ms window disappears and the lab proves nothing.",
  },
  {
    title: "Only declared roads exist",
    body: "Every directed link is configured with a latency. An undeclared path aborts the run instead of delivering instantly.",
    risk: "Without it: latency is whatever someone forgot to configure.",
  },
  {
    title: "Loss is decided at send",
    body: "A dropped message never enters the wire, and the log records why. The decision is made once, by a seeded generator.",
    risk: "Without it: “lost” and “late” become the same observation.",
  },
  {
    title: "The log is append-only",
    body: "The recorder assigns every sequence number itself and rejects an event that travels backwards in virtual time.",
    risk: "Without it: a log that can be reordered is not evidence.",
  },
  {
    title: "Replay is byte equality",
    body: "Two runs are compared as raw JSONL, not as parsed objects. Randomness is a local splitmix64, so a Go upgrade cannot change the stream.",
    risk: "Without it: reordering slips through a structural diff, and replay breaks on a toolchain bump.",
  },
  {
    title: "The detector cannot reach the truth",
    body: "It imports the vocabulary and the standard library, nothing else. The simulator is never in scope, and a test parses the import graph to keep it that way.",
    risk: "Without it: a shortcut from truth to belief that no test would notice.",
  },
  {
    title: "Failures inside callbacks surface",
    body: "Components that schedule their own work report faults to the engine, which keeps the first one and aborts the run.",
    risk: "Without it: a lost write looks like a successful run.",
  },
  {
    title: "The decision is written before the world changes",
    body: "The proposal lands at 620 ms and the action at 720 ms, and the restart cites the start. A reader following the sequence never finds a consequence before its cause.",
    risk: "Without it: a restart whose reason appears later in the file than the restart itself.",
  },
  {
    title: "A refusal is a decision",
    body: "It has an instant, a reason and the references it declined. The gate reviews at 620 ms even when the threshold cannot be met, and writes down that it declined.",
    risk: "Without it: one observer's silence is indistinguishable from a dead node, and “two witnesses” stays an untested preference.",
  },
  {
    title: "The gate cannot see the truth",
    body: "It receives reports and returns a decision: no clock, no state, no access to a node. One observer gets one vote, and one decision covers one target.",
    risk: "Without it: a decision that cites the crash, which is right for a reason the system could not have had.",
  },
  {
    title: "Verification is a query, not an event",
    body: "The proof is a walk over edges the log already has — proposal, start, restart — performed by a package that cannot act. There is no recovery_verified event, and there never will be.",
    risk: "Without it: the run certifies its own work, and a true certification is indistinguishable from a confident one.",
  },
  {
    title: "A restarted node resumes its counter",
    body: "B comes back on round three, not round one, and its first round after the restart cites the restart — so the resumed chain names the reason the node is alive.",
    risk: "Without it: duplicate round numbers read as reordering, and the chain walks past the crash it survived.",
  },
  {
    title: "Recovery is not belief recovery",
    body: "B is running again at 720 ms and A still distrusts it until 840 ms, when round three arrives. The receipt clears the belief; the restart never does.",
    risk: "Without it: a log in which an observer learned something nobody told it.",
  },
];

export function Principles() {
  return (
    <div>
      <div className="principles__grid">
        {principles.map((principle, index) => (
          <article className="principle" key={principle.title}>
            <div className="principle__top">
              <span className="principle__num">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="principle__title">{principle.title}</h3>
            </div>
            <p className="principle__body">{principle.body}</p>
            <p className="principle__risk">{principle.risk}</p>
          </article>
        ))}
      </div>
      <p className="panel-note">
        Each card is a decision taken in the Go repository, recorded with the alternative it rejected in doc_m1.md and
        doc_m4.md.
      </p>
    </div>
  );
}
