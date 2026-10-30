#!/usr/bin/env bash
# Ready-release installation. Sourced by install.sh; compatible with macOS Bash 3.2.

sass_bundle_cleanup() {
  sass_bundle_progress_stop
  if [[ -n "${SASS_BUNDLE_BACKUP:-}" && ! -e "$SASS_DIR" && -d "$SASS_BUNDLE_BACKUP" ]]; then
    mv "$SASS_BUNDLE_BACKUP" "$SASS_DIR"
  fi
  # These paths are created by mktemp, never derived from archive entries.
  [[ -z "${SASS_BUNDLE_STAGE:-}" ]] || rm -rf "$SASS_BUNDLE_STAGE"
  [[ -z "${SASS_BUNDLE_META_DIR:-}" ]] || rm -rf "$SASS_BUNDLE_META_DIR"
  [[ -z "${SASS_BUNDLE_HELPER_TEMP:-}" ]] || rm -f "$SASS_BUNDLE_HELPER_TEMP"
}

sass_bundle_progress_stop() {
  if [[ -n "${SASS_BUNDLE_PROGRESS_PID:-}" ]]; then
    kill "$SASS_BUNDLE_PROGRESS_PID" 2>/dev/null || true
    wait "$SASS_BUNDLE_PROGRESS_PID" 2>/dev/null || true
    SASS_BUNDLE_PROGRESS_PID=''
  fi
}

sass_bundle_progress_start() {
  local partial="$1"
  [[ "${INSTALLER_FRAME_ACTIVE:-0}" == 1 ]] || return 0
  (
    while :; do
      downloaded=0
      if [[ -f "$partial" ]]; then downloaded="$(wc -c <"$partial" | tr -d ' ')"; fi
      installer_out "Downloading $downloaded / $SASS_BUNDLE_BYTES bytes"
      sleep 1
    done
  ) &
  SASS_BUNDLE_PROGRESS_PID=$!
}

sass_bundle_field() {
  plutil -extract "$1" raw -o - "${2:-$SASS_BUNDLE_META_DIR/manifest.json}" 2>/dev/null \
    || die "Release metadata is invalid ($1). No installation changed."
}

sass_bundle_check_macos() {
  local version major
  version="$(sw_vers -productVersion 2>/dev/null)" || die 'Could not check the macOS version. No installation changed.'
  major="${version%%.*}"
  if [[ ! "$major" =~ ^[1-9][0-9]{0,2}$ ]] || [[ "$major" -lt 15 ]]; then
    die 'This Mac bundle requires macOS 15 or newer. No installation changed.'
  fi
}

