#!/bin/sh
set -e

aws s3 sync "$1" "$2" \
  --exclude "*" \
  --include "config/*" --include "defaultconfigs/*" --include "mods/*" --include "world/*" \
  --include "ops.json" --include "whitelist.json" --include "server.properties"
echo "download done"
