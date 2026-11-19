# The observability EKS cluster in Ohio. Argo CD syncs main from this path.
{
  nixidy.target = {
    repository = "https://github.com/macro-inc/macro.git";
    branch = "main";
    rootPath = "./infra/k8s/observability/cluster/manifests/prod";
  };

  macro.cluster = {
    # Off for the first rollout: each application waits for a manual sync
    # after its diff has been read in Argo CD (README "Bootstrap"). On once
    # the cluster has been tested.
    autoSync = false;
    name = "observability";
    region = "us-east-2";
    kubernetesVersion = "1.37.0";
    # The Pulumi observability stack tags its VPC with these and no Name.
    vpcTags = {
      project = "observability";
      environment = "prod";
    };
    secretsManagerSecret = "observability/prod";
  };

  # From ../aws/settings.nix (hosts, edge, existing.alb*) and its outputs.
  macro.edge = {
    # Cutover adds grafana.macro-internal.com and otlp.macro-internal.com.
    grafanaHosts = [ "grafana-next.macro-internal.com" ];
    otlpHosts = [ "otlp-next.macro-internal.com" ];
    targetGroups = {
      grafana = "obs-k8s-grafana";
      otlp = "obs-k8s-otlp";
    };
    zones = [
      "us-east-2a"
      "us-east-2b"
    ];
    albSourceCidrs = [
      "10.88.0.0/24"
      "10.88.1.0/24"
    ];
  };

  macro.grafana = {
    hostname = "grafana-next.macro-internal.com";
    # Through the ALB: GoAlert stays on the host. The host's nginx opens
    # /api/v2/grafana/ there in a later host change; the heartbeat path is
    # open already.
    goalertUrl = "https://oncall.macro-internal.com";
    # Only the host's Grafana notifies until cutover.
    notify = false;
    alertTopicArn = "arn:aws:sns:us-east-2:569036502058:observability-prod-alerts";
    # The versions the host's nixpkgs ships with Grafana 13.0.9.
    plugins = {
      grafana-lokiexplore-app = "2.0.4";
      grafana-metricsdrilldown-app = "2.0.3";
      grafana-exploretraces-app = "2.0.3";
    };
    database = {
      # Set after `tofu apply` from `nix run .#tofu -- main output` in
      # ../aws: grafana_db_address and grafana_db_secret_arn. Grafana runs
      # 0 replicas until both are set.
      host = null;
      secret = null;
      # The private subnets RDS uses: the host's 2a and the cluster's 2b, 2c.
      cidrs = [
        "10.88.10.0/24"
        "10.88.16.0/20"
        "10.88.32.0/20"
      ];
    };
  };
}
