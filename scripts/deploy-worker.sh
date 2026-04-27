#!/usr/bin/env bash
# Deploy a new worker image to ECS Fargate.
#
# With ECS Fargate + ContainerImage.fromAsset, `cdk deploy` itself
# rebuilds the Dockerfile under services/worker/, pushes the resulting
# image to the CDK-managed ECR repository, updates the Task Definition,
# and rolls out the new revision (replacing the running task if any).
#
# This script just wraps the cdk-deploy command with the right working
# directory and prints a tail of the worker logs after the rollout.
set -euo pipefail

cd "$(dirname "$0")/.."

STACK_NAME="${STACK_NAME:-AptlyableStack}"
REGION="${AWS_REGION:-us-east-1}"

echo "→ Building shared package (the Docker stage caches subsequent builds)"
npm --workspace packages/shared run build >/dev/null

echo "→ Deploying via CDK — this rebuilds the worker image + rolls out the service"
(cd infrastructure && npx cdk deploy --require-approval never)

echo
echo "→ Tailing worker log group (Ctrl-C to exit)"
echo "    aws logs tail /aptlyable/worker --follow --region $REGION"
