#!/usr/bin/env bash
# Restarts the subr stack on the final heads: the drafter head's document storage service and
# harness (bin/stack-top) and the editor head's frontend with the sub-routines flag baked in.
# Volumes are kept (stop_local, not stack down).
set -u
C=~/.cache/routines-draft-subroutines
E=$HOME/.herdr/worktrees/macro/synoet-routines-sub-routine-editor
echo "== stop $(date -u +%T)"
\cd $E && nix develop $E --command bash -c "export TMPDIR=\$HOME/.cache/pw; just stop_local --instance subr --port-base 28600 </dev/null > $C/stop_local-after.log 2>&1; echo stop=\$?" 2>&1 | grep -v "Git tree\|rmeta"
echo "== start editor $(git -C $E rev-parse --short=11 HEAD) $(date -u +%T)"
\cd $E && nix develop $E --command bash -c "export TMPDIR=\$HOME/.cache/pw VITE_ENABLE_SUB_ROUTINES=true; just run_local --instance subr --binaries-dir $C/bin/stack-top --no-computers --static-frontend --env-file $C/subr.env </dev/null > $C/run_local-after.log 2>&1; echo run_local=\$?" 2>&1 | grep -v "Git tree\|rmeta"
for c in macro-subr-document_storage_service-1 macro-subr-agent_harness_service-1; do
  nix develop $E --command docker inspect $c --format '{{.Name}} {{.State.Health.Status}} {{range .Mounts}}{{if eq .Destination "/app/out"}}{{.Source}}{{end}}{{end}}' 2>&1 | grep -v "Git tree"
done
sha256sum $C/bin/stack-top/document_storage_service $C/bin/stack-top/agent_harness_service
echo "== done $(date -u +%T)"
