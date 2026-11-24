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
    # The host's Loki and Tempo buckets. Pulumi names them with a random
    # suffix, so they are found by these prefixes among the stack's tagged
    # buckets (modules/existing.nix).
    bucketPrefixes = {
      logs = "observability-logs-";
      traces = "observability-traces-";
    };
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
    # The one cluster admin: an IAM role whose only AWS permission is reading
    # the cluster, mapped to cluster admin. Who may assume it is an IAM tag on their IAM
    # user, `<adminTag> = admin` (people, MFA required) or `automation`
    # (agents and scripts, no MFA). Tagging an identity is the grant, so no
    # person is named here.
    adminRole = "observability-eks-admin";
    adminTag = "observability-eks";
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

  # One new bucket per backend, used while the cluster is tested. At the switch
  # (README "The switch") Loki and Tempo move to the host's buckets below,
  # which keeps their history; Mimir keeps its own and gets the host's
  # Prometheus history uploaded. Two Loki or Tempo compactors on one bucket
  # delete each other's blocks, so the host's must be stopped first.
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
    # RDS rotates its managed password every 7 days by default, and Grafana
    # loses new connections until it reads the new one. Once a year instead:
    # the first Sunday of January, the hour after the database's maintenance
    # window (UTC). cron, not rate(): AWS documents that changing a rate()
    # schedule can still run the previously scheduled rotation.
    passwordRotation = {
      schedule = "cron(0 5 ? 1 SUN#1 *)";
      window = "1h";
    };
  };

  # The ALB forwards to the edge nginx pods (IP targets) on this port; the
  # cluster's TargetGroupBinding and edge Service must use the same.
  # The ALB sends nothing to a target in a zone it isn't enabled in, so the edge
  # pods must run only in `existing.albZones` (node affinity), never in 2c.
  edge = {
    port = 8080;
    healthPath = "/healthz";
  };

  # The hostnames the cluster serves through the ALB. Grafana and OTLP came
  # over at the switch; their DNS records and certificate are the Pulumi
  # stack's and don't change. A host with `own = true` is new here: this layer
  # makes its DNS record and its certificate on the listener (modules/edge.nix).
  hosts = {
    grafana = {
      hostname = "grafana.macro-internal.com";
      targetGroup = "obs-k8s-grafana";
      priority = 10;
    };
    otlp = {
      hostname = "otlp.macro-internal.com";
      targetGroup = "obs-k8s-otlp";
      priority = 11;
    };
    # Argo CD's UI and API, behind Google sign-in (../cluster/README.md
    # "Argo CD").
    argocd = {
      hostname = "argo.macro-internal.com";
      targetGroup = "obs-k8s-argocd";
      priority = 12;
      own = true;
    };
  };

  # The switch (README "The switch"). True adds a listener rule per host and
  # the target-group alarms. The Pulumi stack's rule (priority 1) still wins
  # until it drops these hostnames, so applying this alone moves no traffic.
  switched = true;

  # The host copies its Prometheus blocks straight into Mimir's bucket: once
  # with one old block while the cluster is tested, then everything at the
  # switch (../cluster/README.md). `enable` lets the host's role list and
  # write `prefix` there, nothing else; turn it off once the copy is done.
  mimirBackfill = {
    enable = false;
    # Mimir's `blocks_storage.storage_prefix`, then the tenant (`anonymous`
    # with multitenancy off). Change it with ../cluster's
    # modules/backends/mimir.nix.
    prefix = "blocks/anonymous/";
  };

  alarms.target5xxPer5Min = 25;
}
