#!/usr/bin/env bash
# Sass CLI — start, setup, update, doctor (installed to ~/.local/bin/sass by install.sh)
set -euo pipefail

SASS_STATE="${SASS_STATE:-$HOME/.sass/env}"
if [[ -f "$SASS_STATE" ]]; then
  # shellcheck disable=SC1090
  source "$SASS_STATE"
fi

SASS_DIR="${SASS_DIR:-$HOME/Sass}"

die() {
  echo "sass: $*" >&2
  exit 1
}

sass_node() {
  if [[ -x "$SASS_DIR/runtime/bin/node" ]]; then printf '%s' "$SASS_DIR/runtime/bin/node"; else command -v node; fi
}


need_repo() {
  if [[ ! -f "$SASS_DIR/package.json" ]]; then
    die "Sass is not installed at $SASS_DIR. Run the installer from https://github.com/philippsyrov/Sass"
  fi
}

run_in_repo() {
  need_repo
  (cd "$SASS_DIR" && "$@")
}

npm_install_quiet() {
  need_repo
  if (cd "$SASS_DIR" && npm install --no-audit --no-fund --loglevel=error); then
    return 0
  fi
  echo "npm install failed. Retrying with full output…" >&2
  (cd "$SASS_DIR" && npm install --no-audit --no-fund)
}

ensure_build() {
  need_repo
  if [[ -f "$SASS_DIR/bundle-manifest.json" ]]; then return 0; fi
  if [[ ! -f "$SASS_DIR/dist/index.js" ]]; then
    echo "Building Sass (first time)…"
    run_in_repo npm run build
    return
  fi
  if find "$SASS_DIR/src" -newer "$SASS_DIR/dist/index.js" -print -quit 2>/dev/null | grep -q .; then
    echo "Rebuilding Sass…"
    run_in_repo npm run build
  fi
}

cmd_start() {
  if [[ ! -f "$SASS_DIR/.env" ]]; then
    echo "No .env yet. Run: sass setup"
    exit 1
  fi
  ensure_build
  echo "Starting Sass (Ctrl+C to stop her and the local database)."
  cd "$SASS_DIR"
  exec "$(sass_node)" dist/index.js
}

cmd_setup() {
  need_repo
  echo "Setup wizard — secrets stay hidden. Press Ctrl+C to quit without saving."
  if [[ -f "$SASS_DIR/bundle-manifest.json" ]]; then
    run_in_repo "$(sass_node)" dist/setup.js
  else
    run_in_repo npm run setup
  fi
}

cmd_update() {
  need_repo
  if [[ -f "$SASS_DIR/bundle-manifest.json" ]]; then
    echo 'Update with the one-line installer. Your settings and data are retained.'
    return 0
  fi
  if [[ -d "$SASS_DIR/.git" ]]; then
    echo "Updating Sass from git…"
    git -C "$SASS_DIR" pull --ff-only
  fi
  echo "Updating npm packages…"
  npm_install_quiet
  echo "Building…"
  run_in_repo npm run build
  echo "Done. Run sass to start."
}

cmd_doctor() {
  need_repo
  ensure_build
  run_in_repo "$(sass_node)" dist/doctor.js
}

cmd_invite() {
  ensure_build
  run_in_repo "$(sass_node)" dist/invite.js
}

cmd_stop() {
  echo "Sass runs in the terminal you started her in. Switch to that window and press Ctrl+C."
  echo "That stops the bot and the local Postgres safely."
}

cmd_uninstall() {
  local sass_home="${SASS_HOME:-$HOME/.sass}"
  local bin_dir="${SASS_BIN_DIR:-$HOME/.local/bin}"
  echo "This removes Sass from this computer:"
  echo "  $SASS_DIR — bot code and .env"
  echo "  $sass_home — private Node and installer state"
  echo "  PATH line for $bin_dir/sass in your shell profile"
  echo ""
  printf 'Type uninstall to confirm: '
  read -r reply
  if [[ "$reply" != uninstall ]]; then
    echo "Cancelled — nothing was removed."
    exit 0
  fi
  for rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    [[ -f "$rc" ]] || continue
    if grep -q '# Sass installer' "$rc" 2>/dev/null; then
      sed -i.bak '/# Sass installer/,+1d' "$rc" 2>/dev/null || sed -i '' '/# Sass installer/,+1d' "$rc" 2>/dev/null || true
      echo "Updated $rc (backup .bak if created)"
    fi
  done
  rm -f "$bin_dir/sass"
  rm -rf "$SASS_DIR" "$sass_home"
  echo "Done. Sass is uninstalled."
}

cmd_help() {
  cat <<'EOF'
sass — run the Sass Discord bot from ~/Sass (or your SASS_DIR)

  sass              Start the bot (builds first if needed)
  sass setup        Run the interactive setup wizard again
  sass update       git pull, npm install, and build
  sass doctor       Check .env, database, and embeddings
  sass settings     Expert configuration (custom database, models, behavior)
  sass invite       Show the Discord server invite link
  sass stop         How to stop a running bot (Ctrl+C)
  sass uninstall    Remove ~/Sass, ~/.sass, and the sass command
  sass help         This message

After setup, register slash commands once:
  cd ~/Sass && node dist/register-commands.js
EOF
}

main() {
  case "${1:-}" in
    ''|start) cmd_start ;;
    setup) cmd_setup ;;
    settings) export SASS_SETUP_ADVANCED=1; cmd_setup ;;
    update) cmd_update ;;
    doctor) cmd_doctor ;;
    invite) cmd_invite ;;
    stop) cmd_stop ;;
    help|--help|-h) cmd_help ;;
    uninstall) cmd_uninstall ;;
    *) die "Unknown command: $1 (try sass help)" ;;
  esac
}

main "$@"
