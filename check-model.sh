#!/bin/sh
# Smoke-test unit-model.js and report every plan it defines.
# Uses JavaScriptCore, which ships with macOS — nothing to install.
set -e
cd "$(dirname "$0")"

JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
if [ ! -x "$JSC" ]; then
  echo "no JavaScriptCore at $JSC" >&2; exit 1
fi

if [ -n "$1" ]; then
  exec "$JSC" -e "PLAN=\"$1\"" check-model.js
fi
exec "$JSC" check-model.js
