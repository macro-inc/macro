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
    js=$(grep -E '^(apps/web|packages|services/(analytics-proxy|ai-editing-worker|lexical-service|websocket-service|cla-worker|coding-agent-worker|bots))/.*\.(ts|tsx|js|jsx)$' <<<"$changed" || true)
    sg=$(grep -E '^(apps|crates|packages|services|tooling)/.*\.(rs|ts|tsx)$' <<<"$changed" || true)

    fail=0
    if [ -n "$rs" ]; then
      echo "── cargo fmt (root workspace)"
      cargo fmt --check \
        || { echo "   fix: cargo fmt"; fail=1; }
    fi
    if [ -n "$js" ]; then
      # Group changed files by the nearest biome.jsonc so each package uses
      # its own config (apps/web biome does not lint other workspace roots).
      declare -A biome_groups=()
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        d=$(dirname "$f")
        root=""
        while [ "$d" != "." ]; do
          if [ -f "$d/biome.jsonc" ] || [ -f "$d/biome.json" ]; then
            root=$d
            break
          fi
          d=$(dirname "$d")
        done
        if [ -n "$root" ]; then
          biome_groups[$root]+="$f"$'\n'
        fi
      done <<<"$js"

      for root in "${!biome_groups[@]}"; do
        rels=()
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          rels+=("${f#"$root"/}")
        done <<< "${biome_groups[$root]}"
        echo "── biome ($root, changed JS/TS format + lint, same flags as CI)"
        (cd "$root" && bunx --bun @biomejs/biome ci --colors=off --no-errors-on-unmatched \
            --error-on-warnings "${rels[@]}") \
          || { echo "   fix: (cd $root && bunx --bun @biomejs/biome check --write)"; fail=1; }
        if [ "$root" = "apps/web" ]; then
          echo "── oxlint (warn-only; docs/STYLE_GUIDE.md FE-12)"
          web_paths=()
          while IFS= read -r f; do
            [ -z "$f" ] && continue
            web_paths+=("$PWD/$f")
          done <<< "${biome_groups[$root]}"
          (cd apps/web && bunx --yes oxlint@1.73.0 "${web_paths[@]}") || fail=1
        fi
      done
    fi
    if [ -n "$sg" ]; then
      echo "── ast-grep code rules (rule ids map to docs/STYLE_GUIDE.md)"
      bunx --yes @ast-grep/cli@0.44.1 scan --report-style=short $sg || fail=1
    fi
    if [ "{{ ARGS }}" = "full" ]; then
      if [ -n "$js" ]; then
        ts_projects=""
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          case "$f" in
            apps/web/*) ts_projects+=$'apps/web\n' ;;
            packages/collaboration/*) ts_projects+=$'packages/collaboration\n' ;;
            packages/sdk/*) ts_projects+=$'packages/sdk\n' ;;
            packages/lexical-core/*) ts_projects+=$'packages/lexical-core\n' ;;
            packages/loro-mirror/*) ts_projects+=$'packages/loro-mirror\n' ;;
            packages/observability/*) ts_projects+=$'packages/observability\n' ;;
            packages/email-renderer/*) ts_projects+=$'packages/email-renderer\n' ;;
            services/ai-editing-worker/*) ts_projects+=$'services/ai-editing-worker\n' ;;
            services/lexical-service/*) ts_projects+=$'services/lexical-service\n' ;;
            services/cla-worker/*) ts_projects+=$'services/cla-worker\n' ;;
            services/analytics-proxy/*) ts_projects+=$'services/analytics-proxy\n' ;;
            services/websocket-service/*) ts_projects+=$'services/websocket-service\n' ;;
            services/bots/stripe-payment-bot/*) ts_projects+=$'services/bots/stripe-payment-bot\n' ;;
            services/bots/anthropic-status-bot/*) ts_projects+=$'services/bots/anthropic-status-bot\n' ;;
          esac
        done <<<"$js"
        ts_projects=$(printf '%s' "$ts_projects" | sort -u)
        if grep -qx 'apps/web' <<<"$ts_projects"; then
          echo "── tsc (apps/web)"
          bun run check || fail=1
        fi
        if grep -qx 'packages/collaboration' <<<"$ts_projects"; then
          echo "── tsc (packages/collaboration)"
          bun run --cwd packages/collaboration type-check || fail=1
        fi
        if grep -qx 'packages/sdk' <<<"$ts_projects"; then
          echo "── tsc (packages/sdk)"
          bun run --cwd packages/sdk check || fail=1
        fi
        gap=$(printf '%s\n' "$ts_projects" | grep -vE '^(apps/web|packages/collaboration|packages/sdk)$' || true)
        if [ -n "$gap" ]; then
          only=$(printf '%s' "$gap" | paste -sd, -)
          echo "── tsc ($only)"
          bash tooling/scripts/check-typescript.sh --tsc --only "$only" || fail=1
        fi
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
