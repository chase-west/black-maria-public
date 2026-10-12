#!/bin/sh
# Placeholder art is generated, never committed: make sure it exists in the (possibly mounted) assets dir.
set -e
if [ ! -d "$ASSETS_DIR/placeholders" ]; then
  echo "blackmaria: generating placeholders in $ASSETS_DIR"
  node packages/assetgen/dist/generate.js || echo "blackmaria: placeholder generation failed; runtime placeholders will be drawn in the browser"
fi
exec "$@"
