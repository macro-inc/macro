# The one-time Argo CD bootstrap: install Argo CD from manifests/prod/argocd,
# then the `apps` Application, which syncs every other application (including
# Argo CD itself) from main. Run it once, after the cluster exists:
#
#   nix run .#bootstrap -- --context <kube context of the observability cluster>
#
# --revision <branch> is for test clusters only (kind-smoke): it applies the
# applications directly with that targetRevision instead of the app of apps,
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

echo "Bootstrapping Argo CD on $(k config view --minify -o jsonpath='{.clusters[0].cluster.server}') (context $context)"
# The field manager Argo CD's server-side sync uses, so it takes over these
# objects without conflicts.
apply() { k apply --server-side --force-conflicts --field-manager=argocd-controller "$@"; }
apply -f "$manifests/argocd/Namespace-argocd.yaml"
apply -f "$manifests/argocd/"
k wait --for=condition=Established --timeout=2m crd/applications.argoproj.io
k -n argocd rollout status deployment/argocd-repo-server --timeout=5m
k -n argocd rollout status statefulset/argocd-application-controller --timeout=5m

if [ -z "$revision" ]; then
  apply -f "$manifests/bootstrap/"
else
  echo "Test cluster: applying the applications at $revision, without the app of apps"
  for app in "$manifests"/apps/*.yaml; do
    REV="$revision" yq '.spec.source.targetRevision = strenv(REV)' "$app" | apply -f -
  done
fi
k -n argocd get applications
