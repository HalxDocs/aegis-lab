/**
 * The gate, measured from the Go repository.
 *
 * The proof card used to state these numbers as prose — "9 packages ok",
 * "92.4% of statements" — which meant they were true the day they were typed and
 * silently false afterwards. They are facts about a repository that changes, so
 * they are measured, written to `src/engine/gate.json`, and re-measured by the
 * parity check, which fails when the card and the repository disagree.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const labRoot = join(here, "..");
export const goRepo = process.env.AEGIS_GO_REPO ?? join(labRoot, "..", "aegis");
export const gatePath = join(labRoot, "src", "engine", "gate.json");

export interface GateFacts {
  /** Packages the Go module builds, as `go list ./...` counts them. */
  packages: number;
  test: boolean;
  race: boolean;
  vet: boolean;
  /** Total statement coverage, in percent, from `go tool cover`. */
  coverage: number;
  replay: { ok: boolean; scenarios: string[] };
}

const command = (cmd: string, args: string[], cwd: string): { ok: boolean; out: string } => {
  try {
    const out = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/** Runs every command the card talks about, and returns what they said. */
export function measureGate(): GateFacts {
  const packages = command("go", ["list", "./..."], goRepo)
    .out.trim()
    .split("\n")
    .filter(Boolean).length;

  const test = command("go", ["test", "./..."], goRepo).ok;
  const race = command("go", ["test", "-race", "./..."], goRepo).ok;
  const vet = command("go", ["vet", "./..."], goRepo).ok;

  const scratch = mkdtempSync(join(tmpdir(), "aegis-cover-"));
  const profile = join(scratch, "coverage.out");
  command("go", ["test", "-coverprofile", profile, "./..."], goRepo);
  const summary = command("go", ["tool", "cover", "-func", profile], goRepo).out;
  rmSync(scratch, { recursive: true, force: true });

  const total = summary.split("\n").find((line) => line.startsWith("total:")) ?? "";
  const percent = /(\d+(?:\.\d+)?)%/.exec(total);
  const coverage = percent ? Number(percent[1]) : 0;

  const replay = command("make", ["replay"], goRepo);
  const scenarios = [...replay.out.matchAll(/^replay (\S+): identical$/gm)].map((match) => match[1]);

  return { packages, test, race, vet, coverage, replay: { ok: replay.out.includes("identical"), scenarios } };
}

/** A stable, human-readable comparison of two measurements. */
export function differences(committed: GateFacts, measured: GateFacts): string[] {
  const out: string[] = [];
  const check = (label: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${label}: card says ${JSON.stringify(a)}, repo says ${JSON.stringify(b)}`);
  };
  check("packages", committed.packages, measured.packages);
  check("go test", committed.test, measured.test);
  check("go test -race", committed.race, measured.race);
  check("go vet", committed.vet, measured.vet);
  check("coverage", committed.coverage, measured.coverage);
  check("replay", committed.replay, measured.replay);
  return out;
}
