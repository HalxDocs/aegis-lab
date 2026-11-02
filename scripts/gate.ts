/**
 * Regenerates `src/engine/gate.json`, the numbers the proof card shows.
 *
 *   npm run gate
 *
 * The parity check re-measures the same facts and fails when the committed card
 * no longer agrees with the repository, so a stale number is a broken check
 * rather than a quiet lie on the page.
 */
import { renameSync, writeFileSync } from "node:fs";

import { gatePath, goRepo, measureGate } from "./gate-lib";

console.log(`measuring the gate in ${goRepo}`);
const facts = measureGate();

// Written beside the destination and renamed into place: the dev server watches
// this file, and a partial read would fail to parse rather than show a number.
const scratch = `${gatePath}.tmp`;
writeFileSync(scratch, `${JSON.stringify(facts, null, 2)}\n`);
renameSync(scratch, gatePath);

const line = (label: string, value: string) => console.log(`  ${label.padEnd(16)} ${value}`);
line("packages", String(facts.packages));
line("go test", facts.test ? "ok" : "FAILING");
line("go test -race", facts.race ? "ok" : "FAILING");
line("go vet", facts.vet ? "clean" : "FAILING");
line("coverage", `${facts.coverage.toFixed(1)}% of statements`);
line("make replay", `${facts.replay.scenarios.length} scenarios ${facts.replay.ok ? "identical" : "FAILING"}`);
console.log(`\nwrote ${gatePath}`);
