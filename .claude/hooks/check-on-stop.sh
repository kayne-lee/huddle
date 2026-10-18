#!/usr/bin/env bash
# Stop hook: Claude cannot end a turn that left the tree failing `npm run check`.
set -uo pipefail
input=$(cat)
# Second stop after a block: let it through so a check Claude cannot fix does not loop forever.
if [[ $(jq -r '.stop_hook_active // false' <<<"$input") == "true" ]]; then exit 0; fi
cd "$CLAUDE_PROJECT_DIR" || exit 0
# Read-only turns skip the check.
if [[ -z $(git status --porcelain -- src scripts '*.md' '*.json' '*.ts' '*.js') ]]; then exit 0; fi
if ! out=$(npm run check --silent 2>&1); then
  printf 'npm run check failed. Fix these before finishing:\n%s\n' "$(tail -n 60 <<<"$out")" >&2
  exit 2
fi
