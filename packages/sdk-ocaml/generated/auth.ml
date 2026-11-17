(* Generated from packages/sdk/specs/auth.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

type nonrec ab_group =
  | A
  | B
  | Unknown of string  (** A value this SDK version does not know. *)

let ab_group_of_yojson : Yojson.Safe.t -> ab_group =
 fun json ->
  match Json.string json with
  | "A" -> A
  | "B" -> B
  | other -> Json.unknown "ab_group" json (Unknown other)

and yojson_of_ab_group : ab_group -> Yojson.Safe.t =
 fun value ->
  match value with
  | A -> `String "A"
  | B -> `String "B"
  | Unknown other -> `String other

(** A provider an agent can bring its own key for. *)
type nonrec agent_api_key_provider =
  | Anthropic
  | Openai
  | Unknown of string  (** A value this SDK version does not know. *)

let agent_api_key_provider_of_yojson : Yojson.Safe.t -> agent_api_key_provider =
 fun json ->
  match Json.string json with
  | "anthropic" -> Anthropic
  | "openai" -> Openai
  | other -> Json.unknown "agent_api_key_provider" json (Unknown other)

and yojson_of_agent_api_key_provider : agent_api_key_provider -> Yojson.Safe.t =
 fun value ->
  match value with
  | Anthropic -> `String "anthropic"
  | Openai -> `String "openai"
  | Unknown other -> `String other

type nonrec saved_agent_api_key = {
  provider : agent_api_key_provider;  (** The provider the key is for. *)
  updated_at : string;  (** When the key was last replaced. *)
}
(** The agent's saved key. Never includes the key. *)

let saved_agent_api_key_of_yojson : Yojson.Safe.t -> saved_agent_api_key =
 fun json ->
  let fields = Json.obj json in
  {
    provider = Json.required fields "provider" agent_api_key_provider_of_yojson;
    updated_at = Json.required fields "updatedAt" Json.string;
  }

and yojson_of_saved_agent_api_key : saved_agent_api_key -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("provider", Some (yojson_of_agent_api_key_provider value.provider));
      ("updatedAt", Some (Json.of_string value.updated_at));
    ]

let make_saved_agent_api_key ~(provider : agent_api_key_provider)
    ~(updated_at : string) () =
  ({ provider; updated_at } : saved_agent_api_key)

type nonrec agent_api_key = {
  key : saved_agent_api_key option;
  plan_allows : bool;
      (** Whether the agent owner's plan includes API keys. A key saved before a
downgrade is still listed, and removable, but unused. *)
}
(** An agent's API key, and whether its turns can run on it. *)

let agent_api_key_of_yojson : Yojson.Safe.t -> agent_api_key =
 fun json ->
  let fields = Json.obj json in
  {
    key = Json.optional fields "key" saved_agent_api_key_of_yojson;
    plan_allows = Json.required fields "planAllows" Json.bool;
  }

and yojson_of_agent_api_key : agent_api_key -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("key", Option.map yojson_of_saved_agent_api_key value.key);
      ("planAllows", Some (Json.of_bool value.plan_allows));
    ]

let make_agent_api_key ?key ~(plan_allows : bool) () =
  ({ key; plan_allows } : agent_api_key)

type nonrec agent_setup_response = {
  api_key : string;
      (** The agent's API key. Shown only here; repeating setup revokes it. *)
  team_join_failed : bool;
      (** Whether joining the inviting team failed. The invite stays pending:
repeating setup tries again, and the invite link works after confirming. *)
}
(** What an agent needs to start using the SDK. *)

let agent_setup_response_of_yojson : Yojson.Safe.t -> agent_setup_response =
 fun json ->
  let fields = Json.obj json in
  {
    api_key = Json.required fields "api_key" Json.string;
    team_join_failed = Json.required fields "team_join_failed" Json.bool;
  }

and yojson_of_agent_setup_response : agent_setup_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("api_key", Some (Json.of_string value.api_key));
      ("team_join_failed", Some (Json.of_bool value.team_join_failed));
    ]

let make_agent_setup_response ~(api_key : string) ~(team_join_failed : bool) ()
    =
  ({ api_key; team_join_failed } : agent_setup_response)

type nonrec agent_voice = {
  model : string;  (** The Aura-2 model, [aura-2-<name>-<language>]. *)
}
(** The voice an agent speaks with on calls. *)

let agent_voice_of_yojson : Yojson.Safe.t -> agent_voice =
 fun json ->
  let fields = Json.obj json in
  { model = Json.required fields "model" Json.string }

and yojson_of_agent_voice : agent_voice -> Yojson.Safe.t =
 fun value -> Json.record [ ("model", Some (Json.of_string value.model)) ]

let make_agent_voice ~(model : string) () = ({ model } : agent_voice)

type nonrec ai_billing_error_body = {
  error : string;  (** Human-readable error description. *)
}
(** Error response body. *)

let ai_billing_error_body_of_yojson : Yojson.Safe.t -> ai_billing_error_body =
 fun json ->
  let fields = Json.obj json in
  { error = Json.required fields "error" Json.string }

and yojson_of_ai_billing_error_body : ai_billing_error_body -> Yojson.Safe.t =
 fun value -> Json.record [ ("error", Some (Json.of_string value.error)) ]

let make_ai_billing_error_body ~(error : string) () =
  ({ error } : ai_billing_error_body)

type nonrec apple_login_request = { code : string; id_token : string }

let apple_login_request_of_yojson : Yojson.Safe.t -> apple_login_request =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" Json.string;
    id_token = Json.required fields "id_token" Json.string;
  }

and yojson_of_apple_login_request : apple_login_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Some (Json.of_string value.code));
      ("id_token", Some (Json.of_string value.id_token));
    ]

let make_apple_login_request ~(code : string) ~(id_token : string) () =
  ({ code; id_token } : apple_login_request)

type nonrec auto_reload_defaults = {
  minimum_balance_cents : int64;
      (** Balance below which a reload fires, cents. *)
  target_balance_cents : int64;  (** Balance a reload tops up to, cents. *)
}
(** The automatic reload thresholds a payer starts from. *)

let auto_reload_defaults_of_yojson : Yojson.Safe.t -> auto_reload_defaults =
 fun json ->
  let fields = Json.obj json in
  {
    minimum_balance_cents =
      Json.required fields "minimum_balance_cents" Json.int64;
    target_balance_cents =
      Json.required fields "target_balance_cents" Json.int64;
  }

and yojson_of_auto_reload_defaults : auto_reload_defaults -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("minimum_balance_cents", Some (Json.of_int64 value.minimum_balance_cents));
      ("target_balance_cents", Some (Json.of_int64 value.target_balance_cents));
    ]

let make_auto_reload_defaults ~(minimum_balance_cents : int64)
    ~(target_balance_cents : int64) () =
  ({ minimum_balance_cents; target_balance_cents } : auto_reload_defaults)

type nonrec auto_reload_monthly_budget = {
  committed_cents : int64;
      (** Reloads and one-time card purchases paid, pending, or failed with an
invoice that can still collect. Customer cents; Checkout purchases do
not count. *)
  limit_reached : bool;
      (** Remaining cap cannot fund the minimum automatic reload charge. *)
  resets_at : string;
      (** Start of the next UTC calendar month, independently of subscription renewal. *)
}
(** Calendar-month commitments that consume the payer's automatic reload cap. *)

let auto_reload_monthly_budget_of_yojson :
    Yojson.Safe.t -> auto_reload_monthly_budget =
 fun json ->
  let fields = Json.obj json in
  {
    committed_cents = Json.required fields "committed_cents" Json.int64;
    limit_reached = Json.required fields "limit_reached" Json.bool;
    resets_at = Json.required fields "resets_at" Json.string;
  }

and yojson_of_auto_reload_monthly_budget :
    auto_reload_monthly_budget -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("committed_cents", Some (Json.of_int64 value.committed_cents));
      ("limit_reached", Some (Json.of_bool value.limit_reached));
      ("resets_at", Some (Json.of_string value.resets_at));
    ]

let make_auto_reload_monthly_budget ~(committed_cents : int64)
    ~(limit_reached : bool) ~(resets_at : string) () =
  ({ committed_cents; limit_reached; resets_at } : auto_reload_monthly_budget)

type nonrec auto_reload_snapshot = {
  active : bool;
      (** Whether reloads will fire: the payer opted in and reloads are not suspended. *)
  minimum_balance_cents : int64;
      (** Reload once the effective balance drops below this, in customer cents. *)
  monthly_budget : auto_reload_monthly_budget option;
  monthly_spend_limit_cents : int64 option;
      (** Most reloaded per UTC calendar month, in customer cents. [null] when
there is no limit. *)
  suspended : bool;
      (** Whether reloads are paused after a failed reload charge. *)
  target_balance_cents : int64;
      (** Reload the balance back up to this, in customer cents. *)
}
(** The payer's automatic reload settings, as shown in Billing settings. *)

let auto_reload_snapshot_of_yojson : Yojson.Safe.t -> auto_reload_snapshot =
 fun json ->
  let fields = Json.obj json in
  {
    active = Json.required fields "active" Json.bool;
    minimum_balance_cents =
      Json.required fields "minimum_balance_cents" Json.int64;
    monthly_budget =
      Json.optional fields "monthly_budget" auto_reload_monthly_budget_of_yojson;
    monthly_spend_limit_cents =
      Json.optional fields "monthly_spend_limit_cents" Json.int64;
    suspended = Json.required fields "suspended" Json.bool;
    target_balance_cents =
      Json.required fields "target_balance_cents" Json.int64;
  }

and yojson_of_auto_reload_snapshot : auto_reload_snapshot -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("active", Some (Json.of_bool value.active));
      ("minimum_balance_cents", Some (Json.of_int64 value.minimum_balance_cents));
      ( "monthly_budget",
        Option.map yojson_of_auto_reload_monthly_budget value.monthly_budget );
      ( "monthly_spend_limit_cents",
        Option.map Json.of_int64 value.monthly_spend_limit_cents );
      ("suspended", Some (Json.of_bool value.suspended));
      ("target_balance_cents", Some (Json.of_int64 value.target_balance_cents));
    ]

let make_auto_reload_snapshot ~(active : bool) ~(minimum_balance_cents : int64)
    ?monthly_budget ?monthly_spend_limit_cents ~(suspended : bool)
    ~(target_balance_cents : int64) () =
  ({
     active;
     minimum_balance_cents;
     monthly_budget;
     monthly_spend_limit_cents;
     suspended;
     target_balance_cents;
   }
    : auto_reload_snapshot)

(** How often the team subscription bills. *)
type nonrec billing_interval =
  | Month
  | Year
  | Unknown of string  (** A value this SDK version does not know. *)

let billing_interval_of_yojson : Yojson.Safe.t -> billing_interval =
 fun json ->
  match Json.string json with
  | "month" -> Month
  | "year" -> Year
  | other -> Json.unknown "billing_interval" json (Unknown other)

and yojson_of_billing_interval : billing_interval -> Yojson.Safe.t =
 fun value ->
  match value with
  | Month -> `String "month"
  | Year -> `String "year"
  | Unknown other -> `String other

(** Where a computer's billing stands, as its team sees it. *)
type nonrec billing_status =
  | Purchasing
  | Active
  | Past_due
  | Ending
  | Ended
  | Comped
  | Unknown of string  (** A value this SDK version does not know. *)

let billing_status_of_yojson : Yojson.Safe.t -> billing_status =
 fun json ->
  match Json.string json with
  | "purchasing" -> Purchasing
  | "active" -> Active
  | "past_due" -> Past_due
  | "ending" -> Ending
  | "ended" -> Ended
  | "comped" -> Comped
  | other -> Json.unknown "billing_status" json (Unknown other)

and yojson_of_billing_status : billing_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Purchasing -> `String "purchasing"
  | Active -> `String "active"
  | Past_due -> `String "past_due"
  | Ending -> `String "ending"
  | Ended -> `String "ended"
  | Comped -> `String "comped"
  | Unknown other -> `String other

(** The paid plan a seat is billed at. Every member of a paying team has one;
a team may mix them, and its Stripe subscription carries one seat item per
plan in use. *)
type nonrec seat_plan =
  | Premium
  | Max
  | Unknown of string  (** A value this SDK version does not know. *)

let seat_plan_of_yojson : Yojson.Safe.t -> seat_plan =
 fun json ->
  match Json.string json with
  | "premium" -> Premium
  | "max" -> Max
  | other -> Json.unknown "seat_plan" json (Unknown other)

and yojson_of_seat_plan : seat_plan -> Yojson.Safe.t =
 fun value ->
  match value with
  | Premium -> `String "premium"
  | Max -> `String "max"
  | Unknown other -> `String other

type nonrec change_plan_request = {
  plan : seat_plan;  (** The plan to move the active subscription to *)
}
(** Request body for switching plans *)

let change_plan_request_of_yojson : Yojson.Safe.t -> change_plan_request =
 fun json ->
  let fields = Json.obj json in
  { plan = Json.required fields "plan" seat_plan_of_yojson }

and yojson_of_change_plan_request : change_plan_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("plan", Some (yojson_of_seat_plan value.plan)) ]

let make_change_plan_request ~(plan : seat_plan) () =
  ({ plan } : change_plan_request)

type nonrec change_plan_response = {
  plan : seat_plan;  (** The plan the subscription is now on *)
}
(** Response for a plan change *)

let change_plan_response_of_yojson : Yojson.Safe.t -> change_plan_response =
 fun json ->
  let fields = Json.obj json in
  { plan = Json.required fields "plan" seat_plan_of_yojson }

and yojson_of_change_plan_response : change_plan_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("plan", Some (yojson_of_seat_plan value.plan)) ]

let make_change_plan_response ~(plan : seat_plan) () =
  ({ plan } : change_plan_response)

type nonrec checkout_session_metadata = {
  fbc : string option;  (** Meta (Facebook) click ID from _fbc cookie *)
  fbp : string option;  (** Meta (Facebook) browser ID from _fbp cookie *)
  ga_client_id : string option;
      (** Google Analytics client ID for conversion tracking *)
}
(** Tracking metadata for conversion attribution *)

let checkout_session_metadata_of_yojson :
    Yojson.Safe.t -> checkout_session_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    fbc = Json.optional fields "fbc" Json.string;
    fbp = Json.optional fields "fbp" Json.string;
    ga_client_id = Json.optional fields "gaClientId" Json.string;
  }

and yojson_of_checkout_session_metadata :
    checkout_session_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("fbc", Option.map Json.of_string value.fbc);
      ("fbp", Option.map Json.of_string value.fbp);
      ("gaClientId", Option.map Json.of_string value.ga_client_id);
    ]

let make_checkout_session_metadata ?fbc ?fbp ?ga_client_id () =
  ({ fbc; fbp; ga_client_id } : checkout_session_metadata)

type nonrec checkout_session_v2_response = {
  trial_days : int option;
      (** Trial duration, absent for an immediately paid checkout. *)
  url : string;  (** The opaque URL returned by Stripe. *)
}
(** Hosted checkout with the billing terms the server actually granted. *)

let checkout_session_v2_response_of_yojson :
    Yojson.Safe.t -> checkout_session_v2_response =
 fun json ->
  let fields = Json.obj json in
  {
    trial_days = Json.optional fields "trialDays" Json.int;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_checkout_session_v2_response :
    checkout_session_v2_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("trialDays", Option.map Json.of_int value.trial_days);
      ("url", Some (Json.of_string value.url));
    ]

let make_checkout_session_v2_response ?trial_days ~(url : string) () =
  ({ trial_days; url } : checkout_session_v2_response)

type nonrec codex_config_request = {
  environment_id : string;
      (** An environment currently visible to this account. *)
}
(** Explicit remote environment for future Codex sessions. *)

let codex_config_request_of_yojson : Yojson.Safe.t -> codex_config_request =
 fun json ->
  let fields = Json.obj json in
  { environment_id = Json.required fields "environmentId" Json.string }

and yojson_of_codex_config_request : codex_config_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("environmentId", Some (Json.of_string value.environment_id)) ]

let make_codex_config_request ~(environment_id : string) () =
  ({ environment_id } : codex_config_request)

type nonrec codex_connection_status = {
  account_id : string option;  (** Connected provider account identifier. *)
  connected : bool;
      (** Whether the user has completed provider authorization. *)
  email : string option;
      (** Reserved until provider-verified email metadata is available. *)
  environment_id : string option;  (** Explicitly selected remote environment. *)
}
(** Safe connection metadata; no secret or masked token is returned. *)

let codex_connection_status_of_yojson : Yojson.Safe.t -> codex_connection_status
    =
 fun json ->
  let fields = Json.obj json in
  {
    account_id = Json.optional fields "accountId" Json.string;
    connected = Json.required fields "connected" Json.bool;
    email = Json.optional fields "email" Json.string;
    environment_id = Json.optional fields "environmentId" Json.string;
  }

and yojson_of_codex_connection_status : codex_connection_status -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("accountId", Option.map Json.of_string value.account_id);
      ("connected", Some (Json.of_bool value.connected));
      ("email", Option.map Json.of_string value.email);
      ("environmentId", Option.map Json.of_string value.environment_id);
    ]

let make_codex_connection_status ?account_id ~(connected : bool) ?email
    ?environment_id () =
  ({ account_id; connected; email; environment_id } : codex_connection_status)

type nonrec codex_environment_repository = {
  clone_url : string;  (** Credential-free HTTPS clone URL. *)
  default_branch : string;  (** Provider default branch. *)
  full_name : string;  (** Owner/repository identity. *)
}
(** Safe repository metadata available to the connected Codex account. *)

let codex_environment_repository_of_yojson :
    Yojson.Safe.t -> codex_environment_repository =
 fun json ->
  let fields = Json.obj json in
  {
    clone_url = Json.required fields "cloneUrl" Json.string;
    default_branch = Json.required fields "defaultBranch" Json.string;
    full_name = Json.required fields "fullName" Json.string;
  }

and yojson_of_codex_environment_repository :
    codex_environment_repository -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("cloneUrl", Some (Json.of_string value.clone_url));
      ("defaultBranch", Some (Json.of_string value.default_branch));
      ("fullName", Some (Json.of_string value.full_name));
    ]

let make_codex_environment_repository ~(clone_url : string)
    ~(default_branch : string) ~(full_name : string) () =
  ({ clone_url; default_branch; full_name } : codex_environment_repository)

type nonrec codex_environment = {
  id : string;  (** Provider environment identity. *)
  label : string option;  (** Human-readable provider label. *)
  repositories : codex_environment_repository list;
      (** Ordered safe repository identities from Codex. *)
}
(** A cloud environment visible to the connected provider account. *)

let codex_environment_of_yojson : Yojson.Safe.t -> codex_environment =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" Json.string;
    label = Json.optional fields "label" Json.string;
    repositories =
      Json.required fields "repositories"
        (Json.list codex_environment_repository_of_yojson);
  }

and yojson_of_codex_environment : codex_environment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (Json.of_string value.id));
      ("label", Option.map Json.of_string value.label);
      ( "repositories",
        Some
          ((Json.of_list yojson_of_codex_environment_repository)
             value.repositories) );
    ]

let make_codex_environment ~(id : string) ?label
    ~(repositories : codex_environment_repository list) () =
  ({ id; label; repositories } : codex_environment)

(** Device authorization state visible to its initiating user. *)
type nonrec codex_login_state =
  | Pending
  | Connected
  | Expired
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let codex_login_state_of_yojson : Yojson.Safe.t -> codex_login_state =
 fun json ->
  match Json.string json with
  | "pending" -> Pending
  | "connected" -> Connected
  | "expired" -> Expired
  | "failed" -> Failed
  | other -> Json.unknown "codex_login_state" json (Unknown other)

and yojson_of_codex_login_state : codex_login_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pending -> `String "pending"
  | Connected -> `String "connected"
  | Expired -> `String "expired"
  | Failed -> `String "failed"
  | Unknown other -> `String other

type nonrec codex_login_poll = {
  status : codex_login_state;  (** Current attempt state. *)
}
(** Outcome of polling one attempt. *)

let codex_login_poll_of_yojson : Yojson.Safe.t -> codex_login_poll =
 fun json ->
  let fields = Json.obj json in
  { status = Json.required fields "status" codex_login_state_of_yojson }

and yojson_of_codex_login_poll : codex_login_poll -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("status", Some (yojson_of_codex_login_state value.status)) ]

let make_codex_login_poll ~(status : codex_login_state) () =
  ({ status } : codex_login_poll)

type nonrec codex_login_start = {
  attempt_id : string;  (** Owner-bound attempt UUID. *)
  expires_at : string;  (** UTC attempt deadline. *)
  poll_interval_seconds : int64;  (** Minimum browser polling interval. *)
  user_code : string;  (** Short expiring user code, not an API credential. *)
  verification_url : string;  (** Official provider verification URL. *)
}
(** Expiring browser authorization instructions. *)

let codex_login_start_of_yojson : Yojson.Safe.t -> codex_login_start =
 fun json ->
  let fields = Json.obj json in
  {
    attempt_id = Json.required fields "attemptId" Json.string;
    expires_at = Json.required fields "expiresAt" Json.string;
    poll_interval_seconds =
      Json.required fields "pollIntervalSeconds" Json.int64;
    user_code = Json.required fields "userCode" Json.string;
    verification_url = Json.required fields "verificationUrl" Json.string;
  }

and yojson_of_codex_login_start : codex_login_start -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attemptId", Some (Json.of_string value.attempt_id));
      ("expiresAt", Some (Json.of_string value.expires_at));
      ("pollIntervalSeconds", Some (Json.of_int64 value.poll_interval_seconds));
      ("userCode", Some (Json.of_string value.user_code));
      ("verificationUrl", Some (Json.of_string value.verification_url));
    ]

let make_codex_login_start ~(attempt_id : string) ~(expires_at : string)
    ~(poll_interval_seconds : int64) ~(user_code : string)
    ~(verification_url : string) () =
  ({
     attempt_id;
     expires_at;
     poll_interval_seconds;
     user_code;
     verification_url;
   }
    : codex_login_start)

(** A size a team can buy. *)
type nonrec computer_size =
  | Standard
  | Large
  | Xl
  | Unknown of string  (** A value this SDK version does not know. *)

let computer_size_of_yojson : Yojson.Safe.t -> computer_size =
 fun json ->
  match Json.string json with
  | "standard" -> Standard
  | "large" -> Large
  | "xl" -> Xl
  | other -> Json.unknown "computer_size" json (Unknown other)

and yojson_of_computer_size : computer_size -> Yojson.Safe.t =
 fun value ->
  match value with
  | Standard -> `String "standard"
  | Large -> `String "large"
  | Xl -> `String "xl"
  | Unknown other -> `String other

(** Steps a new computer goes through, in order. *)
type nonrec setup_step =
  | Billing
  | Creating
  | Booting
  | Connecting
  | Ready
  | Unknown of string  (** A value this SDK version does not know. *)

let setup_step_of_yojson : Yojson.Safe.t -> setup_step =
 fun json ->
  match Json.string json with
  | "billing" -> Billing
  | "creating" -> Creating
  | "booting" -> Booting
  | "connecting" -> Connecting
  | "ready" -> Ready
  | other -> Json.unknown "setup_step" json (Unknown other)

and yojson_of_setup_step : setup_step -> Yojson.Safe.t =
 fun value ->
  match value with
  | Billing -> `String "billing"
  | Creating -> `String "creating"
  | Booting -> `String "booting"
  | Connecting -> `String "connecting"
  | Ready -> `String "ready"
  | Unknown other -> `String other

type nonrec setup_progress = {
  position : int;  (** 1-based position of [step]. *)
  step : setup_step;  (** Current setup stage. *)
  step_started_at : string option;
      (** When [step] began; null when it is not recorded. *)
  total : int;  (** Number of setup stages. *)
}
(** Setup progress, for invite and purchase flows to show. *)

let setup_progress_of_yojson : Yojson.Safe.t -> setup_progress =
 fun json ->
  let fields = Json.obj json in
  {
    position = Json.required fields "position" Json.int;
    step = Json.required fields "step" setup_step_of_yojson;
    step_started_at = Json.optional fields "stepStartedAt" Json.string;
    total = Json.required fields "total" Json.int;
  }

and yojson_of_setup_progress : setup_progress -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("position", Some (Json.of_int value.position));
      ("step", Some (yojson_of_setup_step value.step));
      ("stepStartedAt", Option.map Json.of_string value.step_started_at);
      ("total", Some (Json.of_int value.total));
    ]

let make_setup_progress ~(position : int) ~(step : setup_step) ?step_started_at
    ~(total : int) () =
  ({ position; step; step_started_at; total } : setup_progress)

(** The coarse status the team sees. *)
type nonrec computer_status_kind =
  | Setting_up
  | Needs_attention
  | Waiting_for_capacity
  | Ready
  | Starting
  | Stopping
  | Stopped
  | Failed
  | Purchasing
  | Released
  | Unknown of string  (** A value this SDK version does not know. *)

let computer_status_kind_of_yojson : Yojson.Safe.t -> computer_status_kind =
 fun json ->
  match Json.string json with
  | "setting_up" -> Setting_up
  | "needs_attention" -> Needs_attention
  | "waiting_for_capacity" -> Waiting_for_capacity
  | "ready" -> Ready
  | "starting" -> Starting
  | "stopping" -> Stopping
  | "stopped" -> Stopped
  | "failed" -> Failed
  | "purchasing" -> Purchasing
  | "released" -> Released
  | other -> Json.unknown "computer_status_kind" json (Unknown other)

