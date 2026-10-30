#!/bin/bash
#
# verify.sh — Pre-commit verification
#
# Runs TypeScript compile check + lint + build.
# Used by the pre-commit hook and can also be run manually: npm run verify
#

set -e

echo "═══════════════════════════════════════"
echo "  Verification"
echo "═══════════════════════════════════════"
echo ""

FAIL=0

# --- Step 1: TypeScript type check ---
echo "Step 1/6: Type checking..."
if npx tsc --noEmit 2>&1; then
  echo "  ✅ Type check passed"
else
  echo "  ❌ Type check failed"
  FAIL=1
fi
echo ""

# --- Step 2: Lint ---
echo "Step 2/6: Linting..."
if npx eslint src/ 2>/dev/null; then
  echo "  ✅ Lint passed"
else
  echo "  ❌ Lint failed"
  FAIL=1
fi
echo ""

# --- Step 3: Build ---
echo "Step 3/6: Building..."
if npx tsc 2>&1; then
  echo "  ✅ Build passed"
else
  echo "  ❌ Build failed"
  FAIL=1
fi
echo ""

# --- Step 4: Shellcheck (install scripts) ---
echo "Step 4/6: Shellcheck (install scripts)..."
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck install.sh scripts/sass.sh scripts/install-ui.sh scripts/install-bundle.sh 2>&1; then
    echo "  ✅ Shellcheck passed"
  else
    echo "  ❌ Shellcheck failed"
    FAIL=1
  fi
else
  echo "  ⏭ Shellcheck not installed (skipped)"
fi
echo ""

# --- Step 5: Piped install under bash 3.2 (macOS) ---
echo "Step 5/6: Install script bash 3.2 smoke test..."
if ./scripts/test-install-bash32.sh 2>&1; then
  :
else
  echo "  ❌ bash 3.2 install smoke test failed"
  FAIL=1
fi
echo ""

# --- Step 6: Public content privacy check ---
echo "Step 6/6: Checking tracked public content..."
if node scripts/check-public-content.mjs; then
  echo "  ✅ Public content check passed"
else
  echo "  ❌ Public content check failed"
  FAIL=1
fi
echo ""

if [ $FAIL -ne 0 ]; then
  echo "═══════════════════════════════════════"
  echo "  ❌ VERIFICATION FAILED"
  echo "═══════════════════════════════════════"
  exit 1
fi

echo "═══════════════════════════════════════"
echo "  ✅ ALL CHECKS PASSED"
echo "═══════════════════════════════════════"
