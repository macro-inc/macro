# Everything the cluster runs. `env/<name>.nix` sets the facts that differ per
# cluster (`macro.cluster`); each module below is one or more Argo CD
# applications.
{
  imports = [
    ./cluster.nix
    ./platform
    ./backends
    # Each is its own application in the `observability` namespace and brings
    # its own NetworkPolicies (see platform/observability-namespace.nix).
    ./grafana.nix
    ./ingest.nix
    ./edge.nix
  ];
}