and yojson_of_computer_status_kind : computer_status_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Setting_up -> `String "setting_up"
  | Needs_attention -> `String "needs_attention"
  | Waiting_for_capacity -> `String "waiting_for_capacity"
  | Ready -> `String "ready"
  | Starting -> `String "starting"
  | Stopping -> `String "stopping"
  | Stopped -> `String "stopped"
  | Failed -> `String "failed"
  | Purchasing -> `String "purchasing"
  | Released -> `String "released"
  | Unknown other -> `String other

type nonrec computer_status = {
  agent_count : int;
      (** Agents bound to the computer's live harness, teammates' private ones
included: the ones releasing it deletes. *)
  billing : billing_status option;
  can_restore : bool;
      (** Whether the computer can be restored ([POST .../restore]): billing
ended and the disk is still retained. *)
  can_undo_cancel : bool;
      (** Whether a cancel at period end can still be undone (until [cancelsAt]). *)
  cancels_at : string option;
      (** When billing stops, for a computer canceled at period end. *)
  catalog_entry : string;  (** Versioned catalog entry saved at purchase. *)
  comp_reason : string option;
      (** Present for a comped purchase, including after release. *)
  created_at : string;  (** Time the computer was reserved. *)
  default_agent_id : string option;
      (** Bot id of the coding agent the computer came with; null until macrod
first connects. It can name an agent the team since deleted. *)
  disk_gib : int64;  (** Root disk limit saved at purchase. *)
  failure_reason : string option;
      (** Why the computer failed, as a short sentence safe to show; present
when it failed and the cause is known. The full error is only in the logs. *)
  harness_id : string option;  (** Harness claimed by this guest. *)
  id : string;  (** Stable resource identity. *)
  memory_gib : int64;  (** Memory limit saved at purchase. *)
  name : string;  (** Display name. *)
  past_due_since : string option;
      (** Since when the team subscription is past due. *)
  powered_on : bool;
      (** Whether validated state requests power on; false for quarantined records. *)
  purchased_by : string;
      (** The Macro user who bought it. The team's owner and admins, not the
buyer, finish its setup and manage its Claude account. *)
  retained_until : string option;
      (** When the disk is destroyed, for a computer whose billing ended. *)
  setup : setup_progress option;
  setup_completed_at : string option;
      (** When the team finished the guided setup; null while it is unfinished. *)
  size : computer_size;  (** Purchased catalog size. *)
  status : computer_status_kind;  (** Observed guest status. *)
  vcpus : int64;  (** Virtual CPU count. *)
}
(** A computer as its team sees it. *)

let computer_status_of_yojson : Yojson.Safe.t -> computer_status =
 fun json ->
  let fields = Json.obj json in
  {
    agent_count = Json.required fields "agentCount" Json.int;
    billing = Json.optional fields "billing" billing_status_of_yojson;
    can_restore = Json.required fields "canRestore" Json.bool;
    can_undo_cancel = Json.required fields "canUndoCancel" Json.bool;
    cancels_at = Json.optional fields "cancelsAt" Json.string;
    catalog_entry = Json.required fields "catalogEntry" Json.string;
    comp_reason = Json.optional fields "compReason" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    default_agent_id = Json.optional fields "defaultAgentId" Json.string;
    disk_gib = Json.required fields "diskGib" Json.int64;
    failure_reason = Json.optional fields "failureReason" Json.string;
    harness_id = Json.optional fields "harnessId" Json.string;
    id = Json.required fields "id" Json.string;
    memory_gib = Json.required fields "memoryGib" Json.int64;
    name = Json.required fields "name" Json.string;
    past_due_since = Json.optional fields "pastDueSince" Json.string;
    powered_on = Json.required fields "poweredOn" Json.bool;
    purchased_by = Json.required fields "purchasedBy" Json.string;
    retained_until = Json.optional fields "retainedUntil" Json.string;
    setup = Json.optional fields "setup" setup_progress_of_yojson;
    setup_completed_at = Json.optional fields "setupCompletedAt" Json.string;
    size = Json.required fields "size" computer_size_of_yojson;
    status = Json.required fields "status" computer_status_kind_of_yojson;
    vcpus = Json.required fields "vcpus" Json.int64;
  }

and yojson_of_computer_status : computer_status -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("agentCount", Some (Json.of_int value.agent_count));
      ("billing", Option.map yojson_of_billing_status value.billing);
      ("canRestore", Some (Json.of_bool value.can_restore));
      ("canUndoCancel", Some (Json.of_bool value.can_undo_cancel));
      ("cancelsAt", Option.map Json.of_string value.cancels_at);
      ("catalogEntry", Some (Json.of_string value.catalog_entry));
      ("compReason", Option.map Json.of_string value.comp_reason);
      ("createdAt", Some (Json.of_string value.created_at));
      ("defaultAgentId", Option.map Json.of_string value.default_agent_id);
      ("diskGib", Some (Json.of_int64 value.disk_gib));
      ("failureReason", Option.map Json.of_string value.failure_reason);
      ("harnessId", Option.map Json.of_string value.harness_id);
      ("id", Some (Json.of_string value.id));
      ("memoryGib", Some (Json.of_int64 value.memory_gib));
      ("name", Some (Json.of_string value.name));
      ("pastDueSince", Option.map Json.of_string value.past_due_since);
      ("poweredOn", Some (Json.of_bool value.powered_on));
      ("purchasedBy", Some (Json.of_string value.purchased_by));
      ("retainedUntil", Option.map Json.of_string value.retained_until);
      ("setup", Option.map yojson_of_setup_progress value.setup);
      ("setupCompletedAt", Option.map Json.of_string value.setup_completed_at);
      ("size", Some (yojson_of_computer_size value.size));
      ("status", Some (yojson_of_computer_status_kind value.status));
      ("vcpus", Some (Json.of_int64 value.vcpus));
    ]

let make_computer_status ~(agent_count : int) ?billing ~(can_restore : bool)
    ~(can_undo_cancel : bool) ?cancels_at ~(catalog_entry : string) ?comp_reason
    ~(created_at : string) ?default_agent_id ~(disk_gib : int64) ?failure_reason
    ?harness_id ~(id : string) ~(memory_gib : int64) ~(name : string)
    ?past_due_since ~(powered_on : bool) ~(purchased_by : string)
    ?retained_until ?setup ?setup_completed_at ~(size : computer_size)
    ~(status : computer_status_kind) ~(vcpus : int64) () =
  ({
     agent_count;
     billing;
     can_restore;
     can_undo_cancel;
     cancels_at;
     catalog_entry;
     comp_reason;
     created_at;
     default_agent_id;
     disk_gib;
     failure_reason;
     harness_id;
     id;
     memory_gib;
     name;
     past_due_since;
     powered_on;
     purchased_by;
     retained_until;
     setup;
     setup_completed_at;
     size;
     status;
     vcpus;
   }
    : computer_status)

type nonrec create_account_merge_request = {
  email : string;  (** The email address to generate the merge link for. *)
}

let create_account_merge_request_of_yojson :
    Yojson.Safe.t -> create_account_merge_request =
 fun json ->
  let fields = Json.obj json in
  { email = Json.required fields "email" Json.string }

and yojson_of_create_account_merge_request :
    create_account_merge_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("email", Some (Json.of_string value.email)) ]

let make_create_account_merge_request ~(email : string) () =
  ({ email } : create_account_merge_request)

type nonrec create_checkout_session_v2_request = {
  cancel_url : string;  (** The URL to redirect to if checkout is cancelled *)
  discount : string option;  (** Optional discount/promo code to apply *)
  metadata : checkout_session_metadata option;
      (** Tracking metadata for conversion attribution *)
  onboarding_trial : bool option;
      (** Request the automatic, first-subscription 30-day Premium trial. *)
  plan : seat_plan option;
  success_url : string;  (** The URL to redirect to on successful checkout *)
}
(** Request body for creating a Stripe checkout session *)

let create_checkout_session_v2_request_of_yojson :
    Yojson.Safe.t -> create_checkout_session_v2_request =
 fun json ->
  let fields = Json.obj json in
  {
    cancel_url = Json.required fields "cancelUrl" Json.string;
    discount = Json.optional fields "discount" Json.string;
    metadata =
      Json.optional fields "metadata" checkout_session_metadata_of_yojson;
    onboarding_trial = Json.optional fields "onboardingTrial" Json.bool;
    plan = Json.optional fields "plan" seat_plan_of_yojson;
    success_url = Json.required fields "successUrl" Json.string;
  }

and yojson_of_create_checkout_session_v2_request :
    create_checkout_session_v2_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("cancelUrl", Some (Json.of_string value.cancel_url));
      ("discount", Option.map Json.of_string value.discount);
      ("metadata", Option.map yojson_of_checkout_session_metadata value.metadata);
      ("onboardingTrial", Option.map Json.of_bool value.onboarding_trial);
      ("plan", Option.map yojson_of_seat_plan value.plan);
      ("successUrl", Some (Json.of_string value.success_url));
    ]

let make_create_checkout_session_v2_request ~(cancel_url : string) ?discount
    ?metadata ?onboarding_trial ?plan ~(success_url : string) () =
  ({ cancel_url; discount; metadata; onboarding_trial; plan; success_url }
    : create_checkout_session_v2_request)

type nonrec create_gtm_invite_link_request = {
  first_name : string;
      (** The recipient's first name, shown on the welcome page. *)
  note : string option;  (** Free-form internal note for the dashboard. *)
  recipient_email : string option;
      (** The recipient's email, when the sender knows it. *)
}
(** Request body to create a link. *)

let create_gtm_invite_link_request_of_yojson :
    Yojson.Safe.t -> create_gtm_invite_link_request =
 fun json ->
  let fields = Json.obj json in
  {
    first_name = Json.required fields "firstName" Json.string;
    note = Json.optional fields "note" Json.string;
    recipient_email = Json.optional fields "recipientEmail" Json.string;
  }

and yojson_of_create_gtm_invite_link_request :
    create_gtm_invite_link_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("firstName", Some (Json.of_string value.first_name));
      ("note", Option.map Json.of_string value.note);
      ("recipientEmail", Option.map Json.of_string value.recipient_email);
    ]

let make_create_gtm_invite_link_request ~(first_name : string) ?note
    ?recipient_email () =
  ({ first_name; note; recipient_email } : create_gtm_invite_link_request)

type nonrec create_in_progress_link_response = {
  link_id : string;  (** The link id *)
}

let create_in_progress_link_response_of_yojson :
    Yojson.Safe.t -> create_in_progress_link_response =
 fun json ->
  let fields = Json.obj json in
  { link_id = Json.required fields "link_id" Json.string }

and yojson_of_create_in_progress_link_response :
    create_in_progress_link_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("link_id", Some (Json.of_string value.link_id)) ]

let make_create_in_progress_link_response ~(link_id : string) () =
  ({ link_id } : create_in_progress_link_response)

type nonrec create_portal_session_request = {
  return_url : string;  (** The URL to redirect to after leaving the portal *)
}
(** Request body for creating a Stripe portal session *)

let create_portal_session_request_of_yojson :
    Yojson.Safe.t -> create_portal_session_request =
 fun json ->
  let fields = Json.obj json in
  { return_url = Json.required fields "returnUrl" Json.string }

and yojson_of_create_portal_session_request :
    create_portal_session_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("returnUrl", Some (Json.of_string value.return_url)) ]

let make_create_portal_session_request ~(return_url : string) () =
  ({ return_url } : create_portal_session_request)

type nonrec create_profile_picture_upload_request = {
  content_type : string;  (** Mime type of the image. *)
  file_name : string;  (** File name, such as [avatar.png]. *)
  size_bytes : int64;
      (** Exact size of the image in bytes. Storage rejects a body of any other size. *)
}

let create_profile_picture_upload_request_of_yojson :
    Yojson.Safe.t -> create_profile_picture_upload_request =
 fun json ->
  let fields = Json.obj json in
  {
    content_type = Json.required fields "content_type" Json.string;
    file_name = Json.required fields "file_name" Json.string;
    size_bytes = Json.required fields "size_bytes" Json.int64;
  }

and yojson_of_create_profile_picture_upload_request :
    create_profile_picture_upload_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content_type", Some (Json.of_string value.content_type));
      ("file_name", Some (Json.of_string value.file_name));
      ("size_bytes", Some (Json.of_int64 value.size_bytes));
    ]

let make_create_profile_picture_upload_request ~(content_type : string)
    ~(file_name : string) ~(size_bytes : int64) () =
  ({ content_type; file_name; size_bytes }
    : create_profile_picture_upload_request)

type nonrec create_team_agent = {
  avatar_url : string option;
      (** Profile picture URL (a static file the caller uploaded). *)
  job_description : string;
      (** What the agent is responsible for. Seeds its workspace. *)
  name : string;  (** Display name. *)
  personality : string;
      (** How the agent behaves and talks. Seeds its workspace. *)
  purchase_key : string;
      (** One key per Invite dialog, reused when the invite is retried, so a
retry never buys a second computer. *)
  size : string;  (** The computer to buy. *)
  voice : string option;
      (** The call voice picked in the invite; [None] keeps the starter
agent's default. *)
}
(** Input for inviting an agent teammate and buying its computer. *)

let create_team_agent_of_yojson : Yojson.Safe.t -> create_team_agent =
 fun json ->
  let fields = Json.obj json in
  {
    avatar_url = Json.optional fields "avatarUrl" Json.string;
    job_description = Json.required fields "jobDescription" Json.string;
    name = Json.required fields "name" Json.string;
    personality = Json.required fields "personality" Json.string;
    purchase_key = Json.required fields "purchaseKey" Json.string;
    size = Json.required fields "size" Json.string;
    voice = Json.optional fields "voice" Json.string;
  }

and yojson_of_create_team_agent : create_team_agent -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("avatarUrl", Option.map Json.of_string value.avatar_url);
      ("jobDescription", Some (Json.of_string value.job_description));
      ("name", Some (Json.of_string value.name));
      ("personality", Some (Json.of_string value.personality));
      ("purchaseKey", Some (Json.of_string value.purchase_key));
      ("size", Some (Json.of_string value.size));
      ("voice", Option.map Json.of_string value.voice);
    ]

let make_create_team_agent ?avatar_url ~(job_description : string)
    ~(name : string) ~(personality : string) ~(purchase_key : string)
    ~(size : string) ?voice () =
  ({ avatar_url; job_description; name; personality; purchase_key; size; voice }
    : create_team_agent)

type nonrec create_team_request = {
  allow_domain_join : bool option;
      (** Whether colleagues who sign up with the owner's work email domain join
the team automatically. Ignored for generic email providers. *)
  name : string;  (** The name of the team *)
}
(** The request body to create a new team *)

let create_team_request_of_yojson : Yojson.Safe.t -> create_team_request =
 fun json ->
  let fields = Json.obj json in
  {
    allow_domain_join = Json.optional fields "allow_domain_join" Json.bool;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_create_team_request : create_team_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("allow_domain_join", Option.map Json.of_bool value.allow_domain_join);
      ("name", Some (Json.of_string value.name));
    ]

let make_create_team_request ?allow_domain_join ~(name : string) () =
  ({ allow_domain_join; name } : create_team_request)

type nonrec team_invite_link_token = string
(** The secret in a team's shareable invite link.

Anyone signed in who holds the token can join the team, so it is a random
value rather than a time-ordered id, and an admin resetting the link
replaces it. *)

let team_invite_link_token_of_yojson : Yojson.Safe.t -> team_invite_link_token =
 fun json -> Json.string json

and yojson_of_team_invite_link_token : team_invite_link_token -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec created_team_invite_link_response = {
  token : team_invite_link_token;
      (** The new link's token. Any previous link stops working. *)
}
(** A newly created team invite link. *)

let created_team_invite_link_response_of_yojson :
    Yojson.Safe.t -> created_team_invite_link_response =
 fun json ->
  let fields = Json.obj json in
  { token = Json.required fields "token" team_invite_link_token_of_yojson }

and yojson_of_created_team_invite_link_response :
    created_team_invite_link_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("token", Some (yojson_of_team_invite_link_token value.token)) ]

let make_created_team_invite_link_response ~(token : team_invite_link_token) ()
    =
  ({ token } : created_team_invite_link_response)

type nonrec credit_checkout_request_body = {
  amount_cents : int64;
      (** Pack size, cents; one of the catalog's [credit_packs_cents]. *)
  cancel_url : string;
      (** Where Stripe returns the user on cancel. Same rules as [success_url]. *)
  success_url : string;
      (** Where Stripe returns the user after paying. Must be an [https] URL
on the origin the request came from. *)
}
(** Request body for \[[create_credit_checkout_handler]\]. *)

let credit_checkout_request_body_of_yojson :
    Yojson.Safe.t -> credit_checkout_request_body =
 fun json ->
  let fields = Json.obj json in
  {
    amount_cents = Json.required fields "amountCents" Json.int64;
    cancel_url = Json.required fields "cancelUrl" Json.string;
    success_url = Json.required fields "successUrl" Json.string;
  }

and yojson_of_credit_checkout_request_body :
    credit_checkout_request_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("amountCents", Some (Json.of_int64 value.amount_cents));
      ("cancelUrl", Some (Json.of_string value.cancel_url));
      ("successUrl", Some (Json.of_string value.success_url));
    ]

let make_credit_checkout_request_body ~(amount_cents : int64)
    ~(cancel_url : string) ~(success_url : string) () =
  ({ amount_cents; cancel_url; success_url } : credit_checkout_request_body)

type nonrec credit_checkout_response = {
  url : string;  (** The hosted Checkout URL to redirect to. *)
}
(** Response for \[[create_credit_checkout_handler]\]. *)

let credit_checkout_response_of_yojson :
    Yojson.Safe.t -> credit_checkout_response =
 fun json ->
  let fields = Json.obj json in
  { url = Json.required fields "url" Json.string }

and yojson_of_credit_checkout_response :
    credit_checkout_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("url", Some (Json.of_string value.url)) ]

let make_credit_checkout_response ~(url : string) () =
  ({ url } : credit_checkout_response)

type nonrec credit_purchase_request_body = {
  amount_cents : int64;  (** One of the catalog's credit packs, cents. *)
}
(** Request body for \[[purchase_credits_handler]\]. *)

let credit_purchase_request_body_of_yojson :
    Yojson.Safe.t -> credit_purchase_request_body =
 fun json ->
  let fields = Json.obj json in
  { amount_cents = Json.required fields "amountCents" Json.int64 }

and yojson_of_credit_purchase_request_body :
    credit_purchase_request_body -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("amountCents", Some (Json.of_int64 value.amount_cents)) ]

let make_credit_purchase_request_body ~(amount_cents : int64) () =
  ({ amount_cents } : credit_purchase_request_body)

(** Why a request was refused. *)
type nonrec deny_reason =
  | Allowance_exhausted
  | Free_allowance_exhausted
  | Overage_limit_reached
  | Overage_payment_failed
  | Unknown of string  (** A value this SDK version does not know. *)

let deny_reason_of_yojson : Yojson.Safe.t -> deny_reason =
 fun json ->
  match Json.string json with
  | "allowance_exhausted" -> Allowance_exhausted
  | "free_allowance_exhausted" -> Free_allowance_exhausted
  | "overage_limit_reached" -> Overage_limit_reached
  | "overage_payment_failed" -> Overage_payment_failed
  | other -> Json.unknown "deny_reason" json (Unknown other)

and yojson_of_deny_reason : deny_reason -> Yojson.Safe.t =
 fun value ->
  match value with
  | Allowance_exhausted -> `String "allowance_exhausted"
  | Free_allowance_exhausted -> `String "free_allowance_exhausted"
  | Overage_limit_reached -> `String "overage_limit_reached"
  | Overage_payment_failed -> `String "overage_payment_failed"
  | Unknown other -> `String other

type nonrec credit_purchase_snapshot = {
  committed_cents : int64;
      (** Charged this month so far, including charges that may still collect. *)
  monthly_limit_cents : int64 option;
      (** Most credits charged to the card on file per UTC calendar month, from
automatic reloads and one-time purchases together, in customer cents.
[null] when the payer set no limit; team members always have one. *)
  resets_at : string;  (** Start of the next UTC calendar month. *)
}
(** The monthly credit limit that applies to this user's one-time purchases. *)

let credit_purchase_snapshot_of_yojson :
    Yojson.Safe.t -> credit_purchase_snapshot =
 fun json ->
  let fields = Json.obj json in
  {
    committed_cents = Json.required fields "committed_cents" Json.int64;
    monthly_limit_cents = Json.optional fields "monthly_limit_cents" Json.int64;
    resets_at = Json.required fields "resets_at" Json.string;
  }

and yojson_of_credit_purchase_snapshot :
    credit_purchase_snapshot -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("committed_cents", Some (Json.of_int64 value.committed_cents));
      ("monthly_limit_cents", Option.map Json.of_int64 value.monthly_limit_cents);
      ("resets_at", Some (Json.of_string value.resets_at));
    ]

let make_credit_purchase_snapshot ~(committed_cents : int64)
    ?monthly_limit_cents ~(resets_at : string) () =
  ({ committed_cents; monthly_limit_cents; resets_at }
    : credit_purchase_snapshot)

(** The plans a user can be on, cheapest first. *)
type nonrec plan_tier =
  | Free
  | Premium
  | Max
  | Unknown of string  (** A value this SDK version does not know. *)

let plan_tier_of_yojson : Yojson.Safe.t -> plan_tier =
 fun json ->
  match Json.string json with
  | "free" -> Free
  | "premium" -> Premium
  | "max" -> Max
  | other -> Json.unknown "plan_tier" json (Unknown other)

and yojson_of_plan_tier : plan_tier -> Yojson.Safe.t =
 fun value ->
  match value with
  | Free -> `String "free"
  | Premium -> `String "premium"
  | Max -> `String "max"
  | Unknown other -> `String other

type nonrec usage_snapshot = {
  auto_reload : auto_reload_snapshot;
      (** Automatic credit reload settings. [active] means the payer opted in and
reloads are not suspended. *)
  blocked_reason : deny_reason option;
  can_manage_billing : bool;  (** Whether the requesting user is the payer. *)
  credit_balance_cents : int64;
      (** Shared prepaid credit balance, in customer cents. *)
  credit_purchase : credit_purchase_snapshot option;
  credits_consumed_cents : int64;
      (** Shared payer credits already applied to this period, in customer cents. *)
  credits_shared_with_team : bool;
      (** Whether prepaid credits belong to the team, including a team with one seat. *)
  included_cents : int64;
      (** Included AI for this user's seat this period, in cents at provider cost. *)
  overage_charged_cents : int64;
      (** Shared overage charged so far this period, in customer cents. *)
  overage_enabled : bool;
      (** Legacy API name for the automatic reload opt-in. Never authorizes direct charges. *)
  overage_limit_cents : int64;
      (** Per-period overage cap, in customer cents. *)
  overage_suspended : bool;
      (** Whether overage is paused after a failed charge. *)
  payer : string;  (** The payer for this user's AI. *)
  period_end : string;  (** Period end (exclusive). *)
  period_start : string;  (** Period start. *)
  remaining_cents : int64;
      (** Cost cents of usage this seat may still consume: its remaining allowance
plus whatever shared credit and overage headroom pays for at the markup.
0 when blocked. *)
  seats : int;  (** Seats billed to the payer. *)
  tier : plan_tier;  (** The plan. *)
  uncovered_cents : int64;
      (** Team-wide usage beyond per-seat allowances, at the overage markup, that
is not yet covered by shared credits or charges (awaiting settlement).
Customer cents. *)
  unlimited : bool;  (** Enterprise: never metered. *)
  used_cents : int64;
      (** AI used by this user this period, in cents at provider cost. *)
}
(** The payer's current-period position, as shown in Billing settings and used
by the gate. *)

let usage_snapshot_of_yojson : Yojson.Safe.t -> usage_snapshot =
 fun json ->
  let fields = Json.obj json in
  {
    auto_reload =
      Json.required fields "auto_reload" auto_reload_snapshot_of_yojson;
    blocked_reason = Json.optional fields "blocked_reason" deny_reason_of_yojson;
    can_manage_billing = Json.required fields "can_manage_billing" Json.bool;
    credit_balance_cents =
      Json.required fields "credit_balance_cents" Json.int64;
    credit_purchase =
      Json.optional fields "credit_purchase" credit_purchase_snapshot_of_yojson;
    credits_consumed_cents =
      Json.required fields "credits_consumed_cents" Json.int64;
    credits_shared_with_team =
      Json.required fields "credits_shared_with_team" Json.bool;
    included_cents = Json.required fields "included_cents" Json.int64;
    overage_charged_cents =
      Json.required fields "overage_charged_cents" Json.int64;
    overage_enabled = Json.required fields "overage_enabled" Json.bool;
    overage_limit_cents = Json.required fields "overage_limit_cents" Json.int64;
    overage_suspended = Json.required fields "overage_suspended" Json.bool;
    payer = Json.required fields "payer" Json.string;
    period_end = Json.required fields "period_end" Json.string;
    period_start = Json.required fields "period_start" Json.string;
    remaining_cents = Json.required fields "remaining_cents" Json.int64;
    seats = Json.required fields "seats" Json.int;
    tier = Json.required fields "tier" plan_tier_of_yojson;
    uncovered_cents = Json.required fields "uncovered_cents" Json.int64;
    unlimited = Json.required fields "unlimited" Json.bool;
    used_cents = Json.required fields "used_cents" Json.int64;
  }

and yojson_of_usage_snapshot : usage_snapshot -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("auto_reload", Some (yojson_of_auto_reload_snapshot value.auto_reload));
      ("blocked_reason", Option.map yojson_of_deny_reason value.blocked_reason);
      ("can_manage_billing", Some (Json.of_bool value.can_manage_billing));
      ("credit_balance_cents", Some (Json.of_int64 value.credit_balance_cents));
      ( "credit_purchase",
        Option.map yojson_of_credit_purchase_snapshot value.credit_purchase );
      ( "credits_consumed_cents",
        Some (Json.of_int64 value.credits_consumed_cents) );
      ( "credits_shared_with_team",
        Some (Json.of_bool value.credits_shared_with_team) );
      ("included_cents", Some (Json.of_int64 value.included_cents));
      ("overage_charged_cents", Some (Json.of_int64 value.overage_charged_cents));
      ("overage_enabled", Some (Json.of_bool value.overage_enabled));
      ("overage_limit_cents", Some (Json.of_int64 value.overage_limit_cents));
      ("overage_suspended", Some (Json.of_bool value.overage_suspended));
      ("payer", Some (Json.of_string value.payer));
      ("period_end", Some (Json.of_string value.period_end));
      ("period_start", Some (Json.of_string value.period_start));
      ("remaining_cents", Some (Json.of_int64 value.remaining_cents));
      ("seats", Some (Json.of_int value.seats));
      ("tier", Some (yojson_of_plan_tier value.tier));
      ("uncovered_cents", Some (Json.of_int64 value.uncovered_cents));
      ("unlimited", Some (Json.of_bool value.unlimited));
      ("used_cents", Some (Json.of_int64 value.used_cents));
    ]

let make_usage_snapshot ~(auto_reload : auto_reload_snapshot) ?blocked_reason
    ~(can_manage_billing : bool) ~(credit_balance_cents : int64)
    ?credit_purchase ~(credits_consumed_cents : int64)
    ~(credits_shared_with_team : bool) ~(included_cents : int64)
    ~(overage_charged_cents : int64) ~(overage_enabled : bool)
    ~(overage_limit_cents : int64) ~(overage_suspended : bool) ~(payer : string)
    ~(period_end : string) ~(period_start : string) ~(remaining_cents : int64)
    ~(seats : int) ~(tier : plan_tier) ~(uncovered_cents : int64)
    ~(unlimited : bool) ~(used_cents : int64) () =
  ({
     auto_reload;
     blocked_reason;
     can_manage_billing;
     credit_balance_cents;
     credit_purchase;
     credits_consumed_cents;
     credits_shared_with_team;
     included_cents;
     overage_charged_cents;
     overage_enabled;
     overage_limit_cents;
     overage_suspended;
     payer;
     period_end;
     period_start;
     remaining_cents;
     seats;
     tier;
     uncovered_cents;
     unlimited;
     used_cents;
   }
    : usage_snapshot)

(** How a one-time credit purchase charged to the card on file ended. *)
type nonrec credit_purchase_status =
  | Paid
  | Declined
  | Payment_method_required
  | Authentication_required
  | Unknown of string  (** A value this SDK version does not know. *)

let credit_purchase_status_of_yojson : Yojson.Safe.t -> credit_purchase_status =
 fun json ->
  match Json.string json with
  | "paid" -> Paid
  | "declined" -> Declined
  | "payment_method_required" -> Payment_method_required
  | "authentication_required" -> Authentication_required
  | other -> Json.unknown "credit_purchase_status" json (Unknown other)

and yojson_of_credit_purchase_status : credit_purchase_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Paid -> `String "paid"
  | Declined -> `String "declined"
  | Payment_method_required -> `String "payment_method_required"
  | Authentication_required -> `String "authentication_required"
  | Unknown other -> `String other

type nonrec credit_purchase_response = {
  amount_cents : int64;
      (** Amount charged, cents: the requested pack, unless an earlier declined
purchase that Stripe collected in the meantime was booked instead. *)
  snapshot : usage_snapshot option;
  status : credit_purchase_status;  (** Whether the card on file paid. *)
}
(** Response for \[[purchase_credits_handler]\]. *)

let credit_purchase_response_of_yojson :
    Yojson.Safe.t -> credit_purchase_response =
 fun json ->
  let fields = Json.obj json in
  {
    amount_cents = Json.required fields "amountCents" Json.int64;
    snapshot = Json.optional fields "snapshot" usage_snapshot_of_yojson;
    status = Json.required fields "status" credit_purchase_status_of_yojson;
  }

and yojson_of_credit_purchase_response :
    credit_purchase_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("amountCents", Some (Json.of_int64 value.amount_cents));
      ("snapshot", Option.map yojson_of_usage_snapshot value.snapshot);
      ("status", Some (yojson_of_credit_purchase_status value.status));
    ]

let make_credit_purchase_response ~(amount_cents : int64) ?snapshot
    ~(status : credit_purchase_status) () =
  ({ amount_cents; snapshot; status } : credit_purchase_response)

(** The platform status. Only the non-operational statuses carry a message. *)
type nonrec system_status =
  | Operational  (** Everything works; no banner is shown. *)
  | Degraded of { message : string  (** What users should know. *) }
      (** Some features are slow or failing. *)
  | Major_outage of { message : string  (** What users should know. *) }
      (** Macro is largely unavailable. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let system_status_of_yojson : Yojson.Safe.t -> system_status =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "status" with
  | "operational" -> Operational
  | "degraded" ->
      Degraded { message = Json.required fields "message" Json.string }
  | "major_outage" ->
      Major_outage { message = Json.required fields "message" Json.string }
  | _ -> Json.unknown "system_status" json (Unknown json)

and yojson_of_system_status : system_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Operational -> Json.record [ ("status", Some (`String "operational")) ]
  | Degraded case ->
      Json.record
        [
          ("status", Some (`String "degraded"));
          ("message", Some (Json.of_string case.message));
        ]
  | Major_outage case ->
      Json.record
        [
          ("status", Some (`String "major_outage"));
          ("message", Some (Json.of_string case.message));
        ]
  | Unknown json -> json

let make_system_status_degraded ~(message : string) () =
  (Degraded { message } : system_status)

let make_system_status_major_outage ~(message : string) () =
  (Major_outage { message } : system_status)

type nonrec current_system_status = {
  system_status : system_status;  (** The status and its message. *)
  id : string option;
      (** The id of the update that set it; absent when no status was ever set.
Clients remember dismissed banners by this id. *)
  updated_at : string option;
      (** When it was set; absent when no status was ever set. Clients keep the
newest status they have seen, whether fetched or pushed. *)
}
(** The status every user sees, without who set it. *)

let current_system_status_of_yojson : Yojson.Safe.t -> current_system_status =
 fun json ->
  let fields = Json.obj json in
  {
    system_status = system_status_of_yojson json;
    id = Json.optional fields "id" Json.string;
    updated_at = Json.optional fields "updatedAt" Json.string;
  }

and yojson_of_current_system_status : current_system_status -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("id", Option.map Json.of_string value.id);
          ("updatedAt", Option.map Json.of_string value.updated_at);
        ];
      yojson_of_system_status value.system_status;
    ]

let make_current_system_status ~(system_status : system_status) ?id ?updated_at
    () =
  ({ system_status; id; updated_at } : current_system_status)

type nonrec cursor_api_key_status = {
  default_effort : string option;
      (** The reasoning effort those sessions start on, as the value of the
default model's effort parameter (e.g. [high]). [None] means the
model's own default; never set without [default_model_id]. *)
  default_model_id : string option;
      (** The Cursor model id this user's sessions start on, when they have
chosen one. [None] means the deployment default is in effect — the
settings dropdown shows that as its resting value. *)
  registered : bool;  (** Whether this user has a key stored. *)
  updated_at : string option;
      (** When the stored key was last replaced, if there is one. *)
}
(** What settings needs to render the Cursor connection.

Deliberately thin. [registered] drives the whole UI; [updatedAt] lets it say
when the key was last replaced, which is the only thing a user can check
against their own memory when a session starts failing.

Deliberately *not* reporting anything about the deployment itself. That is
operator information: a user who sees it cannot act on it, and a service
that cannot reach KMS does not start. *)

let cursor_api_key_status_of_yojson : Yojson.Safe.t -> cursor_api_key_status =
 fun json ->
  let fields = Json.obj json in
  {
    default_effort = Json.optional fields "defaultEffort" Json.string;
    default_model_id = Json.optional fields "defaultModelId" Json.string;
    registered = Json.required fields "registered" Json.bool;
    updated_at = Json.optional fields "updatedAt" Json.string;
  }

and yojson_of_cursor_api_key_status : cursor_api_key_status -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("defaultEffort", Option.map Json.of_string value.default_effort);
      ("defaultModelId", Option.map Json.of_string value.default_model_id);
      ("registered", Some (Json.of_bool value.registered));
      ("updatedAt", Option.map Json.of_string value.updated_at);
    ]

let make_cursor_api_key_status ?default_effort ?default_model_id
    ~(registered : bool) ?updated_at () =
  ({ default_effort; default_model_id; registered; updated_at }
    : cursor_api_key_status)

type nonrec cursor_model_option = {
  display_name : string;
      (** The human-readable name, e.g. [Cursor Grok 4.6]. *)
  group : string;
      (** The family heading to list this model under, e.g. [Cursor Grok]. *)
  id : string;  (** The id to store and send, e.g. [grok-4.6]. *)
}
(** One model the settings dropdown can offer.

Id, name and family: the dropdown lists models, not the hundreds of
parameter variants each carries. The chosen id's parameters are resolved to
Cursor's default variant at session start. The family is the same heading
the Cursor ACP agent groups its session model select under, so the settings
picker and the in-session picker read the same way. *)

let cursor_model_option_of_yojson : Yojson.Safe.t -> cursor_model_option =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    group = Json.required fields "group" Json.string;
    id = Json.required fields "id" Json.string;
  }

and yojson_of_cursor_model_option : cursor_model_option -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("group", Some (Json.of_string value.group));
      ("id", Some (Json.of_string value.id));
    ]

let make_cursor_model_option ~(display_name : string) ~(group : string)
    ~(id : string) () =
  ({ display_name; group; id } : cursor_model_option)

type nonrec cursor_models_response = {
  models : cursor_model_option list;
      (** The offered models, in the order Cursor returned them. *)
}
(** The models this account may choose from. *)

let cursor_models_response_of_yojson : Yojson.Safe.t -> cursor_models_response =
 fun json ->
  let fields = Json.obj json in
  {
    models =
      Json.required fields "models" (Json.list cursor_model_option_of_yojson);
  }

and yojson_of_cursor_models_response : cursor_models_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "models",
        Some ((Json.of_list yojson_of_cursor_model_option) value.models) );
    ]

let make_cursor_models_response ~(models : cursor_model_option list) () =
  ({ models } : cursor_models_response)

type nonrec email_connection_providers = {
  gmail : bool;
  outlook : bool;
      (** Whether this user may start a new Outlook connection: the deployment
switch and their [enable-outlook] flag. *)
  outlook_admin_consent_url : string option;
      (** Where a Microsoft 365 administrator approves Macro for their whole
directory. Present when Outlook is configured and the request named an
[original_url] for the administrator's browser to return to. *)
}
(** What the provider selector offers the requesting user. *)

let email_connection_providers_of_yojson :
    Yojson.Safe.t -> email_connection_providers =
 fun json ->
  let fields = Json.obj json in
  {
    gmail = Json.required fields "gmail" Json.bool;
    outlook = Json.required fields "outlook" Json.bool;
    outlook_admin_consent_url =
      Json.optional fields "outlook_admin_consent_url" Json.string;
  }

and yojson_of_email_connection_providers :
    email_connection_providers -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("gmail", Some (Json.of_bool value.gmail));
      ("outlook", Some (Json.of_bool value.outlook));
      ( "outlook_admin_consent_url",
        Option.map Json.of_string value.outlook_admin_consent_url );
    ]

let make_email_connection_providers ~(gmail : bool) ~(outlook : bool)
    ?outlook_admin_consent_url () =
  ({ gmail; outlook; outlook_admin_consent_url } : email_connection_providers)

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

let empty_response_of_yojson : Yojson.Safe.t -> empty_response =
 fun json -> Json.json json

and yojson_of_empty_response : empty_response -> Yojson.Safe.t =
 fun value -> Json.of_json value

