# Pieces every replicated workload in `observability` shares, so a rollout, a
# node replacement or a lost zone never takes all replicas at once.
{ lib }:
rec {
  # Replicas in different zones (hard) and on different nodes (soft). With
  # 2 replicas and 3 zones a surge pod still has a zone to go to.
  spread = selector: [
    {
      maxSkew = 1;
      topologyKey = "topology.kubernetes.io/zone";
      whenUnsatisfiable = "DoNotSchedule";
      labelSelector.matchLabels = selector;
    }
    {
      maxSkew = 1;
      topologyKey = "kubernetes.io/hostname";
      whenUnsatisfiable = "ScheduleAnyway";
      labelSelector.matchLabels = selector;
    }
  ];

  # Only on nodes in these zones (the edge: the ALB serves only some).
  zoneAffinity = zones: {
    nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms = [
      {
        matchExpressions = [
          {
            key = "topology.kubernetes.io/zone";
            operator = "In";
            values = zones;
          }
        ];
      }
    ];
  };

  # Pod Security `restricted`, which the namespace warns on.
  podSecurity = uid: {
    runAsNonRoot = true;
    runAsUser = uid;
    runAsGroup = uid;
    fsGroup = uid;
    seccompProfile.type = "RuntimeDefault";
  };
  containerSecurity = {
    allowPrivilegeEscalation = false;
    readOnlyRootFilesystem = true;
    capabilities.drop = [ "ALL" ];
    seccompProfile.type = "RuntimeDefault";
  };

  # A rolling update that adds the new pod before removing an old one.
  surgeOne = {
    type = "RollingUpdate";
    rollingUpdate = {
      maxSurge = 1;
      maxUnavailable = 0;
    };
  };

  tcpPorts = map (port: {
    protocol = "TCP";
    inherit port;
  });

  # NetworkPolicy peers.
  pods = matchLabels: { podSelector.matchLabels = matchLabels; };
  # Any pod in the namespace: for egress to the backends, whose own ingress
  # policies decide who gets in (by `clientLabels`).
  anyPod = {
    podSelector = { };
  };
  cidrs = map (cidr: {
    ipBlock.cidr = cidr;
  });

  # Rolls a pod template when this text changes (mounted ConfigMaps don't).
  checksum = text: builtins.hashString "sha256" text;

  # An ExternalSecret (as YAML for `applications.<app>.yamls`) that copies
  # keys of a Secrets Manager secret into the Secret `name`:
  # - `properties`: keys of the JSON secret `cluster.secretsManagerSecret`;
  # - `extract`: every key of another JSON secret (name or ARN);
  # - `template`: Secret data built from those keys (Go templates).
  # A key missing from the secret fails the whole ExternalSecret, so keys
  # that may not exist yet get their own.
  externalSecret =
    cluster:
    {
      name,
      properties ? [ ],
      extract ? null,
      template ? null,
      refreshInterval ? "1h",
    }:
    builtins.toJSON {
      apiVersion = "external-secrets.io/v1";
      kind = "ExternalSecret";
      metadata = {
        inherit name;
        # The CRD comes from the external-secrets application.
        annotations."argocd.argoproj.io/sync-options" = "SkipDryRunOnMissingResource=true";
      };
      spec = {
        inherit refreshInterval;
        secretStoreRef = {
          kind = "ClusterSecretStore";
          name = cluster.secretStore;
        };
        target = {
          inherit name;
          creationPolicy = "Owner";
        }
        // lib.optionalAttrs (template != null) {
          template = {
            engineVersion = "v2";
            data = template;
          };
        };
      }
      // lib.optionalAttrs (properties != [ ]) {
        data = map (property: {
          secretKey = property;
          remoteRef = {
            key = cluster.secretsManagerSecret;
            inherit property;
          };
        }) properties;
      }
      // lib.optionalAttrs (extract != null) {
        dataFrom = [ { extract.key = extract; } ];
      };
    };

  # Split "http://host:port/path" into the origin and the path ("" if none).
  splitUrl =
    url:
    let
      parts = builtins.match "(https?://[^/]+)(/.*)?" url;
    in
    assert lib.assertMsg (parts != null) "not an http(s) URL: ${url}";
    {
      origin = builtins.elemAt parts 0;
      path = if builtins.elemAt parts 1 == null then "" else builtins.elemAt parts 1;
    };
}
