# Single local quality gate: format + lint + code rules, scoped to files you
# changed vs origin/main (merge-base, plus uncommitted and untracked work) so
# the output is exactly what is wrong with YOUR changes — legacy findings in
# untouched files never appear. Findings print as file:line with the rule id;
# ast-grep rule ids map to docs/STYLE_GUIDE.md (its `severity: error` rules fail
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

    rs=$(grep -E '^(crates|services|tooling)/.*\.rs$' <<<"$changed" || true)
    js=$(grep -E '^(apps/web|packages|services/(analytics-proxy|ai-editing-worker|lexical-service|websocket-service))/.*\.(ts|tsx)$' <<<"$changed" || true)
    sg=$(grep -E '^(apps|crates|packages|services|tooling)/.*\.(rs|ts|tsx)$' <<<"$changed" || true)

    fail=0
    if [ -n "$rs" ]; then
      echo "── cargo fmt (root workspace)"
      cargo fmt --check \
        || { echo "   fix: cargo fmt"; fail=1; }
    fi
    if [ -n "$js" ]; then
      echo "── biome (apps/web format + lint, same flags as CI)"
      (cd apps/web && bunx --bun @biomejs/biome ci --colors=off --no-errors-on-unmatched \
          --error-on-warnings $(sed 's|^apps/web/||' <<<"$js")) \
        || { echo "   fix: bun run fix, then re-check"; fail=1; }
      echo "── oxlint (warn-only; docs/STYLE_GUIDE.md FE-12)"
      (cd apps/web && bunx --yes oxlint@1.73.0 $(sed 's|^apps/web/||' <<<"$js")) || fail=1
    fi
    if [ -n "$sg" ]; then
      echo "── ast-grep code rules (rule ids map to docs/STYLE_GUIDE.md)"
      bunx --yes @ast-grep/cli@0.44.1 scan --report-style=short $sg || fail=1
    fi
    if [ "{{ ARGS }}" = "full" ]; then
      if [ -n "$js" ]; then
        echo "── tsc (apps/web)"
        bun run check || fail=1
      fi
      if [ -n "$rs" ]; then
        echo "── clippy (root workspace)"
        (RUSTFLAGS="-Dwarnings -Dclippy::disallowed_methods" \
            RUSTDOCFLAGS=-Dwarnings SQLX_OFFLINE=true cargo clippy --workspace --all-features \
            --exclude sync_service && \
         RUSTFLAGS="-Dwarnings -Dclippy::disallowed_methods" \
            RUSTDOCFLAGS=-Dwarnings SQLX_OFFLINE=true cargo clippy -p sync_service -- \
            -A clippy::unnecessary_map_or -A clippy::collapsible_if) || fail=1
      fi
    fi

    echo
    if [ "$fail" -ne 0 ]; then echo "FAIL"; exit 1; fi
    echo "OK"
