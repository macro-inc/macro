# The Alloy configuration that computes the metrics of spans.nix and logs.nix,
# in two parts: `tap` runs in alloy-ingest and forwards the spans and log records
# a metric reads, `config` runs in the `derived-metrics` application and turns
# them into metrics.
{ lib }:
let
  spans = signal (import ./spans.nix { inherit lib; });
  logs = signal (import ./logs.nix { inherit lib; });

  # An Alloy raw string; OTTL has no backticks.
  raw =
    text:
    assert !lib.hasInfix "`" text;
    "`${text}`";
  list = items: "[\n${lib.concatMapStrings (item: "    ${raw item},\n") items}  ]";
  attr = key: ''attributes["${key}"]'';
  present = key: "${attr key} != nil";
  all = lib.concatStringsSep " and ";

  # Labels are collected under a prefix nothing uses, so that a label never
  # picks up an unrelated attribute of the same name.
  prefix = "tag.";

  # What the configuration needs of one signal's definitions.
  signal =
    {
      selections,
      openTags,
      metrics,
      messages ? { },
      ...
    }:
    rec {
      inherit metrics;
      selected = name: all selections.${name};
      conditions =
        m:
        selections.${m.select}
        ++ m.where
        # The bounds leave out NaN and infinity, which would be the sum for good.
        ++ lib.optionals (m.value != null && m.value != "duration") [
          "IsDouble(${attr m.value})"
          "${attr m.value} > -1.0e300"
          "${attr m.value} < 1.0e300"
        ];

      values = lib.unique (
        map (m: m.value) (lib.filter (m: m.value != null && m.value != "duration") metrics)
      );

      # Everything no metric is computed from.
      unselected = "not (${
        lib.concatMapStringsSep " or " (name: "(${selected name})") (lib.attrNames selections)
      })";

      # What the tap leaves of a record's body: the phrases definitions look for.
      bodies =
        lib.mapAttrsToList (
          key: text:
          ''set(cache["${key}"], true) where IsString(body) and IsMatch(body, "(?i)\\b${text}\\b")''
        ) messages
        ++ [ ''set(body, "")'' ]
        ++ lib.mapAttrsToList (
          key: text: ''set(body, Concat([body, "${text}"], ". ")) where cache["${key}"] == true''
        ) messages;

      # Attributes the definitions read: what the tap keeps. Conditions are
      # text, so their attributes are found by pattern.
      keep =
        let
          mentioned = map (match: builtins.elemAt match 0) (
            lib.filter builtins.isList (builtins.split ''attributes\["([^"]+)"]'' conditionText)
          );
          conditionText = lib.concatStringsSep "\n" (
            lib.concatLists (lib.attrValues selections) ++ lib.concatMap (m: m.where) metrics
          );
          sources = lib.filter isAttribute (
            lib.concatMap (m: lib.concatLists (lib.attrValues m.tags)) metrics
          );
          kept = lib.unique (values ++ sources ++ mentioned);
        in
        [ "keep_keys(attributes, [${lib.concatMapStringsSep ", " (key: ''"${key}"'') kept}])" ]
        # A map, a list or bytes are no value a definition reads, and
        # truncating leaves their content.
        ++ map (
          key:
          "delete_key(attributes, \"${key}\") where ${present key} and not (IsString(${attr key}) or IsBool(${attr key}) or IsInt(${attr key}) or IsDouble(${attr key}))"
        ) kept
        ++ [ "truncate_all(attributes, 256)" ];

      # Numbers as numbers (many are sent as strings) and tags as Datadog has
      # them.
      statements =
        map (
          key: "set(${attr key}, Double(${attr key})) where ${attr key} != nil and not IsBool(${attr key})"
        ) values
        ++ lib.concatMap tagStatements tags
        ++ lib.concatMap (openTagStatements selected) (lib.filter (t: lib.elem t.label openTags) tags);

      tags = lib.unique (
        lib.concatMap (
          m:
          lib.mapAttrsToList (tag: from: {
            inherit (m) select;
            inherit from;
            label = m.labels.${tag};
          }) m.tags
        ) metrics
      );

      # Datadog's tags as `tag.<label>` attributes. Later statements win, so the
      # sources run from the last resort to the first choice. Strings, so `true`
      # and "true" aren't two sets of one series' samples.
      tagStatements =
        {
          select,
          label,
          from,
        }:
        let
          set =
            source:
            "set(${attr "${prefix}${label}"}, String(${source})) where ${source} != nil and ${source} != \"\" and ${selected select}";
          attributeSources = lib.reverseList (lib.filter isAttribute from);
        in
        lib.optional (!lib.all isAttribute from) (set "name")
        ++ (
          let
            fromResource = map (key: set ''resource.attributes["${key}"]'') attributeSources;
            fromItem = map (key: set (attr key)) attributeSources;
          in
          # A service or environment is the sender's, not what one item says.
          if lib.elem label reserved then fromItem ++ fromResource else fromResource ++ fromItem
        );
    };

  # Labels that are the resource's, whatever the span or record says.
  reserved = [
    "service"
    "deployment_environment"
  ];

  # "name" is the span's name.
  isAttribute = source: source != "name";

  # A tag in `openTags` holds whatever its source says, up to whole commands:
  # only a plain name is worth a series (and fit to store as a label). Ingest
  # removes the name of a call that isn't one, so that is `other` too.
  openTagStatements =
    selected:
    { select, label, ... }:
    let
      tag = attr "${prefix}${label}";
    in
    [
      ''set(${tag}, "other") where ${selected select} and (${tag} == nil or not IsMatch(${tag}, "^[A-Za-z][A-Za-z0-9_-]{0,63}$"))''
    ];

  # One metric for signaltometrics; `block` is its signal there.
  metricBlock =
    block: conditions: m:
    let
      value = if m.value == "duration" then "Seconds(end_time - start_time)" else attr m.value;
    in
    ''
      ${block} {
        name        = "${m.metric}"
        description = "Datadog ${m.name}"
        conditions  = [${raw (all (conditions m))}]

        // None: without this block, every resource attribute becomes a label.
        include_resource_attributes {
          key      = "none"
          optional = true
        }
      ${lib.concatMapStrings (label: ''
        ${"  "}attributes {
            key      = "${prefix}${label}"
            optional = true
          }
      '') (lib.attrValues m.labels)}
        ${
          if m.value == null then
            ''sum { value = "1" }''
          else
            "exponential_histogram { value = ${raw value} }"
        }
      }
    '';
  metricBlocks = block: s: lib.concatMapStrings (metricBlock block s.conditions) s.metrics;
