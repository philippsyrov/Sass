#!/usr/bin/env bash
# Sass one-line installer — safe to pipe: curl -fsSL …/install.sh | bash
# Reads prompts from /dev/tty when setup needs input.
set -euo pipefail

SASS_HOME="${SASS_HOME:-$HOME/.sass}"
SASS_DIR="${SASS_DIR:-$HOME/Sass}"
SASS_REPO="${SASS_REPO:-https://github.com/philippsyrov/Sass.git}"
sass_resolve_branch() {
  if [[ -n "${SASS_BRANCH:-}" ]]; then
    printf '%s' "$SASS_BRANCH"
    return 0
  fi
  if [[ -n "${SASS_INSTALL_BRANCH:-}" ]]; then
    printf '%s' "$SASS_INSTALL_BRANCH"
    return 0
  fi
  local url="${SASS_INSTALL_SOURCE_URL:-${SASS_INSTALL_SCRIPT_URL:-}}"
  if [[ "$url" =~ github\.com/[^/]+/[^/]+/(blob|tree)/(.+)/install\.sh([?#].*)?$ ]]; then
    printf '%s' "${BASH_REMATCH[2]}"
    return 0
  fi
  if [[ "$url" =~ raw\.githubusercontent\.com/[^/]+/[^/]+/(.+)/install\.sh([?#].*)?$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  printf '%s' "main"
}

SASS_BRANCH="$(sass_resolve_branch)"
export SASS_BRANCH
SASS_BIN_DIR="${SASS_BIN_DIR:-$HOME/.local/bin}"
NODE_LTS_VERSION="${SASS_NODE_VERSION:-22.12.0}"

install_ui_path() {
  # macOS ships bash 3.2, where BASH_SOURCE is empty when piped (curl | bash)
  # and set -u would abort on it. Read it with nounset off.
  local src=""
  set +u
  src="${BASH_SOURCE[1]:-${BASH_SOURCE[0]:-}}"
  set -u
  if [[ -n "$src" && "$src" != bash && -f "$src" ]]; then
    cd "$(dirname "$src")" && pwd
    return 0
  fi
  echo ""
}

# Keep installation usable when the optional UI download is unavailable.
installer_task() { "$@"; }
installer_spinner_start() { say "  … $1"; }
installer_spinner_ok() { say "  ✓ $1"; }
installer_spinner_fail() { warn "$1"; }
installer_confirm_continue() {
  if [[ "${SASS_INSTALL_ASSUME_YES:-0}" == "1" ]]; then
    return 0
  fi
  if ! has_interactive_tty; then
    warn "Run this installer in a terminal, or set SASS_INSTALL_ASSUME_YES=1 for automation."
    return 1
  fi
  local reply
  printf 'Continue? (Enter = yes, n = quit) ' >/dev/tty
  read -r reply </dev/tty || return 1
  case "${reply:-y}" in
    y|Y|yes|YES) return 0 ;;
    *) say "Stopped — nothing was changed."; return 1 ;;
  esac
}

INSTALLER_DIR="$(install_ui_path)"
INSTALL_UI=""
if [[ -n "$INSTALLER_DIR" && -f "$INSTALLER_DIR/scripts/install-ui.sh" ]]; then
  INSTALL_UI="$INSTALLER_DIR/scripts/install-ui.sh"
elif [[ -f "${SASS_DIR}/scripts/install-ui.sh" ]]; then
  INSTALL_UI="${SASS_DIR}/scripts/install-ui.sh"
elif [[ -n "${SASS_REPO:-}" ]]; then
  INSTALL_UI="$(mktemp)"
  INSTALLER_UI_TEMP="$INSTALL_UI"
  _ui_repo="${SASS_REPO#https://github.com/}"
  _ui_repo="${_ui_repo%.git}"
  if curl -fsSL "https://raw.githubusercontent.com/${_ui_repo}/${SASS_BRANCH}/scripts/install-ui.sh" -o "$INSTALL_UI" --connect-timeout 10 --max-time 30 2>/dev/null; then
    :
  else
    rm -f "$INSTALL_UI"
    INSTALL_UI=""
  fi
fi
if [[ -n "$INSTALL_UI" && -f "$INSTALL_UI" ]]; then
  # shellcheck source=scripts/install-ui.sh
  source "$INSTALL_UI"
fi

has_interactive_tty() {
  { : >/dev/tty; } 2>/dev/null
}

say() {
  if [[ "${INSTALLER_FRAME_ACTIVE:-0}" == 1 ]]; then installer_out "$*"; return; fi
  if has_interactive_tty; then printf '%s\n' "$*" >/dev/tty
  else printf '%s\n' "$*"
  fi
}
warn() {
  if [[ "${INSTALLER_FRAME_ACTIVE:-0}" == 1 ]]; then installer_out "! $*"; return; fi
  if has_interactive_tty; then printf '  ! %s\n' "$*" >/dev/tty
  else printf '  ! %s\n' "$*"
  fi
}

installer_use_color() {
  [[ -z "${NO_COLOR:-}" ]]
}

say_phase() {
  local msg="$1"
  if [[ "${INSTALLER_FRAME_ACTIVE:-0}" == 1 ]]; then installer_out "$msg"; return; fi
  if installer_use_color && has_interactive_tty; then
    printf '  \033[32m✓\033[0m %s\n' "$msg" >/dev/tty
  else
    say "  ✓ $msg"
  fi
}

say_step() {
  say "  → $1"
}

setup_tty() {
  if has_interactive_tty; then echo /dev/tty
  else echo /dev/stdin
  fi
}

platform_os() {
  uname -s | tr '[:upper:]' '[:lower:]'
}

platform_arch() {
  local raw
  raw="$(uname -m)"
  case "$raw" in
    x86_64|amd64) echo 'x64' ;;
    arm64|aarch64) echo 'arm64' ;;
    *) die "Unsupported CPU architecture: $raw" ;;
  esac
}

die() {
  warn "$*"
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_git() {
  installer_spinner_start "Checking git"
  if need_cmd git; then
    installer_spinner_ok "Git ready"
    return 0
  fi
  installer_spinner_fail "Git not found"
  local os
  os="$(platform_os)"
  if [[ "$os" == "darwin" ]]; then
    say "Git is not installed yet."
    say "macOS should show a dialog — choose Install to add Command Line Tools (includes git)."
    if need_cmd xcode-select; then
      xcode-select --install >/dev/null 2>&1 || true
    fi
    say "Waiting for git… (this can take several minutes after you click Install)"
    local tries=0
    while ! need_cmd git; do
      sleep 5
      tries=$((tries + 1))
      if [[ "$tries" -gt 360 ]]; then
        die "Git still not available. Install Command Line Tools, then run this installer again."
      fi
    done
    installer_spinner_ok "Git ready"
    return 0
  fi
  die "Git is required. Install it with your package manager, then run this installer again."
}

node_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

system_node_ok() {
  if ! need_cmd node; then
    return 1
  fi
  local major
  major="$(node_major node)"
  [[ "${major:-0}" -ge 20 ]]
}

private_node_dir() {
  echo "$SASS_HOME/node/v${NODE_LTS_VERSION}"
}

install_private_node() {
  local os arch base name tarball url sums_url tmpdir sum_line expected
  os="$(platform_os)"
  arch="$(platform_arch)"
  case "$os" in
    darwin) base="darwin" ;;
    linux) base="linux" ;;
    *) die "Unsupported OS for automatic Node install: $os" ;;
  esac
  name="node-v${NODE_LTS_VERSION}-${base}-${arch}"
  tarball="${name}.tar.xz"
  url="https://nodejs.org/dist/v${NODE_LTS_VERSION}/${tarball}"
  sums_url="https://nodejs.org/dist/v${NODE_LTS_VERSION}/SHASUMS256.txt"
  tmpdir="$(mktemp -d)"

  installer_spinner_start "Downloading Node ${NODE_LTS_VERSION} (${base}-${arch})"
  if ! need_cmd curl; then
    die "curl is required to download Node."
  fi
  curl -fsSL "$sums_url" -o "$tmpdir/SHASUMS256.txt"
  curl -fsSL "$url" -o "$tmpdir/$tarball"
  expected="$(grep "  ${tarball}$" "$tmpdir/SHASUMS256.txt" | awk '{print $1}')"
  if [[ -z "$expected" ]]; then
    die "Could not find SHA256 for ${tarball} in official SHASUMS256.txt"
  fi
  if need_cmd sha256sum; then
    sum_line="$(sha256sum "$tmpdir/$tarball" | awk '{print $1}')"
  elif need_cmd shasum; then
    sum_line="$(shasum -a 256 "$tmpdir/$tarball" | awk '{print $1}')"
  else
    die "Need sha256sum or shasum to verify the Node download."
  fi
  if [[ "$sum_line" != "$expected" ]]; then
    die "Node download failed verification. Try again later."
  fi

  mkdir -p "$SASS_HOME/node"
  rm -rf "$(private_node_dir)"
  tar -xJf "$tmpdir/$tarball" -C "$SASS_HOME/node"
  mv "$SASS_HOME/node/$name" "$(private_node_dir)"
  ln -sfn "v${NODE_LTS_VERSION}" "$SASS_HOME/node/current"
  rm -rf "$tmpdir"
  installer_spinner_ok "Node ${NODE_LTS_VERSION} downloaded"
}

SASS_USE_PRIVATE_NODE=0

ensure_node() {
  installer_spinner_start "Checking Node.js"
  if [[ "${SASS_FORCE_PRIVATE_NODE:-0}" != "1" ]] && system_node_ok; then
    installer_spinner_ok "Node $(node -v) from PATH"
    return 0
  fi
  if [[ -x "$SASS_HOME/node/current/bin/node" ]]; then
    local major
    major="$(node_major "$SASS_HOME/node/current/bin/node")"
    if [[ "${major:-0}" -ge 20 ]]; then
      installer_spinner_ok "Node $($SASS_HOME/node/current/bin/node -v) from ~/.sass/node"
      SASS_USE_PRIVATE_NODE=1
      return 0
    fi
  fi
  installer_spinner_fail "Need Node 20+"
  install_private_node
  SASS_USE_PRIVATE_NODE=1
  installer_spinner_ok "Node ${NODE_LTS_VERSION} in ~/.sass/node"
}

write_env_file() {
  mkdir -p "$SASS_HOME"
  {
    printf '# Generated by install.sh — do not commit\n'
    printf 'SASS_DIR=%q\nexport SASS_DIR\n' "$SASS_DIR"
    if [[ "${SASS_SOURCE_INSTALL:-0}" != 1 ]]; then
      printf 'export PATH=%q:"$PATH"\n' "$SASS_DIR/runtime/bin"
      printf 'SASS_BUNDLE=1\nexport SASS_BUNDLE\n'
    elif [[ "$SASS_USE_PRIVATE_NODE" == "1" ]]; then
      printf 'export PATH=%q:"$PATH"\n' "$SASS_HOME/node/current/bin"
      printf 'SASS_USE_PRIVATE_NODE=1\nexport SASS_USE_PRIVATE_NODE\n'
    fi
  } >"$SASS_HOME/env"
}

ensure_path_line() {
  local bin_dir="$1"
  local escaped
  printf -v escaped '%q' "$bin_dir"
  local line="export PATH=${escaped}:\"\$PATH\""
  local updated=0
  for rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    [[ -f "$rc" ]] || continue
    if grep -qF '.local/bin' "$rc" 2>/dev/null || grep -qF "$bin_dir" "$rc" 2>/dev/null; then
      updated=1
      continue
    fi
    say "Adding $bin_dir to PATH in $rc"
    printf '\n# Sass installer\n%s\n' "$line" >>"$rc"
    updated=1
  done
  if [[ "$updated" -eq 0 ]]; then
    say "Add this to your shell profile, then open a new terminal:"
    say "  $line"
  fi
}

install_launcher() {
  mkdir -p "$SASS_BIN_DIR"
  if [[ -f "$SASS_DIR/scripts/sass.sh" ]]; then
    cp "$SASS_DIR/scripts/sass.sh" "$SASS_BIN_DIR/sass"
  else
    die "Missing scripts/sass.sh in $SASS_DIR"
  fi
  chmod +x "$SASS_BIN_DIR/sass"
  ensure_path_line "$SASS_BIN_DIR"
}

ensure_repo() {
  if [[ "${SASS_SKIP_CLONE:-0}" == "1" && -f "$SASS_DIR/package.json" ]]; then
    installer_spinner_start "Sass files"
    installer_spinner_ok "Using $SASS_DIR"
    return 0
  fi
  if [[ -d "$SASS_DIR/.git" ]]; then
    installer_spinner_start "Updating $SASS_DIR"
    git -C "$SASS_DIR" fetch origin "$SASS_BRANCH" 2>/dev/null || git -C "$SASS_DIR" fetch origin
    git -C "$SASS_DIR" checkout "$SASS_BRANCH" 2>/dev/null || true
    git -C "$SASS_DIR" pull --ff-only 2>/dev/null || git -C "$SASS_DIR" pull
    installer_spinner_ok "Updated $SASS_DIR"
    return 0
  fi
  installer_spinner_start "Cloning into $SASS_DIR"
  mkdir -p "$(dirname "$SASS_DIR")"
  git clone --branch "$SASS_BRANCH" --depth 1 "$SASS_REPO" "$SASS_DIR" 2>/dev/null \
    || git clone --depth 1 "$SASS_REPO" "$SASS_DIR"
  installer_spinner_ok "Cloned to $SASS_DIR"
}

npm_install_quiet() {
  local dir="$1"
  if (cd "$dir" && npm install --no-audit --no-fund --loglevel=error); then
    return 0
  fi
  warn "npm install failed. Retrying with full output:"
  (cd "$dir" && npm install --no-audit --no-fund)
}

run_npm_install() {
  # shellcheck disable=SC1090
  source "$SASS_HOME/env"
  installer_spinner_start "Installing npm packages"
  npm_install_quiet "$SASS_DIR" || { installer_spinner_fail "npm install failed"; die "npm install failed."; }
  installer_spinner_ok "npm packages installed"
}

run_setup_wizard() {
  if [[ "${SASS_SKIP_SETUP:-0}" == "1" ]]; then
    say "Skipping setup wizard (SASS_SKIP_SETUP=1)."
    return 0
  fi
  # shellcheck disable=SC1090
  source "$SASS_HOME/env"
  say_step "Setup wizard — follow the prompts (secrets stay hidden)."
  say ""
  local tty
  tty="$(setup_tty)"
  if [[ "${SASS_SOURCE_INSTALL:-0}" == 1 ]]; then
    say "Source setup lets you choose and explicitly prepare memory search; no model is downloaded without consent."
    export SASS_SETUP_ADVANCED=1
  fi
  if [[ "${SASS_SOURCE_INSTALL:-0}" != 1 ]]; then
    export SASS_INSTALL_FRAME=1
    if [[ -n "${SASS_SETUP_INPUT:-}" && -f "$SASS_SETUP_INPUT" ]]; then tty="$SASS_SETUP_INPUT"; fi
    (cd "$SASS_DIR" && ./runtime/bin/node dist/setup.js) <"$tty"
  elif [[ -n "${SASS_SETUP_INPUT:-}" && -f "$SASS_SETUP_INPUT" ]]; then
    (cd "$SASS_DIR" && npm run setup) <"$SASS_SETUP_INPUT"
  else
    if [[ "${INSTALLER_FRAME_ACTIVE:-0}" == 1 ]]; then
      export SASS_INSTALL_FRAME=1
      # Keep Node attached to the TTY; npm's own banner must not enter the screen.
      (cd "$SASS_DIR" && ./node_modules/.bin/tsx src/setup.ts) <"$tty"
    else
      (cd "$SASS_DIR" && npm run setup) <"$tty"
    fi
  fi
}

load_bundle_installer() {
  local helper
  if [[ -n "$INSTALLER_DIR" && -f "$INSTALLER_DIR/scripts/install-bundle.sh" ]]; then
    helper="$INSTALLER_DIR/scripts/install-bundle.sh"
  else
    helper="$(mktemp)"
    SASS_BUNDLE_HELPER_TEMP="$helper"
    local repo="${SASS_REPO#https://github.com/}"
    repo="${repo%.git}"
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --connect-timeout 10 --max-time 30 "https://raw.githubusercontent.com/${repo}/${SASS_BRANCH}/scripts/install-bundle.sh" -o "$helper" 2>/dev/null \
      || die 'Cannot load the release installer. Retry the same install command.'
  fi
  # shellcheck disable=SC1090
  source "$helper"
}

sass_install_exit() {
  local code="$1"
  if declare -F installer_frame_exit >/dev/null 2>&1; then installer_frame_exit "$code" || true; fi
  if declare -F sass_bundle_cleanup >/dev/null 2>&1; then sass_bundle_cleanup; fi
  [[ -z "${SASS_BUNDLE_HELPER_TEMP:-}" ]] || rm -f "$SASS_BUNDLE_HELPER_TEMP"
  return "$code"
}

main() {
  if [[ "${SASS_INSTALL_ASSUME_YES:-0}" != "1" ]] && ! has_interactive_tty; then
    die "Run this installer in a terminal, or set SASS_INSTALL_ASSUME_YES=1 for automation."
  fi
  if declare -F installer_print_banner >/dev/null 2>&1; then installer_print_banner
  else say 'Sass installer'; fi
  trap 'sass_install_exit $?' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if [[ "${SASS_SOURCE_INSTALL:-0}" != 1 ]]; then
    load_bundle_installer
    installer_spinner_start 'Checking the ready release'
    sass_bundle_prepare
  fi
  if declare -F installer_trust_preamble >/dev/null 2>&1; then installer_trust_preamble
  elif [[ "${SASS_SOURCE_INSTALL:-0}" != 1 ]]; then
    say "Install Sass in $SASS_DIR, with its private runtime, database and memory model."
    say "Download: $SASS_BUNDLE_BYTES bytes. On disk: $SASS_BUNDLE_UNPACKED_BYTES bytes."
    say 'Keep existing settings and local data. No admin password is needed.'
    say 'EmbeddingGemma 2: Apache License 2.0'
    say 'https://www.apache.org/licenses/LICENSE-2.0'
    say 'Copies and third-party notices are included in licenses/.'
  fi
  installer_confirm_continue || exit 0

  if [[ "${SASS_SOURCE_INSTALL:-0}" == 1 ]]; then
    installer_task ensure_git
    installer_task ensure_node
    installer_task write_env_file
    installer_task ensure_repo
    installer_spinner_start 'Installing sass command'
    installer_task install_launcher
    installer_spinner_ok 'sass command installed'
    installer_task run_npm_install
    local setup_status=0
    run_setup_wizard || setup_status=$?
    case "$setup_status" in
      0|10) ;;
      *) exit "$setup_status" ;;
    esac
    if [[ "$setup_status" == 10 ]]; then
      if declare -F installer_frame_exit >/dev/null 2>&1; then
        INSTALLER_SKIP_CLOSE=1 installer_frame_exit 0
      fi
      trap - EXIT INT TERM WINCH
      cd "$SASS_DIR"
      npm run build
      node dist/register-commands.js
      exec node dist/index.js
    fi
    say 'Installation complete. Configuration may still need attention.'
    say 'Next: sass start. Change settings: sass setup. Check: sass doctor.'
    return 0
  fi

  installer_task sass_bundle_install
  installer_task write_env_file
  installer_task install_launcher
  local setup_status=0
  run_setup_wizard || setup_status=$?
  case "$setup_status" in
    0|10) ;;
    *) exit "$setup_status" ;;
  esac
  if declare -F installer_frame_exit >/dev/null 2>&1; then
    INSTALLER_SKIP_CLOSE=1 installer_frame_exit 0
  fi
  sass_bundle_cleanup
  trap - EXIT INT TERM WINCH
  if [[ "$setup_status" == 10 ]]; then
    cd "$SASS_DIR"
    exec ./runtime/bin/node dist/index.js
  fi
  (cd "$SASS_DIR" && ./runtime/bin/node dist/invite.js)
  say 'Setup closed. Run sass to start.'
}

main "$@"
