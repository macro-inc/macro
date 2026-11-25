# What the sampler keeps of each trace, and each service's budget. A budget is
# spans a second over every sampler; a service over its own loses traces while
# the others keep theirs. Services not named share `other`.
#
# A trace is charged to the service of its root span, so a noisy service never
# spends the budget of one it calls. One whose root never arrived is charged to
# every named service in it. A trace can match two groups (an error that is also
# in the tenth) and is then kept by either.
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
      # Each of a developer machine's services (below): one failing in a loop
      # sends as much as the rest of dev.
      local = 200;
    };
    # Every perf trace (the browser samples the users) and Outlook trace.
    perf = 1000;
    outlook = 3000;
  };

  # Every service that has a budget of its own in each group.
  services = [
    "agent-harness-service"
    "ai-editing-worker"
    "authentication-service"
    "calendar-service"
    "github-actions"
    "cloud-storage-service"
    "connection-gateway"
    "contacts-service"
    "convert-service"
    "email-focus-worker"
    "email-service"
    "gitai-service"
    "notification-service"
    "search-freshness-probe"
    "search-processing-service"
    "static-file-service"
    "sync-service"
    "web-app"
    "whatsapp-session-service"
  ];
  # What local stacks call theirs. They have a budget in `nonProd` only.
  localServices = [
    "agent_harness_service"
    "authentication_service"
    "calendar_service"
    "connection_gateway_service"
    "contacts_service"
    "document_storage_service"
    "email_service"
    "notification_service"
    "pubsub_workers"
    "search_processing_service"
    "static_file_service"
    "whatsapp_session_service"
  ];
  named = services ++ localServices;

  rootKey = "macro.sampling.root";
  service = ''resource.attributes["service.name"]'';
  isListed = ''IsMatch(${service}, "^(${lib.concatStringsSep "|" named})$")'';
  # Dev, CI and local stacks name their environment, on the resource or
  # (Cloudflare workers) on the span; anything that doesn't is sampled like prod.
  isNonProd = ''(IsMatch(resource.attributes["deployment.environment"], "^(dev|development|ci|local)$") or IsMatch(attributes["deployment.environment"], "^(dev|development|ci|local)$"))'';
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
  ottl = text: ''
    ottl_condition {
      error_mode = "ignore"
      span = [`${text}`]
    }'';
  # Some span of the trace.
  any = name: text: sub name "ottl_condition" (ottl text);
  # Some span (or, inverted, no span) with one of these values. `and` takes no
  # `not` policy, so "none" is an inverted string match.
  values =
    key: wanted: invert:
    sub (if invert then "none" else "some") "string_attribute" ''
      string_attribute {
        key = "${key}"
        values = ${builtins.toJSON wanted}
        invert_match = ${lib.boolToString invert}
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

  # sampler.alloy names the root span's service in `rootKey`, `other` for one
  # not listed.
  perService =
    {
      group,
      own ? services,
    }:
    parts:
    let
      unowned = lib.subtractLists own named ++ [ "other" ];
      budget =
        s:
        budgets.${group}.${s}
          or (if lib.elem s localServices then budgets.${group}.local else budgets.${group}.other);
    in
    map (
      s:
      policy "${group}-${s}" (
        [
          (any "has" ''${service} == "${s}"'')
          (values rootKey (lib.filter (o: o != s) named ++ [ "other" ]) true)
        ]
        ++ parts
        ++ [ (limit (budget s)) ]
      )
    ) own
    ++ [
      (policy "${group}-other" (
        [ (values rootKey unowned false) ] ++ parts ++ [ (limit budgets.${group}.other) ]
      ))
      # No root and no named service.
      (policy "${group}-rootless" (
        [
          (values rootKey (named ++ [ "other" ]) true)
          (values "service.name" own true)
        ]
        ++ parts
        ++ [ (limit budgets.${group}.other) ]
      ))
    ];
in
{
  rootStatements = lib.concatMapStringsSep "\n" (s: "      `${s}`,") [
    ''set(attributes["${rootKey}"], "other") where IsRootSpan()''
    ''set(attributes["${rootKey}"], ${service}) where IsRootSpan() and ${isListed}''
  ];
  policies = lib.concatStrings (
    perService { group = "important"; } [
      (any "match" "${isProd} and (${isError} or ${isSlowRequest})")
    ]
    ++ [
      (policy "perf" [
        (any "match" isPerf)
        (limit budgets.perf)
      ])
      (policy "outlook" [
        (any "match" isOutlook)
        (limit budgets.outlook)
      ])
    ]
    ++ perService { group = "tenth"; } [
      (any "match" isProd)
      probabilistic
    ]
    ++ perService {
      group = "nonProd";
      own = named;
    } [ (any "match" isNonProd) ]
  );
}
