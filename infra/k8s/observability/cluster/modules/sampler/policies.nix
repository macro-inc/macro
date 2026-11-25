# What the sampler keeps of each trace, and each service's budget. A budget is
# spans a second over every sampler; a service over its own loses traces while
# the others keep theirs. Services not named share `other`.
{ lib }:
{ replicas }:
let
  budgets = {
    # Prod traces with an error or a slow request: every one, until a service
    # sends more than this.
    important = {
      email-service = 2000;
      cloud-storage-service = 1500;
      other = 600;
    };
    # A tenth of the rest of prod.
    tenth = {
      email-service = 3000;
      cloud-storage-service = 1000;
      other = 500;
    };
    # Everything from dev, CI and local stacks, unsampled (local stacks
    # sample before they send).
    nonProd = {
      cloud-storage-service = 2000;
      connection-gateway = 2000;
      other = 500;
    };
    # Every perf trace (the browser samples the users) and Outlook trace.
    perf = 1000;
    outlook = 3000;
  };

  # Every service that has a budget of its own in each group.
  services = [
    "agent-harness-service"
    "authentication-service"
    "calendar-service"
    "ci-telemetry"
    "cloud-storage-service"
    "connection-gateway"
    "contacts-service"
    "convert-service"
    "email-focus-worker"
    "email-service"
    "notification-service"
    "search-processing-service"
    "static-file-service"
    "sync-service"
    "web-app"
  ];

  service = ''resource.attributes["service.name"]'';
  # Dev, CI and local stacks name their environment; anything that doesn't is
  # sampled like prod.
  isNonProd = ''IsMatch(resource.attributes["deployment.environment"], "^(dev|development|ci|local)$")'';
  isProd = "not ${isNonProd}";
  # `status.code` and `kind` are the span's. Slow is a served request of 1 s or
  # more: about the 99th percentile of the slowest service.
  isError = "status.code == STATUS_CODE_ERROR";
  isSlowRequest = "(kind == SPAN_KIND_SERVER and end_time_unix_nano - start_time_unix_nano >= 1000000000)";
  isPerf = ''attributes["macro.sampling.class"] == "perf"'';
  isOutlook = ''(IsMatch(name, "^outlook\\.") or attributes["outlook.throttle_origin"] != nil or attributes["outlook.token_cache"] != nil)'';

  # Integer share of one sampler, at least 1.
  share = total: toString (lib.max 1 (total / replicas));

  sub = name: type: body: ''
    and_sub_policy {
      name = "${name}"
      type = "${type}"
    ${body}
    }
  '';
  condition =
    text:
    sub "match" "ottl_condition" ''
      ottl_condition {
        error_mode = "ignore"
        span = [`${text}`]
      }'';
  probabilistic = sub "tenth" "probabilistic" "  probabilistic { sampling_percentage = 10 }";
  # Last, so only a trace the others keep is charged. The burst admits a whole
  # large trace.
  limit =
    total:
    sub "budget" "rate_limiting" ''
      rate_limiting {
        spans_per_second = ${share total}
        burst_capacity = ${toString (lib.max 20000 (10 * (total / replicas)))}
      }'';
  policy = name: parts: ''
    policy {
      name = "${name}"
      type = "and"
      and {
    ${lib.concatStrings parts}
      }
    }
  '';

  perService =
    group: matches: extra:
    map (
      s:
      policy "${group}-${s}" (
        [ (condition ''${service} == "${s}" and ${matches}'') ]
        ++ extra
        ++ [ (limit (budgets.${group}.${s} or budgets.${group}.other)) ]
      )
    ) services
    ++ [
      (policy "${group}-other" (
        [
          (condition ''not IsMatch(${service}, "^(${lib.concatStringsSep "|" services})$") and ${matches}'')
        ]
        ++ extra
        ++ [ (limit budgets.${group}.other) ]
      ))
    ];
in
lib.concatStrings (
  perService "important" "${isProd} and (${isError} or ${isSlowRequest})" [ ]
  ++ [
    (policy "perf" [
      (condition isPerf)
      (limit budgets.perf)
    ])
    (policy "outlook" [
      (condition isOutlook)
      (limit budgets.outlook)
    ])
  ]
  ++ perService "tenth" isProd [ probabilistic ]
  ++ perService "nonProd" isNonProd [ ]
)
