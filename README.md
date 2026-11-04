# Aegis Lab

A single page that explains — and runs — the Aegis failure lab: three nodes, a
heartbeat, a crash at 215 ms, and the 355 ms during which the system is dead
while both observers still believe it is healthy. Then the same page lets that
knowledge act: a decision puts the node back, and a one-witness world gets a
refusal instead.

Four worlds are wired in. **A crash** kills B and shows a belief that outlives
the truth. **A cut path** keeps everyone alive and severs B→A for 600 ms, so A
stops hearing B while B keeps hearing A — then the repair at 900 ms changes
nothing on its own, and A trusts B again at 920 ms when a message arrives.

**A repair** adds the milestone where the system acts: two witnesses, 50 ms of
patience and 100 ms between deciding and acting. The gate grants at 620 ms, B is
back at 720 ms on round three, and A still distrusts it until 840 ms, when that
round arrives. **A refusal** is the same crash and the same policy with one
observer: the gate declines at 620 ms with `insufficient_witnesses`, B stays
down, and the log shows a decision not to act rather than an absence of one.

The page is not an illustration. `src/engine/` is a direct port of the Go engine
(`internal/domain`, `internal/sim`, `internal/detector`, `internal/causal`,
`internal/recovery`, `internal/verify`), and the proof section runs all four
canonical worlds in the browser and compares each JSONL, byte for byte, against
the log the Go CLI produced — 139 events in total, hashed on both sides in the
page. The decisions are read back out of the log by a port of the proof query
rather than trusted from the run that made them.

Every event in that log cites the events that caused it, so the page can answer
a second question: not only what happened, but why a belief changed. Click any
belief, any line in the live log, or any row of the four committed histories —
16, 75, 37 and 11 events — and it opens that event's chain, the same ancestry
`aegis explain` prints: the crash visibly absent from a suspicion's reasoning,
the repair absent from a belief until a message arrives, and the refusal
standing on the one report it declined.

## The page

- **Hero** — truth, belief and decision side by side: B crashes at 215 ms, A
  believes it anyway until 570 ms, the system puts it back at 720 ms.
- **Story** — six moments, from the promise to the refusal.
- **Lab** — four worlds on a virtual clock, with a `DECISION` block whose proof
  is read back out of the log, and a chain behind every belief.
- **The log** — any of the four committed histories (16, 75, 37, 11 lines),
  every line openable into the events it rests on.
- **Principles** — eighteen decisions, twelve about observing a failure and six
  about acting on one.
- **Proof** — all four worlds re-run in the browser and hashed against the Go
  output: 4 / 4 identical, 139 events.
- **Code map** — where each idea lives in the Go repository.

## Run it

```bash
npm install
npm run dev
```

## Prove it

```bash
npm run check         # typecheck → lint → gate → parity → build, stopping at the first failure
```

The same steps, one at a time:

```bash
npm run typecheck:scripts  # tsc -p tsconfig.scripts.json (strict, no emit)
npm run lint          # oxlint over the page and the scripts
npm run gate          # re-measure the proof card's numbers from ../aegis
npm run parity        # every world vs. the Go fixtures, hashed + causal claims
npm run build         # tsc -b && vite build
npm run sync-fixture  # regenerate every fixture from ../aegis (set AEGIS_GO_REPO)
```

`npm run check` runs them in that order — the scripts are typechecked and linted
first, then the card is measured, then verified against the repository, then
built — and stops as soon as one fails, so a failing parity check never gets a
green build printed after it. The scripts are checked by `tsconfig.scripts.json`
because `tsc -b` only ever compiled the page: nothing typechecked the checks
themselves before that.

`npm run parity` runs the Go program again before it compares anything, so when
the two logs disagree it can say which side moved. A scenario that changed in the
implementation fails as a stale fixture — which file it is, the Go file and line
that define the scenario, what changed across the whole log (events added,
removed, retimed, or changed beyond their timestamp, with one example), and
`npm run sync-fixture` to recopy it. That path is found by reading the Go
repository at failure time rather than hardcoded, so it stays right if a scenario
moves. A port that drifted fails against the fixture instead, and points at
`src/engine/`. Both are the same exit code and mean opposite repairs, which is why
the check tells them apart rather than printing one log against another.

The worlds are a hand-written list, so `npm run parity` also compares it against
the scenarios the implementation can run — asked of `go run ./cmd/aegis
scenarios`, which prints them one per line, rather than parsed out of its source
or read from the usage text beside it. A scenario that exists but has no world
fails the check by name, because a page that omits one still reads as having
checked them all.

CI runs the same gate on every push and pull request. Because the page proves
things about the Go repository, the workflow checks that out too and runs
`make check-all` from it, with `AEGIS_GO_REPO` saying where it landed — so a
change to the page is gated without a commit to the implementation.

`npm run hooks` points `core.hooksPath` at `hooks/`, where a pre-push hook runs
`npm run check` before anything leaves the machine. Branch protection cannot
require that check: GitHub rejects a direct push to `main` with `GH006` because
the checks only exist after the push they would reject. `git push --no-verify`
skips it when the push is not about code.

`npm run sync-fixture` shells out to `go run ./cmd/aegis run --scenario <name>
--format jsonl` for each scenario the Go repository can run, defaulting to
`../aegis`. That list comes from `aegis scenarios` rather than being kept here,
so a new scenario is synced instead of being left with a fixture nobody writes.

The proof card's gate numbers — packages, test and race results, vet, coverage,
scenarios replayed — are not typed into the page. `npm run gate` measures them in
the Go repository and writes `src/engine/gate.json`, and `npm run parity`
re-measures them, failing with `run: npm run gate` when the committed card no
longer agrees.

## Where things are

| Path | What it is |
| --- | --- |
| `src/engine/` | The ported simulator: `scheduler`, `network`, `nodes`, `detector`, `rng`, `recorder`. |
| `src/engine/causal.ts` | The ported graph: validates a history, walks ancestors, explains any event. |
| `src/engine/recovery.ts` | The policy, the witness, the decision and the pure gate that turns reports into one. |
| `src/engine/verify.ts` | The proof query: was this action proposed, started and applied, by edge? |
| `src/engine/fixtures/node-crash.jsonl` | The Go program's own output, committed as the comparison target. |
| `src/engine/fixtures/one-way-partition.jsonl` | The same for the cut world: 75 events, cuts and drops included. |
| `src/engine/fixtures/recovered-crash.jsonl` | The granted history: 37 events, a restart at 720 ms, a belief cleared at 840 ms. |
| `src/engine/fixtures/lone-witness.jsonl` | The refused history: 11 events, and no restart anywhere in it. |
| `src/components/Lab.tsx` | The live lab: virtual clock, transport, beliefs, decision block, event log, controls. |
| `src/components/ChainPanel.tsx` | The chain behind a belief or an event, shared by the live lab and the static log. |
| `src/components/EventTable.tsx` | The static log: four selectable histories, each line opening its chain. |
| `src/components/Proof.tsx` | Re-runs all four worlds and hashes each pair in the browser. |
| `src/engine/gate.json` | The measured gate facts the proof card displays; generated, never hand-edited. |
| `scripts/parity.ts` | The same comparison as a build-time check, with a non-zero exit on mismatch. |
| `scripts/gate.ts` | Measures the Go gate and writes `gate.json`; `scripts/gate-lib.ts` is shared with parity. |

Design: black and white only, Geist / Geist Mono, one grid, no decorative colour.
