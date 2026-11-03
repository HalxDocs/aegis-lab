/**
 * The scenarios the Go implementation can run, read from its own dispatch.
 *
 * The `runnable` table in cmd/aegis/main.go is the set: the usage text repeats
 * that list by hand, so trusting it would only compare one copy against another.
 * Both the parity check and the fixture sync ask this module, so a scenario added
 * in the Go repository is noticed by both rather than remembered by each.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The names in the `runnable` table, or null when it cannot be read. */
export const runnableScenarios = (goRepo: string): string[] | null => {
  let text: string;
  try {
    text = readFileSync(join(goRepo, "cmd/aegis/main.go"), "utf8");
  } catch {
    return null;
  }

  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("var runnable = "));
  if (start < 0) return null;

  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The table's field lines and its `}{` follow the declaration, so only a
    // closing brace on its own ends the entries.
    if (line === "}") break;
    const match = /\bname:\s*"([^"]+)"/.exec(line);
    if (match !== null) names.push(match[1]);
  }
  return names.length === 0 ? null : names;
};
