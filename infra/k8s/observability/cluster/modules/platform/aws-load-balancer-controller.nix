# The AWS Load Balancer Controller only registers pod IPs in target groups the
# AWS layer owns (TargetGroupBinding). Nothing here asks it for a load
# balancer: no IngressClass, no Service controller or mutator, no Ingress
# validation (whose webhook would reject every Ingress while the controller is
# down). Its role, from Pod Identity on the service account
# `kube-system/aws-load-balancer-controller`, can only describe and register
# targets, so it couldn't create one either.
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
        controllerConfig.featureGates.EnableServiceController = false;
        webhookConfig.disableIngressValidation = true;
        # The webhook certificate comes from cert-manager (see cert-manager.nix).
        enableCertManager = true;

        replicaCount = 2;
        podDisruptionBudget.maxUnavailable = 1;
      };
    };
  };
}
