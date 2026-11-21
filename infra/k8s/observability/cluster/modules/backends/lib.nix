# What the Loki, Tempo and Mimir modules share: their buckets, the host's
# settings they keep, scheduling and NetworkPolicy pieces.
rec {
  endpoints = import ./endpoints.nix;
  inherit (endpoints) namespace;

  # Created by ../aws (settings.nix `buckets`), one per backend, each readable
  # only by that backend's Pod Identity role. Change both sides together.
  # Loki and Tempo take theirs through `macro.backends.buckets` (default.nix),
  # which the switch points at the host's buckets.
  buckets = {
    loki = "macro-observability-k8s-loki";
    tempo = "macro-observability-k8s-tempo";
    mimir = "macro-observability-k8s-mimir";
  };

  # The single host's Loki, Tempo and Prometheus settings. The cluster takes
  # its features and limits from here (pattern ingestion, level detection,
  # span metrics, service graphs, retention, ...) so both stay the same
  # while they run side by side.
  host = import ../../../../../stacks/observability/nixos/backend-config.nix;

  # Lets a pod reach S3 and the Pod Identity agent
  # (platform/observability-namespace.nix).
  awsApis."observability.macro.com/aws-apis" = "true";

  # One node per zone: replicas spread one per zone, and a replica waits for
  # its zone rather than doubling up in another, so a lost zone takes one
  # copy of the data, never two. A volume (gp3, WaitForFirstConsumer) stays in
  # the zone its pod first ran in. `minDomains` keeps that true while a zone
  # has no node (bootstrap, a node being replaced): without it the scheduler
  # counts only the zones it sees and would put two replicas in one.
  zoneSpread = matchLabels: [
    {
      maxSkew = 1;
      minDomains = 3;
      topologyKey = "topology.kubernetes.io/zone";
      whenUnsatisfiable = "DoNotSchedule";
      labelSelector.matchLabels = matchLabels;
    }
  ];

  # Restricted Pod Security (the namespace warns below it).
  podSecurityContext = uid: {
    runAsNonRoot = true;
    runAsUser = uid;
    runAsGroup = uid;
    fsGroup = uid;
    fsGroupChangePolicy = "OnRootMismatch";
    seccompProfile.type = "RuntimeDefault";
  };
  containerSecurityContext = {
    allowPrivilegeEscalation = false;
    readOnlyRootFilesystem = true;
    capabilities.drop = [ "ALL" ];
    seccompProfile.type = "RuntimeDefault";
  };

  tcp = map (port: {
    protocol = "TCP";
    inherit port;
  });

  # NetworkPolicy peers.
  pods = matchLabels: { podSelector.matchLabels = matchLabels; };
  writers = pods endpoints.clientLabels.write;
  readers = pods endpoints.clientLabels.read;
  # The node Alloy (platform/alloy-node.nix): pushes the cluster's own logs
  # and metrics and scrapes the backends' /metrics.
  nodeAlloy.namespaceSelector.matchLabels."kubernetes.io/metadata.name" = "alloy";

  # A backend's pods talk to each other on every port (HTTP, gRPC, memberlist
  # gossip). Everything else comes in through `ingress`.
  policy =
    {
      selector,
      ingress,
      egress ? [ ],
    }:
    {
      podSelector.matchLabels = selector;
      policyTypes = [
        "Ingress"
        "Egress"
      ];
      ingress = [ { from = [ (pods selector) ]; } ] ++ ingress;
      egress = [ { to = [ (pods selector) ]; } ] ++ egress;
    };

  # Config files as block YAML, so a reviewer reads the rendered ConfigMap like
  # the charts' own. Keys sorted; scalars, `{}` and `[]` in JSON form, which
  # YAML reads the same.
  toYAML =
    value:
    let
      pad = depth: builtins.concatStringsSep "" (builtins.genList (_: "  ") depth);
      isBlock = v: (builtins.isAttrs v && v != { }) || (builtins.isList v && v != [ ]);
      key = k: if builtins.match "[A-Za-z0-9_./-]+" k != null then k else builtins.toJSON k;
      # A list item: its first line takes "- " in place of the indent.
      item =
        depth: v:
        let
          lines = render (depth + 1) v;
          first = builtins.head lines;
          prefix = pad (depth + 1);
        in
        [
          "${pad depth}- ${builtins.substring (builtins.stringLength prefix) (-1) first}"
        ]
        ++ builtins.tail lines;
      render =
        depth: v:
        if builtins.isAttrs v then
          builtins.concatLists (
            map (
              k:
              if isBlock v.${k} then
                [ "${pad depth}${key k}:" ] ++ render (depth + 1) v.${k}
              else
                [ "${pad depth}${key k}: ${builtins.toJSON v.${k}}" ]
            ) (builtins.attrNames v)
          )
        else if builtins.isList v then
          builtins.concatLists (
            map (x: if isBlock x then item depth x else [ "${pad depth}- ${builtins.toJSON x}" ]) v
          )
        else
          [ "${pad depth}${builtins.toJSON v}" ];
    in
    builtins.concatStringsSep "\n" (render 0 value) + "\n";
}