type nonrec github_pull_request_ref = {
  display_name : string;  (** A compact label suitable for display in the UI. *)
  github_key : string;
      (** The stored GitHub association key, in [owner/repo/pull/number] format. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  url : string;  (** The public GitHub URL for the pull request. *)
}
(** A pull request reference that can be enriched with live GitHub data. *)

let github_pull_request_ref_of_yojson : Yojson.Safe.t -> github_pull_request_ref
    =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_github_pull_request_ref : github_pull_request_ref -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("githubKey", Some (Json.of_string value.github_key));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ("url", Some (Json.of_string value.url));
    ]

let make_github_pull_request_ref ~(display_name : string) ~(github_key : string)
    ~(number : int64) ~(owner : string) ~(repo : string) ~(url : string) () =
  ({ display_name; github_key; number; owner; repo; url }
    : github_pull_request_ref)

type nonrec enrich_github_pull_requests_proxy_request = {
  pull_requests : github_pull_request_ref list;
      (** The pull requests to enrich for the authenticated user. *)
}
(** Request body for the authenticated pull request enrichment proxy. *)

let enrich_github_pull_requests_proxy_request_of_yojson :
    Yojson.Safe.t -> enrich_github_pull_requests_proxy_request =
 fun json ->
  let fields = Json.obj json in
  {
    pull_requests =
      Json.required fields "pullRequests"
        (Json.list github_pull_request_ref_of_yojson);
  }

and yojson_of_enrich_github_pull_requests_proxy_request :
    enrich_github_pull_requests_proxy_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "pullRequests",
        Some
          ((Json.of_list yojson_of_github_pull_request_ref) value.pull_requests)
      );
    ]

let make_enrich_github_pull_requests_proxy_request
    ~(pull_requests : github_pull_request_ref list) () =
  ({ pull_requests } : enrich_github_pull_requests_proxy_request)

type nonrec github_pull_request_user = {
  github_user_id : string;
      (** The stable numeric GitHub user id, as a string. *)
  login : string option;  (** The user's GitHub login, when known. *)
}
(** A GitHub user named on a pull request, such as an assignee. *)

let github_pull_request_user_of_yojson :
    Yojson.Safe.t -> github_pull_request_user =
 fun json ->
  let fields = Json.obj json in
  {
    github_user_id = Json.required fields "githubUserId" Json.string;
    login = Json.optional fields "login" Json.string;
  }

and yojson_of_github_pull_request_user :
    github_pull_request_user -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("githubUserId", Some (Json.of_string value.github_user_id));
      ("login", Option.map Json.of_string value.login);
    ]

let make_github_pull_request_user ~(github_user_id : string) ?login () =
  ({ github_user_id; login } : github_pull_request_user)

type nonrec github_pull_request_check_run = {
  completed_at : string option;
      (** When the check run completed, when available. *)
  conclusion : string option;
      (** The raw GitHub check run conclusion, when the run has completed. *)
  id : int64;  (** The unique GitHub identifier for the check run. *)
  name : string;  (** The check run name. *)
  started_at : string option;
      (** When the check run started, when available. *)
  status : string;  (** The raw GitHub check run status. *)
  url : string option;
      (** The public GitHub URL for the check run, when available. *)
}
(** A check run associated with a GitHub pull request. *)

let github_pull_request_check_run_of_yojson :
    Yojson.Safe.t -> github_pull_request_check_run =
 fun json ->
  let fields = Json.obj json in
  {
    completed_at = Json.optional fields "completedAt" Json.string;
    conclusion = Json.optional fields "conclusion" Json.string;
    id = Json.required fields "id" Json.int64;
    name = Json.required fields "name" Json.string;
    started_at = Json.optional fields "startedAt" Json.string;
    status = Json.required fields "status" Json.string;
    url = Json.optional fields "url" Json.string;
  }

and yojson_of_github_pull_request_check_run :
    github_pull_request_check_run -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("completedAt", Option.map Json.of_string value.completed_at);
      ("conclusion", Option.map Json.of_string value.conclusion);
      ("id", Some (Json.of_int64 value.id));
      ("name", Some (Json.of_string value.name));
      ("startedAt", Option.map Json.of_string value.started_at);
      ("status", Some (Json.of_string value.status));
      ("url", Option.map Json.of_string value.url);
    ]

let make_github_pull_request_check_run ?completed_at ?conclusion ~(id : int64)
    ~(name : string) ?started_at ~(status : string) ?url () =
  ({ completed_at; conclusion; id; name; started_at; status; url }
    : github_pull_request_check_run)

type nonrec github_pull_request_comment = {
  author_association : string option;
      (** GitHub's relationship label for the author, when available. *)
  author_id : int64 option;
      (** The stable numeric GitHub user id for the comment author, when available. *)
  author_login : string option;
      (** The GitHub login for the comment author, when available. *)
  body : string;  (** The comment or review body text. *)
  created_at : string option;
      (** When the comment was created or the review was submitted. *)
  id : int64;  (** The unique GitHub identifier for the comment or review. *)
  in_reply_to_id : int64 option;
      (** The id of the comment this one replies to, when it is part of a review
thread. Only ever present on [review_comment] sources. *)
  line : int64 option;
      (** The line in the current diff the comment is anchored to. Cleared by
GitHub when later commits outdate the comment's diff. *)
  original_line : int64 option;
      (** The line the comment was originally anchored to, kept even when the
diff has since changed. *)
  path : string option;
      (** The repository-relative file path the review comment is anchored to.
Only ever present on [review_comment] sources. *)
  pull_request_review_id : int64 option;
      (** The id of the pull request review this comment was submitted with.
Only ever present on [review_comment] sources. *)
  source : string;
      (** The GitHub source for the comment, such as [issue_comment] or [review_comment]. *)
  updated_at : string option;
      (** When the comment or review was last updated. *)
  url : string option;
      (** The public GitHub URL for the comment or review, when available. *)
}
(** A comment associated with a GitHub pull request. *)

let github_pull_request_comment_of_yojson :
    Yojson.Safe.t -> github_pull_request_comment =
 fun json ->
  let fields = Json.obj json in
  {
    author_association = Json.optional fields "authorAssociation" Json.string;
    author_id = Json.optional fields "authorId" Json.int64;
    author_login = Json.optional fields "authorLogin" Json.string;
    body = Json.required fields "body" Json.string;
    created_at = Json.optional fields "createdAt" Json.string;
    id = Json.required fields "id" Json.int64;
    in_reply_to_id = Json.optional fields "inReplyToId" Json.int64;
    line = Json.optional fields "line" Json.int64;
    original_line = Json.optional fields "originalLine" Json.int64;
    path = Json.optional fields "path" Json.string;
    pull_request_review_id =
      Json.optional fields "pullRequestReviewId" Json.int64;
    source = Json.required fields "source" Json.string;
    updated_at = Json.optional fields "updatedAt" Json.string;
    url = Json.optional fields "url" Json.string;
  }

and yojson_of_github_pull_request_comment :
    github_pull_request_comment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("authorAssociation", Option.map Json.of_string value.author_association);
      ("authorId", Option.map Json.of_int64 value.author_id);
      ("authorLogin", Option.map Json.of_string value.author_login);
      ("body", Some (Json.of_string value.body));
      ("createdAt", Option.map Json.of_string value.created_at);
      ("id", Some (Json.of_int64 value.id));
      ("inReplyToId", Option.map Json.of_int64 value.in_reply_to_id);
      ("line", Option.map Json.of_int64 value.line);
      ("originalLine", Option.map Json.of_int64 value.original_line);
      ("path", Option.map Json.of_string value.path);
      ( "pullRequestReviewId",
        Option.map Json.of_int64 value.pull_request_review_id );
      ("source", Some (Json.of_string value.source));
      ("updatedAt", Option.map Json.of_string value.updated_at);
      ("url", Option.map Json.of_string value.url);
    ]

let make_github_pull_request_comment ?author_association ?author_id
    ?author_login ~(body : string) ?created_at ~(id : int64) ?in_reply_to_id
    ?line ?original_line ?path ?pull_request_review_id ~(source : string)
    ?updated_at ?url () =
  ({
     author_association;
     author_id;
     author_login;
     body;
     created_at;
     id;
     in_reply_to_id;
     line;
     original_line;
     path;
     pull_request_review_id;
     source;
     updated_at;
     url;
   }
    : github_pull_request_comment)

type nonrec github_pull_request_label = {
  color : string option;
      (** The label color as six hex digits without a leading [#], when known. *)
  name : string;
      (** The label name, unique within its repository regardless of case. *)
}
(** A label on a GitHub pull request. *)

let github_pull_request_label_of_yojson :
    Yojson.Safe.t -> github_pull_request_label =
 fun json ->
  let fields = Json.obj json in
  {
    color = Json.optional fields "color" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_github_pull_request_label :
    github_pull_request_label -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("color", Option.map Json.of_string value.color);
      ("name", Some (Json.of_string value.name));
    ]

let make_github_pull_request_label ?color ~(name : string) () =
  ({ color; name } : github_pull_request_label)

(** What a reviewer's latest review on a pull request said. *)
type nonrec github_pull_request_review_state =
  | Approved
  | Changes_requested
  | Commented
  | Dismissed
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pull_request_review_state_of_yojson :
    Yojson.Safe.t -> github_pull_request_review_state =
 fun json ->
  match Json.string json with
  | "approved" -> Approved
  | "changes_requested" -> Changes_requested
  | "commented" -> Commented
  | "dismissed" -> Dismissed
  | other ->
      Json.unknown "github_pull_request_review_state" json (Unknown other)

and yojson_of_github_pull_request_review_state :
    github_pull_request_review_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Approved -> `String "approved"
  | Changes_requested -> `String "changes_requested"
  | Commented -> `String "commented"
  | Dismissed -> `String "dismissed"
  | Unknown other -> `String other

type nonrec github_pull_request_review = {
  reviewer_github_user_id : string;
      (** The stable numeric GitHub user id of the reviewer, as a string. *)
  reviewer_login : string option;
      (** The reviewer's GitHub login, when known. *)
  state : github_pull_request_review_state;  (** What the review said. *)
  submitted_at : string option;
      (** When the review was submitted, when known. *)
}
(** A reviewer's latest submitted review on a pull request. *)

let github_pull_request_review_of_yojson :
    Yojson.Safe.t -> github_pull_request_review =
 fun json ->
  let fields = Json.obj json in
  {
    reviewer_github_user_id =
      Json.required fields "reviewerGithubUserId" Json.string;
    reviewer_login = Json.optional fields "reviewerLogin" Json.string;
    state =
      Json.required fields "state" github_pull_request_review_state_of_yojson;
    submitted_at = Json.optional fields "submittedAt" Json.string;
  }

and yojson_of_github_pull_request_review :
    github_pull_request_review -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "reviewerGithubUserId",
        Some (Json.of_string value.reviewer_github_user_id) );
      ("reviewerLogin", Option.map Json.of_string value.reviewer_login);
      ("state", Some (yojson_of_github_pull_request_review_state value.state));
      ("submittedAt", Option.map Json.of_string value.submitted_at);
    ]

let make_github_pull_request_review ~(reviewer_github_user_id : string)
    ?reviewer_login ~(state : github_pull_request_review_state) ?submitted_at ()
    =
  ({ reviewer_github_user_id; reviewer_login; state; submitted_at }
    : github_pull_request_review)

(** The normalized lifecycle status for a GitHub pull request. *)
type nonrec github_pull_request_status =
  | Open
  | Closed
  | Merged
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pull_request_status_of_yojson :
    Yojson.Safe.t -> github_pull_request_status =
 fun json ->
  match Json.string json with
  | "open" -> Open
  | "closed" -> Closed
  | "merged" -> Merged
  | other -> Json.unknown "github_pull_request_status" json (Unknown other)

and yojson_of_github_pull_request_status :
    github_pull_request_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Open -> `String "open"
  | Closed -> `String "closed"
  | Merged -> `String "merged"
  | Unknown other -> `String other

type nonrec enriched_github_pull_request = {
  additions : int64 option;
      (** The number of added lines reported by GitHub, when enrichment succeeds. *)
  assignees : github_pull_request_user list option;
      (** The users assigned to the pull request, when known. *)
  author_id : int64 option;
      (** The stable numeric GitHub user id for the pull request author, when available. *)
  author_login : string option;
      (** The GitHub login for the pull request author, when available. *)
  checks : github_pull_request_check_run list option;
      (** Check runs collected from the pull request head commit, when enrichment includes them. *)
  comments : github_pull_request_comment list option;
      (** Comments collected from the pull request, when enrichment includes them. *)
  deletions : int64 option;
      (** The number of deleted lines reported by GitHub, when enrichment succeeds. *)
  description : string option;
      (** The pull request description (body), when available. *)
  display_name : string;  (** A compact label suitable for display in the UI. *)
  github_key : string;
      (** The stored GitHub association key, in [owner/repo/pull/number] format. *)
  labels : github_pull_request_label list option;
      (** The pull request's labels, when known. *)
  name : string option;
      (** The GitHub pull request title, when enrichment succeeds. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  participant_github_user_ids : string list option;
      (** Stable numeric GitHub user ids (as strings) for everyone involved in the pull request.
Queried by the foreign entity [includes_me] filter, so stored metadata merges this as a
union rather than replacing it (partial write paths must not drop known participants). *)
  repo : string;  (** The GitHub repository name. *)
  reviews : github_pull_request_review list option;
      (** Each reviewer's latest submitted review, when known. Stored metadata merges this per
reviewer, so a write that knows one review keeps the others. *)
  status : github_pull_request_status option;
  url : string;  (** The public GitHub URL for the pull request. *)
}
(** A pull request reference enriched with live GitHub details when available. *)

let enriched_github_pull_request_of_yojson :
    Yojson.Safe.t -> enriched_github_pull_request =
 fun json ->
  let fields = Json.obj json in
  {
    additions = Json.optional fields "additions" Json.int64;
    assignees =
      Json.optional fields "assignees"
        (Json.list github_pull_request_user_of_yojson);
    author_id = Json.optional fields "authorId" Json.int64;
    author_login = Json.optional fields "authorLogin" Json.string;
    checks =
      Json.optional fields "checks"
        (Json.list github_pull_request_check_run_of_yojson);
    comments =
      Json.optional fields "comments"
        (Json.list github_pull_request_comment_of_yojson);
    deletions = Json.optional fields "deletions" Json.int64;
    description = Json.optional fields "description" Json.string;
    display_name = Json.required fields "displayName" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    labels =
      Json.optional fields "labels"
        (Json.list github_pull_request_label_of_yojson);
    name = Json.optional fields "name" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    participant_github_user_ids =
      Json.optional fields "participantGithubUserIds" (Json.list Json.string);
    repo = Json.required fields "repo" Json.string;
    reviews =
      Json.optional fields "reviews"
        (Json.list github_pull_request_review_of_yojson);
    status = Json.optional fields "status" github_pull_request_status_of_yojson;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_enriched_github_pull_request :
    enriched_github_pull_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("additions", Option.map Json.of_int64 value.additions);
      ( "assignees",
        Option.map
          (Json.of_list yojson_of_github_pull_request_user)
          value.assignees );
      ("authorId", Option.map Json.of_int64 value.author_id);
      ("authorLogin", Option.map Json.of_string value.author_login);
      ( "checks",
        Option.map
          (Json.of_list yojson_of_github_pull_request_check_run)
          value.checks );
      ( "comments",
        Option.map
          (Json.of_list yojson_of_github_pull_request_comment)
          value.comments );
      ("deletions", Option.map Json.of_int64 value.deletions);
      ("description", Option.map Json.of_string value.description);
      ("displayName", Some (Json.of_string value.display_name));
      ("githubKey", Some (Json.of_string value.github_key));
      ( "labels",
        Option.map
          (Json.of_list yojson_of_github_pull_request_label)
          value.labels );
      ("name", Option.map Json.of_string value.name);
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ( "participantGithubUserIds",
        Option.map
          (Json.of_list Json.of_string)
          value.participant_github_user_ids );
      ("repo", Some (Json.of_string value.repo));
      ( "reviews",
        Option.map
          (Json.of_list yojson_of_github_pull_request_review)
          value.reviews );
      ("status", Option.map yojson_of_github_pull_request_status value.status);
      ("url", Some (Json.of_string value.url));
    ]

let make_enriched_github_pull_request ?additions ?assignees ?author_id
    ?author_login ?checks ?comments ?deletions ?description
    ~(display_name : string) ~(github_key : string) ?labels ?name
    ~(number : int64) ~(owner : string) ?participant_github_user_ids
    ~(repo : string) ?reviews ?status ~(url : string) () =
  ({
     additions;
     assignees;
     author_id;
     author_login;
     checks;
     comments;
     deletions;
     description;
     display_name;
     github_key;
     labels;
     name;
     number;
     owner;
     participant_github_user_ids;
     repo;
     reviews;
     status;
     url;
   }
    : enriched_github_pull_request)

type nonrec enrich_github_pull_requests_response = {
  pull_requests : enriched_github_pull_request list;
      (** Pull requests with enrichment fields populated when GitHub data was available. *)
}
(** Response body for pull request enrichment. *)

let enrich_github_pull_requests_response_of_yojson :
    Yojson.Safe.t -> enrich_github_pull_requests_response =
 fun json ->
  let fields = Json.obj json in
  {
    pull_requests =
      Json.required fields "pullRequests"
        (Json.list enriched_github_pull_request_of_yojson);
  }

and yojson_of_enrich_github_pull_requests_response :
    enrich_github_pull_requests_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "pullRequests",
        Some
          ((Json.of_list yojson_of_enriched_github_pull_request)
             value.pull_requests) );
    ]

let make_enrich_github_pull_requests_response
    ~(pull_requests : enriched_github_pull_request list) () =
  ({ pull_requests } : enrich_github_pull_requests_response)

type nonrec error_response = {
  message : string;  (** Message to explain failure *)
}
(** A plain old json error response for use with axum.
yup, thats it. *)

let error_response_of_yojson : Yojson.Safe.t -> error_response =
 fun json ->
  let fields = Json.obj json in
  { message = Json.required fields "message" Json.string }

and yojson_of_error_response : error_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("message", Some (Json.of_string value.message)) ]

let make_error_response ~(message : string) () = ({ message } : error_response)

type nonrec generate_email_link_request = {
  email : string;  (** The email address to resend the verification email to *)
}

let generate_email_link_request_of_yojson :
    Yojson.Safe.t -> generate_email_link_request =
 fun json ->
  let fields = Json.obj json in
  { email = Json.required fields "email" Json.string }

and yojson_of_generate_email_link_request :
    generate_email_link_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("email", Some (Json.of_string value.email)) ]

let make_generate_email_link_request ~(email : string) () =
  ({ email } : generate_email_link_request)

type nonrec generic_success_response = {
  success : bool;  (** Indicates if the request was successful *)
}

let generic_success_response_of_yojson :
    Yojson.Safe.t -> generic_success_response =
 fun json ->
  let fields = Json.obj json in
  { success = Json.required fields "success" Json.bool }

and yojson_of_generic_success_response :
    generic_success_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("success", Some (Json.of_bool value.success)) ]

let make_generic_success_response ~(success : bool) () =
  ({ success } : generic_success_response)

type nonrec get_legacy_user_permissions_response = {
  ai_data_consent : bool;
      (** Whether the user has consented to AI data sharing *)
  created_at : string option;
      (** When the account was created. Absent for accounts that predate
creation-time tracking. *)
  email : string;  (** The user's email *)
  group : ab_group option;
  has_chrome_ext : bool;  (** Whether the user has the chrome extension *)
  has_trialed : bool;  (** Whether the user has trialed through stripe *)
  is_agent : bool;  (** Whether this is an agent account rather than a person *)
  license_status : string;  (** The user's license status *)
  name : string option;  (** The user's name *)
  permissions : string list;  (** The permissions the user has *)
  referral_code : string;  (** The referral code for the user *)
  tutorial_complete : bool;  (** Whether the user has completed the tutorial *)
  user_id : string;  (** The user id *)
}

let get_legacy_user_permissions_response_of_yojson :
    Yojson.Safe.t -> get_legacy_user_permissions_response =
 fun json ->
  let fields = Json.obj json in
  {
    ai_data_consent = Json.required fields "aiDataConsent" Json.bool;
    created_at = Json.optional fields "createdAt" Json.string;
    email = Json.required fields "email" Json.string;
    group = Json.optional fields "group" ab_group_of_yojson;
    has_chrome_ext = Json.required fields "hasChromeExt" Json.bool;
    has_trialed = Json.required fields "hasTrialed" Json.bool;
    is_agent = Json.required fields "isAgent" Json.bool;
    license_status = Json.required fields "licenseStatus" Json.string;
    name = Json.optional fields "name" Json.string;
    permissions = Json.required fields "permissions" (Json.list Json.string);
    referral_code = Json.required fields "referralCode" Json.string;
    tutorial_complete = Json.required fields "tutorialComplete" Json.bool;
    user_id = Json.required fields "userId" Json.string;
  }

and yojson_of_get_legacy_user_permissions_response :
    get_legacy_user_permissions_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("aiDataConsent", Some (Json.of_bool value.ai_data_consent));
      ("createdAt", Option.map Json.of_string value.created_at);
      ("email", Some (Json.of_string value.email));
      ("group", Option.map yojson_of_ab_group value.group);
      ("hasChromeExt", Some (Json.of_bool value.has_chrome_ext));
      ("hasTrialed", Some (Json.of_bool value.has_trialed));
      ("isAgent", Some (Json.of_bool value.is_agent));
      ("licenseStatus", Some (Json.of_string value.license_status));
      ("name", Option.map Json.of_string value.name);
      ("permissions", Some ((Json.of_list Json.of_string) value.permissions));
      ("referralCode", Some (Json.of_string value.referral_code));
      ("tutorialComplete", Some (Json.of_bool value.tutorial_complete));
      ("userId", Some (Json.of_string value.user_id));
    ]

let make_get_legacy_user_permissions_response ~(ai_data_consent : bool)
    ?created_at ~(email : string) ?group ~(has_chrome_ext : bool)
    ~(has_trialed : bool) ~(is_agent : bool) ~(license_status : string) ?name
    ~(permissions : string list) ~(referral_code : string)
    ~(tutorial_complete : bool) ~(user_id : string) () =
  ({
     ai_data_consent;
     created_at;
     email;
     group;
     has_chrome_ext;
     has_trialed;
     is_agent;
     license_status;
     name;
     permissions;
     referral_code;
     tutorial_complete;
     user_id;
   }
    : get_legacy_user_permissions_response)

type nonrec get_names_with_email_request_body = { user_ids : string list }

let get_names_with_email_request_body_of_yojson :
    Yojson.Safe.t -> get_names_with_email_request_body =
 fun json ->
  let fields = Json.obj json in
  { user_ids = Json.required fields "user_ids" (Json.list Json.string) }

and yojson_of_get_names_with_email_request_body :
    get_names_with_email_request_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("user_ids", Some ((Json.of_list Json.of_string) value.user_ids)) ]

let make_get_names_with_email_request_body ~(user_ids : string list) () =
  ({ user_ids } : get_names_with_email_request_body)

type nonrec get_profile_pictures_request_body = { user_id_list : string list }

let get_profile_pictures_request_body_of_yojson :
    Yojson.Safe.t -> get_profile_pictures_request_body =
 fun json ->
  let fields = Json.obj json in
  { user_id_list = Json.required fields "user_id_list" (Json.list Json.string) }

and yojson_of_get_profile_pictures_request_body :
    get_profile_pictures_request_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("user_id_list", Some ((Json.of_list Json.of_string) value.user_id_list));
    ]

let make_get_profile_pictures_request_body ~(user_id_list : string list) () =
  ({ user_id_list } : get_profile_pictures_request_body)

type nonrec get_user_info = {
  organization_id : int option;
      (** The user's organization id if there is one associated with the user *)
  permissions : string list;  (** The user's permissions *)
  user_id : string;  (** The user id *)
}

let get_user_info_of_yojson : Yojson.Safe.t -> get_user_info =
 fun json ->
  let fields = Json.obj json in
  {
    organization_id = Json.optional fields "organization_id" Json.int;
    permissions = Json.required fields "permissions" (Json.list Json.string);
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_get_user_info : get_user_info -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("organization_id", Option.map Json.of_int value.organization_id);
      ("permissions", Some ((Json.of_list Json.of_string) value.permissions));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_get_user_info ?organization_id ~(permissions : string list)
    ~(user_id : string) () =
  ({ organization_id; permissions; user_id } : get_user_info)

type nonrec github_link_status_response = {
  github_user_id : string;
      (** Stable ID of the authenticated user's linked GitHub account. *)
  github_username : string;
      (** Login of the authenticated user's linked GitHub account. *)
  reauthentication_required : bool;
      (** Whether the user must reauthenticate their GitHub link. *)
}

let github_link_status_response_of_yojson :
    Yojson.Safe.t -> github_link_status_response =
 fun json ->
  let fields = Json.obj json in
  {
    github_user_id = Json.required fields "github_user_id" Json.string;
    github_username = Json.required fields "github_username" Json.string;
    reauthentication_required =
      Json.required fields "reauthentication_required" Json.bool;
  }

and yojson_of_github_link_status_response :
    github_link_status_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("github_user_id", Some (Json.of_string value.github_user_id));
      ("github_username", Some (Json.of_string value.github_username));
      ( "reauthentication_required",
        Some (Json.of_bool value.reauthentication_required) );
    ]

let make_github_link_status_response ~(github_user_id : string)
    ~(github_username : string) ~(reauthentication_required : bool) () =
  ({ github_user_id; github_username; reauthentication_required }
    : github_link_status_response)

(** How GitHub combines a pull request's commits into its base branch. *)
type nonrec github_merge_method =
  | Merge
  | Squash
  | Rebase
  | Unknown of string  (** A value this SDK version does not know. *)

let github_merge_method_of_yojson : Yojson.Safe.t -> github_merge_method =
 fun json ->
  match Json.string json with
  | "merge" -> Merge
  | "squash" -> Squash
  | "rebase" -> Rebase
  | other -> Json.unknown "github_merge_method" json (Unknown other)

and yojson_of_github_merge_method : github_merge_method -> Yojson.Safe.t =
 fun value ->
  match value with
  | Merge -> `String "merge"
  | Squash -> `String "squash"
  | Rebase -> `String "rebase"
  | Unknown other -> `String other

(** Whether GitHub can merge a pull request's head into its base without conflicts. *)
type nonrec github_pull_request_mergeability =
  | Mergeable
  | Conflicting
  | Unknown_
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pull_request_mergeability_of_yojson :
    Yojson.Safe.t -> github_pull_request_mergeability =
 fun json ->
  match Json.string json with
  | "mergeable" -> Mergeable
  | "conflicting" -> Conflicting
  | "unknown" -> Unknown_
  | other ->
      Json.unknown "github_pull_request_mergeability" json (Unknown other)

and yojson_of_github_pull_request_mergeability :
    github_pull_request_mergeability -> Yojson.Safe.t =
 fun value ->
  match value with
  | Mergeable -> `String "mergeable"
  | Conflicting -> `String "conflicting"
  | Unknown_ -> `String "unknown"
  | Unknown other -> `String other

type nonrec github_pull_request_mergeability_entry = {
  mergeability : github_pull_request_mergeability;
      (** Whether the head merges cleanly into the base. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
}
(** One pull request's mergeability. *)

let github_pull_request_mergeability_entry_of_yojson :
    Yojson.Safe.t -> github_pull_request_mergeability_entry =
 fun json ->
  let fields = Json.obj json in
  {
    mergeability =
      Json.required fields "mergeability"
        github_pull_request_mergeability_of_yojson;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
  }

and yojson_of_github_pull_request_mergeability_entry :
    github_pull_request_mergeability_entry -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "mergeability",
        Some (yojson_of_github_pull_request_mergeability value.mergeability) );
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
    ]

let make_github_pull_request_mergeability_entry
    ~(mergeability : github_pull_request_mergeability) ~(number : int64)
    ~(owner : string) ~(repo : string) () =
  ({ mergeability; number; owner; repo }
    : github_pull_request_mergeability_entry)

type nonrec github_pull_request_number = {
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
}
(** One pull request, by repository and number. *)

let github_pull_request_number_of_yojson :
    Yojson.Safe.t -> github_pull_request_number =
 fun json ->
  let fields = Json.obj json in
  {
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
  }

and yojson_of_github_pull_request_number :
    github_pull_request_number -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
    ]

let make_github_pull_request_number ~(number : int64) ~(owner : string)
    ~(repo : string) () =
  ({ number; owner; repo } : github_pull_request_number)

type nonrec github_pull_request_mergeability_request = {
  pull_requests : github_pull_request_number list;
      (** The pull requests to check, at most \[[GithubPullRequestMergeabilityRequest::MAX]\]. *)
}
(** Request body for the mergeability of several pull requests. *)

let github_pull_request_mergeability_request_of_yojson :
    Yojson.Safe.t -> github_pull_request_mergeability_request =
 fun json ->
  let fields = Json.obj json in
  {
    pull_requests =
      Json.required fields "pullRequests"
        (Json.list github_pull_request_number_of_yojson);
  }

and yojson_of_github_pull_request_mergeability_request :
    github_pull_request_mergeability_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "pullRequests",
        Some
          ((Json.of_list yojson_of_github_pull_request_number)
             value.pull_requests) );
    ]

let make_github_pull_request_mergeability_request
    ~(pull_requests : github_pull_request_number list) () =
  ({ pull_requests } : github_pull_request_mergeability_request)

type nonrec github_pull_request_mergeability_response = {
  pull_requests : github_pull_request_mergeability_entry list;
      (** The mergeability of each visible pull request. *)
}
(** Response body for pull request mergeability. Pull requests the user
cannot see are left out. *)

let github_pull_request_mergeability_response_of_yojson :
    Yojson.Safe.t -> github_pull_request_mergeability_response =
 fun json ->
  let fields = Json.obj json in
  {
    pull_requests =
      Json.required fields "pullRequests"
        (Json.list github_pull_request_mergeability_entry_of_yojson);
  }

and yojson_of_github_pull_request_mergeability_response :
    github_pull_request_mergeability_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "pullRequests",
        Some
          ((Json.of_list yojson_of_github_pull_request_mergeability_entry)
             value.pull_requests) );
    ]

let make_github_pull_request_mergeability_response
    ~(pull_requests : github_pull_request_mergeability_entry list) () =
  ({ pull_requests } : github_pull_request_mergeability_response)

(** Whether a pull request is open or closed, as a user sets it. Merging is a
separate action, so unlike [GithubPullRequestStatus] there is no merged
state. *)
type nonrec github_pull_request_state =
  | Open
  | Closed
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pull_request_state_of_yojson :
    Yojson.Safe.t -> github_pull_request_state =
 fun json ->
  match Json.string json with
  | "open" -> Open
  | "closed" -> Closed
  | other -> Json.unknown "github_pull_request_state" json (Unknown other)

and yojson_of_github_pull_request_state :
    github_pull_request_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Open -> `String "open"
  | Closed -> `String "closed"
  | Unknown other -> `String other

type nonrec gmail_link_status_response = {
  reauthentication_required : bool;
      (** Whether the user must reauthenticate their Gmail link. *)
}

let gmail_link_status_response_of_yojson :
    Yojson.Safe.t -> gmail_link_status_response =
 fun json ->
  let fields = Json.obj json in
  {
    reauthentication_required =
      Json.required fields "reauthentication_required" Json.bool;
  }

and yojson_of_gmail_link_status_response :
    gmail_link_status_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "reauthentication_required",
        Some (Json.of_bool value.reauthentication_required) );
    ]

let make_gmail_link_status_response ~(reauthentication_required : bool) () =
  ({ reauthentication_required } : gmail_link_status_response)

(** Where a link is in its lifecycle. *)
type nonrec gtm_invite_link_status =
  | Active
  | Expired
  | Revoked
  | Redeemed
  | Converted
  | Unknown of string  (** A value this SDK version does not know. *)

let gtm_invite_link_status_of_yojson : Yojson.Safe.t -> gtm_invite_link_status =
 fun json ->
  match Json.string json with
  | "active" -> Active
  | "expired" -> Expired
  | "revoked" -> Revoked
  | "redeemed" -> Redeemed
  | "converted" -> Converted
  | other -> Json.unknown "gtm_invite_link_status" json (Unknown other)

and yojson_of_gtm_invite_link_status : gtm_invite_link_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Active -> `String "active"
  | Expired -> `String "expired"
  | Revoked -> `String "revoked"
  | Redeemed -> `String "redeemed"
  | Converted -> `String "converted"
  | Unknown other -> `String other

type nonrec gtm_invite_link = {
  converted_at : string option;
      (** When the account started a paid subscription. *)
  created_at : string;  (** When the link was created. *)
  created_by : string;
      (** The Macro user id of the staff member who created the link. *)
  expires_at : string;  (** When the link stops being openable. *)
  first_name : string;  (** The recipient's first name. *)
  first_opened_at : string option;  (** When the welcome page first loaded. *)
  free_months : int;  (** Free months the promotion grants. *)
  id : string;  (** Primary key. *)
  note : string option;  (** Internal note. *)
  open_count : int;  (** How many times the welcome page loaded. *)
  promo_code : string;  (** The Stripe promotion code applied at checkout. *)
  recipient_email : string option;  (** The recipient's email, when known. *)
  redeemed_at : string option;  (** When that account redeemed the link. *)
  redeemed_by : string option;
      (** The Macro user id of the account that signed up through the link. *)
  revoked_at : string option;  (** When staff revoked the link. *)
  status : gtm_invite_link_status;  (** Lifecycle status. *)
  stripe_subscription_id : string option;
      (** The Stripe subscription id of that subscription. *)
  token : string;  (** The secret to embed in the link URL. *)
}
(** A link as shown on the staff dashboard. *)

let gtm_invite_link_of_yojson : Yojson.Safe.t -> gtm_invite_link =
 fun json ->
  let fields = Json.obj json in
  {
    converted_at = Json.optional fields "convertedAt" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    created_by = Json.required fields "createdBy" Json.string;
    expires_at = Json.required fields "expiresAt" Json.string;
    first_name = Json.required fields "firstName" Json.string;
    first_opened_at = Json.optional fields "firstOpenedAt" Json.string;
    free_months = Json.required fields "freeMonths" Json.int;
    id = Json.required fields "id" Json.string;
    note = Json.optional fields "note" Json.string;
    open_count = Json.required fields "openCount" Json.int;
    promo_code = Json.required fields "promoCode" Json.string;
    recipient_email = Json.optional fields "recipientEmail" Json.string;
    redeemed_at = Json.optional fields "redeemedAt" Json.string;
    redeemed_by = Json.optional fields "redeemedBy" Json.string;
    revoked_at = Json.optional fields "revokedAt" Json.string;
    status = Json.required fields "status" gtm_invite_link_status_of_yojson;
    stripe_subscription_id =
      Json.optional fields "stripeSubscriptionId" Json.string;
    token = Json.required fields "token" Json.string;
  }

and yojson_of_gtm_invite_link : gtm_invite_link -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("convertedAt", Option.map Json.of_string value.converted_at);
      ("createdAt", Some (Json.of_string value.created_at));
      ("createdBy", Some (Json.of_string value.created_by));
      ("expiresAt", Some (Json.of_string value.expires_at));
      ("firstName", Some (Json.of_string value.first_name));
      ("firstOpenedAt", Option.map Json.of_string value.first_opened_at);
      ("freeMonths", Some (Json.of_int value.free_months));
      ("id", Some (Json.of_string value.id));
      ("note", Option.map Json.of_string value.note);
      ("openCount", Some (Json.of_int value.open_count));
      ("promoCode", Some (Json.of_string value.promo_code));
      ("recipientEmail", Option.map Json.of_string value.recipient_email);
      ("redeemedAt", Option.map Json.of_string value.redeemed_at);
      ("redeemedBy", Option.map Json.of_string value.redeemed_by);
      ("revokedAt", Option.map Json.of_string value.revoked_at);
      ("status", Some (yojson_of_gtm_invite_link_status value.status));
      ( "stripeSubscriptionId",
        Option.map Json.of_string value.stripe_subscription_id );
      ("token", Some (Json.of_string value.token));
    ]

let make_gtm_invite_link ?converted_at ~(created_at : string)
    ~(created_by : string) ~(expires_at : string) ~(first_name : string)
    ?first_opened_at ~(free_months : int) ~(id : string) ?note
    ~(open_count : int) ~(promo_code : string) ?recipient_email ?redeemed_at
    ?redeemed_by ?revoked_at ~(status : gtm_invite_link_status)
    ?stripe_subscription_id ~(token : string) () =
  ({
     converted_at;
     created_at;
     created_by;
     expires_at;
     first_name;
     first_opened_at;
     free_months;
     id;
     note;
     open_count;
     promo_code;
     recipient_email;
     redeemed_at;
     redeemed_by;
     revoked_at;
     status;
     stripe_subscription_id;
     token;
   }
    : gtm_invite_link)

type nonrec gtm_invite_link_list = {
  links : gtm_invite_link list;  (** Newest first. *)
}
(** Links for the dashboard. *)

let gtm_invite_link_list_of_yojson : Yojson.Safe.t -> gtm_invite_link_list =
 fun json ->
  let fields = Json.obj json in
  { links = Json.required fields "links" (Json.list gtm_invite_link_of_yojson) }

and yojson_of_gtm_invite_link_list : gtm_invite_link_list -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("links", Some ((Json.of_list yojson_of_gtm_invite_link) value.links)) ]

let make_gtm_invite_link_list ~(links : gtm_invite_link list) () =
  ({ links } : gtm_invite_link_list)

type nonrec gtm_invite_offer = {
  first_name : string;  (** The first name the link was made out to. *)
  free_months : int;  (** Free months the promotion grants. *)
  link_id : string;  (** The redeemed link. *)
  promo_code : string;  (** The Stripe promotion code checkout applies. *)
  redeemed_at : string;  (** When the account redeemed the link. *)
}
(** The promotion a signed-in user's account holds. *)

let gtm_invite_offer_of_yojson : Yojson.Safe.t -> gtm_invite_offer =
 fun json ->
  let fields = Json.obj json in
  {
    first_name = Json.required fields "firstName" Json.string;
    free_months = Json.required fields "freeMonths" Json.int;
    link_id = Json.required fields "linkId" Json.string;
    promo_code = Json.required fields "promoCode" Json.string;
    redeemed_at = Json.required fields "redeemedAt" Json.string;
  }

and yojson_of_gtm_invite_offer : gtm_invite_offer -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("firstName", Some (Json.of_string value.first_name));
      ("freeMonths", Some (Json.of_int value.free_months));
      ("linkId", Some (Json.of_string value.link_id));
      ("promoCode", Some (Json.of_string value.promo_code));
      ("redeemedAt", Some (Json.of_string value.redeemed_at));
    ]

let make_gtm_invite_offer ~(first_name : string) ~(free_months : int)
    ~(link_id : string) ~(promo_code : string) ~(redeemed_at : string) () =
  ({ first_name; free_months; link_id; promo_code; redeemed_at }
    : gtm_invite_offer)

type nonrec gtm_invite_offer_status = { offer : gtm_invite_offer option }
(** Whether the signed-in user holds an unused offer. *)

let gtm_invite_offer_status_of_yojson : Yojson.Safe.t -> gtm_invite_offer_status
    =
 fun json ->
  let fields = Json.obj json in
  { offer = Json.optional fields "offer" gtm_invite_offer_of_yojson }

and yojson_of_gtm_invite_offer_status : gtm_invite_offer_status -> Yojson.Safe.t
    =
 fun value ->
  Json.record [ ("offer", Option.map yojson_of_gtm_invite_offer value.offer) ]

let make_gtm_invite_offer_status ?offer () =
  ({ offer } : gtm_invite_offer_status)

type nonrec init_github_link_response = {
  authorization_url : string;
      (** The OAuth authorization URL to redirect the user to *)
  link_id : string;  (** The link ID for tracking the OAuth flow *)
}

let init_github_link_response_of_yojson :
    Yojson.Safe.t -> init_github_link_response =
 fun json ->
  let fields = Json.obj json in
  {
    authorization_url = Json.required fields "authorization_url" Json.string;
    link_id = Json.required fields "link_id" Json.string;
  }

and yojson_of_init_github_link_response :
    init_github_link_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("authorization_url", Some (Json.of_string value.authorization_url));
      ("link_id", Some (Json.of_string value.link_id));
    ]

let make_init_github_link_response ~(authorization_url : string)
    ~(link_id : string) () =
  ({ authorization_url; link_id } : init_github_link_response)

type nonrec init_gmail_link_response = {
  authorization_url : string;
      (** The OAuth authorization URL to redirect the user to *)
  link_id : string;  (** The link ID for tracking the OAuth flow *)
}

let init_gmail_link_response_of_yojson :
    Yojson.Safe.t -> init_gmail_link_response =
 fun json ->
  let fields = Json.obj json in
  {
    authorization_url = Json.required fields "authorization_url" Json.string;
    link_id = Json.required fields "link_id" Json.string;
  }

and yojson_of_init_gmail_link_response :
    init_gmail_link_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("authorization_url", Some (Json.of_string value.authorization_url));
      ("link_id", Some (Json.of_string value.link_id));
    ]

