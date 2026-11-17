# Every value the AWS layer is built from. Names here are part of the contract
# with infra/k8s/observability/cluster (service accounts, ports, bucket names):
# change both sides together.
rec {
  region = "us-east-2";
  accountId = "569036502058";

  # Applied to every resource through the provider's default_tags. Not
  # `project = observability`: the Pulumi stack's resources carry that tag and
  # are looked up by it.
  tags = {
    project = "observability-k8s";
    environment = "prod";
    managed-by = "opentofu";
  };

  state = {
    bucket = "macro-observability-k8s-tofu-state";
    mainKey = "main/terraform.tfstate";
    bootstrapKey = "bootstrap/terraform.tfstate";
  };

  # Owned by the Pulumi `observability` stack (infra/stacks/observability).
  # Read only, never imported or changed.
  existing = {
    tags = {
      project = "observability";
      environment = "prod";
    };
    privateSubnetCidr = "10.88.10.0/24"; # us-east-2a, shared with the host
    # The ALB's subnets: it is enabled only in 2a and 2b, and its traffic and
    # health checks to pods come from these addresses.
    albZones = [
      "us-east-2a"
      "us-east-2b"
    ];
    albSubnetCidrs = [
      "10.88.0.0/24"
      "10.88.1.0/24"
    ];
    zone = "macro-internal.com";
    alarmTopic = "observability-prod-alerts";
    secret = "observability/prod";
  };

  # New private subnets; with the existing 2a subnet the cluster spans 3 AZs.
  privateSubnets = {
    b = "10.88.16.0/20";
    c = "10.88.32.0/20";
  };

  cluster = {
    name = "observability";
    # Newest version in EKS standard support; check before apply (README).
    version = "1.37";
    nodes = {
      instanceType = "m7g.large";
      amiType = "AL2023_ARM_64_STANDARD";
      count = 3;
      diskGiB = 40;
    };
    # Control-plane log groups are kept this long.
    logRetentionDays = 30;
  };

  # Pod Identity: namespace -> service account -> what its role may do.
  # The roles' policies are in modules/pod-identity.nix.
  serviceAccounts = {
    loki = {
      namespace = "observability";
      name = "loki";
    };
    tempo = {
      namespace = "observability";
      name = "tempo";
    };
    mimir = {
      namespace = "observability";
      name = "mimir";
    };
    grafana = {
      namespace = "observability";
      name = "grafana";
    };
    externalSecrets = {
      namespace = "external-secrets";
      name = "external-secrets";
    };
    loadBalancerController = {
      namespace = "kube-system";
      name = "aws-load-balancer-controller";
    };
    ebsCsi = {
      namespace = "kube-system";
      name = "ebs-csi-controller-sa";
    };
  };

  # One new bucket per backend: two Loki or Tempo compactors on one bucket
  # would delete each other's blocks, so the host's buckets are not shared.
  buckets = {
    loki = "macro-observability-k8s-loki";
    tempo = "macro-observability-k8s-tempo";
    mimir = "macro-observability-k8s-mimir";
  };

  # Secrets External Secrets may read besides the RDS-managed Grafana password:
  # the host's bundle and any cluster-only secret under this prefix (such as
  # Argo CD's repository deploy key).
  clusterSecretPrefix = "observability/k8s/";

  grafanaDb = {
    identifier = "observability-grafana";
    instanceClass = "db.t4g.micro";
    engineVersion = "17";
    storageGiB = 20;
    name = "grafana";
    username = "grafana";
  };

  # The ALB forwards to the edge nginx pods (IP targets) on this port; the
  # cluster's TargetGroupBinding and edge Service must use the same.
  # The ALB sends nothing to a target in a zone it isn't enabled in, so the edge
  # pods must run only in `existing.albZones` (node affinity), never in 2c.
  edge = {
    port = 8080;
    healthPath = "/healthz";
  };

  # Hostnames served by the cluster before cutover. Listener rule priorities
  # stay clear of the Pulumi stack's 1 and 2.
  hosts = {
    grafana = {
      hostname = "grafana-next.macro-internal.com";
      targetGroup = "obs-k8s-grafana";
      priority = 10;
    };
    otlp = {
      hostname = "otlp-next.macro-internal.com";
      targetGroup = "obs-k8s-otlp";
      priority = 11;
    };
  };

  alarms = {
    # Off until cutover: the alarms exist and change state, but don't publish
    # to the alarm topic (its subscribers are people) while the cluster is an
    # experiment with nothing behind its target groups yet.
    notify = false;
    target5xxPer5Min = 25;
  };
}
