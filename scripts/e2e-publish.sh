#!/bin/sh
# Phase E end to end: pack both published packages, then from clean directories with an empty npm cache:
#   1. npx @black-maria/sim play --vs master --seed 7
#   2. npx blackmaria play --vs novice      (against the packed simulator's local wire server)
#   3. npx blackmaria official              (9 matches, 3 at a time, through the Master network profile)
# usage: sh scripts/e2e-publish.sh [MAX_TICK]   (default 60 ticks per match for step 3; step 2 plays a full match)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MAX_TICK=${1:-60}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/bm-e2e.XXXXXX")
export npm_config_cache="$WORK/npm-cache"
export npm_config_update_notifier=false
PORT=$((20000 + $$ % 20000))
SIM_PID=""
cleanup() {
  if [ -n "$SIM_PID" ]; then kill "$SIM_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

echo "e2e: packing into $WORK/pack"
node "$ROOT/scripts/pack-public.mjs" --out "$WORK/pack"
SIM_TGZ="$WORK/pack/black-maria-sim-0.7.1.tgz"
CLIENT_TGZ="$WORK/pack/blackmaria-0.7.1.tgz"

echo "e2e: 1. npx @black-maria/sim play --vs master --seed 7 (clean directory)"
mkdir "$WORK/one" && cd "$WORK/one"
npx --yes --package "$SIM_TGZ" sim play --vs master --seed 7 | tee "$WORK/one.log"
grep -q "^Result: " "$WORK/one.log"
grep -q "Errands Maria took first" "$WORK/one.log"

echo "e2e: 2. npx blackmaria play --vs novice (clean directory, local wire server on UDP $PORT)"
mkdir "$WORK/two" && cd "$WORK/two"
npm install --no-audit --no-fund --silent "$SIM_TGZ" "$CLIENT_TGZ"
printf 'BM_PORTS=%s\n' "$PORT" > .env
npx sim wire --port "$PORT" > "$WORK/wire.log" 2>&1 &
SIM_PID=$!
sleep 2
npx blackmaria play --vs novice | tee "$WORK/two.log"
grep -q "against Maria (Novice): " "$WORK/two.log"
kill "$SIM_PID"; wait "$SIM_PID" 2>/dev/null || true; SIM_PID=""

echo "e2e: 3. npx blackmaria official through the Master network profile ($MAX_TICK ticks per match)"
npx sim wire --port "$PORT" --chaos master --max-tick "$MAX_TICK" > "$WORK/wire-official.log" 2>&1 &
SIM_PID=$!
sleep 2
npx blackmaria official | tee "$WORK/three.log"
grep -q "^Official run done" "$WORK/three.log"
sleep 1
grep -q "^Official run .* finished" "$WORK/wire-official.log"
test "$(grep -c "official .* of 9, .*network master) ended" "$WORK/wire-official.log")" -eq 9
cat "$WORK/wire-official.log"
echo "e2e: all green ($WORK)"