let make_init_gmail_link_response ~(authorization_url : string)
    ~(link_id : string) () =
  ({ authorization_url; link_id } : init_gmail_link_response)

type nonrec init_outlook_link_response = {
  authorization_url : string;
      (** The OAuth authorization URL to redirect the user to. *)
  link_id : string;  (** The link ID for tracking the OAuth flow. *)
}
(** Response returned when a Microsoft Outlook link is initiated. *)

let init_outlook_link_response_of_yojson :
    Yojson.Safe.t -> init_outlook_link_response =
 fun json ->
  let fields = Json.obj json in
  {
    authorization_url = Json.required fields "authorization_url" Json.string;
    link_id = Json.required fields "link_id" Json.string;
  }

and yojson_of_init_outlook_link_response :
    init_outlook_link_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("authorization_url", Some (Json.of_string value.authorization_url));
      ("link_id", Some (Json.of_string value.link_id));
    ]

let make_init_outlook_link_response ~(authorization_url : string)
    ~(link_id : string) () =
  ({ authorization_url; link_id } : init_outlook_link_response)

type nonrec invite_entry = {
  email : string;  (** The email of the user to invite *)
}
(** A single invite entry with email and tier *)

let invite_entry_of_yojson : Yojson.Safe.t -> invite_entry =
 fun json ->
  let fields = Json.obj json in
  { email = Json.required fields "email" Json.string }

and yojson_of_invite_entry : invite_entry -> Yojson.Safe.t =
 fun value -> Json.record [ ("email", Some (Json.of_string value.email)) ]

let make_invite_entry ~(email : string) () = ({ email } : invite_entry)

type nonrec invite_to_team_request = {
  invites : invite_entry list;
      (** The invites to send, each with an email and tier *)
  is_agent : bool option;
      (** Invite these addresses as agents: an address with no account signs up
as an agent and joins the team when it first signs in. *)
  team_id : string option;
      (** The team the caller means to invite to. Invites always go to the
caller's current team; when this names another team, nothing is sent
and the request answers 409. *)
}
(** The request body to invite a user to a team *)

let invite_to_team_request_of_yojson : Yojson.Safe.t -> invite_to_team_request =
 fun json ->
  let fields = Json.obj json in
  {
    invites = Json.required fields "invites" (Json.list invite_entry_of_yojson);
    is_agent = Json.optional fields "is_agent" Json.bool;
    team_id = Json.optional fields "team_id" Json.string;
  }

and yojson_of_invite_to_team_request : invite_to_team_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("invites", Some ((Json.of_list yojson_of_invite_entry) value.invites));
      ("is_agent", Option.map Json.of_bool value.is_agent);
      ("team_id", Option.map Json.of_string value.team_id);
    ]

let make_invite_to_team_request ~(invites : invite_entry list) ?is_agent
    ?team_id () =
  ({ invites; is_agent; team_id } : invite_to_team_request)

type nonrec join_team_by_invite_link_response = {
  already_member : bool;
      (** True when the user was already on the team and nothing changed. *)
  team_id : string;  (** The team the link joins. *)
}
(** The result of opening a team invite link. *)

let join_team_by_invite_link_response_of_yojson :
    Yojson.Safe.t -> join_team_by_invite_link_response =
 fun json ->
  let fields = Json.obj json in
  {
    already_member = Json.required fields "already_member" Json.bool;
    team_id = Json.required fields "team_id" Json.string;
  }

and yojson_of_join_team_by_invite_link_response :
    join_team_by_invite_link_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("already_member", Some (Json.of_bool value.already_member));
      ("team_id", Some (Json.of_string value.team_id));
    ]

let make_join_team_by_invite_link_response ~(already_member : bool)
    ~(team_id : string) () =
  ({ already_member; team_id } : join_team_by_invite_link_response)

(** A language the app's interface is available in, as a BCP 47 tag. *)
type nonrec language =
  | En
  | De
  | Fr
  | Es
  | It
  | Nl
  | Pt_pt
  | Sv
  | Da
  | Nb
  | Fi
  | Pl
  | Ru
  | Ja
  | Ko
  | Zh_hans
  | Zh_hant
  | Hi
  | Id
  | Vi
  | Th
  | Unknown of string  (** A value this SDK version does not know. *)

let language_of_yojson : Yojson.Safe.t -> language =
 fun json ->
  match Json.string json with
  | "en" -> En
  | "de" -> De
  | "fr" -> Fr
  | "es" -> Es
  | "it" -> It
  | "nl" -> Nl
  | "pt-PT" -> Pt_pt
  | "sv" -> Sv
  | "da" -> Da
  | "nb" -> Nb
  | "fi" -> Fi
  | "pl" -> Pl
  | "ru" -> Ru
  | "ja" -> Ja
  | "ko" -> Ko
  | "zh-Hans" -> Zh_hans
  | "zh-Hant" -> Zh_hant
  | "hi" -> Hi
  | "id" -> Id
  | "vi" -> Vi
  | "th" -> Th
  | other -> Json.unknown "language" json (Unknown other)

and yojson_of_language : language -> Yojson.Safe.t =
 fun value ->
  match value with
  | En -> `String "en"
  | De -> `String "de"
  | Fr -> `String "fr"
  | Es -> `String "es"
  | It -> `String "it"
  | Nl -> `String "nl"
  | Pt_pt -> `String "pt-PT"
  | Sv -> `String "sv"
  | Da -> `String "da"
  | Nb -> `String "nb"
  | Fi -> `String "fi"
  | Pl -> `String "pl"
  | Ru -> `String "ru"
  | Ja -> `String "ja"
  | Ko -> `String "ko"
  | Zh_hans -> `String "zh-Hans"
  | Zh_hant -> `String "zh-Hant"
  | Hi -> `String "hi"
  | Id -> `String "id"
  | Vi -> `String "vi"
  | Th -> `String "th"
  | Unknown other -> `String other

(** Defines who can access an item through its share link. *)
type nonrec link_share =
  | Public
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

let link_share_of_yojson : Yojson.Safe.t -> link_share =
 fun json ->
  match Json.string json with
  | "PUBLIC" -> Public
  | "TEAM" -> Team
  | other -> Json.unknown "link_share" json (Unknown other)

and yojson_of_link_share : link_share -> Yojson.Safe.t =
 fun value ->
  match value with
  | Public -> `String "PUBLIC"
  | Team -> `String "TEAM"
  | Unknown other -> `String other

type nonrec macro_api_token_response = {
  macro_api_token : string;  (** The newly created macro_api_token *)
}

let macro_api_token_response_of_yojson :
    Yojson.Safe.t -> macro_api_token_response =
 fun json ->
  let fields = Json.obj json in
  { macro_api_token = Json.required fields "macro_api_token" Json.string }

and yojson_of_macro_api_token_response :
    macro_api_token_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("macro_api_token", Some (Json.of_string value.macro_api_token)) ]

let make_macro_api_token_response ~(macro_api_token : string) () =
  ({ macro_api_token } : macro_api_token_response)

type nonrec merge_github_pull_request_request = {
  merge_method : github_merge_method option;
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
}
(** A request to merge one pull request on the user's behalf. *)

let merge_github_pull_request_request_of_yojson :
    Yojson.Safe.t -> merge_github_pull_request_request =
 fun json ->
  let fields = Json.obj json in
  {
    merge_method =
      Json.optional fields "mergeMethod" github_merge_method_of_yojson;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
  }

and yojson_of_merge_github_pull_request_request :
    merge_github_pull_request_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "mergeMethod",
        Option.map yojson_of_github_merge_method value.merge_method );
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
    ]

let make_merge_github_pull_request_request ?merge_method ~(number : int64)
    ~(owner : string) ~(repo : string) () =
  ({ merge_method; number; owner; repo } : merge_github_pull_request_request)

type nonrec merge_github_pull_request_response = {
  message : string;  (** GitHub's own summary of the merge. *)
  pull_request : enriched_github_pull_request option;
  sha : string;  (** The merge commit's SHA. *)
}
(** Response body for a merged pull request. *)

let merge_github_pull_request_response_of_yojson :
    Yojson.Safe.t -> merge_github_pull_request_response =
 fun json ->
  let fields = Json.obj json in
  {
    message = Json.required fields "message" Json.string;
    pull_request =
      Json.optional fields "pullRequest" enriched_github_pull_request_of_yojson;
    sha = Json.required fields "sha" Json.string;
  }

and yojson_of_merge_github_pull_request_response :
    merge_github_pull_request_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("message", Some (Json.of_string value.message));
      ( "pullRequest",
        Option.map yojson_of_enriched_github_pull_request value.pull_request );
      ("sha", Some (Json.of_string value.sha));
    ]

let make_merge_github_pull_request_response ~(message : string) ?pull_request
    ~(sha : string) () =
  ({ message; pull_request; sha } : merge_github_pull_request_response)

type nonrec password_request = {
  email : string;  (** The email to login with *)
  password : string;
}

let password_request_of_yojson : Yojson.Safe.t -> password_request =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    password = Json.required fields "password" Json.string;
  }

and yojson_of_password_request : password_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("password", Some (Json.of_string value.password));
    ]

let make_password_request ~(email : string) ~(password : string) () =
  ({ email; password } : password_request)

type nonrec passwordless_request = {
  email : string;  (** The email to initiate passwordless authentication for *)
  is_agent : bool option;
      (** Create an agent account if this address has no account yet. Otherwise
[true] has no effect, and [false] reverts an agent flag nobody has proven:
see [revert_unconfirmed_agent]. *)
  redirect_uri : string;  (** The redirect uri to redirect to after login *)
  referral_code : string option;  (** The referral code *)
}

let passwordless_request_of_yojson : Yojson.Safe.t -> passwordless_request =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    is_agent = Json.optional fields "is_agent" Json.bool;
    redirect_uri = Json.required fields "redirect_uri" Json.string;
    referral_code = Json.optional fields "referral_code" Json.string;
  }

and yojson_of_passwordless_request : passwordless_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("is_agent", Option.map Json.of_bool value.is_agent);
      ("redirect_uri", Some (Json.of_string value.redirect_uri));
      ("referral_code", Option.map Json.of_string value.referral_code);
    ]

let make_passwordless_request ~(email : string) ?is_agent
    ~(redirect_uri : string) ?referral_code () =
  ({ email; is_agent; redirect_uri; referral_code } : passwordless_request)

type nonrec passwordless_started_response = {
  code : string option;
      (** The one-time login code, returned only by local environments so dev
tooling can complete the flow without reading the email. *)
}

let passwordless_started_response_of_yojson :
    Yojson.Safe.t -> passwordless_started_response =
 fun json ->
  let fields = Json.obj json in
  { code = Json.optional fields "code" Json.string }

and yojson_of_passwordless_started_response :
    passwordless_started_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("code", Option.map Json.of_string value.code) ]

let make_passwordless_started_response ?code () =
  ({ code } : passwordless_started_response)

type nonrec patch_team_crm_settings_request = {
  backfill : bool option;
      (** Retained for compatibility and ignored. Email backfill requires
each member's explicit consent through CRM email privacy settings. *)
  enabled : bool;
      (** Legacy compatibility flag. True is a no-op; false is rejected. *)
}
(** Request body for [PATCH /team/crm]. *)

let patch_team_crm_settings_request_of_yojson :
    Yojson.Safe.t -> patch_team_crm_settings_request =
 fun json ->
  let fields = Json.obj json in
  {
    backfill = Json.optional fields "backfill" Json.bool;
    enabled = Json.required fields "enabled" Json.bool;
  }

and yojson_of_patch_team_crm_settings_request :
    patch_team_crm_settings_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("backfill", Option.map Json.of_bool value.backfill);
      ("enabled", Some (Json.of_bool value.enabled));
    ]

let make_patch_team_crm_settings_request ?backfill ~(enabled : bool) () =
  ({ backfill; enabled } : patch_team_crm_settings_request)

type nonrec patch_team_crm_settings_response = {
  backfill_enqueued : int;
      (** Always zero: mailbox contributions require individual consent. *)
  backfill_failed : int;
      (** Always zero: this endpoint does not enqueue backfills. *)
  changed : bool;
      (** Always false: the legacy command does not change availability. *)
  enabled : bool;  (** Always true: CRM records are available to team members. *)
}
(** Compatibility response for [PATCH /team/crm]. CRM records are always
available; this endpoint does not enroll mailboxes or backfill emails. *)

let patch_team_crm_settings_response_of_yojson :
    Yojson.Safe.t -> patch_team_crm_settings_response =
 fun json ->
  let fields = Json.obj json in
  {
    backfill_enqueued = Json.required fields "backfill_enqueued" Json.int;
    backfill_failed = Json.required fields "backfill_failed" Json.int;
    changed = Json.required fields "changed" Json.bool;
    enabled = Json.required fields "enabled" Json.bool;
  }

and yojson_of_patch_team_crm_settings_response :
    patch_team_crm_settings_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("backfill_enqueued", Some (Json.of_int value.backfill_enqueued));
      ("backfill_failed", Some (Json.of_int value.backfill_failed));
      ("changed", Some (Json.of_bool value.changed));
      ("enabled", Some (Json.of_bool value.enabled));
    ]

let make_patch_team_crm_settings_response ~(backfill_enqueued : int)
    ~(backfill_failed : int) ~(changed : bool) ~(enabled : bool) () =
  ({ backfill_enqueued; backfill_failed; changed; enabled }
    : patch_team_crm_settings_response)

type nonrec patch_team_member_plan_request = {
  plan : seat_plan;  (** The plan to bill the member's seat at from now on. *)
}
(** Request body for [PATCH /team/members/{member_user_id}/plan]. *)

let patch_team_member_plan_request_of_yojson :
    Yojson.Safe.t -> patch_team_member_plan_request =
 fun json ->
  let fields = Json.obj json in
  { plan = Json.required fields "plan" seat_plan_of_yojson }

and yojson_of_patch_team_member_plan_request :
    patch_team_member_plan_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("plan", Some (yojson_of_seat_plan value.plan)) ]

let make_patch_team_member_plan_request ~(plan : seat_plan) () =
  ({ plan } : patch_team_member_plan_request)

(** Ordered from least to most access top -> bottom *)
type nonrec team_role =
  | Member
  | Admin
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

let team_role_of_yojson : Yojson.Safe.t -> team_role =
 fun json ->
  match Json.string json with
  | "member" -> Member
  | "admin" -> Admin
  | "owner" -> Owner
  | other -> Json.unknown "team_role" json (Unknown other)

and yojson_of_team_role : team_role -> Yojson.Safe.t =
 fun value ->
  match value with
  | Member -> `String "member"
  | Admin -> `String "admin"
  | Owner -> `String "owner"
  | Unknown other -> `String other

type nonrec patch_team_user_role = {
  role : team_role;  (** The new role of the team user *)
  team_user_id : string;  (** The team user you are updating *)
}
(** Request to update a team user's role *)

let patch_team_user_role_of_yojson : Yojson.Safe.t -> patch_team_user_role =
 fun json ->
  let fields = Json.obj json in
  {
    role = Json.required fields "role" team_role_of_yojson;
    team_user_id = Json.required fields "team_user_id" Json.string;
  }

and yojson_of_patch_team_user_role : patch_team_user_role -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("role", Some (yojson_of_team_role value.role));
      ("team_user_id", Some (Json.of_string value.team_user_id));
    ]

let make_patch_team_user_role ~(role : team_role) ~(team_user_id : string) () =
  ({ role; team_user_id } : patch_team_user_role)

type nonrec patch_team_request = {
  default_link_share : link_share option;
  language : language option;
  name : string option;  (** The new name for the team *)
  slug : string option;
      (** The new slug for the team. This is normalized to SCREAMING_SNAKE_CASE. *)
  user_role_updates : patch_team_user_role list option;
      (** Role updates to apply to team users *)
}
(** Request to update a team *)

let patch_team_request_of_yojson : Yojson.Safe.t -> patch_team_request =
 fun json ->
  let fields = Json.obj json in
  {
    default_link_share =
      Json.optional fields "default_link_share" link_share_of_yojson;
    language = Json.optional fields "language" language_of_yojson;
    name = Json.optional fields "name" Json.string;
    slug = Json.optional fields "slug" Json.string;
    user_role_updates =
      Json.optional fields "user_role_updates"
        (Json.list patch_team_user_role_of_yojson);
  }

and yojson_of_patch_team_request : patch_team_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "default_link_share",
        Option.map yojson_of_link_share value.default_link_share );
      ("language", Option.map yojson_of_language value.language);
      ("name", Option.map Json.of_string value.name);
      ("slug", Option.map Json.of_string value.slug);
      ( "user_role_updates",
        Option.map
          (Json.of_list yojson_of_patch_team_user_role)
          value.user_role_updates );
    ]

let make_patch_team_request ?default_link_share ?language ?name ?slug
    ?user_role_updates () =
  ({ default_link_share; language; name; slug; user_role_updates }
    : patch_team_request)

type nonrec patch_user_group_request = {
  group : string;  (** The group to add the user to *)
}

let patch_user_group_request_of_yojson :
    Yojson.Safe.t -> patch_user_group_request =
 fun json ->
  let fields = Json.obj json in
  { group = Json.required fields "group" Json.string }

and yojson_of_patch_user_group_request :
    patch_user_group_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("group", Some (Json.of_string value.group)) ]

let make_patch_user_group_request ~(group : string) () =
  ({ group } : patch_user_group_request)

type nonrec patch_user_onboarding_request = {
  first_name : string;  (** The first name of the user *)
  industry : string;  (** The industry of the user *)
  last_name : string;  (** The last name of the user *)
  title : string;  (** The title of the user *)
}

let patch_user_onboarding_request_of_yojson :
    Yojson.Safe.t -> patch_user_onboarding_request =
 fun json ->
  let fields = Json.obj json in
  {
    first_name = Json.required fields "firstName" Json.string;
    industry = Json.required fields "industry" Json.string;
    last_name = Json.required fields "lastName" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_patch_user_onboarding_request :
    patch_user_onboarding_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("firstName", Some (Json.of_string value.first_name));
      ("industry", Some (Json.of_string value.industry));
      ("lastName", Some (Json.of_string value.last_name));
      ("title", Some (Json.of_string value.title));
    ]

let make_patch_user_onboarding_request ~(first_name : string)
    ~(industry : string) ~(last_name : string) ~(title : string) () =
  ({ first_name; industry; last_name; title } : patch_user_onboarding_request)

type nonrec patch_user_tutorial_request = {
  tutorial_complete : bool;  (** If the user has completed the tutorial *)
}

let patch_user_tutorial_request_of_yojson :
    Yojson.Safe.t -> patch_user_tutorial_request =
 fun json ->
  let fields = Json.obj json in
  { tutorial_complete = Json.required fields "tutorialComplete" Json.bool }

and yojson_of_patch_user_tutorial_request :
    patch_user_tutorial_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("tutorialComplete", Some (Json.of_bool value.tutorial_complete)) ]

let make_patch_user_tutorial_request ~(tutorial_complete : bool) () =
  ({ tutorial_complete } : patch_user_tutorial_request)

type nonrec permission = {
  description : string;  (** The description of the permission *)
  id : string;  (** The permission *)
}

let permission_of_yojson : Yojson.Safe.t -> permission =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.required fields "description" Json.string;
    id = Json.required fields "id" Json.string;
  }

and yojson_of_permission : permission -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Some (Json.of_string value.description));
      ("id", Some (Json.of_string value.id));
    ]

let make_permission ~(description : string) ~(id : string) () =
  ({ description; id } : permission)

type nonrec plan_catalog_entry = {
  auto_reload_default_monthly_limit_cents : int64 option;
      (** Monthly automatic reload limit a payer on this plan starts from,
cents. Absent for plans that cannot reload. *)
  included_ai_cents_per_seat : int64;
      (** Included AI per seat per period, in cents at provider cost. For the
free plan this is its monthly hard cap. *)
  monthly_price_cents : int64;
      (** Monthly subscription price per seat, cents. *)
  purchasable : bool;
      (** Whether a new purchase or plan move may pick this plan today. *)
  tier : plan_tier;  (** The tier. *)
}
(** One plan in the catalog. *)

let plan_catalog_entry_of_yojson : Yojson.Safe.t -> plan_catalog_entry =
 fun json ->
  let fields = Json.obj json in
  {
    auto_reload_default_monthly_limit_cents =
      Json.optional fields "auto_reload_default_monthly_limit_cents" Json.int64;
    included_ai_cents_per_seat =
      Json.required fields "included_ai_cents_per_seat" Json.int64;
    monthly_price_cents = Json.required fields "monthly_price_cents" Json.int64;
    purchasable = Json.required fields "purchasable" Json.bool;
    tier = Json.required fields "tier" plan_tier_of_yojson;
  }

and yojson_of_plan_catalog_entry : plan_catalog_entry -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "auto_reload_default_monthly_limit_cents",
        Option.map Json.of_int64 value.auto_reload_default_monthly_limit_cents
      );
      ( "included_ai_cents_per_seat",
        Some (Json.of_int64 value.included_ai_cents_per_seat) );
      ("monthly_price_cents", Some (Json.of_int64 value.monthly_price_cents));
      ("purchasable", Some (Json.of_bool value.purchasable));
      ("tier", Some (yojson_of_plan_tier value.tier));
    ]

let make_plan_catalog_entry ?auto_reload_default_monthly_limit_cents
    ~(included_ai_cents_per_seat : int64) ~(monthly_price_cents : int64)
    ~(purchasable : bool) ~(tier : plan_tier) () =
  ({
     auto_reload_default_monthly_limit_cents;
     included_ai_cents_per_seat;
     monthly_price_cents;
     purchasable;
     tier;
   }
    : plan_catalog_entry)

type nonrec plan_catalog_response = {
  auto_reload_defaults : auto_reload_defaults;
      (** Thresholds automatic reload starts from before the payer sets their own. *)
  auto_reload_target_max_cents : int64;
      (** Largest allowed automatic reload target, cents. *)
  credit_packs_cents : int64 list;  (** Credit packs a payer may buy, cents. *)
  overage_limit_max_cents : int64;  (** Largest allowed overage cap, cents. *)
  overage_limit_min_cents : int64;  (** Smallest allowed overage cap, cents. *)
  plans : plan_catalog_entry list;
      (** Every plan, cheapest first. Clients read allowances from here rather
than hard-coding them; [purchasable] marks the plans a user can buy. *)
}
(** The plan catalog and the knobs the billing UI offers. *)

let plan_catalog_response_of_yojson : Yojson.Safe.t -> plan_catalog_response =
 fun json ->
  let fields = Json.obj json in
  {
    auto_reload_defaults =
      Json.required fields "auto_reload_defaults" auto_reload_defaults_of_yojson;
    auto_reload_target_max_cents =
      Json.required fields "auto_reload_target_max_cents" Json.int64;
    credit_packs_cents =
      Json.required fields "credit_packs_cents" (Json.list Json.int64);
    overage_limit_max_cents =
      Json.required fields "overage_limit_max_cents" Json.int64;
    overage_limit_min_cents =
      Json.required fields "overage_limit_min_cents" Json.int64;
    plans =
      Json.required fields "plans" (Json.list plan_catalog_entry_of_yojson);
  }

and yojson_of_plan_catalog_response : plan_catalog_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "auto_reload_defaults",
        Some (yojson_of_auto_reload_defaults value.auto_reload_defaults) );
      ( "auto_reload_target_max_cents",
        Some (Json.of_int64 value.auto_reload_target_max_cents) );
      ( "credit_packs_cents",
        Some ((Json.of_list Json.of_int64) value.credit_packs_cents) );
      ( "overage_limit_max_cents",
        Some (Json.of_int64 value.overage_limit_max_cents) );
      ( "overage_limit_min_cents",
        Some (Json.of_int64 value.overage_limit_min_cents) );
      ("plans", Some ((Json.of_list yojson_of_plan_catalog_entry) value.plans));
    ]

let make_plan_catalog_response ~(auto_reload_defaults : auto_reload_defaults)
    ~(auto_reload_target_max_cents : int64) ~(credit_packs_cents : int64 list)
    ~(overage_limit_max_cents : int64) ~(overage_limit_min_cents : int64)
    ~(plans : plan_catalog_entry list) () =
  ({
     auto_reload_defaults;
     auto_reload_target_max_cents;
     credit_packs_cents;
     overage_limit_max_cents;
     overage_limit_min_cents;
     plans;
   }
    : plan_catalog_response)

type nonrec post_get_names_request_body = { user_ids : string list }

let post_get_names_request_body_of_yojson :
    Yojson.Safe.t -> post_get_names_request_body =
 fun json ->
  let fields = Json.obj json in
  { user_ids = Json.required fields "user_ids" (Json.list Json.string) }

and yojson_of_post_get_names_request_body :
    post_get_names_request_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("user_ids", Some ((Json.of_list Json.of_string) value.user_ids)) ]

let make_post_get_names_request_body ~(user_ids : string list) () =
  ({ user_ids } : post_get_names_request_body)

type nonrec power_body = { on : bool  (** Requested power state. *) }
(** Body of a power change. *)

let power_body_of_yojson : Yojson.Safe.t -> power_body =
 fun json ->
  let fields = Json.obj json in
  { on = Json.required fields "on" Json.bool }

and yojson_of_power_body : power_body -> Yojson.Safe.t =
 fun value -> Json.record [ ("on", Some (Json.of_bool value.on)) ]

let make_power_body ~(on : bool) () = ({ on } : power_body)

type nonrec profile_picture_query_params = { url : string }

let profile_picture_query_params_of_yojson :
    Yojson.Safe.t -> profile_picture_query_params =
 fun json ->
  let fields = Json.obj json in
  { url = Json.required fields "url" Json.string }

and yojson_of_profile_picture_query_params :
    profile_picture_query_params -> Yojson.Safe.t =
 fun value -> Json.record [ ("url", Some (Json.of_string value.url)) ]

let make_profile_picture_query_params ~(url : string) () =
  ({ url } : profile_picture_query_params)

type nonrec profile_picture_upload = {
  file_id : string;
      (** Id to pass to [PUT /user/profile_picture/file] once uploaded. *)
  upload_url : string;  (** Expiring URL to [PUT] the image bytes to. *)
}
(** Where to upload a new profile picture, and the file id to set afterwards. *)

let profile_picture_upload_of_yojson : Yojson.Safe.t -> profile_picture_upload =
 fun json ->
  let fields = Json.obj json in
  {
    file_id = Json.required fields "file_id" Json.string;
    upload_url = Json.required fields "upload_url" Json.string;
  }

and yojson_of_profile_picture_upload : profile_picture_upload -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("file_id", Some (Json.of_string value.file_id));
      ("upload_url", Some (Json.of_string value.upload_url));
    ]

let make_profile_picture_upload ~(file_id : string) ~(upload_url : string) () =
  ({ file_id; upload_url } : profile_picture_upload)

type nonrec user_profile_picture = {
  checksum : string option;
  id : string;
  url : string;
}

let user_profile_picture_of_yojson : Yojson.Safe.t -> user_profile_picture =
 fun json ->
  let fields = Json.obj json in
  {
    checksum = Json.optional fields "checksum" Json.string;
    id = Json.required fields "id" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_user_profile_picture : user_profile_picture -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("checksum", Option.map Json.of_string value.checksum);
      ("id", Some (Json.of_string value.id));
      ("url", Some (Json.of_string value.url));
    ]

let make_user_profile_picture ?checksum ~(id : string) ~(url : string) () =
  ({ checksum; id; url } : user_profile_picture)

type nonrec profile_pictures = { pictures : user_profile_picture list }

let profile_pictures_of_yojson : Yojson.Safe.t -> profile_pictures =
 fun json ->
  let fields = Json.obj json in
  {
    pictures =
      Json.required fields "pictures" (Json.list user_profile_picture_of_yojson);
  }

and yojson_of_profile_pictures : profile_pictures -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "pictures",
        Some ((Json.of_list yojson_of_user_profile_picture) value.pictures) );
    ]

let make_profile_pictures ~(pictures : user_profile_picture list) () =
  ({ pictures } : profile_pictures)

type nonrec public_gtm_invite_link = {
  first_name : string;  (** The recipient's first name. *)
  free_months : int;  (** Free months the promotion grants. *)
  status : gtm_invite_link_status;  (** Whether the link can still be used. *)
}
(** What the public welcome page learns about a link. *)

let public_gtm_invite_link_of_yojson : Yojson.Safe.t -> public_gtm_invite_link =
 fun json ->
  let fields = Json.obj json in
  {
    first_name = Json.required fields "firstName" Json.string;
    free_months = Json.required fields "freeMonths" Json.int;
    status = Json.required fields "status" gtm_invite_link_status_of_yojson;
  }

and yojson_of_public_gtm_invite_link : public_gtm_invite_link -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("firstName", Some (Json.of_string value.first_name));
      ("freeMonths", Some (Json.of_int value.free_months));
      ("status", Some (yojson_of_gtm_invite_link_status value.status));
    ]

let make_public_gtm_invite_link ~(first_name : string) ~(free_months : int)
    ~(status : gtm_invite_link_status) () =
  ({ first_name; free_months; status } : public_gtm_invite_link)

type nonrec purchase_body = {
  name : string option;  (** Display name. *)
  purchase_key : string;
      (** The client's key for this purchase: one per Buy dialog, sent again
when the purchase is retried, so a retry never charges twice. *)
  size : computer_size;  (** Purchased catalog size. *)
}
(** Body of a team purchase. *)

let purchase_body_of_yojson : Yojson.Safe.t -> purchase_body =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.optional fields "name" Json.string;
    purchase_key = Json.required fields "purchaseKey" Json.string;
    size = Json.required fields "size" computer_size_of_yojson;
  }

and yojson_of_purchase_body : purchase_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Option.map Json.of_string value.name);
      ("purchaseKey", Some (Json.of_string value.purchase_key));
      ("size", Some (yojson_of_computer_size value.size));
    ]

let make_purchase_body ?name ~(purchase_key : string) ~(size : computer_size) ()
    =
  ({ name; purchase_key; size } : purchase_body)

(** Where a purchase stands when its request returns. *)
type nonrec purchase_state =
  | Ready
  | Confirming
  | Unknown of string  (** A value this SDK version does not know. *)

let purchase_state_of_yojson : Yojson.Safe.t -> purchase_state =
 fun json ->
  match Json.string json with
  | "ready" -> Ready
  | "confirming" -> Confirming
  | other -> Json.unknown "purchase_state" json (Unknown other)

and yojson_of_purchase_state : purchase_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Ready -> `String "ready"
  | Confirming -> `String "confirming"
  | Unknown other -> `String other

type nonrec purchased = {
  computer_id : string;  (** Computer this operation addresses. *)
  state : purchase_state;  (** Whether the computer exists yet. *)
}
(** Answer of a purchase. *)

let purchased_of_yojson : Yojson.Safe.t -> purchased =
 fun json ->
  let fields = Json.obj json in
  {
    computer_id = Json.required fields "computerId" Json.string;
    state = Json.required fields "state" purchase_state_of_yojson;
  }

and yojson_of_purchased : purchased -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("computerId", Some (Json.of_string value.computer_id));
      ("state", Some (yojson_of_purchase_state value.state));
    ]

