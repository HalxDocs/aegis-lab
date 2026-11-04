/**
 * The scenarios the Go implementation can run, asked of the implementation.
 *
 * `go run ./cmd/aegis scenarios` prints them one per line. Asking the binary is
 * the point: a previous version parsed the `runnable` table out of main.go, which
 * meant this check failed with the right loudness and the wrong diagnosis when
 * that file moved, and could not tell a reshaped table from an empty one. The
 * command is an interface, so a rename there is a contract change rather than a
 * regex that quietly stops matching.
 *
 * Both the parity check and the fixture sync ask this module, so a scenario added
 * in the Go repository is noticed by both rather than remembered by each.
 */
import { execFileSync } from "node:child_process";

/** The names the implementation prints, or null when it cannot be asked. */
export const runnableScenarios = (goRepo: string): string[] | null => {
  let out: string;
  try {
    out = execFileSync("go", ["run", "./cmd/aegis", "scenarios"], {
      cwd: goRepo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }

  const names = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return names.length === 0 ? null : names;
};
