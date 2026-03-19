#!/bin/bash
#
# verify.sh — Pre-commit verification
#
# Runs lint + syntax check. Used by the pre-commit hook
# and can also be run manually: npm run verify
#

set -e

echo "═══════════════════════════════════════"
echo "  Verification"
echo "═══════════════════════════════════════"
echo ""

FAIL=0

# --- Step 1: Lint ---
echo "Step 1/2: Linting..."
if npx eslint src/ 2>/dev/null; then
  echo "  ✅ Lint passed"
else
  echo "  ❌ Lint failed"
  FAIL=1
fi
echo ""

# --- Step 2: Syntax check ---
echo "Step 2/2: Syntax check..."
if node --check src/index.js 2>&1; then
  echo "  ✅ Syntax OK"
else
  echo "  ❌ Syntax errors found"
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
