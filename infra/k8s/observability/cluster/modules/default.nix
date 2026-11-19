# Everything the cluster runs. `env/<name>.nix` sets the facts that differ per
# cluster (`macro.cluster`); each module below is one or more Argo CD
# applications.
{
  imports = [
    ./cluster.nix
    ./platform
    # Later: ./loki.nix ./tempo.nix ./mimir.nix (backends), ./grafana.nix,
    # ./ingest.nix, ./edge.nix. Each is its own application in the
    # `observability` namespace and brings its own NetworkPolicies (see
    # platform/observability-namespace.nix).
  ];
}
