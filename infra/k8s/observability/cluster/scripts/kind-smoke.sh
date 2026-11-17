# Bootstrap Argo CD on a throwaway kind cluster from this branch (pushed: Argo
# CD reads it from GitHub) and wait for every application to settle. There is
# no AWS here, so two applications can't become healthy and are reported, not
# failed: the load balancer controller can't look up its VPC, and the
# ClusterSecretStore can't authenticate.
#
#   nix run .#kind-smoke [-- --revision <branch>] [--delete]
name=observability-smoke
image="kindest/node:v1.36.4@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed"
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

# Expected without AWS.
expected_unhealthy="aws-load-balancer-controller external-secrets"
deadline=$((SECONDS + 1200))
while :; do
  table=$(kubectl --context "$context" -n argocd get applications \
    -o jsonpath='{range .items[*]}{.metadata.name} {.status.sync.status} {.status.health.status}{"\n"}{end}')
  pending=$(awk -v skip=" $expected_unhealthy " \
    'index(skip, " " $1 " ") == 0 && ($2 != "Synced" || $3 != "Healthy")' <<<"$table")
  if [ -z "$pending" ]; then break; fi
  if [ $SECONDS -ge $deadline ]; then
    echo "Timed out; not Synced and Healthy:" >&2
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