in
{
  # Forwards to `endpoint` (host:port, OTLP gRPC) only the spans and log records
  # some metric reads, with only the attributes the metrics read.
  #
  # It must never hold up or grow the ingest it hangs off: errors drop nothing
  # but the item at hand, what it queues is stripped and bounded in bytes, and
  # when derived-metrics is away for longer than that its items are dropped.
  tap = endpoint: ''
    // Generated by infra/k8s/observability/cluster/modules/derived-metrics.
    otelcol.processor.filter "derived" {
      error_mode = "ignore"
      traces {
        span      = [${raw spans.unselected}]
        spanevent = [`true`]
      }
      logs {
        log_record = [${raw logs.unselected}]
      }
      output {
        traces = [otelcol.processor.transform.derived.input]
        logs   = [otelcol.processor.transform.derived.input]
      }
    }

    otelcol.processor.transform "derived" {
      error_mode = "ignore"
      trace_statements {
        context    = "resource"
        statements = ${list (spans.keep)}
      }
      trace_statements {
        context    = "scope"
        statements = [`keep_keys(attributes, [])`]
      }
      trace_statements {
        context    = "span"
        statements = ${
          list (
            spans.keep
            ++ [
              ''set(status.message, "")''
              ''set(trace_state, "")''
              "set(links, nil)"
            ]
          )
        }
      }
      log_statements {
        context    = "resource"
        statements = ${list (logs.keep)}
      }
      log_statements {
        context    = "scope"
        statements = [`keep_keys(attributes, [])`]
      }
      log_statements {
        context    = "log"
        statements = ${list (logs.keep ++ logs.bodies)}
      }
      output {
        traces = [otelcol.exporter.otlp.derived.input]
        logs   = [otelcol.exporter.otlp.derived.input]
      }
    }

    otelcol.exporter.otlp "derived" {
      client {
        endpoint = "${endpoint}"
        tls { insecure = true }
      }
      sending_queue {
        sizer      = "bytes"
        queue_size = ${toString (4 * 1024 * 1024)}
      }
      retry_on_failure { max_elapsed_time = "1m" }
    }
  '';

  config =
    {
      port,
      mimirOtlp,
      mimirPush,
    }:
    ''
      // Generated by infra/k8s/observability/cluster/modules/derived-metrics.
      otelcol.receiver.otlp "derived" {
        grpc { endpoint = "0.0.0.0:${toString port}" }
        output {
          traces = [otelcol.processor.memory_limiter.derived.input]
          logs   = [otelcol.processor.memory_limiter.derived.input]
        }
      }

      otelcol.processor.memory_limiter "derived" {
        check_interval = "1s"
        limit          = "256MiB"
        spike_limit    = "64MiB"
        output {
          traces = [otelcol.processor.transform.derived.input]
          logs   = [otelcol.processor.transform.derived.input]
        }
      }

      // An attribute that is no number stays as it is, and no metric reads it;
      // `silent` because that isn't worth a log line each.
      otelcol.processor.transform "derived" {
        error_mode = "silent"
        trace_statements {
          context    = "span"
          statements = ${list spans.statements}
        }
        log_statements {
          context    = "log"
          statements = ${list logs.statements}
        }
        output {
          traces = [otelcol.processor.batch.derived.input]
          logs   = [otelcol.processor.batch.derived.input]
        }
      }

      // One batch becomes one sample per series, so the timeout is the metrics'
      // resolution; it never sends early on size.
      otelcol.processor.batch "derived" {
        timeout             = "30s"
        send_batch_size     = 100000000
        send_batch_max_size = 0
        output {
          traces = [otelcol.connector.signaltometrics.derived.input]
          logs   = [otelcol.connector.signaltometrics.derived.input]
        }
      }

      otelcol.connector.signaltometrics "derived" {
      ${metricBlocks "spans" spans}
      ${metricBlocks "logs" logs}
        output { metrics = [otelcol.processor.transform.metrics.input] }
      }

      // Each replica writes its own series: `instance` is the pod.
      otelcol.processor.transform "metrics" {
        error_mode = "propagate"
        metric_statements {
          context    = "resource"
          statements = [
            `keep_keys(attributes, [])`,
            `set(attributes["service.name"], "derived-metrics")`,
            "set(attributes[\"service.instance.id\"], \"" + sys.env("POD_NAME") + "\")",
          ]
        }
        metric_statements {
          context    = "datapoint"
          statements = [`replace_all_patterns(attributes, "key", "^${
            lib.replaceStrings [ "." ] [ "[.]" ] prefix
          }", "")`]
        }
        output { metrics = [otelcol.exporter.otlphttp.mimir.input] }
      }

      // One sender: Mimir refuses a sample older than the series' last one, so
      // a retried batch must not be overtaken.
      otelcol.exporter.otlphttp "mimir" {
        client { endpoint = "${mimirOtlp}" }
        sending_queue {
          num_consumers = 1
          queue_size    = 120
        }
        retry_on_failure { max_elapsed_time = "1h" }
      }

      // Its own health: spans refused, samples that failed to send, memory.
      prometheus.exporter.self "alloy" { }

      prometheus.scrape "alloy" {
        targets         = prometheus.exporter.self.alloy.targets
        scrape_interval = "30s"
        forward_to      = [prometheus.relabel.alloy.receiver]
      }

      // The exporter's targets bring their own job.
      prometheus.relabel "alloy" {
        rule {
          target_label = "job"
          replacement  = "observability/derived-metrics"
        }
        rule {
          source_labels = ["__name__"]
          regex         = "otelcol_.*|alloy_resources_process_.*|up"
          action        = "keep"
        }
        rule {
          target_label = "instance"
          replacement  = sys.env("POD_NAME")
        }
        forward_to = [prometheus.remote_write.mimir.receiver]
      }

      prometheus.remote_write "mimir" {
        endpoint { url = "${mimirPush}" }
      }
    '';
}
