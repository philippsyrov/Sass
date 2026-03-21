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
echo "Step 1/3: Type checking..."
if npx tsc --noEmit 2>&1; then
  echo "  ✅ Type check passed"
else
  echo "  ❌ Type check failed"
  FAIL=1
fi
echo ""

# --- Step 2: Lint ---
echo "Step 2/3: Linting..."
if npx eslint src/ 2>/dev/null; then
  echo "  ✅ Lint passed"
else
  echo "  ❌ Lint failed"
  FAIL=1
fi
echo ""

# --- Step 3: Build ---
echo "Step 3/3: Building..."
if npx tsc 2>&1; then
  echo "  ✅ Build passed"
else
  echo "  ❌ Build failed"
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
