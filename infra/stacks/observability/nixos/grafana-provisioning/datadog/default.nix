# Datadog's monitors (infra/stacks/monitoring/monitors/) as Grafana alert
# rules, in shadow: each rule evaluates beside its Datadog monitor, carries
# `shadow = "datadog"`, and notifies GoAlert's `Notify` service without ever
# paging (alerting.nix routes it), until it has fired when Datadog did. A
# monitor that sends nothing in Datadog (`route = "silent"`) sends nothing here.
#
# One file per Datadog source file, listing each of its monitors:
#
# - Ported: `inputs` (each a query and the reducer that makes it one value per
#   series), the `value` computed from them, and Datadog's `comparator`,
#   `critical` and optional `warning`, `window` (the range the inputs read) and
#   `delay` (Datadog's evaluation delay). `translation` says what differs from
#   Datadog's query, `comparison` what running beside it has shown so far.
#   A monitor split into several rules (per region, per instance) has an entry
#   per `part`.
# - Not ported: `status = "not-ported"` and the `reason`.
#
# MAPPING.md, rendered by the observability cluster's flake, lists them all.
{ lib }:
let
  # Query constructors: the datasource, the query model Grafana stores, and
  # the query as MAPPING.md prints it.
  q = {
    loki = expr: {
      datasourceUid = "loki";
      model = {
        inherit expr;
        queryType = "instant";
        intervalMs = 1000;
        maxDataPoints = 43200;
      };
      text = "Loki: `${expr}`";
    };
    prometheus = expr: {
      datasourceUid = "prometheus";
      model = {
        inherit expr;
        instant = true;
        range = false;
        intervalMs = 1000;
        maxDataPoints = 43200;
      };
      text = "Mimir: `${expr}`";
    };
    # A metric by its dimensions: several values for one dimension give a
    # series per value, labelled with it.
    cloudwatch =
      {
        namespace,
        metricName,
        dimensions ? { },
        statistic,
        region ? "us-east-1",
      }:
      {
        datasourceUid = "cloudwatch";
        model = {
          inherit
            namespace
            metricName
            dimensions
            statistic
            region
            ;
          period = "60";
          matchExact = true;
          metricQueryType = 0;
          metricEditorMode = 0;
          queryMode = "Metrics";
          # Grafana names each series by its label and labels it with the
          # dimensions: the same label in every input lets math join series on
          # their dimensions alone.
          label = "value";
        };
        text =
          let
            dims = lib.concatStringsSep ", " (
              lib.mapAttrsToList (name: values: "${name}=${lib.concatStringsSep "|" values}") dimensions
            );
          in
          "CloudWatch ${region}: `${namespace} ${metricName} {${dims}} ${statistic}` per minute";
      };
    # A metric math expression (SEARCH and friends). Series are labelled
    # `Series` only, by the name CloudWatch gives them.
    cloudwatchMath =
      {
        expression,
        region ? "us-east-1",
      }:
      {
        datasourceUid = "cloudwatch";
        model = {
          inherit expression region;
          period = "60";
          metricQueryType = 0;
          metricEditorMode = 1;
          queryMode = "Metrics";
        };
        text = "CloudWatch ${region}: `${expression}`";
      };
    # A Metrics Insights query; series are labelled `Series` by their GROUP BY
    # value.
    metricsInsights =
      {
        sql,
        region ? "us-east-1",
      }:
      {
        datasourceUid = "cloudwatch";
        model = {
          sqlExpression = sql;
          inherit region;
          period = "60";
          metricQueryType = 1;
          metricEditorMode = 1;
          queryMode = "Metrics";
        };
        text = "CloudWatch Metrics Insights ${region}: `${sql}`";
      };
  };

  files = map (file: import file { inherit lib q; }) [
    ./computers.nix
    ./stripe-inbox.nix
    ./rds.nix
    ./ses.nix
    ./cache.nix
    ./graphql-soup.nix
    ./load-balancer.nix
    ./compute.nix
    ./rum.nix
    ./ai-providers.nix
    ./firecracker.nix
    ./macrodb.nix
  ];

  ported = monitor: (monitor.status or "ported") == "ported";

  # Datadog's `{{tag.name}}` (the group's tag value) in a monitor name: `f`
  # gets the tag as a Grafana label name.
  templated =
    f: name:
    lib.concatMapStrings (
      piece:
      if builtins.isList piece then
        f (builtins.replaceStrings [ "." ] [ "_" ] (builtins.head piece))
      else
        piece
    ) (builtins.split "[{][{][[]?@?([A-Za-z0-9_.]+)[]]?[.]name[}][}]" name);

  negate = {
    ">" = "<=";
    ">=" = "<";
    "<" = ">=";
    "<=" = ">";
  };

  # 12 hex digits of the monitor (and part): Grafana uids are at most 40
  # characters, and some resource names alone are longer.
  uid =
    monitor: severity:
    let
      key = monitor.monitor + lib.optionalString (monitor ? part) "/${monitor.part}";
    in
    "dd-${builtins.substring 0 12 (builtins.hashString "sha256" key)}-${
      if severity == "critical" then "crit" else "warn"
    }";

  severities = monitor: [ "critical" ] ++ lib.optional (monitor ? warning) "warning";

  # A window with no datapoints reduces to NaN, and a comparison with NaN is
  # NaN, which Grafana treats as firing; so each condition holds only for a
  # number (alerting.nix, prodRulePairWith). Warning and critical are
  # mutually exclusive bands, as Datadog's are.
  condition =
    monitor: severity:
    let
      cmp = monitor.comparator;
      critical = "$B ${cmp} ${builtins.toJSON monitor.critical}";
    in
    if severity == "critical" then
      if (monitor.noData or "OK") == "Alerting" then
        "!is_number($B) || ${critical}"
      else
        "is_number($B) && ${critical}"
    else
      "is_number($B) && $B ${cmp} ${builtins.toJSON monitor.warning} && $B ${negate.${cmp}} ${builtins.toJSON monitor.critical}";

  threshold =
    monitor: severity:
    "${monitor.comparator} ${
      builtins.toJSON (if severity == "critical" then monitor.critical else monitor.warning)
    }";

  expression = refId: model: {
    inherit refId;
    datasourceUid = "__expr__";
    relativeTimeRange = {
      from = 0;
      to = 0;
    };
    model = model // {
      inherit refId;
    };
  };

  datadogUrl = id: "https://us5.datadoghq.com/monitors/${toString id}";
  sourceUrl = file: "https://github.com/macro-inc/macro/blob/main/infra/stacks/monitoring/${file}";
  mappingUrl = "https://github.com/macro-inc/macro/blob/main/infra/stacks/observability/nixos/grafana-provisioning/datadog/MAPPING.md";

  rule =
    file: monitor: severity:
    let
      delay = monitor.delay or 0;
      value = monitor.value or ("$" + (builtins.head monitor.inputs).id);
      part = lib.optionalString (monitor ? part) " (${monitor.part})";
    in
    {
      uid = uid monitor severity;
      title = "[SHADOW] ${templated (tag: "<${tag}>") monitor.name}${part} (${severity})";
      condition = "C";
      for = "0s";
      noDataState = monitor.noData or "OK";
      execErrState = "Error";
      isPaused = false;
      labels = {
        shadow = "datadog";
        datadog_monitor = monitor.monitor;
        datadog_route = monitor.route;
        inherit severity;
        inherit (monitor) environment service;
      };
      annotations = {
        summary = templated (tag: "{{ $labels.${tag} }}") monitor.name + part;
        description = "Shadow of Datadog monitor `${monitor.monitor}` (${monitor.route} in Datadog): it notifies, never pages, until it has fired when Datadog did. Value {{ $values.B.Value }}, fires ${threshold monitor severity}. ${monitor.translation}";
        datadog_source = sourceUrl file.source;
        mapping_url = mappingUrl;
      }
      // lib.optionalAttrs (monitor.datadogId != null) {
        datadog_url = datadogUrl monitor.datadogId;
      };
      data =
        map (input: {
          refId = "${input.id}_query";
          inherit (input.query) datasourceUid;
          relativeTimeRange = {
            from = monitor.window + delay;
            to = delay;
          };
          model =
            input.query.model
            // {
              refId = "${input.id}_query";
            }
            // lib.optionalAttrs (input.query.datasourceUid == "cloudwatch") {
              # CloudWatch's query id: unique in the request.
              inherit (input) id;
            };
        }) monitor.inputs
        ++ map (
          input:
          expression input.id {
            type = "reduce";
            expression = "${input.id}_query";
            reducer = input.reducer or "last";
          }
        ) monitor.inputs
        ++ [
          (expression "B" {
            type = "math";
            expression = value;
          })
          (expression "C" {
            type = "math";
            expression = condition monitor severity;
          })
        ];
    };

  rulesOf = file: monitor: map (rule file monitor) (severities monitor);
in
{
  inherit
    files
    ported
    uid
    severities
    threshold
    datadogUrl
    sourceUrl
    ;

  # Rule groups, one per Datadog source file, in their own folder.
  groups = lib.concatMap (
    file:
    let
      rules = lib.concatMap (rulesOf file) (builtins.filter ported file.monitors);
    in
    lib.optional (rules != [ ]) {
      orgId = 1;
      # `monitors/rds.ts` → `Datadog rds`.
      name = "Datadog ${lib.removeSuffix ".ts" (baseNameOf file.source)}";
      folder = "Datadog shadow";
      inherit (file) interval;
      inherit rules;
    }
  ) files;
}
