/**
 * The scenarios the Go implementation can run, read from its own dispatch.
 *
 * `func lookup` in cmd/aegis/main.go is the set: the usage text and the
 * unknown-scenario error each repeat that list by hand, so trusting either would
 * only compare one copy against another. Both the parity check and the fixture
 * sync ask this module, so a scenario added in the Go repository is noticed by
 * both rather than remembered by each.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The case arms of `func lookup`, or null when the function cannot be read. */
export const runnableScenarios = (goRepo: string): string[] | null => {
  let text: string;
  try {
    text = readFileSync(join(goRepo, "cmd/aegis/main.go"), "utf8");
  } catch {
    return null;
  }

  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^func lookup\(/.test(line));
  if (start < 0) return null;

  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("}")) break;
    const match = /^\s*case "([^"]+)":/.exec(line);
    if (match !== null) names.push(match[1]);
  }
  return names.length === 0 ? null : names;
};
