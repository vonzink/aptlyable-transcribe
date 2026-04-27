#!/usr/bin/env bash
# Guard against the recurring em-dash bug: AWS rejects non-Latin-1
# characters in IAM role descriptions, SG descriptions, alarm names,
# secret descriptions, etc.
#
# This is a fast text grep, not a full AST scan. It catches the common
# case where someone types `description: 'foo — bar'` in a CDK file.
# Comments and UI strings can still use any Unicode — only the listed
# AWS-facing fields are checked.

set -euo pipefail

cd "$(dirname "$0")/.."

# Field names that must be Latin-1 / ASCII when passed to AWS.
PATTERN='(description|alarmDescription|secretName|tableName|queueName|alarmName|topicName|displayName|logGroupName|bucketName|clusterName|serviceName):'

# Match literal non-ASCII bytes inside lines that contain the pattern.
# We use perl for portable Unicode matching; grep -P isn't on macOS by default.
if perl -ne '
  next if /^\s*\*/;
  next if /^\s*\/\//;
  if (/'"$PATTERN"'/ && /[^\x00-\x7f]/) {
    print "$ARGV:$.: $_";
    $found = 1;
  }
  END { exit($found ? 1 : 0); }
' infrastructure/lib/constructs/*.ts infrastructure/lib/aptlyable-stack.ts; then
  : # exit 0 from perl means clean
else
  echo ""
  echo "❌ Non-ASCII character detected in an AWS-facing field above."
  echo "   AWS rejects characters outside the Latin-1 range (regex: [\\u0009\\u000A\\u000D\\u0020-\\u007E\\u00A1-\\u00FF])."
  echo "   Common culprit: em-dash (—) instead of ASCII double-hyphen (--)."
  exit 1
fi

echo "✓ AWS-facing fields are ASCII-clean."
