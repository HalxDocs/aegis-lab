#!/usr/bin/env bash
# Regenerates the parity fixture from the Go implementation.
#
#   AEGIS_GO_REPO=/path/to/aegis npm run sync-fixture
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
go_repo="${AEGIS_GO_REPO:-$here/../aegis}"
if [ ! -d "$go_repo" ]; then
  echo "Go repository not found at $go_repo (set AEGIS_GO_REPO)" >&2
  exit 1
fi

# Each fixture is written beside its destination and renamed into place. The
# dev server watches these files, and a plain redirect leaves a window in which a
# reload can read a half-written log and fail to parse it; rename is atomic.
for scenario in node-crash one-way-partition recovered-crash lone-witness; do
  out="$here/src/engine/fixtures/$scenario.jsonl"
  (cd "$go_repo" && go run ./cmd/aegis run --scenario "$scenario" --format jsonl) > "$out.tmp"
  mv "$out.tmp" "$out"
  echo "wrote $out ($(wc -l < "$out" | tr -d ' ') events)"
done
