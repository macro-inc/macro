#!/usr/bin/env bash
# Restarts the subr stack on main 80227ffc54b: main's document storage service and
# harness (bin/main-80227ffc54b) and main's frontend.
# Volumes are kept (stop_local, not stack down).
set -u
C=~/.cache/routines-draft-subroutines
E=$C/main-wt
echo "== stop $(date -u +%T)"
\cd $E && nix develop $E --command bash -c "export TMPDIR=\$HOME/.cache/pw; just stop_local --instance subr --port-base 28600 </dev/null > $C/stop_local-before.log 2>&1; echo stop=\$?" 2>&1 | grep -v "Git tree\|rmeta"
echo "== start main $(git -C $E rev-parse --short=11 HEAD) $(date -u +%T)"
\cd $E && nix develop $E --command bash -c "export TMPDIR=\$HOME/.cache/pw PATH=$HOME/.cache/routines-draft-subroutines/shim:\$PATH; sqlx migrate run --help | grep -c ignore-missing; bun install --frozen-lockfile > $C/bun-install-main.log 2>&1; echo bun-install=\$?; just run_local --instance subr --binaries-dir $C/bin/main-80227ffc54b --no-computers --static-frontend --env-file $C/subr.env </dev/null > $C/run_local-before.log 2>&1; echo run_local=\$?" 2>&1 | grep -v "Git tree\|rmeta"
for c in macro-subr-document_storage_service-1 macro-subr-agent_harness_service-1; do
  nix develop $E --command docker inspect $c --format '{{.Name}} {{.State.Health.Status}} {{range .Mounts}}{{if eq .Destination "/app/out"}}{{.Source}}{{end}}{{end}}' 2>&1 | grep -v "Git tree"
done
sha256sum $C/bin/main-80227ffc54b/document_storage_service $C/bin/main-80227ffc54b/agent_harness_service
echo "== done $(date -u +%T)"
