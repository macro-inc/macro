# Validate manifests/prod (or the directory given) with kubeconform, strictly:
# core kinds against the Kubernetes JSON schemas for the cluster's version,
# custom resources against the CRDs the manifests themselves install.
# CustomResourceDefinitions have no published JSON schema; the API server
# checks them (`nix run .#kind-smoke` applies them all).
dir="$(git rev-parse --show-toplevel)/infra/k8s/observability/cluster"
manifests="${1:-$dir/manifests/prod}"
system=$(nix eval --raw --impure --expr builtins.currentSystem)
version=$(nix eval --raw "$dir#nixidyEnvs.$system.prod.config.macro.cluster.kubernetesVersion")
# Pinned, so a schema change upstream can't change the result.
schemas="https://raw.githubusercontent.com/yannh/kubernetes-json-schema/6ea44f54bb5cdedb2f61fba42c9b342e97959262"

crds=$(mktemp -d)
cache="${XDG_CACHE_HOME:-$HOME/.cache}/kubeconform"
mkdir -p "$cache"
trap 'rm -rf "$crds"' EXIT

# One JSON schema per CRD version, closed like the core strict schemas: an
# object that lists its properties rejects others unless the CRD keeps unknown
# fields. `close` walks schemas only, since a `properties` map can hold a
# field named "properties".
find "$manifests" -name 'CustomResourceDefinition-*.yaml' -print0 |
  while IFS= read -r -d '' crd; do
    yq -o=json '.' "$crd" | jq -c '
      def close:
        if type != "object" then . else
          with_entries(
            if .key == "properties" then .value |= map_values(close)
            elif .key == "items" or .key == "additionalProperties" or .key == "not" then .value |= close
            elif .key == "allOf" or .key == "anyOf" or .key == "oneOf" then .value |= map(close)
            else . end)
          | if has("properties") and (has("additionalProperties") | not)
               and ((."x-kubernetes-preserve-unknown-fields" // false) | not)
            then . + {additionalProperties: false} else . end
        end;
      .spec.group as $group | (.spec.names.kind | ascii_downcase) as $kind |
      .spec.versions[] | {
        path: "\($group)/\($kind)_\(.name).json",
        schema: (.schema.openAPIV3Schema | close)
      }' | while IFS= read -r entry; do
        path="$crds/$(jq -r .path <<<"$entry")"
        mkdir -p "$(dirname "$path")"
        jq .schema <<<"$entry" >"$path"
      done
  done

kubeconform -strict -summary \
  -skip CustomResourceDefinition \
  -kubernetes-version "$version" \
  -cache "$cache" \
  -schema-location "$schemas/{{.NormalizedKubernetesVersion}}-standalone{{.StrictSuffix}}/{{.ResourceKind}}{{.KindSuffix}}.json" \
  -schema-location "$crds/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json" \
  "$manifests"
