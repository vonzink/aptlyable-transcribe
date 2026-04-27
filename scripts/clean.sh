#!/usr/bin/env bash
# Wipe build artifacts. Safe to run anytime — does not touch source,
# git state, or AWS resources.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Cleaning workspace build outputs"
rm -rf infrastructure/cdk.out
rm -rf apps/web/.next
rm -rf apps/web/tsconfig.tsbuildinfo
rm -rf services/api/dist
rm -rf services/worker/dist
rm -rf packages/shared/dist
rm -rf packages/shared/tsconfig.tsbuildinfo

echo "✓ Build artifacts removed."
echo ""
echo "Re-create with:"
echo "  npm run build:shared"
echo "  npm run typecheck"
echo "  cd infrastructure && npx cdk synth"
