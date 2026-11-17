# The AWS Load Balancer Controller only registers pod IPs in target groups the
# AWS layer owns (TargetGroupBinding). It creates no load balancers: no
# IngressClass, no Service mutator. Its role comes from Pod Identity on the
# service account `kube-system/aws-load-balancer-controller`.
{ charts, config, ... }:
let
  cluster = config.macro.cluster;
in
{
  applications.aws-load-balancer-controller = {
    namespace = "kube-system";

    helm.releases.aws-load-balancer-controller = {
      chart = charts.eks.aws-load-balancer-controller;
      values = {
        clusterName = cluster.name;
        inherit (cluster) region vpcTags;
        serviceAccount.name = "aws-load-balancer-controller";

        createIngressClassResource = false;
        enableServiceMutatorWebhook = false;
        # The webhook certificate comes from cert-manager (see cert-manager.nix).
        enableCertManager = true;

        replicaCount = 2;
        podDisruptionBudget.maxUnavailable = 1;
      };
    };
  };
}
