# Fail when manifests/prod differs from what the Nix renders, then validate
# the manifests against the Kubernetes and CRD schemas.
dir="$(git rev-parse --show-toplevel)/infra/k8s/observability/cluster"
out=$(nix build --no-link --print-out-paths "$dir#prod")
if ! diff --recursive --unified "$out" "$dir/manifests/prod"; then
  echo "::error::manifests/prod is out of date. Run \`nix run .#render\` in infra/k8s/observability/cluster and commit the result." >&2
  exit 1
fi
echo "manifests/prod matches the Nix"
nix run "$dir#validate"
