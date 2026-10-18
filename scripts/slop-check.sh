#!/usr/bin/env bash
# Fails on patterns that mark generated-looking code and prose.
# Scans tracked and new files; CLAUDE.md, .claude/ and this script are exempt because they name the patterns.
set -uo pipefail
cd "$(dirname "$0")/.."

files=$(git ls-files --cached --others --exclude-standard -- 'src' 'scripts' '*.md' | grep -v -e '^CLAUDE.md$' -e '^\.claude/' -e '^scripts/slop-check.sh$')
code=$(printf '%s\n' "$files" | grep -E '\.(ts|tsx|js|mjs)$')
fail=0

report() {
  local label=$1 out=$2
  if [[ -n "$out" ]]; then
    printf '%s\n%s\n\n' "$label" "$out"
    fail=1
  fi
}

# shellcheck disable=SC2086
report "Emoji (keep UI, docs and logs plain text):" \
  "$(printf '%s\n' "$files" | xargs grep -nP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B50}\x{2705}]' 2>/dev/null)"

report "Filler words (say the specific thing instead):" \
  "$(printf '%s\n' "$files" | xargs grep -niwE 'seamless(ly)?|robust|leverag(e|es|ing)|delve|cutting-edge|comprehensive|powerful|effortless(ly)?|elevate|unlock|game-chang(er|ing)|blazing(ly)?|supercharge|streamline|harness(ing)?|in today.s|it.s worth noting|best-in-class' 2>/dev/null)"

report "Type escapes (fix the type instead):" \
  "$(printf '%s\n' "$code" | xargs grep -nE 'as any *([);,>]|$)|: any *([);,>=\[]|$)|@ts-ignore|@ts-nocheck|eslint-disable' 2>/dev/null)"

report "Narrating comments (comments explain why, not what the next line does):" \
  "$(printf '%s\n' "$code" | xargs grep -nE '^\s*// (Import|Define|Create|Initialize|Initialise|Return|Loop (over|through)|Call|Set up|Check if|Get the|Update the|Handle the|Add the) ' 2>/dev/null)"

report "Placeholder code:" \
  "$(printf '%s\n' "$code" | xargs grep -nE '// \.\.\. ?(rest|existing|more)|TODO: implement|throw new Error\("Not implemented"\)' 2>/dev/null)"

if [[ $fail -ne 0 ]]; then
  echo "slop-check failed"
  exit 1
fi
echo "slop-check passed"
