/**
 * Regenerates every parity fixture from the Go implementation.
 *
 *   AEGIS_GO_REPO=/path/to/aegis npm run sync-fixture
 *
 * The scenario list comes from the implementation, not from a copy kept here. A
 * scenario added there is synced rather than left with a fixture nobody writes,
 * which is the state parity's coverage check reports as uncovered.
 */
import { execFileSync } from "node:child_process";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runnableScenarios } from "./go-scenarios";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "src", "engine", "fixtures");
const goRepo = process.env.AEGIS_GO_REPO ?? join(here, "..", "..", "aegis");

if (!existsSync(goRepo)) {
  console.error(`Go repository not found at ${goRepo} (set AEGIS_GO_REPO)`);
  process.exit(1);
}

const scenarios = runnableScenarios(goRepo);
if (scenarios === null) {
  console.error(
    `could not run \`go run ./cmd/aegis scenarios\` in ${goRepo}.\n\n` +
      `  That command prints the scenarios the implementation can run, one per` +
      ` line. Without it the fixtures cannot be regenerated for the right set.`,
  );
  process.exit(1);
}

for (const scenario of scenarios) {
  const log = execFileSync(
    "go",
    ["run", "./cmd/aegis", "run", "--scenario", scenario, "--format", "jsonl"],
    { cwd: goRepo, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );

  // Written beside the destination and renamed into place: the dev server watches
  // these files, and a plain write leaves a window in which a reload can read a
  // half-written log and fail to parse it.
  const out = join(fixtures, `${scenario}.jsonl`);
  writeFileSync(`${out}.tmp`, log);
  renameSync(`${out}.tmp`, out);
  console.log(
    `wrote src/engine/fixtures/${scenario}.jsonl (${log.trimEnd().split("\n").length} events)`,
  );
}
