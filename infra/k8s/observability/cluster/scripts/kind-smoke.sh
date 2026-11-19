# Bootstrap Argo CD on a throwaway kind cluster from this branch (pushed: Argo
# CD reads it from GitHub) and wait until every application is synced and all
# but those that need AWS are healthy.
#
#   nix run .#kind-smoke [-- --revision <branch>] [--delete]
name=observability-smoke
image="kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"
revision="$(git rev-parse --abbrev-ref HEAD)"
delete=false
while [ $# -gt 0 ]; do
  case "$1" in
    --revision) revision="${2:-}"; shift 2 ;;
    --delete) delete=true; shift ;;
    *) echo "usage: kind-smoke [--revision <branch>] [--delete]" >&2; exit 2 ;;
  esac
done

remote=$(git ls-remote origin "refs/heads/$revision" | cut -f1)
if [ "$remote" != "$(git rev-parse HEAD)" ]; then
  echo "origin/$revision is not this commit; push it first (Argo CD reads the branch from GitHub)" >&2
  exit 1
fi

if ! kind get clusters | grep -qx "$name"; then
  kind create cluster --name "$name" --image "$image" --wait 2m
fi
context="kind-$name"
nix run "$(git rev-parse --show-toplevel)/infra/k8s/observability/cluster#bootstrap" -- \
  --context "$context" --revision "$revision"
# On a kept cluster the applications may still show an older commit.
kubectl --context "$context" -n argocd annotate applications --all \
  argocd.argoproj.io/refresh=hard --overwrite
# Prod may render with auto-sync off (`macro.cluster.autoSync`); a test cluster
# syncs everything without waiting for anyone.
for app in $(kubectl --context "$context" -n argocd get applications -o name); do
  kubectl --context "$context" -n argocd patch "$app" --type merge \
    -p '{"spec":{"syncPolicy":{"automated":{"prune":true,"selfHeal":true}}}}'
done

# Every application must sync this commit. Without AWS some can't become
# healthy: the load balancer controller can't look up its VPC, the
# ClusterSecretStore can't authenticate, the applications whose pods need a
# secret from it wait for it, and Loki, Tempo and Mimir wait for gp3 volumes
# (EBS CSI) and S3. The edge can't even sync: the controller's webhook, which
# admits TargetGroupBindings, isn't running.
expected_unhealthy="aws-load-balancer-controller external-secrets loki tempo mimir grafana edge alloy-ingest"
expected_unsynced="edge"
deadline=$((SECONDS + 1200))
while :; do
  table=$(kubectl --context "$context" -n argocd get applications \
    -o jsonpath='{range .items[*]}{.metadata.name} {.status.sync.status} {.status.health.status} {.status.sync.revision}{"\n"}{end}')
  pending=$(awk -v skip=" $expected_unhealthy " -v unsynced=" $expected_unsynced " -v rev="$remote" '
    index(unsynced, " " $1 " ") == 0 && ($2 != "Synced" || $4 != rev) { print; next }
    index(skip, " " $1 " ") == 0 && $3 != "Healthy" { print }' <<<"$table")
  if [ -z "$pending" ]; then break; fi
  if [ $SECONDS -ge $deadline ]; then
    echo "Timed out; not Synced at $remote and Healthy:" >&2
    echo "$pending" >&2
    exit 1
  fi
  sleep 20
done

echo "Applications:"
echo "$table" | column -t
echo
echo "Pods not running:"
kubectl --context "$context" get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded || true
if $delete; then kind delete cluster --name "$name"; else echo "Kept: kind delete cluster --name $name"; fi
