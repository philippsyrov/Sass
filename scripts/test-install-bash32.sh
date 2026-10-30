#!/usr/bin/env bash
# Check the piped Bash 3.2 preamble. Headless installs must require explicit consent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASH32_BIN="${BASH32_BIN:-/bin/bash}"
if [[ ! -x "$BASH32_BIN" ]]; then
  echo "  ⏭ bash 3.2 test skipped (no local Bash 3.2 binary)"
  exit 0
fi
ver="$("$BASH32_BIN" --version | head -1)"
case "$ver" in
  *"version 3.2"*) ;;
  *) echo "  ⏭ bash 3.2 test skipped (local binary is not Bash 3.2)"; exit 0 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
cp "$ROOT/scripts/install-ui.sh" "$work/ui.sh"
cat >>"$work/ui.sh" <<'UI'
# Synthetic consent prevents this smoke test from installing anything.
installer_has_tty() { return 1; }
installer_confirm_continue() {
  installer_out 'Stopped — nothing was changed.'
  return 1
}
UI
cat >"$work/bin/curl" <<'CURL'
#!/bin/sh
if [ "$1" = -fsSL ] && [ "$3" = -o ]; then
  cp "$SASS_TEST_UI" "$4"
else
  exit 99
fi
CURL
chmod +x "$work/bin/curl"
for command_name in git node npm; do
  cat >"$work/bin/$command_name" <<'BLOCK'
#!/bin/sh
printf 'Unexpected installer action\n' >&2
exit 99
BLOCK
  chmod +x "$work/bin/$command_name"
done

export SASS_SOURCE_INSTALL=1
export SASS_INSTALL_ASSUME_YES=0
export SASS_DIR="$work/repo"
export SASS_HOME="$work/state"
export SASS_BIN_DIR="$work/launcher"
export SASS_REPO="https://github.com/example/Sass.git"
export SASS_BRANCH="smoke/branch"
export SASS_INSTALL_SOURCE_URL="https://github.com/example/Sass/blob/${SASS_BRANCH}/install.sh"
export SASS_TEST_UI="$work/ui.sh"
export TMPDIR="$work"
export CI=1 NO_COLOR=1 SASS_SETUP_NO_MASCOT=1
export PATH="$work/bin:$PATH"

# Input through stdin matches curl | bash. Cwd has no local installer UI.
if (cd "$work" && python3 -c 'import os, subprocess, sys; os.setsid(); sys.exit(subprocess.call([sys.argv[1]], stdin=open(sys.argv[2], "rb")))' "$BASH32_BIN" "$ROOT/install.sh") >"$work/output" 2>&1; then
  cat "$work/output"
  echo '  ❌ headless installer accepted without consent'
  exit 1
fi
if ! grep -q 'terminal.*SASS_INSTALL_ASSUME_YES=1' "$work/output" \
  || grep -qE 'unbound variable|Unexpected installer action|All set' "$work/output" \
  || [[ -e "$SASS_DIR" || -e "$SASS_HOME" || -e "$SASS_BIN_DIR" ]]; then
  cat "$work/output"
  echo '  ❌ bash 3.2 headless consent smoke test failed'
  exit 1
fi

echo "  ✅ bash 3.2 headless consent smoke test passed ($ver)"
