#!/usr/bin/env bash
# Build all workspaces. Useful before `cdk deploy` (so the bundler reads
# fresh sources) or `deploy-worker.sh` (which packages worker dist/).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Guard: AWS-facing CDK fields must be ASCII"
bash scripts/check-ascii-aws-fields.sh

echo "→ Type-checking everything"
npm run typecheck

echo "→ Building services/api"
npm --workspace services/api run build

echo "→ Building services/worker"
npm --workspace services/worker run build

echo "→ Building infrastructure"
npm --workspace infrastructure run build

echo "→ Building apps/web"
npm --workspace apps/web run build

echo "✓ All workspaces built."
