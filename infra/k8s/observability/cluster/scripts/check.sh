# Fail when manifests/prod or either mapping (derived metrics, Datadog
# monitors) differs from what the Nix renders, then validate the manifests
# against the Kubernetes and CRD schemas.
dir="$(git rev-parse --show-toplevel)/infra/k8s/observability/cluster"
out=$(nix build --no-link --print-out-paths "$dir#prod")
if ! diff --recursive --unified "$out" "$dir/manifests/prod"; then
  echo "::error::manifests/prod is out of date. Run \`nix run .#render\` in infra/k8s/observability/cluster and commit the result." >&2
  exit 1
fi
echo "manifests/prod matches the Nix"
mapping=$(nix build --no-link --print-out-paths "$dir#derived-metrics-mapping")
if ! diff --unified "$mapping" "$dir/modules/derived-metrics/MAPPING.md"; then
  echo "::error::modules/derived-metrics/MAPPING.md is out of date. Run \`nix run .#render\` in infra/k8s/observability/cluster and commit the result." >&2
  exit 1
fi
datadog=$(nix build --no-link --print-out-paths "$dir#datadog-mapping")
if ! diff --unified "$datadog" "$(git rev-parse --show-toplevel)/infra/stacks/observability/nixos/grafana-provisioning/datadog/MAPPING.md"; then
  echo "::error::infra/stacks/observability/nixos/grafana-provisioning/datadog/MAPPING.md is out of date. Run \`nix run .#render\` in infra/k8s/observability/cluster and commit the result." >&2
  exit 1
fi
nix run "$dir#validate"
