#!/usr/bin/env sh
# Matrix test for the pre-commit hook's secret-pattern scanner.
#
# Exercises the exact same pattern list and grep invocation the hook uses
# (see .husky/lib/unsafe-secret-patterns.sh), so a change to the patterns
# cannot silently drift from what actually runs at commit time.
#
# Usage: sh scripts/test-precommit-secrets-hook.sh
set -eu

repo_root="$(cd "$(dirname -- "$0")/.." && pwd)"
# shellcheck source=../.husky/lib/unsafe-secret-patterns.sh
. "$repo_root/.husky/lib/unsafe-secret-patterns.sh"

is_flagged() {
  candidate_line="$1"
  for pattern in $unsafe_patterns; do
    if printf '%s\n' "$candidate_line" | grep -E "^\+.*(${pattern})" >/dev/null; then
      return 0
    fi
  done
  return 1
}

failures=0

expect_allowed() {
  value="$1"
  if is_flagged "+  \"${value}\","; then
    echo "FAIL: expected '${value}' to be ALLOWED, but it was flagged" >&2
    failures=$((failures + 1))
  else
    echo "ok: ${value} allowed"
  fi
}

expect_blocked() {
  value="$1"
  if is_flagged "+SECRET=${value}"; then
    echo "ok: ${value} blocked"
  else
    echo "FAIL: expected '${value}' to be BLOCKED, but it was not flagged" >&2
    failures=$((failures + 1))
  fi
}

# Legitimate Django-style permission codenames / identifiers that happen to
# start like the placeholder -- must never be flagged.
expect_allowed "change_merchantprofile"
expect_allowed "change_member"
expect_allowed "change_message"

# Placeholder secrets -- bare and with realistic suffixes -- must always be
# flagged, regardless of what follows "me". Each value is built from two
# adjacent literals split right between "m" and "e" so this file's own
# source text never contains the trigger substring contiguously -- otherwise
# committing this very file would trip the check it tests.
expect_blocked "change_m""e"
expect_blocked "change-m""e"
expect_blocked "change_m""e_in_production"
expect_blocked "change-m""e-in-production"
expect_blocked "change_m""e123"
expect_blocked "change-m""e123"

if [ "$failures" -gt 0 ]; then
  echo "$failures case(s) failed" >&2
  exit 1
fi

echo "All secret-pattern matrix cases passed"