let make_purchased ~(computer_id : string) ~(state : purchase_state) () =
  ({ computer_id; state } : purchased)

type nonrec put_agent_api_key_request = {
  api_key : string;
      (** An Anthropic ([sk-ant-…]) or OpenAI ([sk-…]) key, for the provider of
the agent's model. *)
}
(** The key someone pasted. *)

let put_agent_api_key_request_of_yojson :
    Yojson.Safe.t -> put_agent_api_key_request =
 fun json ->
  let fields = Json.obj json in
  { api_key = Json.required fields "apiKey" Json.string }

and yojson_of_put_agent_api_key_request :
    put_agent_api_key_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("apiKey", Some (Json.of_string value.api_key)) ]

let make_put_agent_api_key_request ~(api_key : string) () =
  ({ api_key } : put_agent_api_key_request)

type nonrec put_cursor_api_key_request = {
  api_key : string;
      (** A Cursor API key: [grok_…], or [crsr_…] for older keys. *)
}
(** The key the user pasted. *)

let put_cursor_api_key_request_of_yojson :
    Yojson.Safe.t -> put_cursor_api_key_request =
 fun json ->
  let fields = Json.obj json in
  { api_key = Json.required fields "apiKey" Json.string }

and yojson_of_put_cursor_api_key_request :
    put_cursor_api_key_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("apiKey", Some (Json.of_string value.api_key)) ]

let make_put_cursor_api_key_request ~(api_key : string) () =
  ({ api_key } : put_cursor_api_key_request)

type nonrec put_cursor_default_model_request = {
  effort : string option;
      (** The value of the model's reasoning-effort parameter (e.g. [high]), or
[null] for the model's own default. Ignored without a model. *)
  model_id : string option;
      (** A Cursor model id (e.g. [grok-4.6]), or [null] to clear the choice and
fall back to the deployment default. *)
}
(** The model the user chose for their sessions, and its effort. *)

let put_cursor_default_model_request_of_yojson :
    Yojson.Safe.t -> put_cursor_default_model_request =
 fun json ->
  let fields = Json.obj json in
  {
    effort = Json.optional fields "effort" Json.string;
    model_id = Json.optional fields "modelId" Json.string;
  }

and yojson_of_put_cursor_default_model_request :
    put_cursor_default_model_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("effort", Option.map Json.of_string value.effort);
      ("modelId", Option.map Json.of_string value.model_id);
    ]

let make_put_cursor_default_model_request ?effort ?model_id () =
  ({ effort; model_id } : put_cursor_default_model_request)

type nonrec put_profile_picture_file_request = {
  file_id : string;
      (** Id of an image the caller uploaded to static file storage. *)
}

let put_profile_picture_file_request_of_yojson :
    Yojson.Safe.t -> put_profile_picture_file_request =
 fun json ->
  let fields = Json.obj json in
  { file_id = Json.required fields "file_id" Json.string }

and yojson_of_put_profile_picture_file_request :
    put_profile_picture_file_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("file_id", Some (Json.of_string value.file_id)) ]

let make_put_profile_picture_file_request ~(file_id : string) () =
  ({ file_id } : put_profile_picture_file_request)

type nonrec put_user_name_query_params = {
  first_name : string option;  (** First Name of user *)
  last_name : string option;  (** Last Name of user *)
}

let put_user_name_query_params_of_yojson :
    Yojson.Safe.t -> put_user_name_query_params =
 fun json ->
  let fields = Json.obj json in
  {
    first_name = Json.optional fields "first_name" Json.string;
    last_name = Json.optional fields "last_name" Json.string;
  }

and yojson_of_put_user_name_query_params :
    put_user_name_query_params -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("first_name", Option.map Json.of_string value.first_name);
      ("last_name", Option.map Json.of_string value.last_name);
    ]

let make_put_user_name_query_params ?first_name ?last_name () =
  ({ first_name; last_name } : put_user_name_query_params)

type nonrec quote = {
  amount : int64;  (** In the currency's smallest unit. *)
  currency : string;  (** Billing currency code. *)
  interval : billing_interval;  (** Subscription billing interval. *)
  price_id : string;  (** Stripe price saved for billing replay. *)
  size : computer_size;  (** Purchased catalog size. *)
}
(** What one computer of a size costs the team. *)

let quote_of_yojson : Yojson.Safe.t -> quote =
 fun json ->
  let fields = Json.obj json in
  {
    amount = Json.required fields "amount" Json.int64;
    currency = Json.required fields "currency" Json.string;
    interval = Json.required fields "interval" billing_interval_of_yojson;
    price_id = Json.required fields "priceId" Json.string;
    size = Json.required fields "size" computer_size_of_yojson;
  }

and yojson_of_quote : quote -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("amount", Some (Json.of_int64 value.amount));
      ("currency", Some (Json.of_string value.currency));
      ("interval", Some (yojson_of_billing_interval value.interval));
      ("priceId", Some (Json.of_string value.price_id));
      ("size", Some (yojson_of_computer_size value.size));
    ]

let make_quote ~(amount : int64) ~(currency : string)
    ~(interval : billing_interval) ~(price_id : string) ~(size : computer_size)
    () =
  ({ amount; currency; interval; price_id; size } : quote)

type nonrec redeem_gtm_invite_link_request = {
  token : string;  (** The token from the link URL. *)
}
(** Request body to redeem a link. *)

let redeem_gtm_invite_link_request_of_yojson :
    Yojson.Safe.t -> redeem_gtm_invite_link_request =
 fun json ->
  let fields = Json.obj json in
  { token = Json.required fields "token" Json.string }

and yojson_of_redeem_gtm_invite_link_request :
    redeem_gtm_invite_link_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("token", Some (Json.of_string value.token)) ]

let make_redeem_gtm_invite_link_request ~(token : string) () =
  ({ token } : redeem_gtm_invite_link_request)

type nonrec release_body = {
  confirm_name : string;  (** The computer's name, typed to confirm. *)
}
(** Body of a release. *)

let release_body_of_yojson : Yojson.Safe.t -> release_body =
 fun json ->
  let fields = Json.obj json in
  { confirm_name = Json.required fields "confirmName" Json.string }

and yojson_of_release_body : release_body -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("confirmName", Some (Json.of_string value.confirm_name)) ]

let make_release_body ~(confirm_name : string) () =
  ({ confirm_name } : release_body)

type nonrec resend_fusionauth_verify_user_email_request = {
  email : string;  (** The email address to resend the verification email to *)
}

let resend_fusionauth_verify_user_email_request_of_yojson :
    Yojson.Safe.t -> resend_fusionauth_verify_user_email_request =
 fun json ->
  let fields = Json.obj json in
  { email = Json.required fields "email" Json.string }

and yojson_of_resend_fusionauth_verify_user_email_request :
    resend_fusionauth_verify_user_email_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("email", Some (Json.of_string value.email)) ]

let make_resend_fusionauth_verify_user_email_request ~(email : string) () =
  ({ email } : resend_fusionauth_verify_user_email_request)

type nonrec scheduled_seat_plan = {
  effective_at : string;
      (** Provider-confirmed time when the future phase starts. *)
  plan : seat_plan;  (** Plan that takes effect at renewal. *)
}
(** A seat's future plan in the subscription's currently attached schedule. *)

let scheduled_seat_plan_of_yojson : Yojson.Safe.t -> scheduled_seat_plan =
 fun json ->
  let fields = Json.obj json in
  {
    effective_at = Json.required fields "effectiveAt" Json.string;
    plan = Json.required fields "plan" seat_plan_of_yojson;
  }

and yojson_of_scheduled_seat_plan : scheduled_seat_plan -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("effectiveAt", Some (Json.of_string value.effective_at));
      ("plan", Some (yojson_of_seat_plan value.plan));
    ]

let make_scheduled_seat_plan ~(effective_at : string) ~(plan : seat_plan) () =
  ({ effective_at; plan } : scheduled_seat_plan)

type nonrec send_domain_notice_response = {
  sent : int;  (** How many colleagues were emailed by this call. *)
}
(** Response for the domain notice endpoint. *)

let send_domain_notice_response_of_yojson :
    Yojson.Safe.t -> send_domain_notice_response =
 fun json ->
  let fields = Json.obj json in
  { sent = Json.required fields "sent" Json.int }

and yojson_of_send_domain_notice_response :
    send_domain_notice_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("sent", Some (Json.of_int value.sent)) ]

let make_send_domain_notice_response ~(sent : int) () =
  ({ sent } : send_domain_notice_response)

type nonrec send_invite_body = {
  recipient : string;  (** the recipient of the referral email *)
}
(** The body which is used to describe the recipient email *)

let send_invite_body_of_yojson : Yojson.Safe.t -> send_invite_body =
 fun json ->
  let fields = Json.obj json in
  { recipient = Json.required fields "recipient" Json.string }

and yojson_of_send_invite_body : send_invite_body -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("recipient", Some (Json.of_string value.recipient)) ]

let make_send_invite_body ~(recipient : string) () =
  ({ recipient } : send_invite_body)

type nonrec send_mobile_welcome_email_request = {
  email : string;  (** The email address to send the welcome email to *)
}

let send_mobile_welcome_email_request_of_yojson :
    Yojson.Safe.t -> send_mobile_welcome_email_request =
 fun json ->
  let fields = Json.obj json in
  { email = Json.required fields "email" Json.string }

and yojson_of_send_mobile_welcome_email_request :
    send_mobile_welcome_email_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("email", Some (Json.of_string value.email)) ]

let make_send_mobile_welcome_email_request ~(email : string) () =
  ({ email } : send_mobile_welcome_email_request)

type nonrec send_mobile_welcome_email_response = {
  sent : bool;
      (** Whether the lead was enrolled (false if they were already enrolled previously) *)
}

let send_mobile_welcome_email_response_of_yojson :
    Yojson.Safe.t -> send_mobile_welcome_email_response =
 fun json ->
  let fields = Json.obj json in
  { sent = Json.required fields "sent" Json.bool }

and yojson_of_send_mobile_welcome_email_response :
    send_mobile_welcome_email_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("sent", Some (Json.of_bool value.sent)) ]

let make_send_mobile_welcome_email_response ~(sent : bool) () =
  ({ sent } : send_mobile_welcome_email_response)

type nonrec set_github_pull_request_draft_request = {
  draft : bool;
      (** [true] converts the pull request to a draft; [false] marks it ready for review. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
}
(** A request to mark one pull request as a draft, or as ready for review, on
the user's behalf. *)

let set_github_pull_request_draft_request_of_yojson :
    Yojson.Safe.t -> set_github_pull_request_draft_request =
 fun json ->
  let fields = Json.obj json in
  {
    draft = Json.required fields "draft" Json.bool;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
  }

and yojson_of_set_github_pull_request_draft_request :
    set_github_pull_request_draft_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("draft", Some (Json.of_bool value.draft));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
    ]

let make_set_github_pull_request_draft_request ~(draft : bool) ~(number : int64)
    ~(owner : string) ~(repo : string) () =
  ({ draft; number; owner; repo } : set_github_pull_request_draft_request)

type nonrec set_github_pull_request_draft_response = {
  draft : bool;  (** Whether the pull request is now a draft. *)
  pull_request : enriched_github_pull_request option;
}
(** Response body for a pull request whose draft state changed. *)

let set_github_pull_request_draft_response_of_yojson :
    Yojson.Safe.t -> set_github_pull_request_draft_response =
 fun json ->
  let fields = Json.obj json in
  {
    draft = Json.required fields "draft" Json.bool;
    pull_request =
      Json.optional fields "pullRequest" enriched_github_pull_request_of_yojson;
  }

and yojson_of_set_github_pull_request_draft_response :
    set_github_pull_request_draft_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("draft", Some (Json.of_bool value.draft));
      ( "pullRequest",
        Option.map yojson_of_enriched_github_pull_request value.pull_request );
    ]

let make_set_github_pull_request_draft_response ~(draft : bool) ?pull_request ()
    =
  ({ draft; pull_request } : set_github_pull_request_draft_response)

type nonrec set_github_pull_request_state_request = {
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  state : github_pull_request_state;
      (** [closed] closes the pull request; [open] reopens it. *)
}
(** A request to close one pull request, or reopen it, on the user's behalf. *)

let set_github_pull_request_state_request_of_yojson :
    Yojson.Safe.t -> set_github_pull_request_state_request =
 fun json ->
  let fields = Json.obj json in
  {
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    state = Json.required fields "state" github_pull_request_state_of_yojson;
  }

and yojson_of_set_github_pull_request_state_request :
    set_github_pull_request_state_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ("state", Some (yojson_of_github_pull_request_state value.state));
    ]

let make_set_github_pull_request_state_request ~(number : int64)
    ~(owner : string) ~(repo : string) ~(state : github_pull_request_state) () =
  ({ number; owner; repo; state } : set_github_pull_request_state_request)

type nonrec set_github_pull_request_state_response = {
  pull_request : enriched_github_pull_request option;
  state : github_pull_request_state;
      (** Whether the pull request is now open or closed. *)
}
(** Response body for a pull request that was closed or reopened. *)

let set_github_pull_request_state_response_of_yojson :
    Yojson.Safe.t -> set_github_pull_request_state_response =
 fun json ->
  let fields = Json.obj json in
  {
    pull_request =
      Json.optional fields "pullRequest" enriched_github_pull_request_of_yojson;
    state = Json.required fields "state" github_pull_request_state_of_yojson;
  }

and yojson_of_set_github_pull_request_state_response :
    set_github_pull_request_state_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "pullRequest",
        Option.map yojson_of_enriched_github_pull_request value.pull_request );
      ("state", Some (yojson_of_github_pull_request_state value.state));
    ]

let make_set_github_pull_request_state_response ?pull_request
    ~(state : github_pull_request_state) () =
  ({ pull_request; state } : set_github_pull_request_state_response)

type nonrec size_offer = {
  disk_gb : int;  (** Root disk size in GiB. *)
  memory_gb : int;  (** Memory in GiB. *)
  quote : quote;  (** Price for one computer. *)
  size : computer_size;  (** Purchased catalog size. *)
  sold_out : bool;  (** Whether no host can currently sell this size. *)
  vcpus : int;  (** Virtual CPU count. *)
}
(** A size with its resources, price and whether it can be bought now. *)

let size_offer_of_yojson : Yojson.Safe.t -> size_offer =
 fun json ->
  let fields = Json.obj json in
  {
    disk_gb = Json.required fields "diskGb" Json.int;
    memory_gb = Json.required fields "memoryGb" Json.int;
    quote = Json.required fields "quote" quote_of_yojson;
    size = Json.required fields "size" computer_size_of_yojson;
    sold_out = Json.required fields "soldOut" Json.bool;
    vcpus = Json.required fields "vcpus" Json.int;
  }

and yojson_of_size_offer : size_offer -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("diskGb", Some (Json.of_int value.disk_gb));
      ("memoryGb", Some (Json.of_int value.memory_gb));
      ("quote", Some (yojson_of_quote value.quote));
      ("size", Some (yojson_of_computer_size value.size));
      ("soldOut", Some (Json.of_bool value.sold_out));
      ("vcpus", Some (Json.of_int value.vcpus));
    ]

let make_size_offer ~(disk_gb : int) ~(memory_gb : int) ~(quote : quote)
    ~(size : computer_size) ~(sold_out : bool) ~(vcpus : int) () =
  ({ disk_gb; memory_gb; quote; size; sold_out; vcpus } : size_offer)

type nonrec sso_required_response = {
  idp_id : string;  (** The idp_id you need to perform sso login with. *)
}

let sso_required_response_of_yojson : Yojson.Safe.t -> sso_required_response =
 fun json ->
  let fields = Json.obj json in
  { idp_id = Json.required fields "idp_id" Json.string }

and yojson_of_sso_required_response : sso_required_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("idp_id", Some (Json.of_string value.idp_id)) ]

let make_sso_required_response ~(idp_id : string) () =
  ({ idp_id } : sso_required_response)

type nonrec status_update = {
  system_status : system_status;  (** The status that was set. *)
  created_at : string;  (** When it was set. *)
  id : string;  (** UUIDv7, so ids sort by creation. *)
  user_id : string;  (** The staff member who set it. *)
}
(** One status a staff member set. The newest is the current status. *)

let status_update_of_yojson : Yojson.Safe.t -> status_update =
 fun json ->
  let fields = Json.obj json in
  {
    system_status = system_status_of_yojson json;
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    user_id = Json.required fields "userId" Json.string;
  }

and yojson_of_status_update : status_update -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("createdAt", Some (Json.of_string value.created_at));
          ("id", Some (Json.of_string value.id));
          ("userId", Some (Json.of_string value.user_id));
        ];
      yojson_of_system_status value.system_status;
    ]

let make_status_update ~(system_status : system_status) ~(created_at : string)
    ~(id : string) ~(user_id : string) () =
  ({ system_status; created_at; id; user_id } : status_update)

type nonrec stripe_session_response = {
  url : string;  (** The URL to redirect the user to *)
}
(** Response containing the Stripe session URL *)

let stripe_session_response_of_yojson : Yojson.Safe.t -> stripe_session_response
    =
 fun json ->
  let fields = Json.obj json in
  { url = Json.required fields "url" Json.string }

and yojson_of_stripe_session_response : stripe_session_response -> Yojson.Safe.t
    =
 fun value -> Json.record [ ("url", Some (Json.of_string value.url)) ]

let make_stripe_session_response ~(url : string) () =
  ({ url } : stripe_session_response)

type nonrec subscription_seat_total = {
  amount : int64;
      (** Actual recurring price times allocated quantity, in minor units. *)
  quantity : int64;  (** Actual billed quantity allocated to this seat kind. *)
}
(** Billed seat quantity and current recurring amount in minor units. *)

let subscription_seat_total_of_yojson : Yojson.Safe.t -> subscription_seat_total
    =
 fun json ->
  let fields = Json.obj json in
  {
    amount = Json.required fields "amount" Json.int64;
    quantity = Json.required fields "quantity" Json.int64;
  }

and yojson_of_subscription_seat_total : subscription_seat_total -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("amount", Some (Json.of_int64 value.amount));
      ("quantity", Some (Json.of_int64 value.quantity));
    ]

let make_subscription_seat_total ~(amount : int64) ~(quantity : int64) () =
  ({ amount; quantity } : subscription_seat_total)

(** What an actual subscription item pays for. *)
type nonrec subscription_billing_line_kind =
  | Human_seat
  | Computer
  | Other
  | Unknown of string  (** A value this SDK version does not know. *)

let subscription_billing_line_kind_of_yojson :
    Yojson.Safe.t -> subscription_billing_line_kind =
 fun json ->
  match Json.string json with
  | "human_seat" -> Human_seat
  | "computer" -> Computer
  | "other" -> Other
  | other -> Json.unknown "subscription_billing_line_kind" json (Unknown other)

and yojson_of_subscription_billing_line_kind :
    subscription_billing_line_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Human_seat -> `String "human_seat"
  | Computer -> `String "computer"
  | Other -> `String "other"
  | Unknown other -> `String other

type nonrec subscription_billing_line_item = {
  amount : int64;
      (** Current recurring amount for this allocated quantity, in minor units. *)
  computer_id : string option;
      (** Identified computer, absent for aggregate or unattributed items. *)
  included : bool;  (** Included without a subscription charge. *)
  kind : subscription_billing_line_kind;
      (** Actual billing category; unmatched quantities stay [other]. *)
  name : string;  (** Entity name or provider item description. *)
  plan : seat_plan option;
  quantity : int64;  (** Actual subscription quantity allocated to this row. *)
  size : computer_size option;
  status : computer_status_kind option;
  unit_amount : int64 option;
      (** Provider price per unit in minor units, when fixed. *)
}
(** An allocated provider item or an explicitly included computer. *)

let subscription_billing_line_item_of_yojson :
    Yojson.Safe.t -> subscription_billing_line_item =
 fun json ->
  let fields = Json.obj json in
  {
    amount = Json.required fields "amount" Json.int64;
    computer_id = Json.optional fields "computerId" Json.string;
    included = Json.required fields "included" Json.bool;
    kind = Json.required fields "kind" subscription_billing_line_kind_of_yojson;
    name = Json.required fields "name" Json.string;
    plan = Json.optional fields "plan" seat_plan_of_yojson;
    quantity = Json.required fields "quantity" Json.int64;
    size = Json.optional fields "size" computer_size_of_yojson;
    status = Json.optional fields "status" computer_status_kind_of_yojson;
    unit_amount = Json.optional fields "unitAmount" Json.int64;
  }

and yojson_of_subscription_billing_line_item :
    subscription_billing_line_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("amount", Some (Json.of_int64 value.amount));
      ("computerId", Option.map Json.of_string value.computer_id);
      ("included", Some (Json.of_bool value.included));
      ("kind", Some (yojson_of_subscription_billing_line_kind value.kind));
      ("name", Some (Json.of_string value.name));
      ("plan", Option.map yojson_of_seat_plan value.plan);
      ("quantity", Some (Json.of_int64 value.quantity));
      ("size", Option.map yojson_of_computer_size value.size);
      ("status", Option.map yojson_of_computer_status_kind value.status);
      ("unitAmount", Option.map Json.of_int64 value.unit_amount);
    ]

let make_subscription_billing_line_item ~(amount : int64) ?computer_id
    ~(included : bool) ~(kind : subscription_billing_line_kind) ~(name : string)
    ?plan ~(quantity : int64) ?size ?status ?unit_amount () =
  ({
     amount;
     computer_id;
     included;
     kind;
     name;
     plan;
     quantity;
     size;
     status;
     unit_amount;
   }
    : subscription_billing_line_item)

type nonrec subscription_next_invoice = {
  amount : int64;  (** Actual upcoming invoice amount due in minor units. *)
  date : string option;
      (** Provider's next payment or due date, when supplied. *)
}
(** Provider-confirmed next invoice, including its adjustments and credits. *)

let subscription_next_invoice_of_yojson :
    Yojson.Safe.t -> subscription_next_invoice =
 fun json ->
  let fields = Json.obj json in
  {
    amount = Json.required fields "amount" Json.int64;
    date = Json.optional fields "date" Json.string;
  }

and yojson_of_subscription_next_invoice :
    subscription_next_invoice -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("amount", Some (Json.of_int64 value.amount));
      ("date", Option.map Json.of_string value.date);
    ]

