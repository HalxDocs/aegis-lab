type WireState = "alive" | "dead" | "back";

const cards: {
  num: string;
  title: string;
  body: React.ReactNode;
  wire: WireState;
  nodes: 2 | 3;
}[] = [
  {
    num: "01",
    title: "A promise",
    body: (
      <>
        Three machines, A, B and C. B makes a simple promise: <b>“every 100 milliseconds I will send a beep to A
        and to C.”</b> The radio is a little slow — 20 ms to A, 25 ms to C.
      </>
    ),
    wire: "alive",
    nodes: 3,
  },
  {
    num: "02",
    title: "A silence",
    body: (
      <>
        At <b>215 ms</b> someone unplugs B. B is dead. But two beeps had already left its hand, and the radio does
        not know the sender died. They still arrive, at <b>220 ms</b> and <b>225 ms</b>.
      </>
    ),
    wire: "dead",
    nodes: 3,
  },
  {
    num: "03",
    title: "A gap",
    body: (
      <>
        A's stopwatch runs out at <b>570 ms</b>, C's at <b>575 ms</b>. Only then do they write “I don't trust B.”
        For 355 milliseconds, the truth was <b>dead</b> and both beliefs were <b>fine</b>.
      </>
    ),
    wire: "dead",
    nodes: 3,
  },
  {
    num: "04",
    title: "A decision",
    body: (
      <>
        The stopwatches have run out, and now something may act on it. The gate waits <b>50 ms</b> for
        corroboration, weighs both reports at <b>620 ms</b> and grants a restart — writing the decision down before
        anything is touched.
      </>
    ),
    wire: "dead",
    nodes: 3,
  },
  {
    num: "05",
    title: "An action",
    body: (
      <>
        At <b>720 ms</b> the action lands and B runs again, on <b>round three</b> rather than round one. A still
        calls it suspect: that belief clears at <b>840 ms</b>, when the round arrives. A restart is not the news.
      </>
    ),
    wire: "back",
    nodes: 3,
  },
  {
    num: "06",
    title: "A refusal",
    body: (
      <>
        The same crash and the same policy in a one-observer world. With a single report the gate declines at{" "}
        <b>620 ms</b> and B stays down — and the refusal is written with its reason, so “nobody acted” has a line
        in the log.
      </>
    ),
    wire: "dead",
    nodes: 2,
  },
];

export function Story() {
  return (
    <div>
      <div className="story__grid">
        {cards.map((card) => (
          <article className="story__card" key={card.num}>
            <span className="story__num">{card.num}</span>
            <h3 className="story__h">{card.title}</h3>
            <p className="story__p">{card.body}</p>
            <div className="story__wire" aria-hidden="true">
              <span className={`wire__node ${card.wire === "dead" ? "wire__node--dead" : ""}`}>A</span>
              <span className={`wire__line ${card.wire === "dead" ? "wire__line--broken" : ""}`} />
              <span className={`wire__node ${card.wire === "dead" ? "wire__node--dead" : ""}`}>B</span>
              {card.nodes === 3 && (
                <>
                  <span className={`wire__line ${card.wire === "dead" ? "wire__line--broken" : ""}`} />
                  <span className={`wire__node ${card.wire === "dead" ? "wire__node--dead" : ""}`}>C</span>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      <p className="story__note">
        Every claim on this page comes from four worlds of two or three machines. Nothing here is a mock-up: the
        numbers in the lab are computed in your browser by a port of the Go engine, and each world's output is
        compared against the Go program&apos;s own log, byte for byte.
      </p>
    </div>
  );
}