sass_bundle_prepare() {
  local platform manifest_url schema archive version
  platform="$(platform_os)-$(platform_arch)"
  case "$platform" in darwin-arm64|darwin-x64) ;; *) die "No ready bundle for $platform. Use the documented source installation." ;; esac
  sass_bundle_check_macos
  command -v plutil >/dev/null 2>&1 || die 'macOS plutil is required to read release metadata.'
  SASS_BUNDLE_META_DIR="$(mktemp -d)"
  manifest_url="${SASS_RELEASE_MANIFEST_URL:-https://github.com/philippsyrov/Sass/releases/latest/download/sass-${platform}.json}"
  case "$manifest_url" in https://*) ;; *) die 'Release metadata must use HTTPS.' ;; esac
  if ! curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --connect-timeout 10 --max-time 60 --max-filesize 65536 "$manifest_url" -o "$SASS_BUNDLE_META_DIR/manifest.json" 2>"$SASS_BUNDLE_META_DIR/download-error"; then
    die 'No ready release bundle is available. No source build was started. Try again after a release is published.'
  fi
  [[ "$(wc -c <"$SASS_BUNDLE_META_DIR/manifest.json" | tr -d ' ')" -le 65536 ]] || die 'Release metadata is too large.'
  schema="$(sass_bundle_field schemaVersion)"
  version="$(sass_bundle_field version)"
  archive="$(sass_bundle_field archive)"
  [[ "$schema" == 1 && "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || die 'Release version is invalid.'
  [[ "$(sass_bundle_field minimumMacOS)" == '15.0' ]] || die 'Release macOS requirements are invalid.'
  [[ "$(sass_bundle_field platform)" == "$platform" && "$archive" == "sass-v${version}-${platform}.tar.gz" ]] || die 'Release platform or archive name does not match.'
  SASS_BUNDLE_BYTES="$(sass_bundle_field bytes)"
  SASS_BUNDLE_UNPACKED_BYTES="$(sass_bundle_field unpackedBytes)"
  SASS_BUNDLE_SHA="$(sass_bundle_field sha256)"
  [[ "$SASS_BUNDLE_BYTES" =~ ^[1-9][0-9]{0,10}$ && "$SASS_BUNDLE_UNPACKED_BYTES" =~ ^[1-9][0-9]{0,10}$ && "$SASS_BUNDLE_SHA" =~ ^[a-f0-9]{64}$ ]] || die 'Release size or checksum is invalid.'
  SASS_BUNDLE_MODEL="$(sass_bundle_field model.id)"
  SASS_BUNDLE_REVISION="$(sass_bundle_field model.revision)"
  SASS_BUNDLE_DTYPE="$(sass_bundle_field model.dtype)"
  SASS_BUNDLE_DIMENSION="$(sass_bundle_field model.dimension)"
  [[ "$SASS_BUNDLE_MODEL" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ && "$SASS_BUNDLE_REVISION" =~ ^[a-f0-9]{40}$ && "$SASS_BUNDLE_DTYPE" =~ ^[A-Za-z0-9_]+$ && "$SASS_BUNDLE_DIMENSION" =~ ^[1-9][0-9]{0,4}$ ]] || die 'Release model details are invalid.'
  SASS_BUNDLE_ARCHIVE="$archive"
  SASS_BUNDLE_URL="${manifest_url%/*}/$archive"
  SASS_BUNDLE_VERSION="$version"
}

sass_bundle_check_archive() {
  local archive="$1" entry normalized
  # Check effective paths and member types before tar can write any file.
  tar -tzf "$archive" >"$SASS_BUNDLE_META_DIR/paths" || die 'The release archive cannot be read.'
  tar -tvzf "$archive" >"$SASS_BUNDLE_META_DIR/types" || die 'The release archive cannot be inspected.'
  LC_ALL=C awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }' "$SASS_BUNDLE_META_DIR/types" \
    || die 'Release archive contains a link or special file. Installation stopped.'
  while IFS= read -r entry; do
    normalized="${entry#./}"
    case "$normalized" in ''|.) continue ;; esac
    case "$normalized" in /*|../*|*/../*|*/..|*\\*) die 'Unsafe release archive path.' ;; esac
    case "$normalized" in
      dist|dist/*|node_modules|node_modules/*|assets|assets/*|models|models/*|runtime|runtime/*|scripts|scripts/*|licenses|licenses/*|package.json|LICENSE|bundle-manifest.json) ;;
      *) die "Unexpected release archive root: $normalized" ;;
    esac
  done <"$SASS_BUNDLE_META_DIR/paths"
}

sass_bundle_preserve() {
  local name source
  [[ -d "$SASS_DIR" ]] || return 0
  [[ ! -L "$SASS_DIR" ]] || die 'The install destination is a link. Choose a regular directory.'
  if [[ -d "$SASS_DIR/.sass-data" && -n "$(find "$SASS_DIR/.sass-data" -name postmaster.pid -print -quit)" ]]; then
    die 'Stop Sass before updating its local database.'
  fi
  for source in "$SASS_DIR/.env" "$SASS_DIR/.sass-data" "$SASS_DIR/data" "$SASS_DIR/models" "$SASS_DIR/.cache" "$SASS_DIR"/.env.backup-*; do
    name="${source##*/}"
    [[ -e "$source" || -L "$source" ]] || continue
    [[ ! -L "$source" ]] || die "Cannot preserve a linked $name. The existing installation is unchanged."
    [[ -z "$(find "$source" ! -type d ! -type f -print -quit)" ]] || die "Cannot preserve special files in $name. The existing installation is unchanged."
    # Keep verified staged files when names overlap, while copying extra cache entries.
    if [[ -d "$source" ]]; then
      "$SASS_BUNDLE_STAGE/runtime/bin/node" -e 'try { require("node:fs").cpSync(process.argv[1], process.argv[2], { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true }); } catch (error) { console.error("State copy failed:", error.code || "unknown"); process.exit(1); }' "$source" "$SASS_BUNDLE_STAGE/$name" \
        || die "Cannot preserve $name. The existing installation is unchanged."
    else
      cp -p "$source" "$SASS_BUNDLE_STAGE/$name" \
        || die "Cannot preserve $name. The existing installation is unchanged."
    fi
  done
}

