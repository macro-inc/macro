# What the observability apps stand on: GitOps, certificates, AWS
# integration, storage, namespace policy and the cluster's own telemetry.
{
  imports = [
    ./argocd.nix
    ./cert-manager.nix
    ./aws-load-balancer-controller.nix
    ./external-secrets.nix
    ./storage.nix
    ./observability-namespace.nix
    ./alloy-node.nix
    ./reloader.nix
  ];
}
