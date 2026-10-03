#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Capture README/tutorial screenshots of the built index.html with headless Chrome (uses the app's ?demo= mode).
# Usage: tools/screenshots.sh   (macOS default Chrome path; override with CHROME=/path/to/chrome)
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
APP="file://$PWD/index.html"
mkdir -p docs/img
shot() { # name demo width height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$3,$4" --virtual-time-budget=40000 --screenshot="docs/img/$1.png" "$APP?demo=$2" >/dev/null 2>&1
  echo "docs/img/$1.png"
}
shot app-overview      hplc             1440 900
shot compare           compare          1440 900
shot calibration       calibration      1440 900
shot integration-math  integration-math 1440 900
shot digitizer         image            1440 900
shot about             about            1440 900
shot fplc              fplc             1440 900
shot split-dialog      split            1440 900
shot mobile            hplc             500  1000  # headless Chrome enforces a 500 px minimum viewport