sass_bundle_install() {
  local archive actual actual_bytes parent backup field expected curl_status
  mkdir -p "$SASS_HOME/downloads"
  archive="$SASS_HOME/downloads/${SASS_BUNDLE_SHA}-${SASS_BUNDLE_ARCHIVE}"
  [[ ! -L "$archive" && ! -L "$archive.part" ]] || die 'The download cache contains a link. Installation stopped.'
  installer_spinner_start 'Downloading the ready bundle'
  if [[ ! -f "$archive" ]]; then
    sass_bundle_progress_start "$archive.part"
    curl_status=0
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL --retry 2 --continue-at - --write-out '%{http_code}' --max-filesize "$SASS_BUNDLE_BYTES" "$SASS_BUNDLE_URL" -o "$archive.part" >"$SASS_BUNDLE_META_DIR/http-status" || curl_status=$?
    if [[ "$curl_status" != 0 ]]; then
      if [[ "$curl_status" == 33 || "$curl_status" == 36 || "$(cat "$SASS_BUNDLE_META_DIR/http-status")" == 416 ]]; then
        rm -f "$archive.part"
        curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL --retry 2 --max-filesize "$SASS_BUNDLE_BYTES" "$SASS_BUNDLE_URL" -o "$archive.part" \
          || die 'Bundle download stopped. Run the installer again to resume the cached download.'
      else
        die 'Bundle download stopped. Run the installer again to resume the cached download.'
      fi
    fi
    sass_bundle_progress_stop
    mv "$archive.part" "$archive"
  fi
  actual_bytes="$(wc -c <"$archive" | tr -d ' ')"
  if [[ "$actual_bytes" != "$SASS_BUNDLE_BYTES" ]]; then
    rm -f "$archive"
    die 'Bundle size did not match release metadata. Retry the installer.'
  fi
  if command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$archive" | awk '{print $1}')"
  else die 'A SHA256 tool is required to verify this release.'; fi
  if [[ "$actual" != "$SASS_BUNDLE_SHA" ]]; then
    rm -f "$archive"
    die 'Bundle checksum did not match release metadata. Retry the installer.'
  fi
  sass_bundle_check_archive "$archive"
  parent="$(dirname "$SASS_DIR")"
  mkdir -p "$parent"
  [[ ! -L "$SASS_DIR" && ( ! -e "$SASS_DIR" || -d "$SASS_DIR" ) ]] || die 'The install destination must be a regular directory.'
  SASS_BUNDLE_STAGE="$(mktemp -d "$parent/.sass-stage.XXXXXX")"
  installer_spinner_start 'Checking the staged bundle'
  tar -xzf "$archive" -C "$SASS_BUNDLE_STAGE" --no-same-owner --no-same-permissions
  [[ -x "$SASS_BUNDLE_STAGE/runtime/bin/node" && -f "$SASS_BUNDLE_STAGE/scripts/validate-bundle.mjs" ]] || die 'The release is missing its runtime or validator.'
  for field in schemaVersion version platform unpackedBytes model.id model.revision model.dtype model.dimension; do
    expected="$(sass_bundle_field "$field")"
    [[ "$(sass_bundle_field "$field" "$SASS_BUNDLE_STAGE/bundle-manifest.json")" == "$expected" ]] || die "Bundle identity does not match release metadata ($field)."
  done
  "$SASS_BUNDLE_STAGE/runtime/bin/node" "$SASS_BUNDLE_STAGE/scripts/validate-bundle.mjs" "$SASS_BUNDLE_STAGE" \
    || die 'Bundle validation failed. The existing installation is unchanged.'
  sass_bundle_preserve
  backup=''
  if [[ -d "$SASS_DIR" ]]; then
    backup="$(mktemp -d "$parent/.sass-previous.XXXXXX")"
    rmdir "$backup"
    SASS_BUNDLE_BACKUP="$backup"
    mv "$SASS_DIR" "$backup"
  fi
  if ! mv "$SASS_BUNDLE_STAGE" "$SASS_DIR"; then
    [[ -z "$backup" ]] || mv "$backup" "$SASS_DIR"
    die 'Bundle activation failed. The previous installation was restored.'
  fi
  SASS_BUNDLE_STAGE=''
  [[ -z "$backup" ]] || say 'The previous installation is kept beside the Sass folder for recovery.'
  installer_spinner_ok 'Ready bundle installed'
}
