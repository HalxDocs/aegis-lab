import { chainRows, countOf, depthOf, type CausalIndex } from "../engine/causal";
import { describe, fmt } from "../engine/trace";

/**
 * Why one event happened, as the log itself answers it.
 *
 * Every row is an event the line below rests on, indented like the CLI prints
 * it. Clicking a row re-roots the chain on that event, so a reader can walk
 * backwards through the reasoning one step at a time.
 */
export function ChainPanel({
  index,
  selected,
  crashSeq,
  repairSeq = null,
  restartSeq = null,
  onSelect,
  onClose,
}: {
  index: CausalIndex;
  selected: number;
  crashSeq: number | null;
  repairSeq?: number | null;
  restartSeq?: number | null;
  onSelect: (ref: number) => void;
  onClose: () => void;
}) {
  const explanation = index.explain(selected);
  const rows = chainRows(explanation);
  const isRoot = selected === index.root;
  const suspicion = explanation.event.kind === "suspicion_raised";
  const recovery = explanation.event.kind === "suspicion_cleared";
  const crashAbsent = crashSeq !== null && suspicion && !index.hasAncestor(selected, crashSeq);
  const repairAbsent = repairSeq !== null && recovery && !index.hasAncestor(selected, repairSeq);
  const deciding =
    explanation.event.kind === "recovery_proposed" ||
    explanation.event.kind === "recovery_started" ||
    explanation.event.kind === "node_restarted";
  const refused = explanation.event.kind === "recovery_refused";
  const reachesRestart = restartSeq !== null && !deciding && index.hasAncestor(selected, restartSeq);

  return (
    <section className="chain" aria-label="Why this event happened">
      <div className="chain__head">
        <span className="chain__title">
          why <b>#{selected}</b> happened
        </span>
        <span className="chain__meta">
          {countOf(explanation) - 1} {countOf(explanation) - 1 === 1 ? "reason" : "reasons"} ·{" "}
          {depthOf(explanation)} deep
        </span>
        <button className="chain__close" onClick={onClose} aria-label="Close the chain">
          close
        </button>
      </div>

      <div className="chain__rows">
        {rows.map(({ explanation: node, level }, row) => {
          const { event } = node;
          const current = event.seq === selected;
          return (
            <button
              // Two branches can reach the same event, so the sequence number is
              // not unique within a chain: the row is.
              key={`${row}-${event.seq}`}
              className={[
                "chain__row",
                current ? "chain__row--current" : "",
                level === 0 ? "chain__row--root" : "",
              ].join(" ")}
              style={{ paddingLeft: 16 + level * 22 }}
              onClick={() => (current ? undefined : onSelect(event.seq))}
              aria-current={current ? "true" : undefined}
              title={current ? "the event being explained" : `explain #${event.seq} instead`}
            >
              <span className="chain__branch">{level === 0 ? "" : "↳"}</span>
              <span className="chain__seq">{event.seq}</span>
              <span className="chain__time">{fmt(event.at)}</span>
              <span className="chain__kind">{event.kind}</span>
              <span className="chain__text">{describe(event)}</span>
            </button>
          );
        })}
      </div>

      <p className="chain__note">
        {crashAbsent ? (
          <>
            The crash is <b>not</b> in this chain. It was never delivered to this observer, so no line here
            leads back to it — and that absence is why the suspicion was justified rather than late.
          </>
        ) : repairAbsent ? (
          <>
            The repair is <b>not</b> in this chain. A path coming back changes nothing on its own: this belief
            changed because a message arrived on it, and the chain stops at that arrival.
          </>
        ) : refused ? (
          <>
            A refusal is a decision too. It names the report it declined and the reason it declined, so “why did
            nobody act?” has a line in the log to point at instead of an absence.
          </>
        ) : deciding ? (
          <>
            This is a decision being carried out. The proposal cites the reports it weighed, the start cites the
            proposal, and the restart cites the start — and nothing here cites the crash, because a decision rests
            on what the observers could see.
          </>
        ) : reachesRestart ? (
          <>
            This chain does reach a change in ground truth: the restart. That is not truth leaking into a belief.
            The restart was caused by a decision this log contains in full, and the news still arrived as a
            message — which is the only way news ever reaches an observer.
          </>
        ) : isRoot ? (
          <>This is the opening event. Nothing caused it, and every other line in the log reaches it.</>
        ) : (
          <>
            Each line cites an event recorded before it. Click a line to ask why <i>that</i> happened.
          </>
        )}
      </p>
    </section>
  );
}