let make_subscription_next_invoice ~(amount : int64) ?date () =
  ({ amount; date } : subscription_next_invoice)

type nonrec subscription_billing = {
  currency : string;
      (** The subscription's ISO currency, as returned by the provider. *)
  human_seats : subscription_seat_total;  (** Paid seat allocations. *)
  interval : billing_interval;
      (** The actual recurring billing interval shared by these items. *)
  line_items : subscription_billing_line_item list;
      (** Real provider line items, allocated only when their ownership is known. *)
  next_invoice : subscription_next_invoice option;
  subscription_total : int64;
      (** Recurring item subtotal in minor units, before invoice adjustments. *)
}
(** Actual current recurring items and the provider's next invoice preview. *)

let subscription_billing_of_yojson : Yojson.Safe.t -> subscription_billing =
 fun json ->
  let fields = Json.obj json in
  {
    currency = Json.required fields "currency" Json.string;
    human_seats =
      Json.required fields "humanSeats" subscription_seat_total_of_yojson;
    interval = Json.required fields "interval" billing_interval_of_yojson;
    line_items =
      Json.required fields "lineItems"
        (Json.list subscription_billing_line_item_of_yojson);
    next_invoice =
      Json.optional fields "nextInvoice" subscription_next_invoice_of_yojson;
    subscription_total = Json.required fields "subscriptionTotal" Json.int64;
  }

and yojson_of_subscription_billing : subscription_billing -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("currency", Some (Json.of_string value.currency));
      ("humanSeats", Some (yojson_of_subscription_seat_total value.human_seats));
      ("interval", Some (yojson_of_billing_interval value.interval));
      ( "lineItems",
        Some
          ((Json.of_list yojson_of_subscription_billing_line_item)
             value.line_items) );
      ( "nextInvoice",
        Option.map yojson_of_subscription_next_invoice value.next_invoice );
      ("subscriptionTotal", Some (Json.of_int64 value.subscription_total));
    ]

let make_subscription_billing ~(currency : string)
    ~(human_seats : subscription_seat_total) ~(interval : billing_interval)
    ~(line_items : subscription_billing_line_item list) ?next_invoice
    ~(subscription_total : int64) () =
  ({
     currency;
     human_seats;
     interval;
     line_items;
     next_invoice;
     subscription_total;
   }
    : subscription_billing)

type nonrec subscription_item = {
  price_id : string;  (** Stripe price saved for billing replay. *)
  quantity : int;  (** Added to the item's current quantity. *)
}
(** A Stripe price and how many of it to add to the team subscription. *)

let subscription_item_of_yojson : Yojson.Safe.t -> subscription_item =
 fun json ->
  let fields = Json.obj json in
  {
    price_id = Json.required fields "priceId" Json.string;
    quantity = Json.required fields "quantity" Json.int;
  }

and yojson_of_subscription_item : subscription_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("priceId", Some (Json.of_string value.price_id));
      ("quantity", Some (Json.of_int value.quantity));
    ]

let make_subscription_item ~(price_id : string) ~(quantity : int) () =
  ({ price_id; quantity } : subscription_item)

type nonrec subscription_status = {
  billing : subscription_billing option;
  renewal_date : string option;
      (** Provider-confirmed subscription renewal date. *)
  scheduled_change : scheduled_seat_plan option;
}
(** Current renewal and scheduled change; empty for accounts without a subscription. *)

let subscription_status_of_yojson : Yojson.Safe.t -> subscription_status =
 fun json ->
  let fields = Json.obj json in
  {
    billing = Json.optional fields "billing" subscription_billing_of_yojson;
    renewal_date = Json.optional fields "renewalDate" Json.string;
    scheduled_change =
      Json.optional fields "scheduledChange" scheduled_seat_plan_of_yojson;
  }

and yojson_of_subscription_status : subscription_status -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("billing", Option.map yojson_of_subscription_billing value.billing);
      ("renewalDate", Option.map Json.of_string value.renewal_date);
      ( "scheduledChange",
        Option.map yojson_of_scheduled_seat_plan value.scheduled_change );
    ]

let make_subscription_status ?billing ?renewal_date ?scheduled_change () =
  ({ billing; renewal_date; scheduled_change } : subscription_status)

type nonrec system_status_history = {
  updates : status_update list;  (** The updates. *)
}
(** Recent status updates, newest first. *)

let system_status_history_of_yojson : Yojson.Safe.t -> system_status_history =
 fun json ->
  let fields = Json.obj json in
  {
    updates = Json.required fields "updates" (Json.list status_update_of_yojson);
  }

and yojson_of_system_status_history : system_status_history -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("updates", Some ((Json.of_list yojson_of_status_update) value.updates)) ]

let make_system_status_history ~(updates : status_update list) () =
  ({ updates } : system_status_history)

type nonrec team = {
  allow_non_admin_invites : bool;
      (** Whether non-admin members may invite users to the team. Defaults to
true; admins can turn it off so only admins/owners may invite. *)
  auto_join_domain : string option;
      (** The email domain new users are automatically joined to this team
with, when automatic domain joining is enabled (None otherwise). *)
  crm_enabled : bool;
      (** CRM record availability, always true for teams. This compatibility
field does not indicate whether any mailbox contributes emails. *)
  default_link_share : link_share option;
  enterprise : bool;
      (** Whether this team is on an enterprise license. Enterprise teams are
billed out-of-band; membership changes skip all Stripe subscription
bookkeeping (no seat counts, no subscription backfill, no paying check). *)
  id : string;
  language : language option;
  name : string;
  owner_id : string;
  slug : string;
}
(** The Team struct *)

let team_of_yojson : Yojson.Safe.t -> team =
 fun json ->
  let fields = Json.obj json in
  {
    allow_non_admin_invites =
      Json.required fields "allow_non_admin_invites" Json.bool;
    auto_join_domain = Json.optional fields "auto_join_domain" Json.string;
    crm_enabled = Json.required fields "crm_enabled" Json.bool;
    default_link_share =
      Json.optional fields "default_link_share" link_share_of_yojson;
    enterprise = Json.required fields "enterprise" Json.bool;
    id = Json.required fields "id" Json.string;
    language = Json.optional fields "language" language_of_yojson;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    slug = Json.required fields "slug" Json.string;
  }

and yojson_of_team : team -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "allow_non_admin_invites",
        Some (Json.of_bool value.allow_non_admin_invites) );
      ("auto_join_domain", Option.map Json.of_string value.auto_join_domain);
      ("crm_enabled", Some (Json.of_bool value.crm_enabled));
      ( "default_link_share",
        Option.map yojson_of_link_share value.default_link_share );
      ("enterprise", Some (Json.of_bool value.enterprise));
      ("id", Some (Json.of_string value.id));
      ("language", Option.map yojson_of_language value.language);
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("slug", Some (Json.of_string value.slug));
    ]

let make_team ~(allow_non_admin_invites : bool) ?auto_join_domain
    ~(crm_enabled : bool) ?default_link_share ~(enterprise : bool)
    ~(id : string) ?language ~(name : string) ~(owner_id : string)
    ~(slug : string) () =
  ({
     allow_non_admin_invites;
     auto_join_domain;
     crm_enabled;
     default_link_share;
     enterprise;
     id;
     language;
     name;
     owner_id;
     slug;
   }
    : team)

(** Where an agent teammate is, from its computer. *)
type nonrec team_agent_status =
  | Provisioning
  | Running
  | Paused
  | Failed
  | Released
  | Unknown of string  (** A value this SDK version does not know. *)

let team_agent_status_of_yojson : Yojson.Safe.t -> team_agent_status =
 fun json ->
  match Json.string json with
  | "provisioning" -> Provisioning
  | "running" -> Running
  | "paused" -> Paused
  | "failed" -> Failed
  | "released" -> Released
  | other -> Json.unknown "team_agent_status" json (Unknown other)

and yojson_of_team_agent_status : team_agent_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Provisioning -> `String "provisioning"
  | Running -> `String "running"
  | Paused -> `String "paused"
  | Failed -> `String "failed"
  | Released -> `String "released"
  | Unknown other -> `String other

type nonrec team_agent = {
  computer_id : string option;  (** The agent's Macro computer, once bought. *)
  created_at : string;  (** When the agent was invited. *)
  created_by : string option;  (** Admin who invited the agent. *)
  job_description : string;  (** What the agent is responsible for. *)
  name : string;  (** Display name. *)
  personality : string;  (** How the agent behaves and talks. *)
  status : team_agent_status;  (** Where the agent is. *)
  team_id : string;  (** Team the agent belongs to. *)
  user_id : string;  (** The agent's Macro user id ([macro|<email>]). *)
}
(** An agent teammate: an AI member of a team with its own Macro account and
its own Macro computer. *)

let team_agent_of_yojson : Yojson.Safe.t -> team_agent =
 fun json ->
  let fields = Json.obj json in
  {
    computer_id = Json.optional fields "computerId" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    created_by = Json.optional fields "createdBy" Json.string;
    job_description = Json.required fields "jobDescription" Json.string;
    name = Json.required fields "name" Json.string;
    personality = Json.required fields "personality" Json.string;
    status = Json.required fields "status" team_agent_status_of_yojson;
    team_id = Json.required fields "teamId" Json.string;
    user_id = Json.required fields "userId" Json.string;
  }

and yojson_of_team_agent : team_agent -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("computerId", Option.map Json.of_string value.computer_id);
      ("createdAt", Some (Json.of_string value.created_at));
      ("createdBy", Option.map Json.of_string value.created_by);
      ("jobDescription", Some (Json.of_string value.job_description));
      ("name", Some (Json.of_string value.name));
      ("personality", Some (Json.of_string value.personality));
      ("status", Some (yojson_of_team_agent_status value.status));
      ("teamId", Some (Json.of_string value.team_id));
      ("userId", Some (Json.of_string value.user_id));
    ]

let make_team_agent ?computer_id ~(created_at : string) ?created_by
    ~(job_description : string) ~(name : string) ~(personality : string)
    ~(status : team_agent_status) ~(team_id : string) ~(user_id : string) () =
  ({
     computer_id;
     created_at;
     created_by;
     job_description;
     name;
     personality;
     status;
     team_id;
     user_id;
   }
    : team_agent)

type nonrec team_agents = {
  agents : team_agent list;  (** The agents, oldest first. *)
}
(** A team's agents. *)

let team_agents_of_yojson : Yojson.Safe.t -> team_agents =
 fun json ->
  let fields = Json.obj json in
  { agents = Json.required fields "agents" (Json.list team_agent_of_yojson) }

and yojson_of_team_agents : team_agents -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("agents", Some ((Json.of_list yojson_of_team_agent) value.agents)) ]

let make_team_agents ~(agents : team_agent list) () = ({ agents } : team_agents)

type nonrec team_invite_details = {
  created_at : string;  (** When the invite was created *)
  email : string;  (** The invited email *)
  id : string;  (** The invite id *)
  invited_by : string;  (** The user who sent the invitation *)
  is_agent : bool;  (** Whether the invite creates an agent account *)
  last_sent_at : string;  (** When the invite was last sent *)
  team_id : string;  (** The team id *)
  team_role : team_role;  (** The role being invited as *)
}
(** Detailed information about a team invite *)

let team_invite_details_of_yojson : Yojson.Safe.t -> team_invite_details =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    email = Json.required fields "email" Json.string;
    id = Json.required fields "id" Json.string;
    invited_by = Json.required fields "invited_by" Json.string;
    is_agent = Json.required fields "is_agent" Json.bool;
    last_sent_at = Json.required fields "last_sent_at" Json.string;
    team_id = Json.required fields "team_id" Json.string;
    team_role = Json.required fields "team_role" team_role_of_yojson;
  }

and yojson_of_team_invite_details : team_invite_details -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("email", Some (Json.of_string value.email));
      ("id", Some (Json.of_string value.id));
      ("invited_by", Some (Json.of_string value.invited_by));
      ("is_agent", Some (Json.of_bool value.is_agent));
      ("last_sent_at", Some (Json.of_string value.last_sent_at));
      ("team_id", Some (Json.of_string value.team_id));
      ("team_role", Some (yojson_of_team_role value.team_role));
    ]

let make_team_invite_details ~(created_at : string) ~(email : string)
    ~(id : string) ~(invited_by : string) ~(is_agent : bool)
    ~(last_sent_at : string) ~(team_id : string) ~(team_role : team_role) () =
  ({
     created_at;
     email;
     id;
     invited_by;
     is_agent;
     last_sent_at;
     team_id;
     team_role;
   }
    : team_invite_details)

type nonrec team_invite_link_response = {
  token : team_invite_link_token option;
}
(** The caller's team invite link. *)

let team_invite_link_response_of_yojson :
    Yojson.Safe.t -> team_invite_link_response =
 fun json ->
  let fields = Json.obj json in
  { token = Json.optional fields "token" team_invite_link_token_of_yojson }

and yojson_of_team_invite_link_response :
    team_invite_link_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("token", Option.map yojson_of_team_invite_link_token value.token) ]

let make_team_invite_link_response ?token () =
  ({ token } : team_invite_link_response)

type nonrec team_invite_link_team = {
  team_id : string;  (** Id of the team the link joins. *)
  team_name : string;  (** Name of the team the link joins. *)
}
(** The team an invite link joins, shown before the user accepts. *)

let team_invite_link_team_of_yojson : Yojson.Safe.t -> team_invite_link_team =
 fun json ->
  let fields = Json.obj json in
  {
    team_id = Json.required fields "team_id" Json.string;
    team_name = Json.required fields "team_name" Json.string;
  }

and yojson_of_team_invite_link_team : team_invite_link_team -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("team_id", Some (Json.of_string value.team_id));
      ("team_name", Some (Json.of_string value.team_name));
    ]

let make_team_invite_link_team ~(team_id : string) ~(team_name : string) () =
  ({ team_id; team_name } : team_invite_link_team)

type nonrec team_invite_link_token_request = {
  token : team_invite_link_token;  (** The invite link's token. *)
}
(** Identifies an invite link. The token travels in the body, not the path, so
request spans and access logs that record the path never see it. *)

let team_invite_link_token_request_of_yojson :
    Yojson.Safe.t -> team_invite_link_token_request =
 fun json ->
  let fields = Json.obj json in
  { token = Json.required fields "token" team_invite_link_token_of_yojson }

and yojson_of_team_invite_link_token_request :
    team_invite_link_token_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("token", Some (yojson_of_team_invite_link_token value.token)) ]

let make_team_invite_link_token_request ~(token : team_invite_link_token) () =
  ({ token } : team_invite_link_token_request)

type nonrec team_invites_response = {
  invites : team_invite_details list;  (** The invites *)
}
(** Response containing a list of team invites *)

let team_invites_response_of_yojson : Yojson.Safe.t -> team_invites_response =
 fun json ->
  let fields = Json.obj json in
  {
    invites =
      Json.required fields "invites" (Json.list team_invite_details_of_yojson);
  }

and yojson_of_team_invites_response : team_invites_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "invites",
        Some ((Json.of_list yojson_of_team_invite_details) value.invites) );
    ]

let make_team_invites_response ~(invites : team_invite_details list) () =
  ({ invites } : team_invites_response)

type nonrec team_member = {
  plan : seat_plan;
      (** The paid plan the member's seat is billed at. Meaningful on paying
and enterprise teams; free-team members carry the default. *)
  role : team_role;  (** The role of the team member *)
  team_id : string;  (** The id of the team *)
  user_id : string;  (** The user id of the team member *)
}
(** The team member struct *)

let team_member_of_yojson : Yojson.Safe.t -> team_member =
 fun json ->
  let fields = Json.obj json in
  {
    plan = Json.required fields "plan" seat_plan_of_yojson;
    role = Json.required fields "role" team_role_of_yojson;
    team_id = Json.required fields "team_id" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_team_member : team_member -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("plan", Some (yojson_of_seat_plan value.plan));
      ("role", Some (yojson_of_team_role value.role));
      ("team_id", Some (Json.of_string value.team_id));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_team_member ~(plan : seat_plan) ~(role : team_role) ~(team_id : string)
    ~(user_id : string) () =
  ({ plan; role; team_id; user_id } : team_member)

(** Team plans *)
type nonrec team_plan =
  | Idea
  | Pre_seed
  | Seed
  | Series_a
  | Growth
  | Unknown of string  (** A value this SDK version does not know. *)

let team_plan_of_yojson : Yojson.Safe.t -> team_plan =
 fun json ->
  match Json.string json with
  | "idea" -> Idea
  | "pre_seed" -> Pre_seed
  | "seed" -> Seed
  | "series_a" -> Series_a
  | "growth" -> Growth
  | other -> Json.unknown "team_plan" json (Unknown other)

and yojson_of_team_plan : team_plan -> Yojson.Safe.t =
 fun value ->
  match value with
  | Idea -> `String "idea"
  | Pre_seed -> `String "pre_seed"
  | Seed -> `String "seed"
  | Series_a -> `String "series_a"
  | Growth -> `String "growth"
  | Unknown other -> `String other

type nonrec team_with_members = {
  members : team_member list;  (** The members of the team *)
  scheduled_seat_plans : (string * scheduled_seat_plan) list option;
      (** Provider-confirmed pending seat changes, keyed by member user ID.
Empty when no changes apply to this viewer; absent when the lookup fails. *)
  team : team;  (** The team *)
}
(** A team with its members *)

let team_with_members_of_yojson : Yojson.Safe.t -> team_with_members =
 fun json ->
  let fields = Json.obj json in
  {
    members = Json.required fields "members" (Json.list team_member_of_yojson);
    scheduled_seat_plans =
      Json.optional fields "scheduled_seat_plans"
        (Json.map scheduled_seat_plan_of_yojson);
    team = Json.required fields "team" team_of_yojson;
  }

and yojson_of_team_with_members : team_with_members -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("members", Some ((Json.of_list yojson_of_team_member) value.members));
      ( "scheduled_seat_plans",
        Option.map
          (Json.of_map yojson_of_scheduled_seat_plan)
          value.scheduled_seat_plans );
      ("team", Some (yojson_of_team value.team));
    ]

let make_team_with_members ~(members : team_member list) ?scheduled_seat_plans
    ~(team : team) () =
  ({ members; scheduled_seat_plans; team } : team_with_members)

type nonrec toggle_auto_join_domain_response = {
  auto_join_domain : string option;
      (** The team's auto-join domain after the toggle (null when it was
unset by this call). *)
}
(** Response for the toggle auto-join domain endpoint. *)

let toggle_auto_join_domain_response_of_yojson :
    Yojson.Safe.t -> toggle_auto_join_domain_response =
 fun json ->
  let fields = Json.obj json in
  { auto_join_domain = Json.optional fields "auto_join_domain" Json.string }

and yojson_of_toggle_auto_join_domain_response :
    toggle_auto_join_domain_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("auto_join_domain", Option.map Json.of_string value.auto_join_domain) ]

let make_toggle_auto_join_domain_response ?auto_join_domain () =
  ({ auto_join_domain } : toggle_auto_join_domain_response)

type nonrec toggle_non_admin_invites_response = {
  allow_non_admin_invites : bool;
      (** Whether non-admin members may invite users to the team after the
toggle. *)
}
(** Response for the toggle non-admin invites endpoint. *)

let toggle_non_admin_invites_response_of_yojson :
    Yojson.Safe.t -> toggle_non_admin_invites_response =
 fun json ->
  let fields = Json.obj json in
  {
    allow_non_admin_invites =
      Json.required fields "allow_non_admin_invites" Json.bool;
  }

and yojson_of_toggle_non_admin_invites_response :
    toggle_non_admin_invites_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "allow_non_admin_invites",
        Some (Json.of_bool value.allow_non_admin_invites) );
    ]

let make_toggle_non_admin_invites_response ~(allow_non_admin_invites : bool) ()
    =
  ({ allow_non_admin_invites } : toggle_non_admin_invites_response)

type nonrec trial_eligibility = {
  eligible : bool;
      (** Confirmed against the same subscription history used during checkout. *)
  existing_subscription : bool;
      (** An existing subscription requires management instead of a new checkout. *)
}
(** Whether the authenticated customer can receive the introductory Pro trial. *)

let trial_eligibility_of_yojson : Yojson.Safe.t -> trial_eligibility =
 fun json ->
  let fields = Json.obj json in
  {
    eligible = Json.required fields "eligible" Json.bool;
    existing_subscription =
      Json.required fields "existingSubscription" Json.bool;
  }

and yojson_of_trial_eligibility : trial_eligibility -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("eligible", Some (Json.of_bool value.eligible));
      ("existingSubscription", Some (Json.of_bool value.existing_subscription));
    ]

let make_trial_eligibility ~(eligible : bool) ~(existing_subscription : bool) ()
    =
  ({ eligible; existing_subscription } : trial_eligibility)

type nonrec update_auto_reload_request = {
  enabled : bool;
      (** Purchase prepaid credits automatically using the payer's card. *)
  minimum_balance_cents : int64;
      (** Reload once the balance drops below this, cents. Must be positive. *)
  monthly_spend_limit_cents : int64 option;
      (** Most to reload per calendar month, cents. Omit or [null] for no limit.
Must be at least the catalog's [overage_limit_min_cents] (legacy name). *)
  target_balance_cents : int64;
      (** Reload the balance back up to this, cents. At least $0.50 above the
minimum and no more than the catalog's [auto_reload_target_max_cents]. *)
}
(** Request body for \[[update_auto_reload_handler]\]. *)

let update_auto_reload_request_of_yojson :
    Yojson.Safe.t -> update_auto_reload_request =
 fun json ->
  let fields = Json.obj json in
  {
    enabled = Json.required fields "enabled" Json.bool;
    minimum_balance_cents =
      Json.required fields "minimumBalanceCents" Json.int64;
    monthly_spend_limit_cents =
      Json.optional fields "monthlySpendLimitCents" Json.int64;
    target_balance_cents = Json.required fields "targetBalanceCents" Json.int64;
  }

and yojson_of_update_auto_reload_request :
    update_auto_reload_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("enabled", Some (Json.of_bool value.enabled));
      ("minimumBalanceCents", Some (Json.of_int64 value.minimum_balance_cents));
      ( "monthlySpendLimitCents",
        Option.map Json.of_int64 value.monthly_spend_limit_cents );
      ("targetBalanceCents", Some (Json.of_int64 value.target_balance_cents));
    ]

let make_update_auto_reload_request ~(enabled : bool)
    ~(minimum_balance_cents : int64) ?monthly_spend_limit_cents
    ~(target_balance_cents : int64) () =
  ({
     enabled;
     minimum_balance_cents;
     monthly_spend_limit_cents;
     target_balance_cents;
   }
    : update_auto_reload_request)

type nonrec update_overage_request = {
  enabled : bool;  (** Bill usage past allowance and credits. *)
  limit_cents : int64 option;
      (** Per-period cap on overage spend, cents. Required when enabling. *)
}
(** Request body for \[[update_overage_handler]\]. *)

let update_overage_request_of_yojson : Yojson.Safe.t -> update_overage_request =
 fun json ->
  let fields = Json.obj json in
  {
    enabled = Json.required fields "enabled" Json.bool;
    limit_cents = Json.optional fields "limitCents" Json.int64;
  }

and yojson_of_update_overage_request : update_overage_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("enabled", Some (Json.of_bool value.enabled));
      ("limitCents", Option.map Json.of_int64 value.limit_cents);
    ]

let make_update_overage_request ~(enabled : bool) ?limit_cents () =
  ({ enabled; limit_cents } : update_overage_request)

(** What kind of upstream failure a 502 or 503 reports, for clients that
branch on it. *)
type nonrec upstream_error_code =
  | Upstream_unavailable
  | Upstream_rate_limited
  | Upstream_invalid_response
  | Unknown of string  (** A value this SDK version does not know. *)

let upstream_error_code_of_yojson : Yojson.Safe.t -> upstream_error_code =
 fun json ->
  match Json.string json with
  | "upstream_unavailable" -> Upstream_unavailable
  | "upstream_rate_limited" -> Upstream_rate_limited
  | "upstream_invalid_response" -> Upstream_invalid_response
  | other -> Json.unknown "upstream_error_code" json (Unknown other)

and yojson_of_upstream_error_code : upstream_error_code -> Yojson.Safe.t =
 fun value ->
  match value with
  | Upstream_unavailable -> `String "upstream_unavailable"
  | Upstream_rate_limited -> `String "upstream_rate_limited"
  | Upstream_invalid_response -> `String "upstream_invalid_response"
  | Unknown other -> `String other

type nonrec upstream_error_response = {
  code : upstream_error_code;  (** The kind of failure. *)
  message : string;
      (** What failed and what to do about it, written for the user. *)
}
(** The body of a 502 or 503 caused by a third-party service. *)

let upstream_error_response_of_yojson : Yojson.Safe.t -> upstream_error_response
    =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" upstream_error_code_of_yojson;
    message = Json.required fields "message" Json.string;
  }

and yojson_of_upstream_error_response : upstream_error_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("code", Some (yojson_of_upstream_error_code value.code));
      ("message", Some (Json.of_string value.message));
    ]

let make_upstream_error_response ~(code : upstream_error_code)
    ~(message : string) () =
  ({ code; message } : upstream_error_response)

type nonrec user_language = { language : language option }
(** The interface language a user picked for themselves. [None] follows their
team's language, else their browser's. *)

let user_language_of_yojson : Yojson.Safe.t -> user_language =
 fun json ->
  let fields = Json.obj json in
  { language = Json.optional fields "language" language_of_yojson }

and yojson_of_user_language : user_language -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("language", Option.map yojson_of_language value.language) ]

let make_user_language ?language () = ({ language } : user_language)

type nonrec user_link_response = {
  link_exists : bool;  (** Whether or not a link exists for the given idp *)
}

let user_link_response_of_yojson : Yojson.Safe.t -> user_link_response =
 fun json ->
  let fields = Json.obj json in
  { link_exists = Json.required fields "link_exists" Json.bool }

and yojson_of_user_link_response : user_link_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("link_exists", Some (Json.of_bool value.link_exists)) ]

let make_user_link_response ~(link_exists : bool) () =
  ({ link_exists } : user_link_response)

type nonrec user_name = {
  first_name : string option;
  id : string;
  is_agent : bool option;
      (** Whether this is an agent account rather than a person. *)
  last_name : string option;
}

let user_name_of_yojson : Yojson.Safe.t -> user_name =
 fun json ->
  let fields = Json.obj json in
  {
    first_name = Json.optional fields "first_name" Json.string;
    id = Json.required fields "id" Json.string;
    is_agent = Json.optional fields "is_agent" Json.bool;
    last_name = Json.optional fields "last_name" Json.string;
  }

and yojson_of_user_name : user_name -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("first_name", Option.map Json.of_string value.first_name);
      ("id", Some (Json.of_string value.id));
      ("is_agent", Option.map Json.of_bool value.is_agent);
      ("last_name", Option.map Json.of_string value.last_name);
    ]

let make_user_name ?first_name ~(id : string) ?is_agent ?last_name () =
  ({ first_name; id; is_agent; last_name } : user_name)

type nonrec user_names = { names : user_name list }

let user_names_of_yojson : Yojson.Safe.t -> user_names =
 fun json ->
  let fields = Json.obj json in
  { names = Json.required fields "names" (Json.list user_name_of_yojson) }

and yojson_of_user_names : user_names -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("names", Some ((Json.of_list yojson_of_user_name) value.names)) ]

let make_user_names ~(names : user_name list) () = ({ names } : user_names)

type nonrec user_organization_response = {
  organization_id : int;  (** The id of the organization *)
  organization_name : string;  (** The name of the organization *)
}

let user_organization_response_of_yojson :
    Yojson.Safe.t -> user_organization_response =
 fun json ->
  let fields = Json.obj json in
  {
    organization_id = Json.required fields "organizationId" Json.int;
    organization_name = Json.required fields "organizationName" Json.string;
  }

and yojson_of_user_organization_response :
    user_organization_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("organizationId", Some (Json.of_int value.organization_id));
      ("organizationName", Some (Json.of_string value.organization_name));
    ]

let make_user_organization_response ~(organization_id : int)
    ~(organization_name : string) () =
  ({ organization_id; organization_name } : user_organization_response)

