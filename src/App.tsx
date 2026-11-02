import { CodeMap } from "./components/CodeMap";
import { EventTable } from "./components/EventTable";
import { Hero } from "./components/Hero";
import { Lab } from "./components/Lab";
import { Logo } from "./components/Logo";
import { Principles } from "./components/Principles";
import { Proof } from "./components/Proof";
import { Section } from "./components/Section";
import { Story } from "./components/Story";

export default function App() {
  return (
    <>
      <nav className="nav">
        <div className="shell nav__inner">
          <a href="#top" aria-label="Aegis home">
            <Logo sub={false} />
          </a>
          <div className="nav__links">
            <a className="nav__link" href="#story">
              story
            </a>
            <a className="nav__link" href="#lab">
              lab
            </a>
            <a className="nav__link" href="#events">
              log
            </a>
            <a className="nav__link" href="#principles">
              principles
            </a>
            <a className="nav__link" href="#proof">
              proof
            </a>
            <a className="nav__link" href="#code">
              code
            </a>
          </div>
          <a
            className="nav__cta"
            href="https://github.com/HalxDocs/aegis"
            target="_blank"
            rel="noreferrer"
          >
            github ↗
          </a>
        </div>
      </nav>

      <main id="top">
        <Hero />

        <Section
          id="story"
          num="01 / the story"
          title="One promise, one silence, and what happens next."
          lead="Start with a smaller question than consensus: what does one machine actually know about another? A promise, its absence, the gap between them — and then, once that knowledge is allowed to act, a decision and its consequence."
        >
          <Story />
        </Section>

        <Section
          id="lab"
          num="02 / the lab"
          title="Watch it happen."
          lead="Four worlds: a node crashes, one path is cut, a crash is repaired by a decision, or the repair is refused for want of evidence. Press play, scrub the timeline, or change the numbers — every packet, deadline, decision and suspicion is computed by the engine, not drawn by hand, and any belief, decision or log line opens the chain of events it rests on."
        >
          <Lab />
        </Section>

        <Section
          id="events"
          num="03 / the log"
          title="The lines that prove it."
          lead="Four entire histories, exactly as the Go program wrote them. The crash is sixteen lines, the refusal eleven; the repair is thirty-seven and the cut path seventy-five. Click any line to see the events it rests on — the suspicion's chain contains no crash, and the refusal's chain is the one report it declined."
        >
          <EventTable />
        </Section>

        <Section
          id="principles"
          num="04 / principles"
          title="What the code refuses to do."
          lead="Eighteen decisions that keep the simulation honest — twelve about observing a failure, six about acting on one. Each exists because the alternative produces a bug that looks like a feature."
        >
          <Principles />
        </Section>

        <Section
          id="proof"
          num="05 / the proof"
          title="Connected to the real thing."
          lead="This page does not describe the Go program. It runs a port of it and compares the bytes, in your browser, right now."
        >
          <Proof />
        </Section>

        <Section
          id="code"
          num="06 / the code"
          title="Where each idea lives."
          lead="The Go repository, package by package. Every claim above maps to a file here."
        >
          <CodeMap />
        </Section>
      </main>

      <footer className="footer">
        <div className="shell footer__inner">
          <div className="footer__left">
            <Logo sub={false} />
            <span>failure lab · milestones 01–04</span>
          </div>
          <div className="footer__right">
            <a href="https://github.com/HalxDocs/aegis" target="_blank" rel="noreferrer">
              github ↗
            </a>
            <a
              href="https://github.com/HalxDocs/aegis/blob/main/doc_m1.md"
              target="_blank"
              rel="noreferrer"
            >
              doc_m1 ↗
            </a>
            <span>MIT</span>
          </div>
        </div>
      </footer>
    </>
  );
}
