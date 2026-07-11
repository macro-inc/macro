# Single local quality gate: format + lint + code rules, scoped to files you
# changed vs origin/main (merge-base, plus uncommitted and untracked work) so
# the output is exactly what is wrong with YOUR changes — legacy findings in
# untouched files never appear. Findings print as file:line with the rule id;
# ast-grep rule ids map to STYLE_GUIDE.md (its `severity: error` rules fail
# the run, warnings/hints only print; oxlint is warn-only for now).
#
#   just check        fast: rustfmt + biome + oxlint + ast-grep   (~seconds)
#   just check full   also runs tsc + clippy                      (~minutes)
#
# Override the diff base with CHECK_BASE=<ref> (useful in shallow clones,
# where no origin/main merge-base exists and the scope silently narrows to
# uncommitted work only).
check *ARGS:
  #!/usr/bin/env bash
  set -uo pipefail
  cd {{ justfile_directory() }}

  base="${CHECK_BASE:-$(git merge-base HEAD origin/main 2>/dev/null || true)}"
  if [ -z "$base" ]; then
    echo "note: no merge-base with origin/main (shallow clone?); checking uncommitted changes only."
    echo "      Set CHECK_BASE=<ref> to widen."
  fi
  changed=$({ [ -n "$base" ] && git diff --name-only "$base"; \
              git diff --name-only HEAD; \
              git ls-files --others --exclude-standard; } | sort -u \
            | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done)
  if [ -z "$changed" ]; then echo "no changed files — nothing to check"; exit 0; fi

  rs_cs=$(grep -E '^rust/cloud-storage/.*\.rs$' <<<"$changed" || true)
  rs_sync=$(grep -E '^rust/sync-service/.*\.rs$' <<<"$changed" || true)
  js=$(grep -E '^js/app/.*\.(ts|tsx)$' <<<"$changed" || true)
  sg=$(grep -E '^(rust|js)/.*\.(rs|ts|tsx)$' <<<"$changed" || true)

  fail=0
  if [ -n "$rs_cs" ]; then
    echo "── cargo fmt (rust/cloud-storage)"
    (cd rust/cloud-storage && cargo fmt --check) \
      || { echo "   fix: cd rust/cloud-storage && cargo fmt"; fail=1; }
  fi
  if [ -n "$rs_sync" ]; then
    echo "── cargo fmt (rust/sync-service)"
    (cd rust/sync-service && cargo fmt --check) \
      || { echo "   fix: cd rust/sync-service && cargo fmt"; fail=1; }
  fi
  if [ -n "$js" ]; then
    echo "── biome (js/app format + lint, same flags as CI)"
    (cd js/app && bunx --bun @biomejs/biome ci --colors=off --no-errors-on-unmatched \
        --error-on-warnings $(sed 's|^js/app/||' <<<"$js")) \
      || { echo "   fix: cd js && bun run fix, then re-check"; fail=1; }
    echo "── oxlint (warn-only; STYLE_GUIDE.md FE-12)"
    (cd js/app && bunx --yes oxlint@1.73.0 $(sed 's|^js/app/||' <<<"$js")) || fail=1
  fi
  if [ -n "$sg" ]; then
    echo "── ast-grep code rules (rule ids map to STYLE_GUIDE.md)"
    bunx --yes @ast-grep/cli@0.44.1 scan --report-style=short $sg || fail=1
  fi
  if [ "{{ ARGS }}" = "full" ]; then
    if [ -n "$js" ]; then
      echo "── tsc (js/app)"
      (cd js && bun run check) || fail=1
    fi
    if [ -n "$rs_cs" ]; then
      echo "── clippy (rust/cloud-storage)"
      (cd rust/cloud-storage && RUSTFLAGS="-Dwarnings -Dclippy::disallowed_methods" \
          RUSTDOCFLAGS=-Dwarnings SQLX_OFFLINE=true cargo clippy --workspace --all-features) || fail=1
    fi
  fi

  echo
  if [ "$fail" -ne 0 ]; then echo "FAIL"; exit 1; fi
  echo "OK"