type nonrec user_quota = {
  ai_chat_messages : int64;
      (** The user's total number of AI chat messages the user has sent. *)
  documents : int64;
      (** The user's total number of documents they have created. *)
  max_ai_chat_messages : int;
      (** The maximum number of AI chat messages they can send. *)
  max_documents : int;  (** The maximum number of documents they can create. *)
}
(** The UserQuota represents the user's current quota *)

let user_quota_of_yojson : Yojson.Safe.t -> user_quota =
 fun json ->
  let fields = Json.obj json in
  {
    ai_chat_messages = Json.required fields "ai_chat_messages" Json.int64;
    documents = Json.required fields "documents" Json.int64;
    max_ai_chat_messages = Json.required fields "max_ai_chat_messages" Json.int;
    max_documents = Json.required fields "max_documents" Json.int;
  }

and yojson_of_user_quota : user_quota -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("ai_chat_messages", Some (Json.of_int64 value.ai_chat_messages));
      ("documents", Some (Json.of_int64 value.documents));
      ("max_ai_chat_messages", Some (Json.of_int value.max_ai_chat_messages));
      ("max_documents", Some (Json.of_int value.max_documents));
    ]

let make_user_quota ~(ai_chat_messages : int64) ~(documents : int64)
    ~(max_ai_chat_messages : int) ~(max_documents : int) () =
  ({ ai_chat_messages; documents; max_ai_chat_messages; max_documents }
    : user_quota)

type nonrec user_tokens_response = {
  access_token : string;  (** The users access token *)
  refresh_token : string;  (** The users refresh token *)
}

let user_tokens_response_of_yojson : Yojson.Safe.t -> user_tokens_response =
 fun json ->
  let fields = Json.obj json in
  {
    access_token = Json.required fields "access_token" Json.string;
    refresh_token = Json.required fields "refresh_token" Json.string;
  }

and yojson_of_user_tokens_response : user_tokens_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("access_token", Some (Json.of_string value.access_token));
      ("refresh_token", Some (Json.of_string value.refresh_token));
    ]

let make_user_tokens_response ~(access_token : string) ~(refresh_token : string)
    () =
  ({ access_token; refresh_token } : user_tokens_response)

type nonrec set_github_pull_request_draft_error =
  | Unauthorized of error_response  (** HTTP 401. *)
  | Forbidden of error_response  (** HTTP 403. *)
  | Not_found of error_response  (** HTTP 404. *)
  | Unprocessable_entity of error_response  (** HTTP 422. *)
  | Precondition_required of error_response  (** HTTP 428. *)
  | Internal_server_error of error_response  (** HTTP 500. *)
  | Bad_gateway of upstream_error_response  (** HTTP 502. *)
  | Service_unavailable of upstream_error_response  (** HTTP 503. *)

and enrich_github_pull_requests_error =
  | Unauthorized of error_response  (** HTTP 401. *)
  | Not_found of error_response  (** HTTP 404. *)
  | Precondition_required of error_response  (** HTTP 428. *)
  | Internal_server_error of error_response  (** HTTP 500. *)
  | Bad_gateway of upstream_error_response  (** HTTP 502. *)
  | Service_unavailable of upstream_error_response  (** HTTP 503. *)

and merge_github_pull_request_error =
  | Unauthorized of error_response  (** HTTP 401. *)
  | Forbidden of error_response  (** HTTP 403. *)
  | Not_found of error_response  (** HTTP 404. *)
  | Conflict of error_response  (** HTTP 409. *)
  | Unprocessable_entity of error_response  (** HTTP 422. *)
  | Precondition_required of error_response  (** HTTP 428. *)
  | Internal_server_error of error_response  (** HTTP 500. *)
  | Bad_gateway of upstream_error_response  (** HTTP 502. *)
  | Service_unavailable of upstream_error_response  (** HTTP 503. *)

and get_github_pull_request_mergeability_error =
  | Unauthorized of error_response  (** HTTP 401. *)
  | Not_found of error_response  (** HTTP 404. *)
  | Unprocessable_entity of error_response  (** HTTP 422. *)
  | Precondition_required of error_response  (** HTTP 428. *)
  | Internal_server_error of error_response  (** HTTP 500. *)
  | Bad_gateway of upstream_error_response  (** HTTP 502. *)
  | Service_unavailable of upstream_error_response  (** HTTP 503. *)

and set_github_pull_request_state_error =
  | Unauthorized of error_response  (** HTTP 401. *)
  | Forbidden of error_response  (** HTTP 403. *)
  | Not_found of error_response  (** HTTP 404. *)
  | Unprocessable_entity of error_response  (** HTTP 422. *)
  | Precondition_required of error_response  (** HTTP 428. *)
  | Internal_server_error of error_response  (** HTTP 500. *)
  | Bad_gateway of upstream_error_response  (** HTTP 502. *)
  | Service_unavailable of upstream_error_response  (** HTTP 503. *)

and init_github_link_error =
  | Bad_request of error_response  (** HTTP 400. *)
  | Unauthorized of error_response  (** HTTP 401. *)
  | Too_many_requests of error_response  (** HTTP 429. *)
  | Internal_server_error of error_response  (** HTTP 500. *)
  | Bad_gateway of upstream_error_response  (** HTTP 502. *)
  | Service_unavailable of upstream_error_response  (** HTTP 503. *)

and delete_github_link_error =
  | Bad_request of error_response  (** HTTP 400. *)
  | Unauthorized of error_response  (** HTTP 401. *)
  | Internal_server_error of error_response  (** HTTP 500. *)
  | Bad_gateway of upstream_error_response  (** HTTP 502. *)
  | Service_unavailable of upstream_error_response  (** HTTP 503. *)

and check_github_link_status_error =
  | Unauthorized of error_response  (** HTTP 401. *)
  | Not_found of error_response  (** HTTP 404. *)
  | Precondition_required of error_response  (** HTTP 428. *)
  | Internal_server_error of error_response  (** HTTP 500. *)
  | Bad_gateway of upstream_error_response  (** HTTP 502. *)
  | Service_unavailable of upstream_error_response  (** HTTP 503. *)

and passwordless_login_reply =
  | Ok_ of passwordless_started_response  (** HTTP 200. *)
  | Accepted of sso_required_response  (** HTTP 202. *)

and get_team_reply =
  | Ok_ of team_with_members  (** HTTP 200. *)
  | No_content  (** HTTP 204. *)

and get_user_organization_reply =
  | Ok_ of user_organization_response  (** HTTP 200. *)
  | No_content  (** HTTP 204. *)

and get_user_quota_reply =
  | Ok_ of user_quota  (** HTTP 200. *)
  | No_content  (** HTTP 204. *)

(** [GET /agents/{agent_id}/api-key]

The agent's API key, if it has one, and whether its plan allows one. *)
let get_agent_api_key ~(agent_id : string) () =
  ({
     Request.service = "auth";
     operation = "get_agent_api_key";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agents/";
           Request.segment ((fun value -> value) agent_id);
           "/api-key";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_api_key_of_yojson;
     decode_error = Request.error_json [ 403; 404 ] error_response_of_yojson;
   }
    : (agent_api_key, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /agents/{agent_id}/api-key]

Registers or replaces the agent's API key, for its model's provider.
Only in-memory agents on an Anthropic or OpenAI model, on a paid plan. *)
let put_agent_api_key ~(agent_id : string) ~(api_key : string) () =
  ({
     Request.service = "auth";
     operation = "put_agent_api_key";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agents/";
           Request.segment ((fun value -> value) agent_id);
           "/api-key";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_put_agent_api_key_request
               ({ api_key } : put_agent_api_key_request)));
     decode_reply = Request.json agent_api_key_of_yojson;
     decode_error =
       Request.error_json [ 400; 403; 404 ] error_response_of_yojson;
   }
    : (agent_api_key, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /agents/{agent_id}/api-key]

Forgets the agent's API key. Does not revoke it at the provider; succeeds
when there was none. *)
let delete_agent_api_key ~(agent_id : string) () =
  ({
     Request.service = "auth";
     operation = "delete_agent_api_key";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/agents/";
           Request.segment ((fun value -> value) agent_id);
           "/api-key";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_api_key_of_yojson;
     decode_error = Request.error_json [ 403; 404 ] error_response_of_yojson;
   }
    : (agent_api_key, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /ai-billing/auto-reload]

Turn automatic credit reloads on with the given
thresholds, or off. Payer only. Enabling settles right away, so a balance
already under the minimum reloads immediately. *)
let update_ai_billing_auto_reload ~(enabled : bool)
    ~(minimum_balance_cents : int64) ~(target_balance_cents : int64)
    ?monthly_spend_limit_cents () =
  ({
     Request.service = "auth";
     operation = "update_ai_billing_auto_reload";
     meth = `PATCH;
     path = "/ai-billing/auto-reload";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_auto_reload_request
               ({
                  enabled;
                  minimum_balance_cents;
                  monthly_spend_limit_cents;
                  target_balance_cents;
                }
                 : update_auto_reload_request)));
     decode_reply = Request.json usage_snapshot_of_yojson;
     decode_error =
       Request.error_json [ 400; 402; 403; 500 ] ai_billing_error_body_of_yojson;
   }
    : (usage_snapshot, ai_billing_error_body) Macro_sdk_runtime.Request.t)

(** [POST /ai-billing/credits/checkout]

Start a Stripe Checkout for a credit pack. Payer only. *)
let create_ai_credit_checkout ~(amount_cents : int64) ~(cancel_url : string)
    ~(success_url : string) () =
  ({
     Request.service = "auth";
     operation = "create_ai_credit_checkout";
     meth = `POST;
     path = "/ai-billing/credits/checkout";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_credit_checkout_request_body
               ({ amount_cents; cancel_url; success_url }
                 : credit_checkout_request_body)));
     decode_reply = Request.json credit_checkout_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 402; 403; 500 ] ai_billing_error_body_of_yojson;
   }
    : ( credit_checkout_response,
        ai_billing_error_body )
      Macro_sdk_runtime.Request.t)

(** [POST /ai-billing/credits/purchase]

Buy a credit pack now, charged to the payer's card on file. Any paid team
member may buy, within the team's monthly credit limit. *)
let purchase_ai_credits ~(amount_cents : int64) () =
  ({
     Request.service = "auth";
     operation = "purchase_ai_credits";
     meth = `POST;
     path = "/ai-billing/credits/purchase";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_credit_purchase_request_body
               ({ amount_cents } : credit_purchase_request_body)));
     decode_reply = Request.json credit_purchase_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 402; 409; 500 ] ai_billing_error_body_of_yojson;
   }
    : ( credit_purchase_response,
        ai_billing_error_body )
      Macro_sdk_runtime.Request.t)

(** [PATCH /ai-billing/overage]

Retired direct-usage opt-in. Enabling is rejected; disabling remains supported. *)
let update_ai_billing_overage ~(enabled : bool) ?limit_cents () =
  ({
     Request.service = "auth";
     operation = "update_ai_billing_overage";
     meth = `PATCH;
     path = "/ai-billing/overage";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_overage_request
               ({ enabled; limit_cents } : update_overage_request)));
     decode_reply = Request.json usage_snapshot_of_yojson;
     decode_error =
       Request.error_json [ 400; 402; 403; 500 ] ai_billing_error_body_of_yojson;
   }
    : (usage_snapshot, ai_billing_error_body) Macro_sdk_runtime.Request.t)

(** [GET /ai-billing/plans]

The plan catalog, credit packs, overage cap bounds, and automatic reload
defaults and bounds. *)
let get_ai_billing_plans () =
  ({
     Request.service = "auth";
     operation = "get_ai_billing_plans";
     meth = `GET;
     path = "/ai-billing/plans";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json plan_catalog_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( plan_catalog_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /ai-billing/summary]

The caller's current-period AI usage, credits, and overage settings. *)
let get_ai_billing_summary () =
  ({
     Request.service = "auth";
     operation = "get_ai_billing_summary";
     meth = `GET;
     path = "/ai-billing/summary";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json usage_snapshot_of_yojson;
     decode_error = Request.error_json [ 500 ] ai_billing_error_body_of_yojson;
   }
    : (usage_snapshot, ai_billing_error_body) Macro_sdk_runtime.Request.t)

(** [GET /codex] *)
let get_codex_connection () =
  ({
     Request.service = "auth";
     operation = "get_codex_connection";
     meth = `GET;
     path = "/codex";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json codex_connection_status_of_yojson;
     decode_error = Request.no_error;
   }
    : ( codex_connection_status,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /codex] *)
let disconnect_codex () =
  ({
     Request.service = "auth";
     operation = "disconnect_codex";
     meth = `DELETE;
     path = "/codex";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [PUT /codex/config] *)
let configure_codex ~(environment_id : string) () =
  ({
     Request.service = "auth";
     operation = "configure_codex";
     meth = `PUT;
     path = "/codex/config";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_codex_config_request
               ({ environment_id } : codex_config_request)));
     decode_reply = Request.json codex_connection_status_of_yojson;
     decode_error = Request.no_error;
   }
    : ( codex_connection_status,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /codex/environments] *)
let list_codex_environments () =
  ({
     Request.service = "auth";
     operation = "list_codex_environments";
     meth = `GET;
     path = "/codex/environments";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list codex_environment_of_yojson);
     decode_error = Request.no_error;
   }
    : ( codex_environment list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /codex/login] *)
let start_codex_login () =
  ({
     Request.service = "auth";
     operation = "start_codex_login";
     meth = `POST;
     path = "/codex/login";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json codex_login_start_of_yojson;
     decode_error = Request.no_error;
   }
    : ( codex_login_start,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /codex/login/{attempt_id}] *)
let poll_codex_login ~(attempt_id : string) () =
  ({
     Request.service = "auth";
     operation = "poll_codex_login";
     meth = `GET;
     path =
       String.concat ""
         [ "/codex/login/"; Request.segment ((fun value -> value) attempt_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json codex_login_poll_of_yojson;
     decode_error = Request.no_error;
   }
    : ( codex_login_poll,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /codex/login/{attempt_id}] *)
let cancel_codex_login ~(attempt_id : string) () =
  ({
     Request.service = "auth";
     operation = "cancel_codex_login";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/codex/login/"; Request.segment ((fun value -> value) attempt_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /cursor-api-key]

Whether the caller has a Cursor API key registered. *)
let get_cursor_api_key () =
  ({
     Request.service = "auth";
     operation = "get_cursor_api_key";
     meth = `GET;
     path = "/cursor-api-key";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json cursor_api_key_status_of_yojson;
     decode_error = Request.error_json [ 403 ] error_response_of_yojson;
   }
    : (cursor_api_key_status, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /cursor-api-key]

Registers or replaces the caller's Cursor API key. *)
let put_cursor_api_key ~(api_key : string) () =
  ({
     Request.service = "auth";
     operation = "put_cursor_api_key";
     meth = `PUT;
     path = "/cursor-api-key";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_put_cursor_api_key_request
               ({ api_key } : put_cursor_api_key_request)));
     decode_reply = Request.json cursor_api_key_status_of_yojson;
     decode_error = Request.error_json [ 400; 403 ] error_response_of_yojson;
   }
    : (cursor_api_key_status, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /cursor-api-key]

Forgets the caller's Cursor API key. *)
let delete_cursor_api_key () =
  ({
     Request.service = "auth";
     operation = "delete_cursor_api_key";
     meth = `DELETE;
     path = "/cursor-api-key";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json cursor_api_key_status_of_yojson;
     decode_error = Request.error_json [ 403 ] error_response_of_yojson;
   }
    : (cursor_api_key_status, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /cursor-api-key/default-model]

Choose the model, and optionally the effort, this user's [@cursor] sessions
start on. *)
let put_cursor_default_model ?effort ?model_id () =
  ({
     Request.service = "auth";
     operation = "put_cursor_default_model";
     meth = `PUT;
     path = "/cursor-api-key/default-model";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_put_cursor_default_model_request
               ({ effort; model_id } : put_cursor_default_model_request)));
     decode_reply = Request.json cursor_api_key_status_of_yojson;
     decode_error = Request.error_json [ 403; 409 ] error_response_of_yojson;
   }
    : (cursor_api_key_status, error_response) Macro_sdk_runtime.Request.t)

(** [GET /cursor-api-key/models]

List the models the caller's Cursor account offers. *)
let list_cursor_models () =
  ({
     Request.service = "auth";
     operation = "list_cursor_models";
     meth = `GET;
     path = "/cursor-api-key/models";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json cursor_models_response_of_yojson;
     decode_error =
       Request.error_json [ 403; 409; 502 ] error_response_of_yojson;
   }
    : (cursor_models_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/fusionauth/verify/{verification_id}]

Verifies the user's primary email for FusionAuth *)
let verify_fusionauth_user_email ~(verification_id : string) () =
  ({
     Request.service = "auth";
     operation = "verify_fusionauth_user_email";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/fusionauth/verify/";
           Request.segment ((fun value -> value) verification_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/fusionauth_resend]

Resend the user's primary email verification for FusionAuth *)
let resend_fusionauth_verify_user_email ~(email : string) () =
  ({
     Request.service = "auth";
     operation = "resend_fusionauth_verify_user_email";
     meth = `POST;
     path = "/email/fusionauth_resend";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_resend_fusionauth_verify_user_email_request
               ({ email } : resend_fusionauth_verify_user_email_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/generate/link]

Generates an email link for the user to verify their email address. *)
let generate_email_link ~(email : string) () =
  ({
     Request.service = "auth";
     operation = "generate_email_link";
     meth = `POST;
     path = "/email/generate/link";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_generate_email_link_request
               ({ email } : generate_email_link_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 400; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/verify/{verification_id}]

Verifies the user's email for a user profile *)
let verify_email_link ~(verification_id : string) () =
  ({
     Request.service = "auth";
     operation = "verify_email_link";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/verify/";
           Request.segment ((fun value -> value) verification_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /github_pull_requests/draft]

Converts a GitHub pull request to a draft, or marks it ready for review,
as the authenticated user with their own GitHub grant. *)
let set_github_pull_request_draft ~(draft : bool) ~(number : int64)
    ~(owner : string) ~(repo : string) () =
  ({
     Request.service = "auth";
     operation = "set_github_pull_request_draft";
     meth = `POST;
     path = "/github_pull_requests/draft";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_set_github_pull_request_draft_request
               ({ draft; number; owner; repo }
                 : set_github_pull_request_draft_request)));
     decode_reply =
       Request.json set_github_pull_request_draft_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_draft_error)
         | 403 ->
             Some
               (Forbidden
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_draft_error)
         | 404 ->
             Some
               (Not_found
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_draft_error)
         | 422 ->
             Some
               (Unprocessable_entity
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_draft_error)
         | 428 ->
             Some
               (Precondition_required
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_draft_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_draft_error)
         | 502 ->
             Some
               (Bad_gateway
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : set_github_pull_request_draft_error)
         | 503 ->
             Some
               (Service_unavailable
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : set_github_pull_request_draft_error)
         | _ -> None);
   }
    : ( set_github_pull_request_draft_response,
        set_github_pull_request_draft_error )
      Macro_sdk_runtime.Request.t)

(** [POST /github_pull_requests/enrich]

Enriches GitHub pull request references with live GitHub data for the authenticated user. *)
let enrich_github_pull_requests ~(pull_requests : github_pull_request_ref list)
    () =
  ({
     Request.service = "auth";
     operation = "enrich_github_pull_requests";
     meth = `POST;
     path = "/github_pull_requests/enrich";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_enrich_github_pull_requests_proxy_request
               ({ pull_requests } : enrich_github_pull_requests_proxy_request)));
     decode_reply = Request.json enrich_github_pull_requests_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : enrich_github_pull_requests_error)
         | 404 ->
             Some
               (Not_found
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : enrich_github_pull_requests_error)
         | 428 ->
             Some
               (Precondition_required
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : enrich_github_pull_requests_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : enrich_github_pull_requests_error)
         | 502 ->
             Some
               (Bad_gateway
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : enrich_github_pull_requests_error)
         | 503 ->
             Some
               (Service_unavailable
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : enrich_github_pull_requests_error)
         | _ -> None);
   }
    : ( enrich_github_pull_requests_response,
        enrich_github_pull_requests_error )
      Macro_sdk_runtime.Request.t)

(** [POST /github_pull_requests/merge]

Merges a GitHub pull request as the authenticated user, with their own
GitHub grant. GitHub applies the user's permissions and the repository's
branch protections; a refusal is returned with GitHub's message. *)
let merge_github_pull_request ~(number : int64) ~(owner : string)
    ~(repo : string) ?merge_method () =
  ({
     Request.service = "auth";
     operation = "merge_github_pull_request";
     meth = `POST;
     path = "/github_pull_requests/merge";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_merge_github_pull_request_request
               ({ merge_method; number; owner; repo }
                 : merge_github_pull_request_request)));
     decode_reply = Request.json merge_github_pull_request_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | 403 ->
             Some
               (Forbidden
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | 404 ->
             Some
               (Not_found
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | 409 ->
             Some
               (Conflict
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | 422 ->
             Some
               (Unprocessable_entity
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | 428 ->
             Some
               (Precondition_required
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | 502 ->
             Some
               (Bad_gateway
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | 503 ->
             Some
               (Service_unavailable
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : merge_github_pull_request_error)
         | _ -> None);
   }
    : ( merge_github_pull_request_response,
        merge_github_pull_request_error )
      Macro_sdk_runtime.Request.t)

(** [POST /github_pull_requests/mergeability]

Reads whether each GitHub pull request merges cleanly into its base, as
the authenticated user sees it. Pull requests the user cannot see are
left out. *)
let get_github_pull_request_mergeability
    ~(pull_requests : github_pull_request_number list) () =
  ({
     Request.service = "auth";
     operation = "get_github_pull_request_mergeability";
     meth = `POST;
     path = "/github_pull_requests/mergeability";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_github_pull_request_mergeability_request
               ({ pull_requests } : github_pull_request_mergeability_request)));
     decode_reply =
       Request.json github_pull_request_mergeability_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : get_github_pull_request_mergeability_error)
         | 404 ->
             Some
               (Not_found
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : get_github_pull_request_mergeability_error)
         | 422 ->
             Some
               (Unprocessable_entity
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : get_github_pull_request_mergeability_error)
         | 428 ->
             Some
               (Precondition_required
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : get_github_pull_request_mergeability_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : get_github_pull_request_mergeability_error)
         | 502 ->
             Some
               (Bad_gateway
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : get_github_pull_request_mergeability_error)
         | 503 ->
             Some
               (Service_unavailable
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : get_github_pull_request_mergeability_error)
         | _ -> None);
   }
    : ( github_pull_request_mergeability_response,
        get_github_pull_request_mergeability_error )
      Macro_sdk_runtime.Request.t)

(** [POST /github_pull_requests/state]

Closes a GitHub pull request, or reopens it, as the authenticated user
with their own GitHub grant. *)
let set_github_pull_request_state ~(number : int64) ~(owner : string)
    ~(repo : string) ~(state : github_pull_request_state) () =
  ({
     Request.service = "auth";
     operation = "set_github_pull_request_state";
     meth = `POST;
     path = "/github_pull_requests/state";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_set_github_pull_request_state_request
               ({ number; owner; repo; state }
                 : set_github_pull_request_state_request)));
     decode_reply =
       Request.json set_github_pull_request_state_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_state_error)
         | 403 ->
             Some
               (Forbidden
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_state_error)
         | 404 ->
             Some
               (Not_found
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_state_error)
         | 422 ->
             Some
               (Unprocessable_entity
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_state_error)
         | 428 ->
             Some
               (Precondition_required
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_state_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : set_github_pull_request_state_error)
         | 502 ->
             Some
               (Bad_gateway
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : set_github_pull_request_state_error)
         | 503 ->
             Some
               (Service_unavailable
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : set_github_pull_request_state_error)
         | _ -> None);
   }
    : ( set_github_pull_request_state_response,
        set_github_pull_request_state_error )
      Macro_sdk_runtime.Request.t)

(** [GET /gtm-invite/links]

Lists invite links, newest first. Macro staff only. *)
let list_gtm_invite_links ?mine () =
  ({
     Request.service = "auth";
     operation = "list_gtm_invite_links";
     meth = `GET;
     path = "/gtm-invite/links";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "mine",
             match mine with
             | None -> []
             | Some value -> [ string_of_bool value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json gtm_invite_link_list_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 500 ] error_response_of_yojson;
   }
    : (gtm_invite_link_list, error_response) Macro_sdk_runtime.Request.t)

(** [POST /gtm-invite/links]

Creates an invite link. Macro staff only. *)
let create_gtm_invite_link ~(first_name : string) ?note ?recipient_email () =
  ({
     Request.service = "auth";
     operation = "create_gtm_invite_link";
     meth = `POST;
     path = "/gtm-invite/links";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_gtm_invite_link_request
               ({ first_name; note; recipient_email }
                 : create_gtm_invite_link_request)));
     decode_reply = Request.json gtm_invite_link_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 403; 500 ] error_response_of_yojson;
   }
    : (gtm_invite_link, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /gtm-invite/links/{id}]

Revokes an invite link nobody has signed up through. Macro staff only. *)
let revoke_gtm_invite_link ~(id : string) () =
  ({
     Request.service = "auth";
     operation = "revoke_gtm_invite_link";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/gtm-invite/links/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json gtm_invite_link_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : (gtm_invite_link, error_response) Macro_sdk_runtime.Request.t)

(** [GET /gtm-invite/offer]

The promotion the signed-in user's account holds from an invite link, if
they redeemed one and have not started a paid subscription yet. *)
let get_gtm_invite_offer () =
  ({
     Request.service = "auth";
     operation = "get_gtm_invite_offer";
     meth = `GET;
     path = "/gtm-invite/offer";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json gtm_invite_offer_status_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (gtm_invite_offer_status, error_response) Macro_sdk_runtime.Request.t)

(** [GET /gtm-invite/public/{token}]

Resolves an invite link for the public welcome page and counts the open. *)
let resolve_gtm_invite_link ~(token : string) () =
  ({
     Request.service = "auth";
     operation = "resolve_gtm_invite_link";
     meth = `GET;
     path =
       String.concat ""
         [ "/gtm-invite/public/"; Request.segment ((fun value -> value) token) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json public_gtm_invite_link_of_yojson;
     decode_error =
       Request.error_json [ 400; 404; 500 ] error_response_of_yojson;
   }
    : (public_gtm_invite_link, error_response) Macro_sdk_runtime.Request.t)

(** [POST /gtm-invite/redeem]

Attributes the signed-in user's account to the invite link they opened and
grants them its offer. Idempotent for the same account. *)
let redeem_gtm_invite_link ~(token : string) () =
  ({
     Request.service = "auth";
     operation = "redeem_gtm_invite_link";
     meth = `POST;
     path = "/gtm-invite/redeem";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_redeem_gtm_invite_link_request
               ({ token } : redeem_gtm_invite_link_request)));
     decode_reply = Request.json gtm_invite_offer_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 401; 404; 409; 410; 500 ]
         error_response_of_yojson;
   }
    : (gtm_invite_offer, error_response) Macro_sdk_runtime.Request.t)

(** [GET /health]

Health check *)
let health_handler () =
  ({
     Request.service = "auth";
     operation = "health_handler";
     meth = `GET;
     path = "/health";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( empty_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /jwt/macro_api_token]

Generates a macro-api-token using the user's macro-access-token
You can either have your access token in the cookies or in the request
headers
Authorization: Bearer <access_token>
This returns a new macro-api-token *)
let macro_api_token ~(email : string) () =
  ({
     Request.service = "auth";
     operation = "macro_api_token";
     meth = `GET;
     path = "/jwt/macro_api_token";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("email", [ (fun value -> value) email ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json macro_api_token_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( macro_api_token_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /jwt/refresh]

Refreshes a JWT token
You can either have your access token and refresh token in the cookies or in the request
headers
Authorization: Bearer <access_token>
x-macro-refresh-token: <refresh_token>
This returns the cookies with the new access and refresh token *)
let refresh () =
  ({
     Request.service = "auth";
     operation = "refresh";
     meth = `POST;
     path = "/jwt/refresh";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json user_tokens_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( user_tokens_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /link]

Initiates a link for a user *)
let create_in_progress_link () =
  ({
     Request.service = "auth";
     operation = "create_in_progress_link";
     meth = `POST;
     path = "/link";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json create_in_progress_link_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 429; 500 ] error_response_of_yojson;
   }
    : ( create_in_progress_link_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /link/email/providers] *)
let email_connection_providers ?original_url () =
  ({
     Request.service = "auth";
     operation = "email_connection_providers";
     meth = `GET;
     path = "/link/email/providers";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "original_url",
             match original_url with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json email_connection_providers_of_yojson;
     decode_error = Request.error_json [ 400; 401 ] error_response_of_yojson;
   }
    : (email_connection_providers, error_response) Macro_sdk_runtime.Request.t)

(** [POST /link/github]

Initiates a link for a user *)
let init_github_link ~(original_url : string) () =
  ({
     Request.service = "auth";
     operation = "init_github_link";
     meth = `POST;
     path = "/link/github";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("original_url", [ (fun value -> value) original_url ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json init_github_link_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 400 ->
             Some
               (Bad_request
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : init_github_link_error)
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : init_github_link_error)
         | 429 ->
             Some
               (Too_many_requests
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : init_github_link_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : init_github_link_error)
         | 502 ->
             Some
               (Bad_gateway
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : init_github_link_error)
         | 503 ->
             Some
               (Service_unavailable
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : init_github_link_error)
         | _ -> None);
   }
    : ( init_github_link_response,
        init_github_link_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /link/github]

Deletes a github link for a user *)
let delete_github_link () =
  ({
     Request.service = "auth";
     operation = "delete_github_link";
     meth = `DELETE;
     path = "/link/github";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 400 ->
             Some
               (Bad_request
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : delete_github_link_error)
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : delete_github_link_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : delete_github_link_error)
         | 502 ->
             Some
               (Bad_gateway
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : delete_github_link_error)
         | 503 ->
             Some
               (Service_unavailable
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : delete_github_link_error)
         | _ -> None);
   }
    : (empty_response, delete_github_link_error) Macro_sdk_runtime.Request.t)

(** [GET /link/github/status]

Checks whether the authenticated user's GitHub link token is valid. *)
let check_github_link_status () =
  ({
     Request.service = "auth";
     operation = "check_github_link_status";
     meth = `GET;
     path = "/link/github/status";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json github_link_status_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : check_github_link_status_error)
         | 404 ->
             Some
               (Not_found
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : check_github_link_status_error)
         | 428 ->
             Some
               (Precondition_required
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : check_github_link_status_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : check_github_link_status_error)
         | 502 ->
             Some
               (Bad_gateway
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : check_github_link_status_error)
         | 503 ->
             Some
               (Service_unavailable
                  (upstream_error_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : check_github_link_status_error)
         | _ -> None);
   }
    : ( github_link_status_response,
        check_github_link_status_error )
      Macro_sdk_runtime.Request.t)

(** [POST /link/gmail]

Initiates a Gmail link for a user *)
let init_gmail_link ~(original_url : string) ?reconnect_link_id ?scopes () =
  ({
     Request.service = "auth";
     operation = "init_gmail_link";
     meth = `POST;
     path = "/link/gmail";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ("original_url", [ (fun value -> value) original_url ]);
           ( "reconnect_link_id",
             match reconnect_link_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "scopes",
             match scopes with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json init_gmail_link_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 402; 429; 500 ] error_response_of_yojson;
   }
    : (init_gmail_link_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /link/gmail/status]

Checks whether the authenticated user's gmail link is valid. *)
let check_gmail_link_status () =
  ({
     Request.service = "auth";
     operation = "check_gmail_link_status";
     meth = `GET;
     path = "/link/gmail/status";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json gmail_link_status_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 428; 500 ] error_response_of_yojson;
   }
    : (gmail_link_status_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /link/outlook]

Initiates a Microsoft Outlook account link for an authenticated user. *)
let init_outlook_link ?original_url ?scopes ?reconnect_link_id () =
  ({
     Request.service = "auth";
     operation = "init_outlook_link";
     meth = `POST;
     path = "/link/outlook";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "original_url",
             match original_url with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "scopes",
             match scopes with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "reconnect_link_id",
             match reconnect_link_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json init_outlook_link_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 401; 402; 404; 429; 500 ]
         error_response_of_yojson;
   }
    : (init_outlook_link_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /login/apple]

Completes the apple login flow *)
let apple_login ~(code : string) ~(id_token : string) () =
  ({
     Request.service = "auth";
     operation = "apple_login";
     meth = `POST;
     path = "/login/apple";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_apple_login_request
               ({ code; id_token } : apple_login_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /login/password]

Performs a password login *)
let password_login ~(email : string) ~(password : string) () =
  ({
     Request.service = "auth";
     operation = "password_login";
     meth = `POST;
     path = "/login/password";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_password_request
               ({ email; password } : password_request)));
     decode_reply = Request.json user_tokens_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (user_tokens_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /login/passwordless]

Initiates a passwordless login *)
let passwordless_login ~(email : string) ~(redirect_uri : string) ?is_agent
    ?referral_code () =
  ({
     Request.service = "auth";
     operation = "passwordless_login";
     meth = `POST;
     path = "/login/passwordless";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_passwordless_request
               ({ email; is_agent; redirect_uri; referral_code }
                 : passwordless_request)));
     decode_reply =
       Request.by_status
         [
           ( 200,
             fun body ->
               (Ok_
                  (passwordless_started_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : passwordless_login_reply) );
           ( 202,
             fun body ->
               (Accepted
                  (sso_required_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : passwordless_login_reply) );
         ];
     decode_error = Request.no_error;
   }
    : ( passwordless_login_reply,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /login/sso]

Initiates an SSO login *)
let sso_login ~(idp_name : string) ~(idp_id : string) ~(login_hint : string)
    ~(original_url : string) ~(is_mobile : string) ~(referral_code : string)
    ~(is_agent : bool) () =
  ({
     Request.service = "auth";
     operation = "sso_login";
     meth = `GET;
     path = "/login/sso";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ("idp_name", [ (fun value -> value) idp_name ]);
           ("idp_id", [ (fun value -> value) idp_id ]);
           ("login_hint", [ (fun value -> value) login_hint ]);
           ("original_url", [ (fun value -> value) original_url ]);
           ("is_mobile", [ (fun value -> value) is_mobile ]);
           ("referral_code", [ (fun value -> value) referral_code ]);
           ("is_agent", [ string_of_bool is_agent ]);
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 400; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [POST /logout]

Initiates a passwordless login *)
let logout () =
  ({
     Request.service = "auth";
     operation = "logout";
     meth = `POST;
     path = "/logout";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( empty_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /merge]

Creates a merge request used to verify the user's email address in order to merge their
accounts.
This is different than generate_email_link which is used to verify a new email address to add a
new profile to a user's account. *)
let create_merge_request ~(email : string) () =
  ({
     Request.service = "auth";
     operation = "create_merge_request";
     meth = `POST;
     path = "/merge";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_account_merge_request
               ({ email } : create_account_merge_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /merge/verify/{code}]

Verifies the merge request *)
let verify_merge_request ~(code : string) () =
  ({
     Request.service = "auth";
     operation = "verify_merge_request";
     meth = `GET;
     path =
       String.concat ""
         [ "/merge/verify/"; Request.segment ((fun value -> value) code) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /mobile-welcome-email]

Emails a mobile lead a link to continue onboarding on desktop and enrolls
them in the Loops welcome sequence. No-ops if the address was already
captured, and rejects blocked addresses. *)
let send_mobile_welcome_email ~(email : string) () =
  ({
     Request.service = "auth";
     operation = "send_mobile_welcome_email";
     meth = `POST;
     path = "/mobile-welcome-email";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_send_mobile_welcome_email_request
               ({ email } : send_mobile_welcome_email_request)));
     decode_reply = Request.json send_mobile_welcome_email_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 429; 500 ] error_response_of_yojson;
   }
    : ( send_mobile_welcome_email_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /oauth/passwordless/{code}]

Handles oauth redirect *)
let passwordless_callback ~(code : string) ~(email : string) () =
  ({
     Request.service = "auth";
     operation = "passwordless_callback";
     meth = `GET;
     path =
       String.concat ""
         [ "/oauth/passwordless/"; Request.segment ((fun value -> value) code) ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("email", [ (fun value -> value) email ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json user_tokens_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( user_tokens_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /oauth/redirect]

Handles oauth redirect *)
let oauth_redirect () =
  ({
     Request.service = "auth";
     operation = "oauth_redirect";
     meth = `GET;
     path = "/oauth/redirect";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /oauth2/{provider}/callback]

Custom OAuth2 callback *)
let oauth2_callback ~(provider : string) () =
  ({
     Request.service = "auth";
     operation = "oauth2_callback";
     meth = `GET;
     path =
       String.concat ""
         [
           "/oauth2/";
           Request.segment ((fun value -> value) provider);
           "/callback";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 304; 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /permissions]

Gets all permissions *)
let get_permissions () =
  ({
     Request.service = "auth";
     operation = "get_permissions";
     meth = `GET;
     path = "/permissions";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list permission_of_yojson);
     decode_error = Request.no_error;
   }
    : ( permission list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /permissions/me]

Gets a list of the users permissions *)
let get_user_permissions () =
  ({
     Request.service = "auth";
     operation = "get_user_permissions";
     meth = `GET;
     path = "/permissions/me";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list Json.string);
     decode_error = Request.no_error;
   }
    : ( string list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /referral/code]

Handler for [GET /referral-code]. *)
let get_referral_code () =
  ({
     Request.service = "auth";
     operation = "get_referral_code";
     meth = `GET;
     path = "/referral/code";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.text;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (string, error_response) Macro_sdk_runtime.Request.t)

(** [POST /referral/send]

Handler for [POST /referral/send]. *)
let send_referral_code ~(recipient : string) () =
  ({
     Request.service = "auth";
     operation = "send_referral_code";
     meth = `POST;
     path = "/referral/send";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_send_invite_body ({ recipient } : send_invite_body)));
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [POST /session]

Refreshes a JWT token *)
let session_creation () =
  ({
     Request.service = "auth";
     operation = "session_creation";
     meth = `POST;
     path = "/session";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /session/login/{session_code}]

Performs a login via session code *)
let session_login ~(session_code : string) () =
  ({
     Request.service = "auth";
     operation = "session_login";
     meth = `GET;
     path =
       String.concat ""
         [
           "/session/login/";
           Request.segment ((fun value -> value) session_code);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json user_tokens_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (user_tokens_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /system-status]

The status every user sees. Public: the banner shows wherever the app
runs, signed in or not. *)
let get_system_status () =
  ({
     Request.service = "auth";
     operation = "get_system_status";
     meth = `GET;
     path = "/system-status";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json current_system_status_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (current_system_status, error_response) Macro_sdk_runtime.Request.t)

(** [POST /system-status]

Sets the status every user sees and pushes it to every open app. Macro
staff only. *)
let set_system_status ~(body : system_status) () =
  ({
     Request.service = "auth";
     operation = "set_system_status";
     meth = `POST;
     path = "/system-status";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (yojson_of_system_status body));
     decode_reply = Request.json status_update_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 500 ] error_response_of_yojson;
   }
    : (status_update, error_response) Macro_sdk_runtime.Request.t)

(** [GET /system-status/history]

Recent status updates, newest first, with who set each. Macro staff only. *)
let list_system_status_history () =
  ({
     Request.service = "auth";
     operation = "list_system_status_history";
     meth = `GET;
     path = "/system-status/history";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json system_status_history_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 500 ] error_response_of_yojson;
   }
    : (system_status_history, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team]

Gets a team by ID. *)
let get_team () =
  ({
     Request.service = "auth";
     operation = "get_team";
     meth = `GET;
     path = "/team";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.by_status
         [
           ( 200,
             fun body ->
               (Ok_ (team_with_members_of_yojson (Yojson.Safe.from_string body))
                 : get_team_reply) );
           (204, fun _body -> (No_content : get_team_reply));
         ];
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (get_team_reply, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team]

Creates a new team. *)
let create_team ~(name : string) ?allow_domain_join () =
  ({
     Request.service = "auth";
     operation = "create_team";
     meth = `POST;
     path = "/team";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_team_request
               ({ allow_domain_join; name } : create_team_request)));
     decode_reply = Request.json team_of_yojson;
     decode_error =
       Request.error_json [ 400; 403; 409; 500 ] error_response_of_yojson;
   }
    : (team, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /team]

