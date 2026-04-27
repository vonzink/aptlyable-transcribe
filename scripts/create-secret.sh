#!/usr/bin/env bash
# Set or rotate a transcription provider key (or the Twilio auth token)
# in AWS Secrets Manager.
#
# Usage:
#   ./scripts/create-secret.sh <target> <SECRET_VALUE>
#   ./scripts/create-secret.sh deepgram   dg_xxx...
#   ./scripts/create-secret.sh openai     sk-xxx...
#   ./scripts/create-secret.sh assemblyai aa_xxx...
#   ./scripts/create-secret.sh twilio     <auth_token>
#
# Or pass the secret via env (safer than shell history):
#   PROVIDER_API_KEY=... ./scripts/create-secret.sh deepgram
#
# Backward-compat: a single argument is treated as a Deepgram key.
set -euo pipefail

PROVIDER=""
KEY=""

if [[ $# -ge 2 ]]; then
  PROVIDER="$1"
  KEY="$2"
elif [[ $# -eq 1 ]]; then
  case "$1" in
    deepgram|openai|assemblyai|twilio)
      PROVIDER="$1"
      KEY="${PROVIDER_API_KEY:-${DEEPGRAM_API_KEY:-}}"
      ;;
    *)
      # Single arg looks like a key — assume Deepgram (back-compat).
      PROVIDER="deepgram"
      KEY="$1"
      ;;
  esac
else
  PROVIDER="${1:-deepgram}"
  KEY="${PROVIDER_API_KEY:-${DEEPGRAM_API_KEY:-}}"
fi

case "$PROVIDER" in
  deepgram)   SECRET_NAME="${DEEPGRAM_SECRET_NAME:-aptlyable/deepgram/api-key}" ;;
  openai)     SECRET_NAME="${OPENAI_SECRET_NAME:-aptlyable/openai/api-key}" ;;
  assemblyai) SECRET_NAME="${ASSEMBLYAI_SECRET_NAME:-aptlyable/assemblyai/api-key}" ;;
  twilio)     SECRET_NAME="${TWILIO_SECRET_NAME:-aptlyable/twilio/auth-token}" ;;
  *)
    echo "ERROR: unknown secret target \"$PROVIDER\". Allowed: deepgram | openai | assemblyai | twilio." >&2
    exit 1
    ;;
esac

if [[ -z "$KEY" ]]; then
  echo "ERROR: pass the API key as the second argument or set PROVIDER_API_KEY." >&2
  exit 1
fi

echo "→ Updating $SECRET_NAME for provider $PROVIDER"
aws secretsmanager put-secret-value \
  --secret-id "$SECRET_NAME" \
  --secret-string "$KEY" \
  >/dev/null

echo "✓ Secret updated. Restart the worker to pick it up:"
echo "    ./scripts/deploy-worker.sh   # redeploys + restarts"
echo "  or, on the box:"
echo "    sudo systemctl restart aptlyable-worker"
