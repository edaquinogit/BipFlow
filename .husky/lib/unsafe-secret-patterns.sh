#!/usr/bin/env sh
# Shared secret-pattern list for the pre-commit hook's secrets-hygiene check.
# Sourced by both .husky/pre-commit and scripts/test-precommit-secrets-hook.sh
# so the two can never drift apart.
#
# The change/me placeholder pattern below matches that value bare, or
# followed by a digit, underscore or hyphen (a "...-in-production" or
# "...123" suffix) -- but stops right after "me" when what follows instead
# continues as more letters of the same word. That's what lets a Django
# permission codename like "change_merchantprofile", "change_member" or
# "change_message" through without reopening the placeholder loophole.
# See scripts/test-precommit-secrets-hook.sh for the concrete allowed/blocked
# examples (spelled out there in a form that doesn't itself trip this check).
unsafe_patterns="$(printf '%s\n' \
  'bipflow[_-]password' \
  'change[-_]me([^a-zA-Z]|$)' \
  'django[-_]insecure' \
  "TODO.*secre"t \
  "FIXME.*passwor"d \
  "admin"123 \
  "password"123
)"
