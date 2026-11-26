# The one-time Argo CD bootstrap: install Argo CD from manifests/prod/argocd,
# then the `apps` Application, which syncs every application (Argo CD and
# itself included) from main. Run it once, after the cluster exists, from a
# checkout of main that already contains this directory:
#
#   nix run .#bootstrap -- --context <kube context of the observability cluster>
#
# --revision <branch> is for test clusters only (kind-smoke): it applies the
# applications directly with that targetRevision and skips the app of apps,
# which would reset them to main.
usage() {
  echo "usage: bootstrap --context <kube-context> [--revision <branch>]" >&2
  exit 2
}
context=""
revision=""
while [ $# -gt 0 ]; do
  case "$1" in
    --context) context="${2:-}"; shift 2 ;;
    --revision) revision="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$context" ] || usage

dir="$(git rev-parse --show-toplevel)/infra/k8s/observability/cluster"
manifests="$dir/manifests/prod"
k() { kubectl --context "$context" "$@"; }

# Argo CD is installed from this checkout and then syncs from main; they must
# be the same, or it starts by changing what was just installed.
if [ -z "$revision" ]; then
  main=$(git ls-remote origin refs/heads/main | cut -f1)
  if [ "$(git rev-parse HEAD)" != "$main" ] || [ -n "$(git status --porcelain -- "$dir")" ]; then
    echo "Run this from a clean checkout of origin/main ($main)." >&2
    exit 1
  fi
fi

echo "Bootstrapping Argo CD on $(k config view --minify -o jsonpath='{.clusters[0].cluster.server}') (context $context)"
# Server-side, as the field manager Argo CD's server-side sync uses, so it
# takes these objects over without conflicts.
apply() { k apply --server-side --force-conflicts --field-manager=argocd-controller "$@"; }
apply -f "$manifests/argocd/Namespace-argocd.yaml"
# Not the ExternalSecrets: their CRD comes with the external-secrets
# application, and Argo CD's first sync of itself creates them.
files=()
for file in "$manifests"/argocd/*.yaml; do
  case "$(basename "$file")" in ExternalSecret-*) ;; *) files+=(-f "$file") ;; esac
done
apply "${files[@]}"
k wait --for=condition=Established --timeout=2m crd/applications.argoproj.io
k -n argocd rollout status deployment/argocd-repo-server --timeout=5m
k -n argocd rollout status statefulset/argocd-application-controller --timeout=5m

if [ -z "$revision" ]; then
  apply -f "$manifests/apps/Application-apps.yaml"
else
  echo "Test cluster: applying the applications at $revision, without the app of apps"
  for app in "$manifests"/apps/*.yaml; do
    [ "$(basename "$app")" = Application-apps.yaml ] && continue
    REV="$revision" yq '.spec.source.targetRevision = strenv(REV)' "$app" | apply -f -
  done
fi
k -n argocd get applications
