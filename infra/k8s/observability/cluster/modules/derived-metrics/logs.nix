# Datadog's log-based metrics, as computed here. The same shape as spans.nix,
# except that a tag's sources are attributes of the log record (a service's
# JSON fields), then of its resource, and nothing has a duration.
{ lib }:
let
  ottl = import ./ottl.nix;
  inherit (ottl) is same service;
  # A phrase of the message, as Datadog's search takes a quoted one. The tap
  # keeps no other body (`messages`).
  message = text: ''IsString(body) and IsMatch(body, "(?i)\\b${text}\\b")'';
  messages = {
    account_unavailable = "ai provider account unavailable";
    usage_priced = "ai usage priced";
    runtime_starvation = "tokio runtime starvation detected";
    mailbox_health = "outlook mailbox health";
  };

  # Datadog's status of a record: from its level (text), whose first letters it
  # reads, or else its severity (number, or text without one). `error` is error
  # only, not critical or fatal.
  status =
    pattern: first: last:
    ''((IsString(attributes["level"]) and IsMatch(attributes["level"], "(?i)^${pattern}")) or (not IsString(attributes["level"]) and ((severity_number >= ${toString first} and severity_number <= ${toString last}) or (severity_number == SEVERITY_NUMBER_UNSPECIFIED and IsMatch(severity_text, "(?i)^${pattern}")))))'';
  info = status "i" 9 12;
  warn = status "w" 13 16;
  error = status "err" 17 20;

  suggestions = event: [
    (is "event" "routine_suggestions.${event}")
    (service "agent-harness-service")
    info
  ];
  onboarding = [ (is "trigger" "onboarding") ];

  selections = {
    provider_account_unavailable = [
      (message messages.account_unavailable)
      error
    ];
    usage_priced = [
      (message messages.usage_priced)
      info
    ];
    runtime_starvation = [
      (message messages.runtime_starvation)
      (service "agent-harness-service")
      warn
    ];
    mailbox_health = [
      (message messages.mailbox_health)
      info
    ];
    suggestions_generated = suggestions "generated" ++ onboarding;
    suggestions_surface = suggestions "surface" ++ onboarding;
    suggestions_suggested = suggestions "suggested";
    suggestions_dismissed = suggestions "dismissed";
    suggestions_saved = suggestions "saved";
    errors = [ error ];
    time_to_first_token = [ (is "metric" "TIME-TO-FIRST-TOKEN") ];
    time_to_send_request = [ (is "metric" "TIME-TO-SEND-REQUEST") ];
  };

  mailbox = field: {
    select = "mailbox_health";
    value = field;
    tags = same "link_id" // same "sync_active" // same "needs_reauth";
  };
  generation = value: {
    select = "suggestions_generated";
    inherit value;
    tags = same "outcome";
  };
  # In Datadog these two were made in its UI and read `event`, which the service
  # has since renamed `metric`, so they are empty there.
  latency = select: {
    inherit select;
    value = "duration_ms";
    tags = same "model_name";
  };
  answered = select: {
    inherit select;
    tags = same "from" // same "kind" // same "surface";
  };
in
{
  inherit selections messages;
  openTags = [ ];
  metrics = import ./define.nix { inherit lib; } (
    {
      "macro.ai.provider_account_unavailable" = {
        select = "provider_account_unavailable";
        tags = {
          service = [ "service.name" ];
        }
        // same "provider"
        // same "reason";
      };
      "macro.ai.usage.cost_usd" = {
        select = "usage_priced";
        value = "cost_usd";
        tags = same "provider";
      };
      "macro.agent_harness.runtime_starvation".select = "runtime_starvation";
      # Datadog counts prod only and has no `env` tag here.
      "macro.logs.errors" = {
        select = "errors";
        tags.service = [ "service.name" ];
      };

      "TimeToFirstToken" = latency "time_to_first_token";
      "TimeToSendRequest" = latency "time_to_send_request";

      "macro.routine_suggestions.generation" = generation null;
      "macro.routine_suggestions.first_ms" = generation "first_ms";
      "macro.routine_suggestions.duration_ms" = generation "duration_ms";
      "macro.routine_suggestions.surfaces_filled" = generation "surfaces_filled";
      "macro.routine_suggestions.surface" = {
        select = "suggestions_surface";
        tags = same "surface" // same "filled";
      };
      "macro.routine_suggestions.suggested" = {
        select = "suggestions_suggested";
        tags = same "kind" // same "surface" // same "ok";
      };
      "macro.routine_suggestions.dismissed" = answered "suggestions_dismissed";
      "macro.routine_suggestions.saved" = answered "suggestions_saved";
    }
    // lib.listToAttrs (
      map (field: lib.nameValuePair "macro.outlook.mailbox.${field}" (mailbox field)) [
        "queued"
        "parked"
        "abandoned"
        "oldest_waiting_seconds"
        "seconds_since_last_import"
        "imported_5m"
        "parked_until_max_seconds"
        "import_round_wait_seconds"
      ]
    )
  );
}
