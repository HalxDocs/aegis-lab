import { Logo } from "./Logo";

export function Hero() {
  return (
    <header className="hero">
      <div className="shell">
        <div className="hero__top">
          <Logo />
          <span className="eyebrow">milestones 01–04 — failure lab</span>
        </div>

        <h1 className="hero__title">
          Watch a node die.
          <br />
          Watch nobody <em>notice</em>.
        </h1>

        <p className="hero__lead">
          A distributed system can be dead and still be trusted. This page runs a real discrete-event simulation —
          the same engine as the <strong>Go repository</strong> — and shows the three hundred milliseconds where
          the truth and everyone's belief disagree. Then it lets the system act on what it knows: two independent
          observers can put the node back, and one observer alone gets a refusal with a reason.
        </p>

        <div className="hero__actions">
          <a className="btn btn--primary" href="#lab">
            Run the lab
          </a>
          <a className="btn btn--ghost" href="#proof">
            See the proof
          </a>
        </div>

        <div className="hero__stats">
          <div className="stat">
            <div className="stat__value">139</div>
            <div className="stat__label">events, four worlds</div>
          </div>
          <div className="stat">
            <div className="stat__value">570 / 575</div>
            <div className="stat__label">each observer's alarm</div>
          </div>
          <div className="stat">
            <div className="stat__value">355 ms</div>
            <div className="stat__label">truth ahead of belief</div>
          </div>
          <div className="stat">
            <div className="stat__value">720 ms</div>
            <div className="stat__label">when the decision lands</div>
          </div>
        </div>

        <div className="hero__split">
          <div className="split__col split__col--truth">
            <div className="split__tag">what happened</div>
            <div className="split__value">B crashed at 215 ms.</div>
            <p className="split__note">
              Ground truth. The simulator knows it the instant it happens, and never tells the observers.
            </p>
          </div>
          <div className="split__col">
            <div className="split__tag">what A believes</div>
            <div className="split__value">B is fine — until 570 ms.</div>
            <p className="split__note">
              A has evidence: a heartbeat arrived at 220 ms. It has no reason to doubt B until its own timeout
              expires, 350 ms later.
            </p>
          </div>
          <div className="split__col split__col--decision">
            <div className="split__tag">what the system did</div>
            <div className="split__value">B is back at 720 ms.</div>
            <p className="split__note">
              Two witnesses, 50 ms of patience, 100 ms before acting. The action cites the two reports — not the
              crash — and A still distrusts B until 840 ms, when a message arrives.
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
