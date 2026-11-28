# Render the Nix to manifests/prod, the YAML Argo CD applies, the derived
# metrics' mapping and the Datadog monitors' mapping. Commit the result.
dir="$(git rev-parse --show-toplevel)/infra/k8s/observability/cluster"
out=$(nix build --no-link --print-out-paths "$dir#prod")
mkdir -p "$dir/manifests/prod"
rsync --recursive --delete --checksum \
  --chmod=Du=rwx,Dg=rx,Do=rx,Fu=rw,Fg=r,Fo=r \
  "$out/" "$dir/manifests/prod/"
echo "rendered $dir/manifests/prod"
mapping=$(nix build --no-link --print-out-paths "$dir#derived-metrics-mapping")
install -m 644 "$mapping" "$dir/modules/derived-metrics/MAPPING.md"
datadog=$(nix build --no-link --print-out-paths "$dir#datadog-mapping")
install -m 644 "$datadog" "$(git rev-parse --show-toplevel)/infra/stacks/observability/nixos/grafana-provisioning/datadog/MAPPING.md"
