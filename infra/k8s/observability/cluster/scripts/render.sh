# Render the Nix to manifests/prod: the YAML Argo CD applies. Commit the result.
dir="$(git rev-parse --show-toplevel)/infra/k8s/observability/cluster"
out=$(nix build --no-link --print-out-paths "$dir#prod")
mkdir -p "$dir/manifests/prod"
rsync --recursive --delete --checksum \
  --chmod=Du=rwx,Dg=rx,Do=rx,Fu=rw,Fg=r,Fo=r \
  "$out/" "$dir/manifests/prod/"
echo "rendered $dir/manifests/prod"
