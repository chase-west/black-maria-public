#!/bin/sh
# Full CI: install, lint, typecheck, build, test (TS), test (Python SDK), layout stability.
set -e
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
# Layout stability in a headless Chrome (skips with a note where there is none; LAYOUT_REQUIRE=1 makes it fail).
pnpm layout
echo "ci: all green"
