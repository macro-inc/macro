# The observability EKS cluster in Ohio. Argo CD syncs main from this path.
{
  nixidy.target = {
    repository = "https://github.com/macro-inc/macro.git";
    branch = "main";
    rootPath = "./infra/k8s/observability/cluster/manifests/prod";
  };

  # The switch: Loki and Tempo on the host's buckets, which hold its history
  # (../aws output `host_buckets`; README "The switch", step 4).
  macro.backends.buckets = {
    loki = "observability-logs-2be9169";
    tempo = "observability-traces-fa2328d";
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
    # The ALB sends these here from the switch on (README "The switch"); until
    # then reach the edge through `kubectl port-forward` with a Host header.
    grafanaHosts = [ "grafana.macro-internal.com" ];
    otlpHosts = [ "otlp.macro-internal.com" ];
    # Until the switch no listener rule uses the target groups, so the ALB
    # never reports these pods healthy (modules/edge.nix).
    albReadinessGate = false;
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
    hostname = "grafana.macro-internal.com";
    # Until the switch Grafana is tested at http://localhost:3000 through
    # `kubectl port-forward` (README "Testing before the switch").
    localTesting = true;
    # Through the ALB: GoAlert stays on the host. Only the GoAlert-only host's
    # nginx lets /api/v2/grafana/ through, so the GoAlert contact points page
    # from the switch's step 8 on (README "Before Grafana runs"); the
    # heartbeat path is open on both.
    goalertUrl = "https://oncall.macro-internal.com";
    # Only the host's Grafana notifies until the switch.
    notify = false;
    alertTopicArn = "arn:aws:sns:us-east-2:569036502058:observability-prod-alerts";
    # The versions the host's nixpkgs ships with Grafana 13.0.9.
    plugins = {
      grafana-lokiexplore-app = "2.0.4";
      grafana-metricsdrilldown-app = "2.0.3";
      grafana-exploretraces-app = "2.0.3";
    };
    database = {
      # ../aws outputs grafana_db_address and grafana_db_secret_arn
      # (`nix run .#tofu -- main output`). Grafana runs 0 replicas while
      # either is null.
      host = "observability-grafana.c7laebw90i5d.us-east-2.rds.amazonaws.com";
      secret = "arn:aws:secretsmanager:us-east-2:569036502058:secret:rds!db-89830474-27c7-4b12-bece-45bf280892da-l6lPOq";
      # The private subnets RDS uses: the host's 2a and the cluster's 2b, 2c.
      cidrs = [
        "10.88.10.0/24"
        "10.88.16.0/20"
        "10.88.32.0/20"
      ];
    };
  };
}