Deletes a team.
This will update all team members roles and cancel your subscription for the team.
This action is **irreversible** and you will not be able to recover the team afterwards. *)
let delete_team () =
  ({
     Request.service = "auth";
     operation = "delete_team";
     meth = `DELETE;
     path = "/team";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /team]

Updates a team. *)
let patch_team ?default_link_share ?language ?name ?slug ?user_role_updates () =
  ({
     Request.service = "auth";
     operation = "patch_team";
     meth = `PATCH;
     path = "/team";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_patch_team_request
               ({ default_link_share; language; name; slug; user_role_updates }
                 : patch_team_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/auto-join-domain/toggle]

Toggles automatic domain joining for the team. When the team has no
auto-join domain, sets it to the team owner's email domain — rejected
with a 400 when that domain is a generic email provider domain (e.g.
gmail.com). When one is already set, removes it. New users whose email
domain matches a team's auto-join domain are added to that team on
signup. Requires the caller to be an Admin or Owner of the team. *)
let toggle_team_auto_join_domain () =
  ({
     Request.service = "auth";
     operation = "toggle_team_auto_join_domain";
     meth = `POST;
     path = "/team/auto-join-domain/toggle";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json toggle_auto_join_domain_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : ( toggle_auto_join_domain_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /team/computers]

The team's computers, oldest first. *)
let list_team_computers () =
  ({
     Request.service = "auth";
     operation = "list_team_computers";
     meth = `GET;
     path = "/team/computers";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list computer_status_of_yojson);
     decode_error = Request.error_json [ 401; 403 ] error_response_of_yojson;
   }
    : (computer_status list, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/computers]

Buy a computer for the team, billed on the team subscription. An error
means nothing was charged; 202 means the charge is still being confirmed. *)
let purchase_team_computer ~(purchase_key : string) ~(size : computer_size)
    ?name () =
  ({
     Request.service = "auth";
     operation = "purchase_team_computer";
     meth = `POST;
     path = "/team/computers";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_purchase_body
               ({ name; purchase_key; size } : purchase_body)));
     decode_reply = Request.json purchased_of_yojson;
     decode_error =
       Request.error_json [ 402; 409; 503 ] error_response_of_yojson;
   }
    : (purchased, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team/computers/offers]

Every size with its price and availability. *)
let list_team_computer_offers () =
  ({
     Request.service = "auth";
     operation = "list_team_computer_offers";
     meth = `GET;
     path = "/team/computers/offers";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list size_offer_of_yojson);
     decode_error = Request.error_json [ 503 ] error_response_of_yojson;
   }
    : (size_offer list, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/computers/{computer_id}/cancel]

Stop billing at the end of the current period. *)
let cancel_team_computer ~(computer_id : string) () =
  ({
     Request.service = "auth";
     operation = "cancel_team_computer";
     meth = `POST;
     path =
       String.concat ""
         [
           "/team/computers/";
           Request.segment ((fun value -> value) computer_id);
           "/cancel";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json computer_status_of_yojson;
     decode_error = Request.no_error;
   }
    : ( computer_status,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /team/computers/{computer_id}/cancel]

Keep a computer that was canceled at period end. *)
let undo_cancel_team_computer ~(computer_id : string) () =
  ({
     Request.service = "auth";
     operation = "undo_cancel_team_computer";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/team/computers/";
           Request.segment ((fun value -> value) computer_id);
           "/cancel";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json computer_status_of_yojson;
     decode_error = Request.no_error;
   }
    : ( computer_status,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /team/computers/{computer_id}/power]

Turn a computer on or off. A computer that is off keeps its disk and stays billed. *)
let set_team_computer_power ~(computer_id : string) ~(on : bool) () =
  ({
     Request.service = "auth";
     operation = "set_team_computer_power";
     meth = `POST;
     path =
       String.concat ""
         [
           "/team/computers/";
           Request.segment ((fun value -> value) computer_id);
           "/power";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (yojson_of_power_body ({ on } : power_body)));
     decode_reply = Request.json computer_status_of_yojson;
     decode_error = Request.no_error;
   }
    : ( computer_status,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /team/computers/{computer_id}/release]

Stop billing and destroy the computer now, without a refund. *)
let release_team_computer ~(computer_id : string) ~(confirm_name : string) () =
  ({
     Request.service = "auth";
     operation = "release_team_computer";
     meth = `POST;
     path =
       String.concat ""
         [
           "/team/computers/";
           Request.segment ((fun value -> value) computer_id);
           "/release";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_release_body ({ confirm_name } : release_body)));
     decode_reply = Request.json computer_status_of_yojson;
     decode_error = Request.error_json [ 400 ] error_response_of_yojson;
   }
    : (computer_status, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/computers/{computer_id}/restore]

Keep a computer whose billing ended, during retention: re-adds its
billing item (the rest of the period is invoiced now) and keeps the
stopped computer and its disk. *)
let restore_team_computer ~(computer_id : string) () =
  ({
     Request.service = "auth";
     operation = "restore_team_computer";
     meth = `POST;
     path =
       String.concat ""
         [
           "/team/computers/";
           Request.segment ((fun value -> value) computer_id);
           "/restore";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json computer_status_of_yojson;
     decode_error = Request.error_json [ 402; 409 ] error_response_of_yojson;
   }
    : (computer_status, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/computers/{computer_id}/retry]

Retry a failed computer without changing billing. *)
let retry_team_computer ~(computer_id : string) () =
  ({
     Request.service = "auth";
     operation = "retry_team_computer";
     meth = `POST;
     path =
       String.concat ""
         [
           "/team/computers/";
           Request.segment ((fun value -> value) computer_id);
           "/retry";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json computer_status_of_yojson;
     decode_error = Request.error_json [ 404; 409 ] error_response_of_yojson;
   }
    : (computer_status, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/computers/{computer_id}/setup-complete]

Mark the guided setup after buying the computer finished. Idempotent;
allowed to the team's owner and admins, like Claude sign-in. *)
let complete_team_computer_setup ~(computer_id : string) () =
  ({
     Request.service = "auth";
     operation = "complete_team_computer_setup";
     meth = `POST;
     path =
       String.concat ""
         [
           "/team/computers/";
           Request.segment ((fun value -> value) computer_id);
           "/setup-complete";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json computer_status_of_yojson;
     decode_error = Request.error_json [ 403; 404 ] error_response_of_yojson;
   }
    : (computer_status, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /team/crm]

Legacy compatibility endpoint for team admins and owners. Enabling
is a no-op; disabling is rejected. CRM records remain available.
Each member manages mailbox contribution through [/crm/email-privacy];
this endpoint does not enroll mailboxes, backfill emails, or purge records. *)
let patch_team_crm_settings ~(enabled : bool) ?backfill () =
  ({
     Request.service = "auth";
     operation = "patch_team_crm_settings";
     meth = `PATCH;
     path = "/team/crm";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_patch_team_crm_settings_request
               ({ backfill; enabled } : patch_team_crm_settings_request)));
     decode_reply = Request.json patch_team_crm_settings_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : ( patch_team_crm_settings_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [POST /team/domain-notice]

Emails the caller's contacts on the team's auto-join domain that the team
exists, so they can sign up and join. Contacts already on Macro, on the
team, invited, or emailed before are skipped, and a team emails at most 25
people in total. Call it after sending the team's invites. Requires the
caller to be an Admin or Owner of the team. *)
let send_team_domain_notice () =
  ({
     Request.service = "auth";
     operation = "send_team_domain_notice";
     meth = `POST;
     path = "/team/domain-notice";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json send_domain_notice_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 500 ] error_response_of_yojson;
   }
    : (send_domain_notice_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/invite]

Invites a user to a team. *)
let invite_to_team ~(invites : invite_entry list) ?is_agent ?team_id () =
  ({
     Request.service = "auth";
     operation = "invite_to_team";
     meth = `POST;
     path = "/team/invite";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_invite_to_team_request
               ({ invites; is_agent; team_id } : invite_to_team_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 404; 409; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team/invite-link]

Gets the team's invite link. Anyone who may invite people to the team may
see it. *)
let get_team_invite_link () =
  ({
     Request.service = "auth";
     operation = "get_team_invite_link";
     meth = `GET;
     path = "/team/invite-link";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json team_invite_link_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 500 ] error_response_of_yojson;
   }
    : (team_invite_link_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/invite-link]

Creates the team's invite link, replacing any existing one. Anyone who may
invite people may create the first link; replacing one requires a team
admin or owner. *)
let create_team_invite_link () =
  ({
     Request.service = "auth";
     operation = "create_team_invite_link";
     meth = `POST;
     path = "/team/invite-link";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json created_team_invite_link_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 500 ] error_response_of_yojson;
   }
    : ( created_team_invite_link_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [DELETE /team/invite-link]

Turns off the team's invite link. Requires a team admin or owner. *)
let delete_team_invite_link () =
  ({
     Request.service = "auth";
     operation = "delete_team_invite_link";
     meth = `DELETE;
     path = "/team/invite-link";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 401; 403; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/invite-link/join]

Joins the team an invite link belongs to. *)
let join_team_by_invite_link ~(token : team_invite_link_token) () =
  ({
     Request.service = "auth";
     operation = "join_team_by_invite_link";
     meth = `POST;
     path = "/team/invite-link/join";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_team_invite_link_token_request
               ({ token } : team_invite_link_token_request)));
     decode_reply = Request.json join_team_by_invite_link_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 409; 500 ] error_response_of_yojson;
   }
    : ( join_team_by_invite_link_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [POST /team/invite-link/team]

Gets the team an invite link joins, so the user can see it before joining. *)
let get_team_by_invite_link ~(token : team_invite_link_token) () =
  ({
     Request.service = "auth";
     operation = "get_team_by_invite_link";
     meth = `POST;
     path = "/team/invite-link/team";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_team_invite_link_token_request
               ({ token } : team_invite_link_token_request)));
     decode_reply = Request.json team_invite_link_team_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 500 ] error_response_of_yojson;
   }
    : (team_invite_link_team, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /team/invite/{team_invite_id}]

Deletes a team invite from a team. *)
let delete_team_invite_handler ~(team_invite_id : string) () =
  ({
     Request.service = "auth";
     operation = "delete_team_invite_handler";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/team/invite/";
           Request.segment ((fun value -> value) team_invite_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team/invites]

Gets all invites for a team. *)
let get_team_invites ?team_id () =
  ({
     Request.service = "auth";
     operation = "get_team_invites";
     meth = `GET;
     path = "/team/invites";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "team_id",
             match team_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json team_invites_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 409; 500 ] error_response_of_yojson;
   }
    : (team_invites_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team/join/{team_invite_id}]

Joins a team by accepting an invite. *)
let join_team ~(team_invite_id : string) () =
  ({
     Request.service = "auth";
     operation = "join_team";
     meth = `GET;
     path =
       String.concat ""
         [
           "/team/join/"; Request.segment ((fun value -> value) team_invite_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /team/join/{team_invite_id}]

Rejects an invitation to join a team. *)
let reject_invitation ~(team_invite_id : string) () =
  ({
     Request.service = "auth";
     operation = "reject_invitation";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/team/join/"; Request.segment ((fun value -> value) team_invite_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /team/members/{member_user_id}/plan]

Moves one team member's seat between paid plans. *)
let patch_team_member_plan ~(member_user_id : string) ~(plan : seat_plan) () =
  ({
     Request.service = "auth";
     operation = "patch_team_member_plan";
     meth = `PATCH;
     path =
       String.concat ""
         [
           "/team/members/";
           Request.segment ((fun value -> value) member_user_id);
           "/plan";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_patch_team_member_plan_request
               ({ plan } : patch_team_member_plan_request)));
     decode_reply = Request.json team_member_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 402; 404; 500 ] error_response_of_yojson;
   }
    : (team_member, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team/non-admin-invites/toggle]

Toggles whether non-admin members may invite users to the team. Teams
start with this on (any member can invite); turning it off restricts
inviting to team admins and owners. Requires the caller to be an Admin
or Owner of the team. *)
let toggle_team_non_admin_invites () =
  ({
     Request.service = "auth";
     operation = "toggle_team_non_admin_invites";
     meth = `POST;
     path = "/team/non-admin-invites/toggle";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json toggle_non_admin_invites_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : ( toggle_non_admin_invites_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [DELETE /team/remove/{remove_user_id}]

Removes a user from a team. *)
let remove_user_from_team ~(remove_user_id : string) () =
  ({
     Request.service = "auth";
     operation = "remove_user_from_team";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/team/remove/";
           Request.segment ((fun value -> value) remove_user_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team/user]

Gets all teams for the authenticated user. *)
let get_user_teams () =
  ({
     Request.service = "auth";
     operation = "get_user_teams";
     meth = `GET;
     path = "/team/user";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list team_of_yojson);
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (team list, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team/user/invites]

Gets all of a user's invitations. *)
let get_user_invites () =
  ({
     Request.service = "auth";
     operation = "get_user_invites";
     meth = `GET;
     path = "/team/user/invites";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json team_invites_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (team_invites_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team_agents]

The caller's team's agents, with their computers' status. *)
let list_team_agents () =
  ({
     Request.service = "auth";
     operation = "list_team_agents";
     meth = `GET;
     path = "/team_agents";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json team_agents_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 500 ] error_response_of_yojson;
   }
    : (team_agents, error_response) Macro_sdk_runtime.Request.t)

(** [POST /team_agents]

Invite an agent teammate and buy its computer. Requires a team admin or
owner using their own credential. The agent comes back [provisioning]. *)
let create_team_agent ~(job_description : string) ~(name : string)
    ~(personality : string) ~(purchase_key : string) ~(size : string)
    ?avatar_url ?voice () =
  ({
     Request.service = "auth";
     operation = "create_team_agent";
     meth = `POST;
     path = "/team_agents";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_team_agent
               ({
                  avatar_url;
                  job_description;
                  name;
                  personality;
                  purchase_key;
                  size;
                  voice;
                }
                 : create_team_agent)));
     decode_reply = Request.json team_agent_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 401; 403; 409; 500; 502 ]
         error_response_of_yojson;
   }
    : (team_agent, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /team_agents/{agent_user_id}]

Remove an agent teammate: release its computer, take it off the team and
delete its repository and account. Requires a team admin or owner. *)
let delete_team_agent ~(agent_user_id : string) () =
  ({
     Request.service = "auth";
     operation = "delete_team_agent";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/team_agents/"; Request.segment ((fun value -> value) agent_user_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json
         [ 400; 401; 403; 404; 500; 502 ]
         error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /team_agents/{agent_user_id}/voice]

The agent's call voice, as committed in its workspace repository.
Requires a team admin or owner. *)
let get_team_agent_voice ~(agent_user_id : string) () =
  ({
     Request.service = "auth";
     operation = "get_team_agent_voice";
     meth = `GET;
     path =
       String.concat ""
         [
           "/team_agents/";
           Request.segment ((fun value -> value) agent_user_id);
           "/voice";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_voice_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 401; 403; 404; 500; 502 ]
         error_response_of_yojson;
   }
    : (agent_voice, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /team_agents/{agent_user_id}/voice]

Change the agent's call voice: a commit to its workspace repository that
its next call picks up. Requires a team admin or owner. *)
let set_team_agent_voice ~(agent_user_id : string) ~(model : string) () =
  ({
     Request.service = "auth";
     operation = "set_team_agent_voice";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/team_agents/";
           Request.segment ((fun value -> value) agent_user_id);
           "/voice";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some (Request.Json (yojson_of_agent_voice ({ model } : agent_voice)));
     decode_reply = Request.json agent_voice_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 401; 403; 404; 500; 502 ]
         error_response_of_yojson;
   }
    : (agent_voice, error_response) Macro_sdk_runtime.Request.t)

(** [POST /user/agent_setup]

Finishes an agent's signup: joins the team that invited it and mints its
SDK token. *)
let agent_setup () =
  ({
     Request.service = "auth";
     operation = "agent_setup";
     meth = `POST;
     path = "/user/agent_setup";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_setup_response_of_yojson;
     decode_error =
       Request.error_json [ 403; 409; 500 ] error_response_of_yojson;
   }
    : (agent_setup_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /user/get_names]

Retrieves user names in bulk *)
let get_user_names ~(user_ids : string list) () =
  ({
     Request.service = "auth";
     operation = "get_user_names";
     meth = `POST;
     path = "/user/get_names";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_post_get_names_request_body
               ({ user_ids } : post_get_names_request_body)));
     decode_reply = Request.json user_names_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (user_names, error_response) Macro_sdk_runtime.Request.t)

(** [POST /user/get_names_with_email]

Gets names for passed user profile ids, falling back to the requesting user's email contact names *)
let get_user_names_with_email ~(user_ids : string list) () =
  ({
     Request.service = "auth";
     operation = "get_user_names_with_email";
     meth = `POST;
     path = "/user/get_names_with_email";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_get_names_with_email_request_body
               ({ user_ids } : get_names_with_email_request_body)));
     decode_reply = Request.json user_names_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (user_names, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /user/group]

Updates the user's group. *)
let patch_user_group ~(group : string) () =
  ({
     Request.service = "auth";
     operation = "patch_user_group";
     meth = `PATCH;
     path = "/user/group";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_patch_user_group_request
               ({ group } : patch_user_group_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /user/language]

Get the caller's interface language. *)
let get_user_language () =
  ({
     Request.service = "auth";
     operation = "get_user_language";
     meth = `GET;
     path = "/user/language";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json user_language_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 500 ] error_response_of_yojson;
   }
    : (user_language, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /user/language]

Set the caller's interface language, or clear it to follow their team's,
else their browser's. *)
let put_user_language ?language () =
  ({
     Request.service = "auth";
     operation = "put_user_language";
     meth = `PUT;
     path = "/user/language";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json (yojson_of_user_language ({ language } : user_language)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /user/legacy_user_permissions]

Gets the calling user's info which matches what was given in the **deprecated**
getUserPermissions query in our graphql api.
This will eventually be removed and optimized to use smaller calls that grab
what is needed for various parts of the UI. *)
let get_legacy_user_permissions () =
  ({
     Request.service = "auth";
     operation = "get_legacy_user_permissions";
     meth = `GET;
     path = "/user/legacy_user_permissions";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_legacy_user_permissions_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : ( get_legacy_user_permissions_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /user/link_exists]

Returns whether or not a given idp link exists for a user *)
let get_user_link_exists ~(idp_name : string) ~(idp_id : string) () =
  ({
     Request.service = "auth";
     operation = "get_user_link_exists";
     meth = `GET;
     path = "/user/link_exists";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ("idp_name", [ (fun value -> value) idp_name ]);
           ("idp_id", [ (fun value -> value) idp_id ]);
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json user_link_response_of_yojson;
     decode_error = Request.error_json [ 400; 500 ] error_response_of_yojson;
   }
    : (user_link_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /user/me]

Gets the calling user's info *)
let get_user_info () =
  ({
     Request.service = "auth";
     operation = "get_user_info";
     meth = `GET;
     path = "/user/me";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_user_info_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (get_user_info, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /user/me]

Deletes the user who calls this endpoint *)
let delete_user () =
  ({
     Request.service = "auth";
     operation = "delete_user";
     meth = `DELETE;
     path = "/user/me";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json generic_success_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (generic_success_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /user/name]

Retrieves the name of a particular user. *)
let get_user_name () =
  ({
     Request.service = "auth";
     operation = "get_user_name";
     meth = `GET;
     path = "/user/name";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json user_name_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (user_name, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /user/name]

Sets the name of a particular user *)
let put_user_name ?first_name ?last_name () =
  ({
     Request.service = "auth";
     operation = "put_user_name";
     meth = `PUT;
     path = "/user/name";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "first_name",
             match first_name with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "last_name",
             match last_name with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /user/onboarding]

Updates the user's onboarding. *)
let patch_user_onboarding ~(first_name : string) ~(industry : string)
    ~(last_name : string) ~(title : string) () =
  ({
     Request.service = "auth";
     operation = "patch_user_onboarding";
     meth = `PATCH;
     path = "/user/onboarding";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_patch_user_onboarding_request
               ({ first_name; industry; last_name; title }
                 : patch_user_onboarding_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /user/organization]

Retrieves the users organization if present.
Returns NO_CONTENT if the user is a not part of an organization. *)
let get_user_organization () =
  ({
     Request.service = "auth";
     operation = "get_user_organization";
     meth = `GET;
     path = "/user/organization";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.by_status
         [
           ( 200,
             fun body ->
               (Ok_
                  (user_organization_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : get_user_organization_reply) );
           (204, fun _body -> (No_content : get_user_organization_reply));
         ];
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (get_user_organization_reply, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /user/profile_picture]

Sets the profile picture URL for a particular user *)
let put_profile_picture ~(url : string) () =
  ({
     Request.service = "auth";
     operation = "put_profile_picture";
     meth = `PUT;
     path = "/user/profile_picture";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("url", [ (fun value -> value) url ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 429; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /user/profile_picture/file]

Sets the caller's profile picture to an image they uploaded. *)
let put_profile_picture_file ~(file_id : string) () =
  ({
     Request.service = "auth";
     operation = "put_profile_picture_file";
     meth = `PUT;
     path = "/user/profile_picture/file";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_put_profile_picture_file_request
               ({ file_id } : put_profile_picture_file_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 404; 429; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /user/profile_picture/file]

Reserves storage for a new profile picture. Static file storage has no
MacroDB, so it cannot check API keys; this route lets key holders upload. *)
let create_profile_picture_upload ~(content_type : string) ~(file_name : string)
    ~(size_bytes : int64) () =
  ({
     Request.service = "auth";
     operation = "create_profile_picture_upload";
     meth = `POST;
     path = "/user/profile_picture/file";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_profile_picture_upload_request
               ({ content_type; file_name; size_bytes }
                 : create_profile_picture_upload_request)));
     decode_reply = Request.json profile_picture_upload_of_yojson;
     decode_error =
       Request.error_json [ 400; 413; 429; 500 ] error_response_of_yojson;
   }
    : (profile_picture_upload, error_response) Macro_sdk_runtime.Request.t)

(** [POST /user/profile_pictures]

Retrieves profile picture URLs for a list of users *)
let post_profile_pictures ~(user_id_list : string list) () =
  ({
     Request.service = "auth";
     operation = "post_profile_pictures";
     meth = `POST;
     path = "/user/profile_pictures";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_get_profile_pictures_request_body
               ({ user_id_list } : get_profile_pictures_request_body)));
     decode_reply = Request.json profile_pictures_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (profile_pictures, error_response) Macro_sdk_runtime.Request.t)

(** [GET /user/quota]

Retrieves the users quota.
Returns NO_CONTENT if the user is a premium user with no quota. *)
let get_user_quota () =
  ({
     Request.service = "auth";
     operation = "get_user_quota";
     meth = `GET;
     path = "/user/quota";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.by_status
         [
           ( 200,
             fun body ->
               (Ok_ (user_quota_of_yojson (Yojson.Safe.from_string body))
                 : get_user_quota_reply) );
           (204, fun _body -> (No_content : get_user_quota_reply));
         ];
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (get_user_quota_reply, error_response) Macro_sdk_runtime.Request.t)

(** [POST /user/stripe/checkoutv2]

Creates a Stripe checkout session for the user to subscribe. *)
let create_checkout_session_v2 ~(cancel_url : string) ~(success_url : string)
    ?discount ?metadata ?onboarding_trial ?plan () =
  ({
     Request.service = "auth";
     operation = "create_checkout_session_v2";
     meth = `POST;
     path = "/user/stripe/checkoutv2";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_checkout_session_v2_request
               ({
                  cancel_url;
                  discount;
                  metadata;
                  onboarding_trial;
                  plan;
                  success_url;
                }
                 : create_checkout_session_v2_request)));
     decode_reply = Request.json checkout_session_v2_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 404; 409; 500 ] error_response_of_yojson;
   }
    : (checkout_session_v2_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /user/stripe/plan]

Read subscription state for the authenticated user's seat. *)
let get_subscription_status () =
  ({
     Request.service = "auth";
     operation = "get_subscription_status";
     meth = `GET;
     path = "/user/stripe/plan";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json subscription_status_of_yojson;
     decode_error =
       Request.error_json [ 401; 409; 500 ] error_response_of_yojson;
   }
    : (subscription_status, error_response) Macro_sdk_runtime.Request.t)

(** [POST /user/stripe/plan]

Changes the caller's paid plan. Upgrades are prorated immediately;
downgrades retain the active plan until renewal. Selecting the active plan
cancels a pending downgrade without charging or resetting usage. *)
let change_plan ~(plan : seat_plan) () =
  ({
     Request.service = "auth";
     operation = "change_plan";
     meth = `POST;
     path = "/user/stripe/plan";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_change_plan_request ({ plan } : change_plan_request)));
     decode_reply = Request.json change_plan_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 402; 403; 404; 409; 500 ]
         error_response_of_yojson;
   }
    : (change_plan_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /user/stripe/portal]

Creates a Stripe billing portal session. *)
let create_portal_session ~(return_url : string) () =
  ({
     Request.service = "auth";
     operation = "create_portal_session";
     meth = `POST;
     path = "/user/stripe/portal";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_portal_session_request
               ({ return_url } : create_portal_session_request)));
     decode_reply = Request.json stripe_session_response_of_yojson;
     decode_error = Request.error_json [ 400; 500 ] error_response_of_yojson;
   }
    : (stripe_session_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /user/stripe/trial_eligibility]

Read the caller's eligibility; checkout revalidates before granting a trial. *)
let get_trial_eligibility () =
  ({
     Request.service = "auth";
     operation = "get_trial_eligibility";
     meth = `GET;
     path = "/user/stripe/trial_eligibility";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json trial_eligibility_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (trial_eligibility, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /user/tutorial]

Updates the user's tutorialComplete flag. *)
let patch_user_tutorial ~(tutorial_complete : bool) () =
  ({
     Request.service = "auth";
     operation = "patch_user_tutorial";
     meth = `PATCH;
     path = "/user/tutorial";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_patch_user_tutorial_request
               ({ tutorial_complete } : patch_user_tutorial_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)
