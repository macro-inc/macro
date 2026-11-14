(* Generated from packages/sdk/specs/auth.json by packages/sdk-ocaml/gen. Do not edit. *)

type nonrec ab_group =
  | A
  | B
  | Unknown of string  (** A value this SDK version does not know. *)

val ab_group_of_yojson : Yojson.Safe.t -> ab_group
val yojson_of_ab_group : ab_group -> Yojson.Safe.t

(** A provider an agent can bring its own key for. *)
type nonrec agent_api_key_provider =
  | Anthropic
  | Openai
  | Unknown of string  (** A value this SDK version does not know. *)

val agent_api_key_provider_of_yojson : Yojson.Safe.t -> agent_api_key_provider
val yojson_of_agent_api_key_provider : agent_api_key_provider -> Yojson.Safe.t

type nonrec saved_agent_api_key = {
  provider : agent_api_key_provider;  (** The provider the key is for. *)
  updated_at : string;  (** When the key was last replaced. *)
}
(** The agent's saved key. Never includes the key. *)

val saved_agent_api_key_of_yojson : Yojson.Safe.t -> saved_agent_api_key
val yojson_of_saved_agent_api_key : saved_agent_api_key -> Yojson.Safe.t

val make_saved_agent_api_key :
  provider:agent_api_key_provider ->
  updated_at:string ->
  unit ->
  saved_agent_api_key
(** The agent's saved key. Never includes the key. *)

type nonrec agent_api_key = {
  key : saved_agent_api_key option;
  plan_allows : bool;
      (** Whether the agent owner's plan includes API keys. A key saved before a
downgrade is still listed, and removable, but unused. *)
}
(** An agent's API key, and whether its turns can run on it. *)

val agent_api_key_of_yojson : Yojson.Safe.t -> agent_api_key
val yojson_of_agent_api_key : agent_api_key -> Yojson.Safe.t

val make_agent_api_key :
  ?key:saved_agent_api_key -> plan_allows:bool -> unit -> agent_api_key
(** An agent's API key, and whether its turns can run on it. *)

type nonrec agent_setup_response = {
  api_key : string;
      (** The agent's API key. Shown only here; repeating setup revokes it. *)
  team_join_failed : bool;
      (** Whether joining the inviting team failed. The invite stays pending:
repeating setup tries again, and the invite link works after confirming. *)
}
(** What an agent needs to start using the SDK. *)

val agent_setup_response_of_yojson : Yojson.Safe.t -> agent_setup_response
val yojson_of_agent_setup_response : agent_setup_response -> Yojson.Safe.t

val make_agent_setup_response :
  api_key:string -> team_join_failed:bool -> unit -> agent_setup_response
(** What an agent needs to start using the SDK. *)

type nonrec agent_voice = {
  model : string;  (** The Aura-2 model, [aura-2-<name>-<language>]. *)
}
(** The voice an agent speaks with on calls. *)

val agent_voice_of_yojson : Yojson.Safe.t -> agent_voice
val yojson_of_agent_voice : agent_voice -> Yojson.Safe.t

val make_agent_voice : model:string -> unit -> agent_voice
(** The voice an agent speaks with on calls. *)

type nonrec ai_billing_error_body = {
  error : string;  (** Human-readable error description. *)
}
(** Error response body. *)

val ai_billing_error_body_of_yojson : Yojson.Safe.t -> ai_billing_error_body
val yojson_of_ai_billing_error_body : ai_billing_error_body -> Yojson.Safe.t

val make_ai_billing_error_body : error:string -> unit -> ai_billing_error_body
(** Error response body. *)

type nonrec apple_login_request = { code : string; id_token : string }

val apple_login_request_of_yojson : Yojson.Safe.t -> apple_login_request
val yojson_of_apple_login_request : apple_login_request -> Yojson.Safe.t

val make_apple_login_request :
  code:string -> id_token:string -> unit -> apple_login_request

type nonrec auto_reload_defaults = {
  minimum_balance_cents : int64;
      (** Balance below which a reload fires, cents. *)
  target_balance_cents : int64;  (** Balance a reload tops up to, cents. *)
}
(** The automatic reload thresholds a payer starts from. *)

val auto_reload_defaults_of_yojson : Yojson.Safe.t -> auto_reload_defaults
val yojson_of_auto_reload_defaults : auto_reload_defaults -> Yojson.Safe.t

val make_auto_reload_defaults :
  minimum_balance_cents:int64 ->
  target_balance_cents:int64 ->
  unit ->
  auto_reload_defaults
(** The automatic reload thresholds a payer starts from. *)

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

val auto_reload_monthly_budget_of_yojson :
  Yojson.Safe.t -> auto_reload_monthly_budget

val yojson_of_auto_reload_monthly_budget :
  auto_reload_monthly_budget -> Yojson.Safe.t

val make_auto_reload_monthly_budget :
  committed_cents:int64 ->
  limit_reached:bool ->
  resets_at:string ->
  unit ->
  auto_reload_monthly_budget
(** Calendar-month commitments that consume the payer's automatic reload cap. *)

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

val auto_reload_snapshot_of_yojson : Yojson.Safe.t -> auto_reload_snapshot
val yojson_of_auto_reload_snapshot : auto_reload_snapshot -> Yojson.Safe.t

val make_auto_reload_snapshot :
  active:bool ->
  minimum_balance_cents:int64 ->
  ?monthly_budget:auto_reload_monthly_budget ->
  ?monthly_spend_limit_cents:int64 ->
  suspended:bool ->
  target_balance_cents:int64 ->
  unit ->
  auto_reload_snapshot
(** The payer's automatic reload settings, as shown in Billing settings. *)

(** How often the team subscription bills. *)
type nonrec billing_interval =
  | Month
  | Year
  | Unknown of string  (** A value this SDK version does not know. *)

val billing_interval_of_yojson : Yojson.Safe.t -> billing_interval
val yojson_of_billing_interval : billing_interval -> Yojson.Safe.t

(** Where a computer's billing stands, as its team sees it. *)
type nonrec billing_status =
  | Purchasing
  | Active
  | Past_due
  | Ending
  | Ended
  | Comped
  | Unknown of string  (** A value this SDK version does not know. *)

val billing_status_of_yojson : Yojson.Safe.t -> billing_status
val yojson_of_billing_status : billing_status -> Yojson.Safe.t

(** The paid plan a seat is billed at. Every member of a paying team has one;
a team may mix them, and its Stripe subscription carries one seat item per
plan in use. *)
type nonrec seat_plan =
  | Premium
  | Max
  | Unknown of string  (** A value this SDK version does not know. *)

val seat_plan_of_yojson : Yojson.Safe.t -> seat_plan
val yojson_of_seat_plan : seat_plan -> Yojson.Safe.t

type nonrec change_plan_request = {
  plan : seat_plan;  (** The plan to move the active subscription to *)
}
(** Request body for switching plans *)

val change_plan_request_of_yojson : Yojson.Safe.t -> change_plan_request
val yojson_of_change_plan_request : change_plan_request -> Yojson.Safe.t

val make_change_plan_request : plan:seat_plan -> unit -> change_plan_request
(** Request body for switching plans *)

type nonrec change_plan_response = {
  plan : seat_plan;  (** The plan the subscription is now on *)
}
(** Response for a plan change *)

val change_plan_response_of_yojson : Yojson.Safe.t -> change_plan_response
val yojson_of_change_plan_response : change_plan_response -> Yojson.Safe.t

val make_change_plan_response : plan:seat_plan -> unit -> change_plan_response
(** Response for a plan change *)

type nonrec checkout_session_metadata = {
  fbc : string option;  (** Meta (Facebook) click ID from _fbc cookie *)
  fbp : string option;  (** Meta (Facebook) browser ID from _fbp cookie *)
  ga_client_id : string option;
      (** Google Analytics client ID for conversion tracking *)
}
(** Tracking metadata for conversion attribution *)

val checkout_session_metadata_of_yojson :
  Yojson.Safe.t -> checkout_session_metadata

val yojson_of_checkout_session_metadata :
  checkout_session_metadata -> Yojson.Safe.t

val make_checkout_session_metadata :
  ?fbc:string ->
  ?fbp:string ->
  ?ga_client_id:string ->
  unit ->
  checkout_session_metadata
(** Tracking metadata for conversion attribution *)

type nonrec checkout_session_v2_response = {
  trial_days : int option;
      (** Trial duration, absent for an immediately paid checkout. *)
  url : string;  (** The opaque URL returned by Stripe. *)
}
(** Hosted checkout with the billing terms the server actually granted. *)

val checkout_session_v2_response_of_yojson :
  Yojson.Safe.t -> checkout_session_v2_response

val yojson_of_checkout_session_v2_response :
  checkout_session_v2_response -> Yojson.Safe.t

val make_checkout_session_v2_response :
  ?trial_days:int -> url:string -> unit -> checkout_session_v2_response
(** Hosted checkout with the billing terms the server actually granted. *)

type nonrec codex_config_request = {
  environment_id : string;
      (** An environment currently visible to this account. *)
}
(** Explicit remote environment for future Codex sessions. *)

val codex_config_request_of_yojson : Yojson.Safe.t -> codex_config_request
val yojson_of_codex_config_request : codex_config_request -> Yojson.Safe.t

val make_codex_config_request :
  environment_id:string -> unit -> codex_config_request
(** Explicit remote environment for future Codex sessions. *)

type nonrec codex_connection_status = {
  account_id : string option;  (** Connected provider account identifier. *)
  connected : bool;
      (** Whether the user has completed provider authorization. *)
  email : string option;
      (** Reserved until provider-verified email metadata is available. *)
  environment_id : string option;  (** Explicitly selected remote environment. *)
}
(** Safe connection metadata; no secret or masked token is returned. *)

val codex_connection_status_of_yojson : Yojson.Safe.t -> codex_connection_status
val yojson_of_codex_connection_status : codex_connection_status -> Yojson.Safe.t

val make_codex_connection_status :
  ?account_id:string ->
  connected:bool ->
  ?email:string ->
  ?environment_id:string ->
  unit ->
  codex_connection_status
(** Safe connection metadata; no secret or masked token is returned. *)

type nonrec codex_environment_repository = {
  clone_url : string;  (** Credential-free HTTPS clone URL. *)
  default_branch : string;  (** Provider default branch. *)
  full_name : string;  (** Owner/repository identity. *)
}
(** Safe repository metadata available to the connected Codex account. *)

val codex_environment_repository_of_yojson :
  Yojson.Safe.t -> codex_environment_repository

val yojson_of_codex_environment_repository :
  codex_environment_repository -> Yojson.Safe.t

val make_codex_environment_repository :
  clone_url:string ->
  default_branch:string ->
  full_name:string ->
  unit ->
  codex_environment_repository
(** Safe repository metadata available to the connected Codex account. *)

type nonrec codex_environment = {
  id : string;  (** Provider environment identity. *)
  label : string option;  (** Human-readable provider label. *)
  repositories : codex_environment_repository list;
      (** Ordered safe repository identities from Codex. *)
}
(** A cloud environment visible to the connected provider account. *)

val codex_environment_of_yojson : Yojson.Safe.t -> codex_environment
val yojson_of_codex_environment : codex_environment -> Yojson.Safe.t

val make_codex_environment :
  id:string ->
  ?label:string ->
  repositories:codex_environment_repository list ->
  unit ->
  codex_environment
(** A cloud environment visible to the connected provider account. *)

(** Device authorization state visible to its initiating user. *)
type nonrec codex_login_state =
  | Pending
  | Connected
  | Expired
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val codex_login_state_of_yojson : Yojson.Safe.t -> codex_login_state
val yojson_of_codex_login_state : codex_login_state -> Yojson.Safe.t

type nonrec codex_login_poll = {
  status : codex_login_state;  (** Current attempt state. *)
}
(** Outcome of polling one attempt. *)

val codex_login_poll_of_yojson : Yojson.Safe.t -> codex_login_poll
val yojson_of_codex_login_poll : codex_login_poll -> Yojson.Safe.t

val make_codex_login_poll : status:codex_login_state -> unit -> codex_login_poll
(** Outcome of polling one attempt. *)

type nonrec codex_login_start = {
  attempt_id : string;  (** Owner-bound attempt UUID. *)
  expires_at : string;  (** UTC attempt deadline. *)
  poll_interval_seconds : int64;  (** Minimum browser polling interval. *)
  user_code : string;  (** Short expiring user code, not an API credential. *)
  verification_url : string;  (** Official provider verification URL. *)
}
(** Expiring browser authorization instructions. *)

val codex_login_start_of_yojson : Yojson.Safe.t -> codex_login_start
val yojson_of_codex_login_start : codex_login_start -> Yojson.Safe.t

val make_codex_login_start :
  attempt_id:string ->
  expires_at:string ->
  poll_interval_seconds:int64 ->
  user_code:string ->
  verification_url:string ->
  unit ->
  codex_login_start
(** Expiring browser authorization instructions. *)

(** A size a team can buy. *)
type nonrec computer_size =
  | Standard
  | Large
  | Xl
  | Unknown of string  (** A value this SDK version does not know. *)

val computer_size_of_yojson : Yojson.Safe.t -> computer_size
val yojson_of_computer_size : computer_size -> Yojson.Safe.t

(** Steps a new computer goes through, in order. *)
type nonrec setup_step =
  | Billing
  | Creating
  | Booting
  | Connecting
  | Ready
  | Unknown of string  (** A value this SDK version does not know. *)

val setup_step_of_yojson : Yojson.Safe.t -> setup_step
val yojson_of_setup_step : setup_step -> Yojson.Safe.t

type nonrec setup_progress = {
  position : int;  (** 1-based position of [step]. *)
  step : setup_step;  (** Current setup stage. *)
  step_started_at : string option;
      (** When [step] began; null when it is not recorded. *)
  total : int;  (** Number of setup stages. *)
}
(** Setup progress, for invite and purchase flows to show. *)

val setup_progress_of_yojson : Yojson.Safe.t -> setup_progress
val yojson_of_setup_progress : setup_progress -> Yojson.Safe.t

val make_setup_progress :
  position:int ->
  step:setup_step ->
  ?step_started_at:string ->
  total:int ->
  unit ->
  setup_progress
(** Setup progress, for invite and purchase flows to show. *)

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

val computer_status_kind_of_yojson : Yojson.Safe.t -> computer_status_kind
val yojson_of_computer_status_kind : computer_status_kind -> Yojson.Safe.t

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

val computer_status_of_yojson : Yojson.Safe.t -> computer_status
val yojson_of_computer_status : computer_status -> Yojson.Safe.t

val make_computer_status :
  agent_count:int ->
  ?billing:billing_status ->
  can_restore:bool ->
  can_undo_cancel:bool ->
  ?cancels_at:string ->
  catalog_entry:string ->
  ?comp_reason:string ->
  created_at:string ->
  ?default_agent_id:string ->
  disk_gib:int64 ->
  ?failure_reason:string ->
  ?harness_id:string ->
  id:string ->
  memory_gib:int64 ->
  name:string ->
  ?past_due_since:string ->
  powered_on:bool ->
  purchased_by:string ->
  ?retained_until:string ->
  ?setup:setup_progress ->
  ?setup_completed_at:string ->
  size:computer_size ->
  status:computer_status_kind ->
  vcpus:int64 ->
  unit ->
  computer_status
(** A computer as its team sees it. *)

type nonrec create_account_merge_request = {
  email : string;  (** The email address to generate the merge link for. *)
}

val create_account_merge_request_of_yojson :
  Yojson.Safe.t -> create_account_merge_request

val yojson_of_create_account_merge_request :
  create_account_merge_request -> Yojson.Safe.t

val make_create_account_merge_request :
  email:string -> unit -> create_account_merge_request

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

val create_checkout_session_v2_request_of_yojson :
  Yojson.Safe.t -> create_checkout_session_v2_request

val yojson_of_create_checkout_session_v2_request :
  create_checkout_session_v2_request -> Yojson.Safe.t

val make_create_checkout_session_v2_request :
  cancel_url:string ->
  ?discount:string ->
  ?metadata:checkout_session_metadata ->
  ?onboarding_trial:bool ->
  ?plan:seat_plan ->
  success_url:string ->
  unit ->
  create_checkout_session_v2_request
(** Request body for creating a Stripe checkout session *)

type nonrec create_gtm_invite_link_request = {
  first_name : string;
      (** The recipient's first name, shown on the welcome page. *)
  note : string option;  (** Free-form internal note for the dashboard. *)
  recipient_email : string option;
      (** The recipient's email, when the sender knows it. *)
}
(** Request body to create a link. *)

val create_gtm_invite_link_request_of_yojson :
  Yojson.Safe.t -> create_gtm_invite_link_request

val yojson_of_create_gtm_invite_link_request :
  create_gtm_invite_link_request -> Yojson.Safe.t

val make_create_gtm_invite_link_request :
  first_name:string ->
  ?note:string ->
  ?recipient_email:string ->
  unit ->
  create_gtm_invite_link_request
(** Request body to create a link. *)

type nonrec create_in_progress_link_response = {
  link_id : string;  (** The link id *)
}

val create_in_progress_link_response_of_yojson :
  Yojson.Safe.t -> create_in_progress_link_response

val yojson_of_create_in_progress_link_response :
  create_in_progress_link_response -> Yojson.Safe.t

val make_create_in_progress_link_response :
  link_id:string -> unit -> create_in_progress_link_response

type nonrec create_portal_session_request = {
  return_url : string;  (** The URL to redirect to after leaving the portal *)
}
(** Request body for creating a Stripe portal session *)

val create_portal_session_request_of_yojson :
  Yojson.Safe.t -> create_portal_session_request

val yojson_of_create_portal_session_request :
  create_portal_session_request -> Yojson.Safe.t

val make_create_portal_session_request :
  return_url:string -> unit -> create_portal_session_request
(** Request body for creating a Stripe portal session *)

type nonrec create_profile_picture_upload_request = {
  content_type : string;  (** Mime type of the image. *)
  file_name : string;  (** File name, such as [avatar.png]. *)
  size_bytes : int64;
      (** Exact size of the image in bytes. Storage rejects a body of any other size. *)
}

val create_profile_picture_upload_request_of_yojson :
  Yojson.Safe.t -> create_profile_picture_upload_request

val yojson_of_create_profile_picture_upload_request :
  create_profile_picture_upload_request -> Yojson.Safe.t

val make_create_profile_picture_upload_request :
  content_type:string ->
  file_name:string ->
  size_bytes:int64 ->
  unit ->
  create_profile_picture_upload_request

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

val create_team_agent_of_yojson : Yojson.Safe.t -> create_team_agent
val yojson_of_create_team_agent : create_team_agent -> Yojson.Safe.t

val make_create_team_agent :
  ?avatar_url:string ->
  job_description:string ->
  name:string ->
  personality:string ->
  purchase_key:string ->
  size:string ->
  ?voice:string ->
  unit ->
  create_team_agent
(** Input for inviting an agent teammate and buying its computer. *)

type nonrec create_team_request = {
  allow_domain_join : bool option;
      (** Whether colleagues who sign up with the owner's work email domain join
the team automatically. Ignored for generic email providers. *)
  name : string;  (** The name of the team *)
}
(** The request body to create a new team *)

val create_team_request_of_yojson : Yojson.Safe.t -> create_team_request
val yojson_of_create_team_request : create_team_request -> Yojson.Safe.t

val make_create_team_request :
  ?allow_domain_join:bool -> name:string -> unit -> create_team_request
(** The request body to create a new team *)

type nonrec team_invite_link_token = string
(** The secret in a team's shareable invite link.

Anyone signed in who holds the token can join the team, so it is a random
value rather than a time-ordered id, and an admin resetting the link
replaces it. *)

val team_invite_link_token_of_yojson : Yojson.Safe.t -> team_invite_link_token
val yojson_of_team_invite_link_token : team_invite_link_token -> Yojson.Safe.t

type nonrec created_team_invite_link_response = {
  token : team_invite_link_token;
      (** The new link's token. Any previous link stops working. *)
}
(** A newly created team invite link. *)

val created_team_invite_link_response_of_yojson :
  Yojson.Safe.t -> created_team_invite_link_response

val yojson_of_created_team_invite_link_response :
  created_team_invite_link_response -> Yojson.Safe.t

val make_created_team_invite_link_response :
  token:team_invite_link_token -> unit -> created_team_invite_link_response
(** A newly created team invite link. *)

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

val credit_checkout_request_body_of_yojson :
  Yojson.Safe.t -> credit_checkout_request_body

val yojson_of_credit_checkout_request_body :
  credit_checkout_request_body -> Yojson.Safe.t

val make_credit_checkout_request_body :
  amount_cents:int64 ->
  cancel_url:string ->
  success_url:string ->
  unit ->
  credit_checkout_request_body
(** Request body for \[[create_credit_checkout_handler]\]. *)

type nonrec credit_checkout_response = {
  url : string;  (** The hosted Checkout URL to redirect to. *)
}
(** Response for \[[create_credit_checkout_handler]\]. *)

val credit_checkout_response_of_yojson :
  Yojson.Safe.t -> credit_checkout_response

val yojson_of_credit_checkout_response :
  credit_checkout_response -> Yojson.Safe.t

val make_credit_checkout_response :
  url:string -> unit -> credit_checkout_response
(** Response for \[[create_credit_checkout_handler]\]. *)

type nonrec credit_purchase_request_body = {
  amount_cents : int64;  (** One of the catalog's credit packs, cents. *)
}
(** Request body for \[[purchase_credits_handler]\]. *)

val credit_purchase_request_body_of_yojson :
  Yojson.Safe.t -> credit_purchase_request_body

val yojson_of_credit_purchase_request_body :
  credit_purchase_request_body -> Yojson.Safe.t

val make_credit_purchase_request_body :
  amount_cents:int64 -> unit -> credit_purchase_request_body
(** Request body for \[[purchase_credits_handler]\]. *)

(** Why a request was refused. *)
type nonrec deny_reason =
  | Allowance_exhausted
  | Free_allowance_exhausted
  | Overage_limit_reached
  | Overage_payment_failed
  | Unknown of string  (** A value this SDK version does not know. *)

val deny_reason_of_yojson : Yojson.Safe.t -> deny_reason
val yojson_of_deny_reason : deny_reason -> Yojson.Safe.t

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

val credit_purchase_snapshot_of_yojson :
  Yojson.Safe.t -> credit_purchase_snapshot

val yojson_of_credit_purchase_snapshot :
  credit_purchase_snapshot -> Yojson.Safe.t

val make_credit_purchase_snapshot :
  committed_cents:int64 ->
  ?monthly_limit_cents:int64 ->
  resets_at:string ->
  unit ->
  credit_purchase_snapshot
(** The monthly credit limit that applies to this user's one-time purchases. *)

(** The plans a user can be on, cheapest first. *)
type nonrec plan_tier =
  | Free
  | Premium
  | Max
  | Unknown of string  (** A value this SDK version does not know. *)

val plan_tier_of_yojson : Yojson.Safe.t -> plan_tier
val yojson_of_plan_tier : plan_tier -> Yojson.Safe.t

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

val usage_snapshot_of_yojson : Yojson.Safe.t -> usage_snapshot
val yojson_of_usage_snapshot : usage_snapshot -> Yojson.Safe.t

val make_usage_snapshot :
  auto_reload:auto_reload_snapshot ->
  ?blocked_reason:deny_reason ->
  can_manage_billing:bool ->
  credit_balance_cents:int64 ->
  ?credit_purchase:credit_purchase_snapshot ->
  credits_consumed_cents:int64 ->
  credits_shared_with_team:bool ->
  included_cents:int64 ->
  overage_charged_cents:int64 ->
  overage_enabled:bool ->
  overage_limit_cents:int64 ->
  overage_suspended:bool ->
  payer:string ->
  period_end:string ->
  period_start:string ->
  remaining_cents:int64 ->
  seats:int ->
  tier:plan_tier ->
  uncovered_cents:int64 ->
  unlimited:bool ->
  used_cents:int64 ->
  unit ->
  usage_snapshot
(** The payer's current-period position, as shown in Billing settings and used
by the gate. *)

(** How a one-time credit purchase charged to the card on file ended. *)
type nonrec credit_purchase_status =
  | Paid
  | Declined
  | Payment_method_required
  | Authentication_required
  | Unknown of string  (** A value this SDK version does not know. *)

val credit_purchase_status_of_yojson : Yojson.Safe.t -> credit_purchase_status
val yojson_of_credit_purchase_status : credit_purchase_status -> Yojson.Safe.t

type nonrec credit_purchase_response = {
  amount_cents : int64;
      (** Amount charged, cents: the requested pack, unless an earlier declined
purchase that Stripe collected in the meantime was booked instead. *)
  snapshot : usage_snapshot option;
  status : credit_purchase_status;  (** Whether the card on file paid. *)
}
(** Response for \[[purchase_credits_handler]\]. *)

val credit_purchase_response_of_yojson :
  Yojson.Safe.t -> credit_purchase_response

val yojson_of_credit_purchase_response :
  credit_purchase_response -> Yojson.Safe.t

val make_credit_purchase_response :
  amount_cents:int64 ->
  ?snapshot:usage_snapshot ->
  status:credit_purchase_status ->
  unit ->
  credit_purchase_response
(** Response for \[[purchase_credits_handler]\]. *)

(** The platform status. Only the non-operational statuses carry a message. *)
type nonrec system_status =
  | Operational  (** Everything works; no banner is shown. *)
  | Degraded of { message : string  (** What users should know. *) }
      (** Some features are slow or failing. *)
  | Major_outage of { message : string  (** What users should know. *) }
      (** Macro is largely unavailable. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val system_status_of_yojson : Yojson.Safe.t -> system_status
val yojson_of_system_status : system_status -> Yojson.Safe.t

val make_system_status_degraded : message:string -> unit -> system_status
(** Some features are slow or failing. *)

val make_system_status_major_outage : message:string -> unit -> system_status
(** Macro is largely unavailable. *)

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

val current_system_status_of_yojson : Yojson.Safe.t -> current_system_status
val yojson_of_current_system_status : current_system_status -> Yojson.Safe.t

val make_current_system_status :
  system_status:system_status ->
  ?id:string ->
  ?updated_at:string ->
  unit ->
  current_system_status
(** The status every user sees, without who set it. *)

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

val cursor_api_key_status_of_yojson : Yojson.Safe.t -> cursor_api_key_status
val yojson_of_cursor_api_key_status : cursor_api_key_status -> Yojson.Safe.t

val make_cursor_api_key_status :
  ?default_effort:string ->
  ?default_model_id:string ->
  registered:bool ->
  ?updated_at:string ->
  unit ->
  cursor_api_key_status
(** What settings needs to render the Cursor connection.

Deliberately thin. [registered] drives the whole UI; [updatedAt] lets it say
when the key was last replaced, which is the only thing a user can check
against their own memory when a session starts failing.

Deliberately *not* reporting anything about the deployment itself. That is
operator information: a user who sees it cannot act on it, and a service
that cannot reach KMS does not start. *)

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

val cursor_model_option_of_yojson : Yojson.Safe.t -> cursor_model_option
val yojson_of_cursor_model_option : cursor_model_option -> Yojson.Safe.t

val make_cursor_model_option :
  display_name:string ->
  group:string ->
  id:string ->
  unit ->
  cursor_model_option
(** One model the settings dropdown can offer.

Id, name and family: the dropdown lists models, not the hundreds of
parameter variants each carries. The chosen id's parameters are resolved to
Cursor's default variant at session start. The family is the same heading
the Cursor ACP agent groups its session model select under, so the settings
picker and the in-session picker read the same way. *)

type nonrec cursor_models_response = {
  models : cursor_model_option list;
      (** The offered models, in the order Cursor returned them. *)
}
(** The models this account may choose from. *)

val cursor_models_response_of_yojson : Yojson.Safe.t -> cursor_models_response
val yojson_of_cursor_models_response : cursor_models_response -> Yojson.Safe.t

val make_cursor_models_response :
  models:cursor_model_option list -> unit -> cursor_models_response
(** The models this account may choose from. *)

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

val email_connection_providers_of_yojson :
  Yojson.Safe.t -> email_connection_providers

val yojson_of_email_connection_providers :
  email_connection_providers -> Yojson.Safe.t

val make_email_connection_providers :
  gmail:bool ->
  outlook:bool ->
  ?outlook_admin_consent_url:string ->
  unit ->
  email_connection_providers
(** What the provider selector offers the requesting user. *)

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

val empty_response_of_yojson : Yojson.Safe.t -> empty_response
val yojson_of_empty_response : empty_response -> Yojson.Safe.t

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

val github_pull_request_ref_of_yojson : Yojson.Safe.t -> github_pull_request_ref
val yojson_of_github_pull_request_ref : github_pull_request_ref -> Yojson.Safe.t

val make_github_pull_request_ref :
  display_name:string ->
  github_key:string ->
  number:int64 ->
  owner:string ->
  repo:string ->
  url:string ->
  unit ->
  github_pull_request_ref
(** A pull request reference that can be enriched with live GitHub data. *)

type nonrec enrich_github_pull_requests_proxy_request = {
  pull_requests : github_pull_request_ref list;
      (** The pull requests to enrich for the authenticated user. *)
}
(** Request body for the authenticated pull request enrichment proxy. *)

val enrich_github_pull_requests_proxy_request_of_yojson :
  Yojson.Safe.t -> enrich_github_pull_requests_proxy_request

val yojson_of_enrich_github_pull_requests_proxy_request :
  enrich_github_pull_requests_proxy_request -> Yojson.Safe.t

val make_enrich_github_pull_requests_proxy_request :
  pull_requests:github_pull_request_ref list ->
  unit ->
  enrich_github_pull_requests_proxy_request
(** Request body for the authenticated pull request enrichment proxy. *)

type nonrec github_pull_request_user = {
  github_user_id : string;
      (** The stable numeric GitHub user id, as a string. *)
  login : string option;  (** The user's GitHub login, when known. *)
}
(** A GitHub user named on a pull request, such as an assignee. *)

val github_pull_request_user_of_yojson :
  Yojson.Safe.t -> github_pull_request_user

val yojson_of_github_pull_request_user :
  github_pull_request_user -> Yojson.Safe.t

val make_github_pull_request_user :
  github_user_id:string -> ?login:string -> unit -> github_pull_request_user
(** A GitHub user named on a pull request, such as an assignee. *)

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

val github_pull_request_check_run_of_yojson :
  Yojson.Safe.t -> github_pull_request_check_run

val yojson_of_github_pull_request_check_run :
  github_pull_request_check_run -> Yojson.Safe.t

val make_github_pull_request_check_run :
  ?completed_at:string ->
  ?conclusion:string ->
  id:int64 ->
  name:string ->
  ?started_at:string ->
  status:string ->
  ?url:string ->
  unit ->
  github_pull_request_check_run
(** A check run associated with a GitHub pull request. *)

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

val github_pull_request_comment_of_yojson :
  Yojson.Safe.t -> github_pull_request_comment

val yojson_of_github_pull_request_comment :
  github_pull_request_comment -> Yojson.Safe.t

val make_github_pull_request_comment :
  ?author_association:string ->
  ?author_id:int64 ->
  ?author_login:string ->
  body:string ->
  ?created_at:string ->
  id:int64 ->
  ?in_reply_to_id:int64 ->
  ?line:int64 ->
  ?original_line:int64 ->
  ?path:string ->
  ?pull_request_review_id:int64 ->
  source:string ->
  ?updated_at:string ->
  ?url:string ->
  unit ->
  github_pull_request_comment
(** A comment associated with a GitHub pull request. *)

type nonrec github_pull_request_label = {
  color : string option;
      (** The label color as six hex digits without a leading [#], when known. *)
  name : string;
      (** The label name, unique within its repository regardless of case. *)
}
(** A label on a GitHub pull request. *)

val github_pull_request_label_of_yojson :
  Yojson.Safe.t -> github_pull_request_label

val yojson_of_github_pull_request_label :
  github_pull_request_label -> Yojson.Safe.t

val make_github_pull_request_label :
  ?color:string -> name:string -> unit -> github_pull_request_label
(** A label on a GitHub pull request. *)

(** What a reviewer's latest review on a pull request said. *)
type nonrec github_pull_request_review_state =
  | Approved
  | Changes_requested
  | Commented
  | Dismissed
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pull_request_review_state_of_yojson :
  Yojson.Safe.t -> github_pull_request_review_state

val yojson_of_github_pull_request_review_state :
  github_pull_request_review_state -> Yojson.Safe.t

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

val github_pull_request_review_of_yojson :
  Yojson.Safe.t -> github_pull_request_review

val yojson_of_github_pull_request_review :
  github_pull_request_review -> Yojson.Safe.t

val make_github_pull_request_review :
  reviewer_github_user_id:string ->
  ?reviewer_login:string ->
  state:github_pull_request_review_state ->
  ?submitted_at:string ->
  unit ->
  github_pull_request_review
(** A reviewer's latest submitted review on a pull request. *)

(** The normalized lifecycle status for a GitHub pull request. *)
type nonrec github_pull_request_status =
  | Open
  | Closed
  | Merged
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pull_request_status_of_yojson :
  Yojson.Safe.t -> github_pull_request_status

val yojson_of_github_pull_request_status :
  github_pull_request_status -> Yojson.Safe.t

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

val enriched_github_pull_request_of_yojson :
  Yojson.Safe.t -> enriched_github_pull_request

val yojson_of_enriched_github_pull_request :
  enriched_github_pull_request -> Yojson.Safe.t

val make_enriched_github_pull_request :
  ?additions:int64 ->
  ?assignees:github_pull_request_user list ->
  ?author_id:int64 ->
  ?author_login:string ->
  ?checks:github_pull_request_check_run list ->
  ?comments:github_pull_request_comment list ->
  ?deletions:int64 ->
  ?description:string ->
  display_name:string ->
  github_key:string ->
  ?labels:github_pull_request_label list ->
  ?name:string ->
  number:int64 ->
  owner:string ->
  ?participant_github_user_ids:string list ->
  repo:string ->
  ?reviews:github_pull_request_review list ->
  ?status:github_pull_request_status ->
  url:string ->
  unit ->
  enriched_github_pull_request
(** A pull request reference enriched with live GitHub details when available. *)

type nonrec enrich_github_pull_requests_response = {
  pull_requests : enriched_github_pull_request list;
      (** Pull requests with enrichment fields populated when GitHub data was available. *)
}
(** Response body for pull request enrichment. *)

val enrich_github_pull_requests_response_of_yojson :
  Yojson.Safe.t -> enrich_github_pull_requests_response

val yojson_of_enrich_github_pull_requests_response :
  enrich_github_pull_requests_response -> Yojson.Safe.t

val make_enrich_github_pull_requests_response :
  pull_requests:enriched_github_pull_request list ->
  unit ->
  enrich_github_pull_requests_response
(** Response body for pull request enrichment. *)

type nonrec error_response = {
  message : string;  (** Message to explain failure *)
}
(** A plain old json error response for use with axum.
yup, thats it. *)

val error_response_of_yojson : Yojson.Safe.t -> error_response
val yojson_of_error_response : error_response -> Yojson.Safe.t

val make_error_response : message:string -> unit -> error_response
(** A plain old json error response for use with axum.
yup, thats it. *)

type nonrec generate_email_link_request = {
  email : string;  (** The email address to resend the verification email to *)
}

val generate_email_link_request_of_yojson :
  Yojson.Safe.t -> generate_email_link_request

val yojson_of_generate_email_link_request :
  generate_email_link_request -> Yojson.Safe.t

val make_generate_email_link_request :
  email:string -> unit -> generate_email_link_request

type nonrec generic_success_response = {
  success : bool;  (** Indicates if the request was successful *)
}

val generic_success_response_of_yojson :
  Yojson.Safe.t -> generic_success_response

val yojson_of_generic_success_response :
  generic_success_response -> Yojson.Safe.t

val make_generic_success_response :
  success:bool -> unit -> generic_success_response

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

val get_legacy_user_permissions_response_of_yojson :
  Yojson.Safe.t -> get_legacy_user_permissions_response

val yojson_of_get_legacy_user_permissions_response :
  get_legacy_user_permissions_response -> Yojson.Safe.t

val make_get_legacy_user_permissions_response :
  ai_data_consent:bool ->
  ?created_at:string ->
  email:string ->
  ?group:ab_group ->
  has_chrome_ext:bool ->
  has_trialed:bool ->
  is_agent:bool ->
  license_status:string ->
  ?name:string ->
  permissions:string list ->
  referral_code:string ->
  tutorial_complete:bool ->
  user_id:string ->
  unit ->
  get_legacy_user_permissions_response

type nonrec get_names_with_email_request_body = { user_ids : string list }

val get_names_with_email_request_body_of_yojson :
  Yojson.Safe.t -> get_names_with_email_request_body

val yojson_of_get_names_with_email_request_body :
  get_names_with_email_request_body -> Yojson.Safe.t

val make_get_names_with_email_request_body :
  user_ids:string list -> unit -> get_names_with_email_request_body

type nonrec get_profile_pictures_request_body = { user_id_list : string list }

val get_profile_pictures_request_body_of_yojson :
  Yojson.Safe.t -> get_profile_pictures_request_body

val yojson_of_get_profile_pictures_request_body :
  get_profile_pictures_request_body -> Yojson.Safe.t

val make_get_profile_pictures_request_body :
  user_id_list:string list -> unit -> get_profile_pictures_request_body

type nonrec get_user_info = {
  organization_id : int option;
      (** The user's organization id if there is one associated with the user *)
  permissions : string list;  (** The user's permissions *)
  user_id : string;  (** The user id *)
}

val get_user_info_of_yojson : Yojson.Safe.t -> get_user_info
val yojson_of_get_user_info : get_user_info -> Yojson.Safe.t

val make_get_user_info :
  ?organization_id:int ->
  permissions:string list ->
  user_id:string ->
  unit ->
  get_user_info

type nonrec github_link_status_response = {
  github_user_id : string;
      (** Stable ID of the authenticated user's linked GitHub account. *)
  github_username : string;
      (** Login of the authenticated user's linked GitHub account. *)
  reauthentication_required : bool;
      (** Whether the user must reauthenticate their GitHub link. *)
}

val github_link_status_response_of_yojson :
  Yojson.Safe.t -> github_link_status_response

val yojson_of_github_link_status_response :
  github_link_status_response -> Yojson.Safe.t

val make_github_link_status_response :
  github_user_id:string ->
  github_username:string ->
  reauthentication_required:bool ->
  unit ->
  github_link_status_response

(** How GitHub combines a pull request's commits into its base branch. *)
type nonrec github_merge_method =
  | Merge
  | Squash
  | Rebase
  | Unknown of string  (** A value this SDK version does not know. *)

val github_merge_method_of_yojson : Yojson.Safe.t -> github_merge_method
val yojson_of_github_merge_method : github_merge_method -> Yojson.Safe.t

(** Whether GitHub can merge a pull request's head into its base without conflicts. *)
type nonrec github_pull_request_mergeability =
  | Mergeable
  | Conflicting
  | Unknown_
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pull_request_mergeability_of_yojson :
  Yojson.Safe.t -> github_pull_request_mergeability

val yojson_of_github_pull_request_mergeability :
  github_pull_request_mergeability -> Yojson.Safe.t

type nonrec github_pull_request_mergeability_entry = {
  mergeability : github_pull_request_mergeability;
      (** Whether the head merges cleanly into the base. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
}
(** One pull request's mergeability. *)

val github_pull_request_mergeability_entry_of_yojson :
  Yojson.Safe.t -> github_pull_request_mergeability_entry

val yojson_of_github_pull_request_mergeability_entry :
  github_pull_request_mergeability_entry -> Yojson.Safe.t

val make_github_pull_request_mergeability_entry :
  mergeability:github_pull_request_mergeability ->
  number:int64 ->
  owner:string ->
  repo:string ->
  unit ->
  github_pull_request_mergeability_entry
(** One pull request's mergeability. *)

type nonrec github_pull_request_number = {
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
}
(** One pull request, by repository and number. *)

val github_pull_request_number_of_yojson :
  Yojson.Safe.t -> github_pull_request_number

val yojson_of_github_pull_request_number :
  github_pull_request_number -> Yojson.Safe.t

val make_github_pull_request_number :
  number:int64 ->
  owner:string ->
  repo:string ->
  unit ->
  github_pull_request_number
(** One pull request, by repository and number. *)

type nonrec github_pull_request_mergeability_request = {
  pull_requests : github_pull_request_number list;
      (** The pull requests to check, at most \[[GithubPullRequestMergeabilityRequest::MAX]\]. *)
}
(** Request body for the mergeability of several pull requests. *)

val github_pull_request_mergeability_request_of_yojson :
  Yojson.Safe.t -> github_pull_request_mergeability_request

val yojson_of_github_pull_request_mergeability_request :
  github_pull_request_mergeability_request -> Yojson.Safe.t

val make_github_pull_request_mergeability_request :
  pull_requests:github_pull_request_number list ->
  unit ->
  github_pull_request_mergeability_request
(** Request body for the mergeability of several pull requests. *)

type nonrec github_pull_request_mergeability_response = {
  pull_requests : github_pull_request_mergeability_entry list;
      (** The mergeability of each visible pull request. *)
}
(** Response body for pull request mergeability. Pull requests the user
cannot see are left out. *)

val github_pull_request_mergeability_response_of_yojson :
  Yojson.Safe.t -> github_pull_request_mergeability_response

val yojson_of_github_pull_request_mergeability_response :
  github_pull_request_mergeability_response -> Yojson.Safe.t

val make_github_pull_request_mergeability_response :
  pull_requests:github_pull_request_mergeability_entry list ->
  unit ->
  github_pull_request_mergeability_response
(** Response body for pull request mergeability. Pull requests the user
cannot see are left out. *)

(** Whether a pull request is open or closed, as a user sets it. Merging is a
separate action, so unlike [GithubPullRequestStatus] there is no merged
state. *)
type nonrec github_pull_request_state =
  | Open
  | Closed
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pull_request_state_of_yojson :
  Yojson.Safe.t -> github_pull_request_state

val yojson_of_github_pull_request_state :
  github_pull_request_state -> Yojson.Safe.t

type nonrec gmail_link_status_response = {
  reauthentication_required : bool;
      (** Whether the user must reauthenticate their Gmail link. *)
}

val gmail_link_status_response_of_yojson :
  Yojson.Safe.t -> gmail_link_status_response

val yojson_of_gmail_link_status_response :
  gmail_link_status_response -> Yojson.Safe.t

val make_gmail_link_status_response :
  reauthentication_required:bool -> unit -> gmail_link_status_response

(** Where a link is in its lifecycle. *)
type nonrec gtm_invite_link_status =
  | Active
  | Expired
  | Revoked
  | Redeemed
  | Converted
  | Unknown of string  (** A value this SDK version does not know. *)

val gtm_invite_link_status_of_yojson : Yojson.Safe.t -> gtm_invite_link_status
val yojson_of_gtm_invite_link_status : gtm_invite_link_status -> Yojson.Safe.t

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

val gtm_invite_link_of_yojson : Yojson.Safe.t -> gtm_invite_link
val yojson_of_gtm_invite_link : gtm_invite_link -> Yojson.Safe.t

val make_gtm_invite_link :
  ?converted_at:string ->
  created_at:string ->
  created_by:string ->
  expires_at:string ->
  first_name:string ->
  ?first_opened_at:string ->
  free_months:int ->
  id:string ->
  ?note:string ->
  open_count:int ->
  promo_code:string ->
  ?recipient_email:string ->
  ?redeemed_at:string ->
  ?redeemed_by:string ->
  ?revoked_at:string ->
  status:gtm_invite_link_status ->
  ?stripe_subscription_id:string ->
  token:string ->
  unit ->
  gtm_invite_link
(** A link as shown on the staff dashboard. *)

type nonrec gtm_invite_link_list = {
  links : gtm_invite_link list;  (** Newest first. *)
}
(** Links for the dashboard. *)

val gtm_invite_link_list_of_yojson : Yojson.Safe.t -> gtm_invite_link_list
val yojson_of_gtm_invite_link_list : gtm_invite_link_list -> Yojson.Safe.t

val make_gtm_invite_link_list :
  links:gtm_invite_link list -> unit -> gtm_invite_link_list
(** Links for the dashboard. *)

type nonrec gtm_invite_offer = {
  first_name : string;  (** The first name the link was made out to. *)
  free_months : int;  (** Free months the promotion grants. *)
  link_id : string;  (** The redeemed link. *)
  promo_code : string;  (** The Stripe promotion code checkout applies. *)
  redeemed_at : string;  (** When the account redeemed the link. *)
}
(** The promotion a signed-in user's account holds. *)

val gtm_invite_offer_of_yojson : Yojson.Safe.t -> gtm_invite_offer
val yojson_of_gtm_invite_offer : gtm_invite_offer -> Yojson.Safe.t

val make_gtm_invite_offer :
  first_name:string ->
  free_months:int ->
  link_id:string ->
  promo_code:string ->
  redeemed_at:string ->
  unit ->
  gtm_invite_offer
(** The promotion a signed-in user's account holds. *)

type nonrec gtm_invite_offer_status = { offer : gtm_invite_offer option }
(** Whether the signed-in user holds an unused offer. *)

val gtm_invite_offer_status_of_yojson : Yojson.Safe.t -> gtm_invite_offer_status
val yojson_of_gtm_invite_offer_status : gtm_invite_offer_status -> Yojson.Safe.t

val make_gtm_invite_offer_status :
  ?offer:gtm_invite_offer -> unit -> gtm_invite_offer_status
(** Whether the signed-in user holds an unused offer. *)

type nonrec init_github_link_response = {
  authorization_url : string;
      (** The OAuth authorization URL to redirect the user to *)
  link_id : string;  (** The link ID for tracking the OAuth flow *)
}

val init_github_link_response_of_yojson :
  Yojson.Safe.t -> init_github_link_response

val yojson_of_init_github_link_response :
  init_github_link_response -> Yojson.Safe.t

val make_init_github_link_response :
  authorization_url:string ->
  link_id:string ->
  unit ->
  init_github_link_response

type nonrec init_gmail_link_response = {
  authorization_url : string;
      (** The OAuth authorization URL to redirect the user to *)
  link_id : string;  (** The link ID for tracking the OAuth flow *)
}

val init_gmail_link_response_of_yojson :
  Yojson.Safe.t -> init_gmail_link_response

val yojson_of_init_gmail_link_response :
  init_gmail_link_response -> Yojson.Safe.t

val make_init_gmail_link_response :
  authorization_url:string -> link_id:string -> unit -> init_gmail_link_response

type nonrec init_outlook_link_response = {
  authorization_url : string;
      (** The OAuth authorization URL to redirect the user to. *)
  link_id : string;  (** The link ID for tracking the OAuth flow. *)
}
(** Response returned when a Microsoft Outlook link is initiated. *)

val init_outlook_link_response_of_yojson :
  Yojson.Safe.t -> init_outlook_link_response

val yojson_of_init_outlook_link_response :
  init_outlook_link_response -> Yojson.Safe.t

val make_init_outlook_link_response :
  authorization_url:string ->
  link_id:string ->
  unit ->
  init_outlook_link_response
(** Response returned when a Microsoft Outlook link is initiated. *)

type nonrec invite_entry = {
  email : string;  (** The email of the user to invite *)
}
(** A single invite entry with email and tier *)

val invite_entry_of_yojson : Yojson.Safe.t -> invite_entry
val yojson_of_invite_entry : invite_entry -> Yojson.Safe.t

val make_invite_entry : email:string -> unit -> invite_entry
(** A single invite entry with email and tier *)

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

val invite_to_team_request_of_yojson : Yojson.Safe.t -> invite_to_team_request
val yojson_of_invite_to_team_request : invite_to_team_request -> Yojson.Safe.t

val make_invite_to_team_request :
  invites:invite_entry list ->
  ?is_agent:bool ->
  ?team_id:string ->
  unit ->
  invite_to_team_request
(** The request body to invite a user to a team *)

type nonrec join_team_by_invite_link_response = {
  already_member : bool;
      (** True when the user was already on the team and nothing changed. *)
  team_id : string;  (** The team the link joins. *)
}
(** The result of opening a team invite link. *)

val join_team_by_invite_link_response_of_yojson :
  Yojson.Safe.t -> join_team_by_invite_link_response

val yojson_of_join_team_by_invite_link_response :
  join_team_by_invite_link_response -> Yojson.Safe.t

val make_join_team_by_invite_link_response :
  already_member:bool ->
  team_id:string ->
  unit ->
  join_team_by_invite_link_response
(** The result of opening a team invite link. *)

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

val language_of_yojson : Yojson.Safe.t -> language
val yojson_of_language : language -> Yojson.Safe.t

(** Defines who can access an item through its share link. *)
type nonrec link_share =
  | Public
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

val link_share_of_yojson : Yojson.Safe.t -> link_share
val yojson_of_link_share : link_share -> Yojson.Safe.t

type nonrec macro_api_token_response = {
  macro_api_token : string;  (** The newly created macro_api_token *)
}

val macro_api_token_response_of_yojson :
  Yojson.Safe.t -> macro_api_token_response

val yojson_of_macro_api_token_response :
  macro_api_token_response -> Yojson.Safe.t

val make_macro_api_token_response :
  macro_api_token:string -> unit -> macro_api_token_response

type nonrec merge_github_pull_request_request = {
  merge_method : github_merge_method option;
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
}
(** A request to merge one pull request on the user's behalf. *)

val merge_github_pull_request_request_of_yojson :
  Yojson.Safe.t -> merge_github_pull_request_request

val yojson_of_merge_github_pull_request_request :
  merge_github_pull_request_request -> Yojson.Safe.t

val make_merge_github_pull_request_request :
  ?merge_method:github_merge_method ->
  number:int64 ->
  owner:string ->
  repo:string ->
  unit ->
  merge_github_pull_request_request
(** A request to merge one pull request on the user's behalf. *)

type nonrec merge_github_pull_request_response = {
  message : string;  (** GitHub's own summary of the merge. *)
  pull_request : enriched_github_pull_request option;
  sha : string;  (** The merge commit's SHA. *)
}
(** Response body for a merged pull request. *)

val merge_github_pull_request_response_of_yojson :
  Yojson.Safe.t -> merge_github_pull_request_response

val yojson_of_merge_github_pull_request_response :
  merge_github_pull_request_response -> Yojson.Safe.t

val make_merge_github_pull_request_response :
  message:string ->
  ?pull_request:enriched_github_pull_request ->
  sha:string ->
  unit ->
  merge_github_pull_request_response
(** Response body for a merged pull request. *)

type nonrec password_request = {
  email : string;  (** The email to login with *)
  password : string;
}

val password_request_of_yojson : Yojson.Safe.t -> password_request
val yojson_of_password_request : password_request -> Yojson.Safe.t

val make_password_request :
  email:string -> password:string -> unit -> password_request

type nonrec passwordless_request = {
  email : string;  (** The email to initiate passwordless authentication for *)
  is_agent : bool option;
      (** Create an agent account if this address has no account yet. Otherwise
[true] has no effect, and [false] reverts an agent flag nobody has proven:
see [revert_unconfirmed_agent]. *)
  redirect_uri : string;  (** The redirect uri to redirect to after login *)
  referral_code : string option;  (** The referral code *)
}

val passwordless_request_of_yojson : Yojson.Safe.t -> passwordless_request
val yojson_of_passwordless_request : passwordless_request -> Yojson.Safe.t

val make_passwordless_request :
  email:string ->
  ?is_agent:bool ->
  redirect_uri:string ->
  ?referral_code:string ->
  unit ->
  passwordless_request

type nonrec passwordless_started_response = {
  code : string option;
      (** The one-time login code, returned only by local environments so dev
tooling can complete the flow without reading the email. *)
}

val passwordless_started_response_of_yojson :
  Yojson.Safe.t -> passwordless_started_response

val yojson_of_passwordless_started_response :
  passwordless_started_response -> Yojson.Safe.t

val make_passwordless_started_response :
  ?code:string -> unit -> passwordless_started_response

type nonrec patch_team_crm_settings_request = {
  backfill : bool option;
      (** Retained for compatibility and ignored. Email backfill requires
each member's explicit consent through CRM email privacy settings. *)
  enabled : bool;
      (** Legacy compatibility flag. True is a no-op; false is rejected. *)
}
(** Request body for [PATCH /team/crm]. *)

val patch_team_crm_settings_request_of_yojson :
  Yojson.Safe.t -> patch_team_crm_settings_request

val yojson_of_patch_team_crm_settings_request :
  patch_team_crm_settings_request -> Yojson.Safe.t

val make_patch_team_crm_settings_request :
  ?backfill:bool -> enabled:bool -> unit -> patch_team_crm_settings_request
(** Request body for [PATCH /team/crm]. *)

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

val patch_team_crm_settings_response_of_yojson :
  Yojson.Safe.t -> patch_team_crm_settings_response

val yojson_of_patch_team_crm_settings_response :
  patch_team_crm_settings_response -> Yojson.Safe.t

val make_patch_team_crm_settings_response :
  backfill_enqueued:int ->
  backfill_failed:int ->
  changed:bool ->
  enabled:bool ->
  unit ->
  patch_team_crm_settings_response
(** Compatibility response for [PATCH /team/crm]. CRM records are always
available; this endpoint does not enroll mailboxes or backfill emails. *)

type nonrec patch_team_member_plan_request = {
  plan : seat_plan;  (** The plan to bill the member's seat at from now on. *)
}
(** Request body for [PATCH /team/members/{member_user_id}/plan]. *)

val patch_team_member_plan_request_of_yojson :
  Yojson.Safe.t -> patch_team_member_plan_request

val yojson_of_patch_team_member_plan_request :
  patch_team_member_plan_request -> Yojson.Safe.t

val make_patch_team_member_plan_request :
  plan:seat_plan -> unit -> patch_team_member_plan_request
(** Request body for [PATCH /team/members/{member_user_id}/plan]. *)

(** Ordered from least to most access top -> bottom *)
type nonrec team_role =
  | Member
  | Admin
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

val team_role_of_yojson : Yojson.Safe.t -> team_role
val yojson_of_team_role : team_role -> Yojson.Safe.t

type nonrec patch_team_user_role = {
  role : team_role;  (** The new role of the team user *)
  team_user_id : string;  (** The team user you are updating *)
}
(** Request to update a team user's role *)

val patch_team_user_role_of_yojson : Yojson.Safe.t -> patch_team_user_role
val yojson_of_patch_team_user_role : patch_team_user_role -> Yojson.Safe.t

val make_patch_team_user_role :
  role:team_role -> team_user_id:string -> unit -> patch_team_user_role
(** Request to update a team user's role *)

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

val patch_team_request_of_yojson : Yojson.Safe.t -> patch_team_request
val yojson_of_patch_team_request : patch_team_request -> Yojson.Safe.t

val make_patch_team_request :
  ?default_link_share:link_share ->
  ?language:language ->
  ?name:string ->
  ?slug:string ->
  ?user_role_updates:patch_team_user_role list ->
  unit ->
  patch_team_request
(** Request to update a team *)

type nonrec patch_user_group_request = {
  group : string;  (** The group to add the user to *)
}

val patch_user_group_request_of_yojson :
  Yojson.Safe.t -> patch_user_group_request

val yojson_of_patch_user_group_request :
  patch_user_group_request -> Yojson.Safe.t

val make_patch_user_group_request :
  group:string -> unit -> patch_user_group_request

type nonrec patch_user_onboarding_request = {
  first_name : string;  (** The first name of the user *)
  industry : string;  (** The industry of the user *)
  last_name : string;  (** The last name of the user *)
  title : string;  (** The title of the user *)
}

val patch_user_onboarding_request_of_yojson :
  Yojson.Safe.t -> patch_user_onboarding_request

val yojson_of_patch_user_onboarding_request :
  patch_user_onboarding_request -> Yojson.Safe.t

val make_patch_user_onboarding_request :
  first_name:string ->
  industry:string ->
  last_name:string ->
  title:string ->
  unit ->
  patch_user_onboarding_request

type nonrec patch_user_tutorial_request = {
  tutorial_complete : bool;  (** If the user has completed the tutorial *)
}

val patch_user_tutorial_request_of_yojson :
  Yojson.Safe.t -> patch_user_tutorial_request

val yojson_of_patch_user_tutorial_request :
  patch_user_tutorial_request -> Yojson.Safe.t

val make_patch_user_tutorial_request :
  tutorial_complete:bool -> unit -> patch_user_tutorial_request

type nonrec permission = {
  description : string;  (** The description of the permission *)
  id : string;  (** The permission *)
}

val permission_of_yojson : Yojson.Safe.t -> permission
val yojson_of_permission : permission -> Yojson.Safe.t
val make_permission : description:string -> id:string -> unit -> permission

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

val plan_catalog_entry_of_yojson : Yojson.Safe.t -> plan_catalog_entry
val yojson_of_plan_catalog_entry : plan_catalog_entry -> Yojson.Safe.t

val make_plan_catalog_entry :
  ?auto_reload_default_monthly_limit_cents:int64 ->
  included_ai_cents_per_seat:int64 ->
  monthly_price_cents:int64 ->
  purchasable:bool ->
  tier:plan_tier ->
  unit ->
  plan_catalog_entry
(** One plan in the catalog. *)

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

val plan_catalog_response_of_yojson : Yojson.Safe.t -> plan_catalog_response
val yojson_of_plan_catalog_response : plan_catalog_response -> Yojson.Safe.t

val make_plan_catalog_response :
  auto_reload_defaults:auto_reload_defaults ->
  auto_reload_target_max_cents:int64 ->
  credit_packs_cents:int64 list ->
  overage_limit_max_cents:int64 ->
  overage_limit_min_cents:int64 ->
  plans:plan_catalog_entry list ->
  unit ->
  plan_catalog_response
(** The plan catalog and the knobs the billing UI offers. *)

type nonrec post_get_names_request_body = { user_ids : string list }

val post_get_names_request_body_of_yojson :
  Yojson.Safe.t -> post_get_names_request_body

val yojson_of_post_get_names_request_body :
  post_get_names_request_body -> Yojson.Safe.t

val make_post_get_names_request_body :
  user_ids:string list -> unit -> post_get_names_request_body

type nonrec power_body = { on : bool  (** Requested power state. *) }
(** Body of a power change. *)

val power_body_of_yojson : Yojson.Safe.t -> power_body
val yojson_of_power_body : power_body -> Yojson.Safe.t

val make_power_body : on:bool -> unit -> power_body
(** Body of a power change. *)

type nonrec profile_picture_query_params = { url : string }

val profile_picture_query_params_of_yojson :
  Yojson.Safe.t -> profile_picture_query_params

val yojson_of_profile_picture_query_params :
  profile_picture_query_params -> Yojson.Safe.t

val make_profile_picture_query_params :
  url:string -> unit -> profile_picture_query_params

type nonrec profile_picture_upload = {
  file_id : string;
      (** Id to pass to [PUT /user/profile_picture/file] once uploaded. *)
  upload_url : string;  (** Expiring URL to [PUT] the image bytes to. *)
}
(** Where to upload a new profile picture, and the file id to set afterwards. *)

val profile_picture_upload_of_yojson : Yojson.Safe.t -> profile_picture_upload
val yojson_of_profile_picture_upload : profile_picture_upload -> Yojson.Safe.t

val make_profile_picture_upload :
  file_id:string -> upload_url:string -> unit -> profile_picture_upload
(** Where to upload a new profile picture, and the file id to set afterwards. *)

type nonrec user_profile_picture = {
  checksum : string option;
  id : string;
  url : string;
}

val user_profile_picture_of_yojson : Yojson.Safe.t -> user_profile_picture
val yojson_of_user_profile_picture : user_profile_picture -> Yojson.Safe.t

val make_user_profile_picture :
  ?checksum:string -> id:string -> url:string -> unit -> user_profile_picture

type nonrec profile_pictures = { pictures : user_profile_picture list }

val profile_pictures_of_yojson : Yojson.Safe.t -> profile_pictures
val yojson_of_profile_pictures : profile_pictures -> Yojson.Safe.t

val make_profile_pictures :
  pictures:user_profile_picture list -> unit -> profile_pictures

type nonrec public_gtm_invite_link = {
  first_name : string;  (** The recipient's first name. *)
  free_months : int;  (** Free months the promotion grants. *)
  status : gtm_invite_link_status;  (** Whether the link can still be used. *)
}
(** What the public welcome page learns about a link. *)

val public_gtm_invite_link_of_yojson : Yojson.Safe.t -> public_gtm_invite_link
val yojson_of_public_gtm_invite_link : public_gtm_invite_link -> Yojson.Safe.t

val make_public_gtm_invite_link :
  first_name:string ->
  free_months:int ->
  status:gtm_invite_link_status ->
  unit ->
  public_gtm_invite_link
(** What the public welcome page learns about a link. *)

type nonrec purchase_body = {
  name : string option;  (** Display name. *)
  purchase_key : string;
      (** The client's key for this purchase: one per Buy dialog, sent again
when the purchase is retried, so a retry never charges twice. *)
  size : computer_size;  (** Purchased catalog size. *)
}
(** Body of a team purchase. *)

val purchase_body_of_yojson : Yojson.Safe.t -> purchase_body
val yojson_of_purchase_body : purchase_body -> Yojson.Safe.t

val make_purchase_body :
  ?name:string ->
  purchase_key:string ->
  size:computer_size ->
  unit ->
  purchase_body
(** Body of a team purchase. *)

(** Where a purchase stands when its request returns. *)
type nonrec purchase_state =
  | Ready
  | Confirming
  | Unknown of string  (** A value this SDK version does not know. *)

val purchase_state_of_yojson : Yojson.Safe.t -> purchase_state
val yojson_of_purchase_state : purchase_state -> Yojson.Safe.t

type nonrec purchased = {
  computer_id : string;  (** Computer this operation addresses. *)
  state : purchase_state;  (** Whether the computer exists yet. *)
}
(** Answer of a purchase. *)

val purchased_of_yojson : Yojson.Safe.t -> purchased
val yojson_of_purchased : purchased -> Yojson.Safe.t

val make_purchased :
  computer_id:string -> state:purchase_state -> unit -> purchased
(** Answer of a purchase. *)

type nonrec put_agent_api_key_request = {
  api_key : string;
      (** An Anthropic ([sk-ant-…]) or OpenAI ([sk-…]) key, for the provider of
the agent's model. *)
}
(** The key someone pasted. *)

val put_agent_api_key_request_of_yojson :
  Yojson.Safe.t -> put_agent_api_key_request

val yojson_of_put_agent_api_key_request :
  put_agent_api_key_request -> Yojson.Safe.t

val make_put_agent_api_key_request :
  api_key:string -> unit -> put_agent_api_key_request
(** The key someone pasted. *)

type nonrec put_cursor_api_key_request = {
  api_key : string;
      (** A Cursor API key: [grok_…], or [crsr_…] for older keys. *)
}
(** The key the user pasted. *)

val put_cursor_api_key_request_of_yojson :
  Yojson.Safe.t -> put_cursor_api_key_request

val yojson_of_put_cursor_api_key_request :
  put_cursor_api_key_request -> Yojson.Safe.t

val make_put_cursor_api_key_request :
  api_key:string -> unit -> put_cursor_api_key_request
(** The key the user pasted. *)

type nonrec put_cursor_default_model_request = {
  effort : string option;
      (** The value of the model's reasoning-effort parameter (e.g. [high]), or
[null] for the model's own default. Ignored without a model. *)
  model_id : string option;
      (** A Cursor model id (e.g. [grok-4.6]), or [null] to clear the choice and
fall back to the deployment default. *)
}
(** The model the user chose for their sessions, and its effort. *)

val put_cursor_default_model_request_of_yojson :
  Yojson.Safe.t -> put_cursor_default_model_request

val yojson_of_put_cursor_default_model_request :
  put_cursor_default_model_request -> Yojson.Safe.t

val make_put_cursor_default_model_request :
  ?effort:string -> ?model_id:string -> unit -> put_cursor_default_model_request
(** The model the user chose for their sessions, and its effort. *)

type nonrec put_profile_picture_file_request = {
  file_id : string;
      (** Id of an image the caller uploaded to static file storage. *)
}

val put_profile_picture_file_request_of_yojson :
  Yojson.Safe.t -> put_profile_picture_file_request

val yojson_of_put_profile_picture_file_request :
  put_profile_picture_file_request -> Yojson.Safe.t

val make_put_profile_picture_file_request :
  file_id:string -> unit -> put_profile_picture_file_request

type nonrec put_user_name_query_params = {
  first_name : string option;  (** First Name of user *)
  last_name : string option;  (** Last Name of user *)
}

val put_user_name_query_params_of_yojson :
  Yojson.Safe.t -> put_user_name_query_params

val yojson_of_put_user_name_query_params :
  put_user_name_query_params -> Yojson.Safe.t

val make_put_user_name_query_params :
  ?first_name:string -> ?last_name:string -> unit -> put_user_name_query_params

type nonrec quote = {
  amount : int64;  (** In the currency's smallest unit. *)
  currency : string;  (** Billing currency code. *)
  interval : billing_interval;  (** Subscription billing interval. *)
  price_id : string;  (** Stripe price saved for billing replay. *)
  size : computer_size;  (** Purchased catalog size. *)
}
(** What one computer of a size costs the team. *)

val quote_of_yojson : Yojson.Safe.t -> quote
val yojson_of_quote : quote -> Yojson.Safe.t

val make_quote :
  amount:int64 ->
  currency:string ->
  interval:billing_interval ->
  price_id:string ->
  size:computer_size ->
  unit ->
  quote
(** What one computer of a size costs the team. *)

type nonrec redeem_gtm_invite_link_request = {
  token : string;  (** The token from the link URL. *)
}
(** Request body to redeem a link. *)

val redeem_gtm_invite_link_request_of_yojson :
  Yojson.Safe.t -> redeem_gtm_invite_link_request

val yojson_of_redeem_gtm_invite_link_request :
  redeem_gtm_invite_link_request -> Yojson.Safe.t

val make_redeem_gtm_invite_link_request :
  token:string -> unit -> redeem_gtm_invite_link_request
(** Request body to redeem a link. *)

type nonrec release_body = {
  confirm_name : string;  (** The computer's name, typed to confirm. *)
}
(** Body of a release. *)

val release_body_of_yojson : Yojson.Safe.t -> release_body
val yojson_of_release_body : release_body -> Yojson.Safe.t

val make_release_body : confirm_name:string -> unit -> release_body
(** Body of a release. *)

type nonrec resend_fusionauth_verify_user_email_request = {
  email : string;  (** The email address to resend the verification email to *)
}

val resend_fusionauth_verify_user_email_request_of_yojson :
  Yojson.Safe.t -> resend_fusionauth_verify_user_email_request

val yojson_of_resend_fusionauth_verify_user_email_request :
  resend_fusionauth_verify_user_email_request -> Yojson.Safe.t

val make_resend_fusionauth_verify_user_email_request :
  email:string -> unit -> resend_fusionauth_verify_user_email_request

type nonrec scheduled_seat_plan = {
  effective_at : string;
      (** Provider-confirmed time when the future phase starts. *)
  plan : seat_plan;  (** Plan that takes effect at renewal. *)
}
(** A seat's future plan in the subscription's currently attached schedule. *)

val scheduled_seat_plan_of_yojson : Yojson.Safe.t -> scheduled_seat_plan
val yojson_of_scheduled_seat_plan : scheduled_seat_plan -> Yojson.Safe.t

val make_scheduled_seat_plan :
  effective_at:string -> plan:seat_plan -> unit -> scheduled_seat_plan
(** A seat's future plan in the subscription's currently attached schedule. *)

type nonrec send_domain_notice_response = {
  sent : int;  (** How many colleagues were emailed by this call. *)
}
(** Response for the domain notice endpoint. *)

val send_domain_notice_response_of_yojson :
  Yojson.Safe.t -> send_domain_notice_response

val yojson_of_send_domain_notice_response :
  send_domain_notice_response -> Yojson.Safe.t

val make_send_domain_notice_response :
  sent:int -> unit -> send_domain_notice_response
(** Response for the domain notice endpoint. *)

type nonrec send_invite_body = {
  recipient : string;  (** the recipient of the referral email *)
}
(** The body which is used to describe the recipient email *)

val send_invite_body_of_yojson : Yojson.Safe.t -> send_invite_body
val yojson_of_send_invite_body : send_invite_body -> Yojson.Safe.t

val make_send_invite_body : recipient:string -> unit -> send_invite_body
(** The body which is used to describe the recipient email *)

type nonrec send_mobile_welcome_email_request = {
  email : string;  (** The email address to send the welcome email to *)
}

val send_mobile_welcome_email_request_of_yojson :
  Yojson.Safe.t -> send_mobile_welcome_email_request

val yojson_of_send_mobile_welcome_email_request :
  send_mobile_welcome_email_request -> Yojson.Safe.t

val make_send_mobile_welcome_email_request :
  email:string -> unit -> send_mobile_welcome_email_request

type nonrec send_mobile_welcome_email_response = {
  sent : bool;
      (** Whether the lead was enrolled (false if they were already enrolled previously) *)
}

val send_mobile_welcome_email_response_of_yojson :
  Yojson.Safe.t -> send_mobile_welcome_email_response

val yojson_of_send_mobile_welcome_email_response :
  send_mobile_welcome_email_response -> Yojson.Safe.t

val make_send_mobile_welcome_email_response :
  sent:bool -> unit -> send_mobile_welcome_email_response

type nonrec set_github_pull_request_draft_request = {
  draft : bool;
      (** [true] converts the pull request to a draft; [false] marks it ready for review. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
}
(** A request to mark one pull request as a draft, or as ready for review, on
the user's behalf. *)

val set_github_pull_request_draft_request_of_yojson :
  Yojson.Safe.t -> set_github_pull_request_draft_request

val yojson_of_set_github_pull_request_draft_request :
  set_github_pull_request_draft_request -> Yojson.Safe.t

val make_set_github_pull_request_draft_request :
  draft:bool ->
  number:int64 ->
  owner:string ->
  repo:string ->
  unit ->
  set_github_pull_request_draft_request
(** A request to mark one pull request as a draft, or as ready for review, on
the user's behalf. *)

type nonrec set_github_pull_request_draft_response = {
  draft : bool;  (** Whether the pull request is now a draft. *)
  pull_request : enriched_github_pull_request option;
}
(** Response body for a pull request whose draft state changed. *)

val set_github_pull_request_draft_response_of_yojson :
  Yojson.Safe.t -> set_github_pull_request_draft_response

val yojson_of_set_github_pull_request_draft_response :
  set_github_pull_request_draft_response -> Yojson.Safe.t

val make_set_github_pull_request_draft_response :
  draft:bool ->
  ?pull_request:enriched_github_pull_request ->
  unit ->
  set_github_pull_request_draft_response
(** Response body for a pull request whose draft state changed. *)

type nonrec set_github_pull_request_state_request = {
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  state : github_pull_request_state;
      (** [closed] closes the pull request; [open] reopens it. *)
}
(** A request to close one pull request, or reopen it, on the user's behalf. *)

val set_github_pull_request_state_request_of_yojson :
  Yojson.Safe.t -> set_github_pull_request_state_request

val yojson_of_set_github_pull_request_state_request :
  set_github_pull_request_state_request -> Yojson.Safe.t

val make_set_github_pull_request_state_request :
  number:int64 ->
  owner:string ->
  repo:string ->
  state:github_pull_request_state ->
  unit ->
  set_github_pull_request_state_request
(** A request to close one pull request, or reopen it, on the user's behalf. *)

type nonrec set_github_pull_request_state_response = {
  pull_request : enriched_github_pull_request option;
  state : github_pull_request_state;
      (** Whether the pull request is now open or closed. *)
}
(** Response body for a pull request that was closed or reopened. *)

val set_github_pull_request_state_response_of_yojson :
  Yojson.Safe.t -> set_github_pull_request_state_response

val yojson_of_set_github_pull_request_state_response :
  set_github_pull_request_state_response -> Yojson.Safe.t

val make_set_github_pull_request_state_response :
  ?pull_request:enriched_github_pull_request ->
  state:github_pull_request_state ->
  unit ->
  set_github_pull_request_state_response
(** Response body for a pull request that was closed or reopened. *)

type nonrec size_offer = {
  disk_gb : int;  (** Root disk size in GiB. *)
  memory_gb : int;  (** Memory in GiB. *)
  quote : quote;  (** Price for one computer. *)
  size : computer_size;  (** Purchased catalog size. *)
  sold_out : bool;  (** Whether no host can currently sell this size. *)
  vcpus : int;  (** Virtual CPU count. *)
}
(** A size with its resources, price and whether it can be bought now. *)

val size_offer_of_yojson : Yojson.Safe.t -> size_offer
val yojson_of_size_offer : size_offer -> Yojson.Safe.t

val make_size_offer :
  disk_gb:int ->
  memory_gb:int ->
  quote:quote ->
  size:computer_size ->
  sold_out:bool ->
  vcpus:int ->
  unit ->
  size_offer
(** A size with its resources, price and whether it can be bought now. *)

type nonrec sso_required_response = {
  idp_id : string;  (** The idp_id you need to perform sso login with. *)
}

val sso_required_response_of_yojson : Yojson.Safe.t -> sso_required_response
val yojson_of_sso_required_response : sso_required_response -> Yojson.Safe.t
val make_sso_required_response : idp_id:string -> unit -> sso_required_response

type nonrec status_update = {
  system_status : system_status;  (** The status that was set. *)
  created_at : string;  (** When it was set. *)
  id : string;  (** UUIDv7, so ids sort by creation. *)
  user_id : string;  (** The staff member who set it. *)
}
(** One status a staff member set. The newest is the current status. *)

val status_update_of_yojson : Yojson.Safe.t -> status_update
val yojson_of_status_update : status_update -> Yojson.Safe.t

val make_status_update :
  system_status:system_status ->
  created_at:string ->
  id:string ->
  user_id:string ->
  unit ->
  status_update
(** One status a staff member set. The newest is the current status. *)

type nonrec stripe_session_response = {
  url : string;  (** The URL to redirect the user to *)
}
(** Response containing the Stripe session URL *)

val stripe_session_response_of_yojson : Yojson.Safe.t -> stripe_session_response
val yojson_of_stripe_session_response : stripe_session_response -> Yojson.Safe.t

val make_stripe_session_response : url:string -> unit -> stripe_session_response
(** Response containing the Stripe session URL *)

type nonrec subscription_seat_total = {
  amount : int64;
      (** Actual recurring price times allocated quantity, in minor units. *)
  quantity : int64;  (** Actual billed quantity allocated to this seat kind. *)
}
(** Billed seat quantity and current recurring amount in minor units. *)

val subscription_seat_total_of_yojson : Yojson.Safe.t -> subscription_seat_total
val yojson_of_subscription_seat_total : subscription_seat_total -> Yojson.Safe.t

val make_subscription_seat_total :
  amount:int64 -> quantity:int64 -> unit -> subscription_seat_total
(** Billed seat quantity and current recurring amount in minor units. *)

(** What an actual subscription item pays for. *)
type nonrec subscription_billing_line_kind =
  | Human_seat
  | Computer
  | Other
  | Unknown of string  (** A value this SDK version does not know. *)

val subscription_billing_line_kind_of_yojson :
  Yojson.Safe.t -> subscription_billing_line_kind

val yojson_of_subscription_billing_line_kind :
  subscription_billing_line_kind -> Yojson.Safe.t

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

val subscription_billing_line_item_of_yojson :
  Yojson.Safe.t -> subscription_billing_line_item

val yojson_of_subscription_billing_line_item :
  subscription_billing_line_item -> Yojson.Safe.t

val make_subscription_billing_line_item :
  amount:int64 ->
  ?computer_id:string ->
  included:bool ->
  kind:subscription_billing_line_kind ->
  name:string ->
  ?plan:seat_plan ->
  quantity:int64 ->
  ?size:computer_size ->
  ?status:computer_status_kind ->
  ?unit_amount:int64 ->
  unit ->
  subscription_billing_line_item
(** An allocated provider item or an explicitly included computer. *)

type nonrec subscription_next_invoice = {
  amount : int64;  (** Actual upcoming invoice amount due in minor units. *)
  date : string option;
      (** Provider's next payment or due date, when supplied. *)
}
(** Provider-confirmed next invoice, including its adjustments and credits. *)

val subscription_next_invoice_of_yojson :
  Yojson.Safe.t -> subscription_next_invoice

val yojson_of_subscription_next_invoice :
  subscription_next_invoice -> Yojson.Safe.t

val make_subscription_next_invoice :
  amount:int64 -> ?date:string -> unit -> subscription_next_invoice
(** Provider-confirmed next invoice, including its adjustments and credits. *)

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

val subscription_billing_of_yojson : Yojson.Safe.t -> subscription_billing
val yojson_of_subscription_billing : subscription_billing -> Yojson.Safe.t

val make_subscription_billing :
  currency:string ->
  human_seats:subscription_seat_total ->
  interval:billing_interval ->
  line_items:subscription_billing_line_item list ->
  ?next_invoice:subscription_next_invoice ->
  subscription_total:int64 ->
  unit ->
  subscription_billing
(** Actual current recurring items and the provider's next invoice preview. *)

type nonrec subscription_item = {
  price_id : string;  (** Stripe price saved for billing replay. *)
  quantity : int;  (** Added to the item's current quantity. *)
}
(** A Stripe price and how many of it to add to the team subscription. *)

val subscription_item_of_yojson : Yojson.Safe.t -> subscription_item
val yojson_of_subscription_item : subscription_item -> Yojson.Safe.t

val make_subscription_item :
  price_id:string -> quantity:int -> unit -> subscription_item
(** A Stripe price and how many of it to add to the team subscription. *)

type nonrec subscription_status = {
  billing : subscription_billing option;
  renewal_date : string option;
      (** Provider-confirmed subscription renewal date. *)
  scheduled_change : scheduled_seat_plan option;
}
(** Current renewal and scheduled change; empty for accounts without a subscription. *)

val subscription_status_of_yojson : Yojson.Safe.t -> subscription_status
val yojson_of_subscription_status : subscription_status -> Yojson.Safe.t

val make_subscription_status :
  ?billing:subscription_billing ->
  ?renewal_date:string ->
  ?scheduled_change:scheduled_seat_plan ->
  unit ->
  subscription_status
(** Current renewal and scheduled change; empty for accounts without a subscription. *)

type nonrec system_status_history = {
  updates : status_update list;  (** The updates. *)
}
(** Recent status updates, newest first. *)

val system_status_history_of_yojson : Yojson.Safe.t -> system_status_history
val yojson_of_system_status_history : system_status_history -> Yojson.Safe.t

val make_system_status_history :
  updates:status_update list -> unit -> system_status_history
(** Recent status updates, newest first. *)

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

val team_of_yojson : Yojson.Safe.t -> team
val yojson_of_team : team -> Yojson.Safe.t

val make_team :
  allow_non_admin_invites:bool ->
  ?auto_join_domain:string ->
  crm_enabled:bool ->
  ?default_link_share:link_share ->
  enterprise:bool ->
  id:string ->
  ?language:language ->
  name:string ->
  owner_id:string ->
  slug:string ->
  unit ->
  team
(** The Team struct *)

(** Where an agent teammate is, from its computer. *)
type nonrec team_agent_status =
  | Provisioning
  | Running
  | Paused
  | Failed
  | Released
  | Unknown of string  (** A value this SDK version does not know. *)

val team_agent_status_of_yojson : Yojson.Safe.t -> team_agent_status
val yojson_of_team_agent_status : team_agent_status -> Yojson.Safe.t

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

val team_agent_of_yojson : Yojson.Safe.t -> team_agent
val yojson_of_team_agent : team_agent -> Yojson.Safe.t

val make_team_agent :
  ?computer_id:string ->
  created_at:string ->
  ?created_by:string ->
  job_description:string ->
  name:string ->
  personality:string ->
  status:team_agent_status ->
  team_id:string ->
  user_id:string ->
  unit ->
  team_agent
(** An agent teammate: an AI member of a team with its own Macro account and
its own Macro computer. *)

type nonrec team_agents = {
  agents : team_agent list;  (** The agents, oldest first. *)
}
(** A team's agents. *)

val team_agents_of_yojson : Yojson.Safe.t -> team_agents
val yojson_of_team_agents : team_agents -> Yojson.Safe.t

val make_team_agents : agents:team_agent list -> unit -> team_agents
(** A team's agents. *)

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

val team_invite_details_of_yojson : Yojson.Safe.t -> team_invite_details
val yojson_of_team_invite_details : team_invite_details -> Yojson.Safe.t

val make_team_invite_details :
  created_at:string ->
  email:string ->
  id:string ->
  invited_by:string ->
  is_agent:bool ->
  last_sent_at:string ->
  team_id:string ->
  team_role:team_role ->
  unit ->
  team_invite_details
(** Detailed information about a team invite *)

type nonrec team_invite_link_response = {
  token : team_invite_link_token option;
}
(** The caller's team invite link. *)

val team_invite_link_response_of_yojson :
  Yojson.Safe.t -> team_invite_link_response

val yojson_of_team_invite_link_response :
  team_invite_link_response -> Yojson.Safe.t

val make_team_invite_link_response :
  ?token:team_invite_link_token -> unit -> team_invite_link_response
(** The caller's team invite link. *)

type nonrec team_invite_link_team = {
  team_id : string;  (** Id of the team the link joins. *)
  team_name : string;  (** Name of the team the link joins. *)
}
(** The team an invite link joins, shown before the user accepts. *)

val team_invite_link_team_of_yojson : Yojson.Safe.t -> team_invite_link_team
val yojson_of_team_invite_link_team : team_invite_link_team -> Yojson.Safe.t

val make_team_invite_link_team :
  team_id:string -> team_name:string -> unit -> team_invite_link_team
(** The team an invite link joins, shown before the user accepts. *)

type nonrec team_invite_link_token_request = {
  token : team_invite_link_token;  (** The invite link's token. *)
}
(** Identifies an invite link. The token travels in the body, not the path, so
request spans and access logs that record the path never see it. *)

val team_invite_link_token_request_of_yojson :
  Yojson.Safe.t -> team_invite_link_token_request

val yojson_of_team_invite_link_token_request :
  team_invite_link_token_request -> Yojson.Safe.t

val make_team_invite_link_token_request :
  token:team_invite_link_token -> unit -> team_invite_link_token_request
(** Identifies an invite link. The token travels in the body, not the path, so
request spans and access logs that record the path never see it. *)

type nonrec team_invites_response = {
  invites : team_invite_details list;  (** The invites *)
}
(** Response containing a list of team invites *)

val team_invites_response_of_yojson : Yojson.Safe.t -> team_invites_response
val yojson_of_team_invites_response : team_invites_response -> Yojson.Safe.t

val make_team_invites_response :
  invites:team_invite_details list -> unit -> team_invites_response
(** Response containing a list of team invites *)

type nonrec team_member = {
  plan : seat_plan;
      (** The paid plan the member's seat is billed at. Meaningful on paying
and enterprise teams; free-team members carry the default. *)
  role : team_role;  (** The role of the team member *)
  team_id : string;  (** The id of the team *)
  user_id : string;  (** The user id of the team member *)
}
(** The team member struct *)

val team_member_of_yojson : Yojson.Safe.t -> team_member
val yojson_of_team_member : team_member -> Yojson.Safe.t

val make_team_member :
  plan:seat_plan ->
  role:team_role ->
  team_id:string ->
  user_id:string ->
  unit ->
  team_member
(** The team member struct *)

(** Team plans *)
type nonrec team_plan =
  | Idea
  | Pre_seed
  | Seed
  | Series_a
  | Growth
  | Unknown of string  (** A value this SDK version does not know. *)

val team_plan_of_yojson : Yojson.Safe.t -> team_plan
val yojson_of_team_plan : team_plan -> Yojson.Safe.t

type nonrec team_with_members = {
  members : team_member list;  (** The members of the team *)
  scheduled_seat_plans : (string * scheduled_seat_plan) list option;
      (** Provider-confirmed pending seat changes, keyed by member user ID.
Empty when no changes apply to this viewer; absent when the lookup fails. *)
  team : team;  (** The team *)
}
(** A team with its members *)

val team_with_members_of_yojson : Yojson.Safe.t -> team_with_members
val yojson_of_team_with_members : team_with_members -> Yojson.Safe.t

val make_team_with_members :
  members:team_member list ->
  ?scheduled_seat_plans:(string * scheduled_seat_plan) list ->
  team:team ->
  unit ->
  team_with_members
(** A team with its members *)

type nonrec toggle_auto_join_domain_response = {
  auto_join_domain : string option;
      (** The team's auto-join domain after the toggle (null when it was
unset by this call). *)
}
(** Response for the toggle auto-join domain endpoint. *)

val toggle_auto_join_domain_response_of_yojson :
  Yojson.Safe.t -> toggle_auto_join_domain_response

val yojson_of_toggle_auto_join_domain_response :
  toggle_auto_join_domain_response -> Yojson.Safe.t

val make_toggle_auto_join_domain_response :
  ?auto_join_domain:string -> unit -> toggle_auto_join_domain_response
(** Response for the toggle auto-join domain endpoint. *)

type nonrec toggle_non_admin_invites_response = {
  allow_non_admin_invites : bool;
      (** Whether non-admin members may invite users to the team after the
toggle. *)
}
(** Response for the toggle non-admin invites endpoint. *)

val toggle_non_admin_invites_response_of_yojson :
  Yojson.Safe.t -> toggle_non_admin_invites_response

val yojson_of_toggle_non_admin_invites_response :
  toggle_non_admin_invites_response -> Yojson.Safe.t

val make_toggle_non_admin_invites_response :
  allow_non_admin_invites:bool -> unit -> toggle_non_admin_invites_response
(** Response for the toggle non-admin invites endpoint. *)

type nonrec trial_eligibility = {
  eligible : bool;
      (** Confirmed against the same subscription history used during checkout. *)
  existing_subscription : bool;
      (** An existing subscription requires management instead of a new checkout. *)
}
(** Whether the authenticated customer can receive the introductory Pro trial. *)

val trial_eligibility_of_yojson : Yojson.Safe.t -> trial_eligibility
val yojson_of_trial_eligibility : trial_eligibility -> Yojson.Safe.t

val make_trial_eligibility :
  eligible:bool -> existing_subscription:bool -> unit -> trial_eligibility
(** Whether the authenticated customer can receive the introductory Pro trial. *)

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

val update_auto_reload_request_of_yojson :
  Yojson.Safe.t -> update_auto_reload_request

val yojson_of_update_auto_reload_request :
  update_auto_reload_request -> Yojson.Safe.t

val make_update_auto_reload_request :
  enabled:bool ->
  minimum_balance_cents:int64 ->
  ?monthly_spend_limit_cents:int64 ->
  target_balance_cents:int64 ->
  unit ->
  update_auto_reload_request
(** Request body for \[[update_auto_reload_handler]\]. *)

type nonrec update_overage_request = {
  enabled : bool;  (** Bill usage past allowance and credits. *)
  limit_cents : int64 option;
      (** Per-period cap on overage spend, cents. Required when enabling. *)
}
(** Request body for \[[update_overage_handler]\]. *)

val update_overage_request_of_yojson : Yojson.Safe.t -> update_overage_request
val yojson_of_update_overage_request : update_overage_request -> Yojson.Safe.t

val make_update_overage_request :
  enabled:bool -> ?limit_cents:int64 -> unit -> update_overage_request
(** Request body for \[[update_overage_handler]\]. *)

(** What kind of upstream failure a 502 or 503 reports, for clients that
branch on it. *)
type nonrec upstream_error_code =
  | Upstream_unavailable
  | Upstream_rate_limited
  | Upstream_invalid_response
  | Unknown of string  (** A value this SDK version does not know. *)

val upstream_error_code_of_yojson : Yojson.Safe.t -> upstream_error_code
val yojson_of_upstream_error_code : upstream_error_code -> Yojson.Safe.t

type nonrec upstream_error_response = {
  code : upstream_error_code;  (** The kind of failure. *)
  message : string;
      (** What failed and what to do about it, written for the user. *)
}
(** The body of a 502 or 503 caused by a third-party service. *)

val upstream_error_response_of_yojson : Yojson.Safe.t -> upstream_error_response
val yojson_of_upstream_error_response : upstream_error_response -> Yojson.Safe.t

val make_upstream_error_response :
  code:upstream_error_code -> message:string -> unit -> upstream_error_response
(** The body of a 502 or 503 caused by a third-party service. *)

type nonrec user_language = { language : language option }
(** The interface language a user picked for themselves. [None] follows their
team's language, else their browser's. *)

val user_language_of_yojson : Yojson.Safe.t -> user_language
val yojson_of_user_language : user_language -> Yojson.Safe.t

val make_user_language : ?language:language -> unit -> user_language
(** The interface language a user picked for themselves. [None] follows their
team's language, else their browser's. *)

type nonrec user_link_response = {
  link_exists : bool;  (** Whether or not a link exists for the given idp *)
}

val user_link_response_of_yojson : Yojson.Safe.t -> user_link_response
val yojson_of_user_link_response : user_link_response -> Yojson.Safe.t
val make_user_link_response : link_exists:bool -> unit -> user_link_response

type nonrec user_name = {
  first_name : string option;
  id : string;
  is_agent : bool option;
      (** Whether this is an agent account rather than a person. *)
  last_name : string option;
}

val user_name_of_yojson : Yojson.Safe.t -> user_name
val yojson_of_user_name : user_name -> Yojson.Safe.t

val make_user_name :
  ?first_name:string ->
  id:string ->
  ?is_agent:bool ->
  ?last_name:string ->
  unit ->
  user_name

type nonrec user_names = { names : user_name list }

val user_names_of_yojson : Yojson.Safe.t -> user_names
val yojson_of_user_names : user_names -> Yojson.Safe.t
val make_user_names : names:user_name list -> unit -> user_names

type nonrec user_organization_response = {
  organization_id : int;  (** The id of the organization *)
  organization_name : string;  (** The name of the organization *)
}

val user_organization_response_of_yojson :
  Yojson.Safe.t -> user_organization_response

val yojson_of_user_organization_response :
  user_organization_response -> Yojson.Safe.t

val make_user_organization_response :
  organization_id:int ->
  organization_name:string ->
  unit ->
  user_organization_response

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

val user_quota_of_yojson : Yojson.Safe.t -> user_quota
val yojson_of_user_quota : user_quota -> Yojson.Safe.t

val make_user_quota :
  ai_chat_messages:int64 ->
  documents:int64 ->
  max_ai_chat_messages:int ->
  max_documents:int ->
  unit ->
  user_quota
(** The UserQuota represents the user's current quota *)

type nonrec user_tokens_response = {
  access_token : string;  (** The users access token *)
  refresh_token : string;  (** The users refresh token *)
}

val user_tokens_response_of_yojson : Yojson.Safe.t -> user_tokens_response
val yojson_of_user_tokens_response : user_tokens_response -> Yojson.Safe.t

val make_user_tokens_response :
  access_token:string -> refresh_token:string -> unit -> user_tokens_response

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

val get_agent_api_key :
  agent_id:string ->
  unit ->
  (agent_api_key, error_response) Macro_sdk_runtime.Request.t
(** [GET /agents/{agent_id}/api-key]

The agent's API key, if it has one, and whether its plan allows one. *)

val put_agent_api_key :
  agent_id:string ->
  api_key:string ->
  unit ->
  (agent_api_key, error_response) Macro_sdk_runtime.Request.t
(** [PUT /agents/{agent_id}/api-key]

Registers or replaces the agent's API key, for its model's provider.
Only in-memory agents on an Anthropic or OpenAI model, on a paid plan. *)

val delete_agent_api_key :
  agent_id:string ->
  unit ->
  (agent_api_key, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /agents/{agent_id}/api-key]

Forgets the agent's API key. Does not revoke it at the provider; succeeds
when there was none. *)

val update_ai_billing_auto_reload :
  enabled:bool ->
  minimum_balance_cents:int64 ->
  target_balance_cents:int64 ->
  ?monthly_spend_limit_cents:int64 ->
  unit ->
  (usage_snapshot, ai_billing_error_body) Macro_sdk_runtime.Request.t
(** [PATCH /ai-billing/auto-reload]

Turn automatic credit reloads on with the given
thresholds, or off. Payer only. Enabling settles right away, so a balance
already under the minimum reloads immediately. *)

val create_ai_credit_checkout :
  amount_cents:int64 ->
  cancel_url:string ->
  success_url:string ->
  unit ->
  (credit_checkout_response, ai_billing_error_body) Macro_sdk_runtime.Request.t
(** [POST /ai-billing/credits/checkout]

Start a Stripe Checkout for a credit pack. Payer only. *)

val purchase_ai_credits :
  amount_cents:int64 ->
  unit ->
  (credit_purchase_response, ai_billing_error_body) Macro_sdk_runtime.Request.t
(** [POST /ai-billing/credits/purchase]

Buy a credit pack now, charged to the payer's card on file. Any paid team
member may buy, within the team's monthly credit limit. *)

val update_ai_billing_overage :
  enabled:bool ->
  ?limit_cents:int64 ->
  unit ->
  (usage_snapshot, ai_billing_error_body) Macro_sdk_runtime.Request.t
(** [PATCH /ai-billing/overage]

Retired direct-usage opt-in. Enabling is rejected; disabling remains supported. *)

val get_ai_billing_plans :
  unit ->
  ( plan_catalog_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /ai-billing/plans]

The plan catalog, credit packs, overage cap bounds, and automatic reload
defaults and bounds. *)

val get_ai_billing_summary :
  unit -> (usage_snapshot, ai_billing_error_body) Macro_sdk_runtime.Request.t
(** [GET /ai-billing/summary]

The caller's current-period AI usage, credits, and overage settings. *)

val get_codex_connection :
  unit ->
  ( codex_connection_status,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /codex] *)

val disconnect_codex :
  unit -> (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /codex] *)

val configure_codex :
  environment_id:string ->
  unit ->
  ( codex_connection_status,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /codex/config] *)

val list_codex_environments :
  unit ->
  ( codex_environment list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /codex/environments] *)

val start_codex_login :
  unit ->
  ( codex_login_start,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /codex/login] *)

val poll_codex_login :
  attempt_id:string ->
  unit ->
  ( codex_login_poll,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /codex/login/{attempt_id}] *)

val cancel_codex_login :
  attempt_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /codex/login/{attempt_id}] *)

val get_cursor_api_key :
  unit -> (cursor_api_key_status, error_response) Macro_sdk_runtime.Request.t
(** [GET /cursor-api-key]

Whether the caller has a Cursor API key registered. *)

val put_cursor_api_key :
  api_key:string ->
  unit ->
  (cursor_api_key_status, error_response) Macro_sdk_runtime.Request.t
(** [PUT /cursor-api-key]

Registers or replaces the caller's Cursor API key. *)

val delete_cursor_api_key :
  unit -> (cursor_api_key_status, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /cursor-api-key]

Forgets the caller's Cursor API key. *)

val put_cursor_default_model :
  ?effort:string ->
  ?model_id:string ->
  unit ->
  (cursor_api_key_status, error_response) Macro_sdk_runtime.Request.t
(** [PUT /cursor-api-key/default-model]

Choose the model, and optionally the effort, this user's [@cursor] sessions
start on. *)

val list_cursor_models :
  unit -> (cursor_models_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /cursor-api-key/models]

List the models the caller's Cursor account offers. *)

val verify_fusionauth_user_email :
  verification_id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/fusionauth/verify/{verification_id}]

Verifies the user's primary email for FusionAuth *)

val resend_fusionauth_verify_user_email :
  email:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/fusionauth_resend]

Resend the user's primary email verification for FusionAuth *)

val generate_email_link :
  email:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/generate/link]

Generates an email link for the user to verify their email address. *)

val verify_email_link :
  verification_id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/verify/{verification_id}]

Verifies the user's email for a user profile *)

val set_github_pull_request_draft :
  draft:bool ->
  number:int64 ->
  owner:string ->
  repo:string ->
  unit ->
  ( set_github_pull_request_draft_response,
    set_github_pull_request_draft_error )
  Macro_sdk_runtime.Request.t
(** [POST /github_pull_requests/draft]

Converts a GitHub pull request to a draft, or marks it ready for review,
as the authenticated user with their own GitHub grant. *)

val enrich_github_pull_requests :
  pull_requests:github_pull_request_ref list ->
  unit ->
  ( enrich_github_pull_requests_response,
    enrich_github_pull_requests_error )
  Macro_sdk_runtime.Request.t
(** [POST /github_pull_requests/enrich]

Enriches GitHub pull request references with live GitHub data for the authenticated user. *)

val merge_github_pull_request :
  number:int64 ->
  owner:string ->
  repo:string ->
  ?merge_method:github_merge_method ->
  unit ->
  ( merge_github_pull_request_response,
    merge_github_pull_request_error )
  Macro_sdk_runtime.Request.t
(** [POST /github_pull_requests/merge]

Merges a GitHub pull request as the authenticated user, with their own
GitHub grant. GitHub applies the user's permissions and the repository's
branch protections; a refusal is returned with GitHub's message. *)

val get_github_pull_request_mergeability :
  pull_requests:github_pull_request_number list ->
  unit ->
  ( github_pull_request_mergeability_response,
    get_github_pull_request_mergeability_error )
  Macro_sdk_runtime.Request.t
(** [POST /github_pull_requests/mergeability]

Reads whether each GitHub pull request merges cleanly into its base, as
the authenticated user sees it. Pull requests the user cannot see are
left out. *)

val set_github_pull_request_state :
  number:int64 ->
  owner:string ->
  repo:string ->
  state:github_pull_request_state ->
  unit ->
  ( set_github_pull_request_state_response,
    set_github_pull_request_state_error )
  Macro_sdk_runtime.Request.t
(** [POST /github_pull_requests/state]

Closes a GitHub pull request, or reopens it, as the authenticated user
with their own GitHub grant. *)

val list_gtm_invite_links :
  ?mine:bool ->
  unit ->
  (gtm_invite_link_list, error_response) Macro_sdk_runtime.Request.t
(** [GET /gtm-invite/links]

Lists invite links, newest first. Macro staff only. *)

val create_gtm_invite_link :
  first_name:string ->
  ?note:string ->
  ?recipient_email:string ->
  unit ->
  (gtm_invite_link, error_response) Macro_sdk_runtime.Request.t
(** [POST /gtm-invite/links]

Creates an invite link. Macro staff only. *)

val revoke_gtm_invite_link :
  id:string ->
  unit ->
  (gtm_invite_link, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /gtm-invite/links/{id}]

Revokes an invite link nobody has signed up through. Macro staff only. *)

val get_gtm_invite_offer :
  unit -> (gtm_invite_offer_status, error_response) Macro_sdk_runtime.Request.t
(** [GET /gtm-invite/offer]

The promotion the signed-in user's account holds from an invite link, if
they redeemed one and have not started a paid subscription yet. *)

val resolve_gtm_invite_link :
  token:string ->
  unit ->
  (public_gtm_invite_link, error_response) Macro_sdk_runtime.Request.t
(** [GET /gtm-invite/public/{token}]

Resolves an invite link for the public welcome page and counts the open. *)

val redeem_gtm_invite_link :
  token:string ->
  unit ->
  (gtm_invite_offer, error_response) Macro_sdk_runtime.Request.t
(** [POST /gtm-invite/redeem]

Attributes the signed-in user's account to the invite link they opened and
grants them its offer. Idempotent for the same account. *)

val health_handler :
  unit ->
  ( empty_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /health]

Health check *)

val macro_api_token :
  email:string ->
  unit ->
  ( macro_api_token_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /jwt/macro_api_token]

Generates a macro-api-token using the user's macro-access-token
You can either have your access token in the cookies or in the request
headers
Authorization: Bearer <access_token>
This returns a new macro-api-token *)

val refresh :
  unit ->
  ( user_tokens_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /jwt/refresh]

Refreshes a JWT token
You can either have your access token and refresh token in the cookies or in the request
headers
Authorization: Bearer <access_token>
x-macro-refresh-token: <refresh_token>
This returns the cookies with the new access and refresh token *)

val create_in_progress_link :
  unit ->
  (create_in_progress_link_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /link]

Initiates a link for a user *)

val email_connection_providers :
  ?original_url:string ->
  unit ->
  (email_connection_providers, error_response) Macro_sdk_runtime.Request.t
(** [GET /link/email/providers] *)

val init_github_link :
  original_url:string ->
  unit ->
  ( init_github_link_response,
    init_github_link_error )
  Macro_sdk_runtime.Request.t
(** [POST /link/github]

Initiates a link for a user *)

val delete_github_link :
  unit -> (empty_response, delete_github_link_error) Macro_sdk_runtime.Request.t
(** [DELETE /link/github]

Deletes a github link for a user *)

val check_github_link_status :
  unit ->
  ( github_link_status_response,
    check_github_link_status_error )
  Macro_sdk_runtime.Request.t
(** [GET /link/github/status]

Checks whether the authenticated user's GitHub link token is valid. *)

val init_gmail_link :
  original_url:string ->
  ?reconnect_link_id:string ->
  ?scopes:string ->
  unit ->
  (init_gmail_link_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /link/gmail]

Initiates a Gmail link for a user *)

val check_gmail_link_status :
  unit ->
  (gmail_link_status_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /link/gmail/status]

Checks whether the authenticated user's gmail link is valid. *)

val init_outlook_link :
  ?original_url:string ->
  ?scopes:string ->
  ?reconnect_link_id:string ->
  unit ->
  (init_outlook_link_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /link/outlook]

Initiates a Microsoft Outlook account link for an authenticated user. *)

val apple_login :
  code:string ->
  id_token:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /login/apple]

Completes the apple login flow *)

val password_login :
  email:string ->
  password:string ->
  unit ->
  (user_tokens_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /login/password]

Performs a password login *)

val passwordless_login :
  email:string ->
  redirect_uri:string ->
  ?is_agent:bool ->
  ?referral_code:string ->
  unit ->
  ( passwordless_login_reply,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /login/passwordless]

Initiates a passwordless login *)

val sso_login :
  idp_name:string ->
  idp_id:string ->
  login_hint:string ->
  original_url:string ->
  is_mobile:string ->
  referral_code:string ->
  is_agent:bool ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [GET /login/sso]

Initiates an SSO login *)

val logout :
  unit ->
  ( empty_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /logout]

Initiates a passwordless login *)

val create_merge_request :
  email:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /merge]

Creates a merge request used to verify the user's email address in order to merge their
accounts.
This is different than generate_email_link which is used to verify a new email address to add a
new profile to a user's account. *)

val verify_merge_request :
  code:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /merge/verify/{code}]

Verifies the merge request *)

val send_mobile_welcome_email :
  email:string ->
  unit ->
  ( send_mobile_welcome_email_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [POST /mobile-welcome-email]

Emails a mobile lead a link to continue onboarding on desktop and enrolls
them in the Loops welcome sequence. No-ops if the address was already
captured, and rejects blocked addresses. *)

val passwordless_callback :
  code:string ->
  email:string ->
  unit ->
  ( user_tokens_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /oauth/passwordless/{code}]

Handles oauth redirect *)

val oauth_redirect : unit -> (unit, error_response) Macro_sdk_runtime.Request.t
(** [GET /oauth/redirect]

Handles oauth redirect *)

val oauth2_callback :
  provider:string -> unit -> (unit, error_response) Macro_sdk_runtime.Request.t
(** [GET /oauth2/{provider}/callback]

Custom OAuth2 callback *)

val get_permissions :
  unit ->
  ( permission list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /permissions]

Gets all permissions *)

val get_user_permissions :
  unit ->
  (string list, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /permissions/me]

Gets a list of the users permissions *)

val get_referral_code :
  unit -> (string, error_response) Macro_sdk_runtime.Request.t
(** [GET /referral/code]

Handler for [GET /referral-code]. *)

val send_referral_code :
  recipient:string -> unit -> (unit, error_response) Macro_sdk_runtime.Request.t
(** [POST /referral/send]

Handler for [POST /referral/send]. *)

val session_creation :
  unit -> (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /session]

Refreshes a JWT token *)

val session_login :
  session_code:string ->
  unit ->
  (user_tokens_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /session/login/{session_code}]

Performs a login via session code *)

val get_system_status :
  unit -> (current_system_status, error_response) Macro_sdk_runtime.Request.t
(** [GET /system-status]

The status every user sees. Public: the banner shows wherever the app
runs, signed in or not. *)

val set_system_status :
  body:system_status ->
  unit ->
  (status_update, error_response) Macro_sdk_runtime.Request.t
(** [POST /system-status]

Sets the status every user sees and pushes it to every open app. Macro
staff only. *)

val list_system_status_history :
  unit -> (system_status_history, error_response) Macro_sdk_runtime.Request.t
(** [GET /system-status/history]

Recent status updates, newest first, with who set each. Macro staff only. *)

val get_team :
  unit -> (get_team_reply, error_response) Macro_sdk_runtime.Request.t
(** [GET /team]

Gets a team by ID. *)

val create_team :
  name:string ->
  ?allow_domain_join:bool ->
  unit ->
  (team, error_response) Macro_sdk_runtime.Request.t
(** [POST /team]

Creates a new team. *)

val delete_team : unit -> (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /team]

Deletes a team.
This will update all team members roles and cancel your subscription for the team.
This action is **irreversible** and you will not be able to recover the team afterwards. *)

val patch_team :
  ?default_link_share:link_share ->
  ?language:language ->
  ?name:string ->
  ?slug:string ->
  ?user_role_updates:patch_team_user_role list ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /team]

Updates a team. *)

val toggle_team_auto_join_domain :
  unit ->
  (toggle_auto_join_domain_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/auto-join-domain/toggle]

Toggles automatic domain joining for the team. When the team has no
auto-join domain, sets it to the team owner's email domain — rejected
with a 400 when that domain is a generic email provider domain (e.g.
gmail.com). When one is already set, removes it. New users whose email
domain matches a team's auto-join domain are added to that team on
signup. Requires the caller to be an Admin or Owner of the team. *)

val list_team_computers :
  unit -> (computer_status list, error_response) Macro_sdk_runtime.Request.t
(** [GET /team/computers]

The team's computers, oldest first. *)

val purchase_team_computer :
  purchase_key:string ->
  size:computer_size ->
  ?name:string ->
  unit ->
  (purchased, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/computers]

Buy a computer for the team, billed on the team subscription. An error
means nothing was charged; 202 means the charge is still being confirmed. *)

val list_team_computer_offers :
  unit -> (size_offer list, error_response) Macro_sdk_runtime.Request.t
(** [GET /team/computers/offers]

Every size with its price and availability. *)

val cancel_team_computer :
  computer_id:string ->
  unit ->
  ( computer_status,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /team/computers/{computer_id}/cancel]

Stop billing at the end of the current period. *)

val undo_cancel_team_computer :
  computer_id:string ->
  unit ->
  ( computer_status,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [DELETE /team/computers/{computer_id}/cancel]

Keep a computer that was canceled at period end. *)

val set_team_computer_power :
  computer_id:string ->
  on:bool ->
  unit ->
  ( computer_status,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /team/computers/{computer_id}/power]

Turn a computer on or off. A computer that is off keeps its disk and stays billed. *)

val release_team_computer :
  computer_id:string ->
  confirm_name:string ->
  unit ->
  (computer_status, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/computers/{computer_id}/release]

Stop billing and destroy the computer now, without a refund. *)

val restore_team_computer :
  computer_id:string ->
  unit ->
  (computer_status, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/computers/{computer_id}/restore]

Keep a computer whose billing ended, during retention: re-adds its
billing item (the rest of the period is invoiced now) and keeps the
stopped computer and its disk. *)

val retry_team_computer :
  computer_id:string ->
  unit ->
  (computer_status, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/computers/{computer_id}/retry]

Retry a failed computer without changing billing. *)

val complete_team_computer_setup :
  computer_id:string ->
  unit ->
  (computer_status, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/computers/{computer_id}/setup-complete]

Mark the guided setup after buying the computer finished. Idempotent;
allowed to the team's owner and admins, like Claude sign-in. *)

val patch_team_crm_settings :
  enabled:bool ->
  ?backfill:bool ->
  unit ->
  (patch_team_crm_settings_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /team/crm]

Legacy compatibility endpoint for team admins and owners. Enabling
is a no-op; disabling is rejected. CRM records remain available.
Each member manages mailbox contribution through [/crm/email-privacy];
this endpoint does not enroll mailboxes, backfill emails, or purge records. *)

val send_team_domain_notice :
  unit ->
  (send_domain_notice_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/domain-notice]

Emails the caller's contacts on the team's auto-join domain that the team
exists, so they can sign up and join. Contacts already on Macro, on the
team, invited, or emailed before are skipped, and a team emails at most 25
people in total. Call it after sending the team's invites. Requires the
caller to be an Admin or Owner of the team. *)

val invite_to_team :
  invites:invite_entry list ->
  ?is_agent:bool ->
  ?team_id:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/invite]

Invites a user to a team. *)

val get_team_invite_link :
  unit ->
  (team_invite_link_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /team/invite-link]

Gets the team's invite link. Anyone who may invite people to the team may
see it. *)

val create_team_invite_link :
  unit ->
  ( created_team_invite_link_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [POST /team/invite-link]

Creates the team's invite link, replacing any existing one. Anyone who may
invite people may create the first link; replacing one requires a team
admin or owner. *)

val delete_team_invite_link :
  unit -> (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /team/invite-link]

Turns off the team's invite link. Requires a team admin or owner. *)

val join_team_by_invite_link :
  token:team_invite_link_token ->
  unit ->
  ( join_team_by_invite_link_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [POST /team/invite-link/join]

Joins the team an invite link belongs to. *)

val get_team_by_invite_link :
  token:team_invite_link_token ->
  unit ->
  (team_invite_link_team, error_response) Macro_sdk_runtime.Request.t
(** [POST /team/invite-link/team]

Gets the team an invite link joins, so the user can see it before joining. *)

val delete_team_invite_handler :
  team_invite_id:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /team/invite/{team_invite_id}]

Deletes a team invite from a team. *)

val get_team_invites :
  ?team_id:string ->
  unit ->
  (team_invites_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /team/invites]

Gets all invites for a team. *)

val join_team :
  team_invite_id:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [GET /team/join/{team_invite_id}]

Joins a team by accepting an invite. *)

val reject_invitation :
  team_invite_id:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /team/join/{team_invite_id}]

Rejects an invitation to join a team. *)

val patch_team_member_plan :
  member_user_id:string ->
  plan:seat_plan ->
  unit ->
  (team_member, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /team/members/{member_user_id}/plan]

Moves one team member's seat between paid plans. *)

val toggle_team_non_admin_invites :
  unit ->
  ( toggle_non_admin_invites_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [POST /team/non-admin-invites/toggle]

Toggles whether non-admin members may invite users to the team. Teams
start with this on (any member can invite); turning it off restricts
inviting to team admins and owners. Requires the caller to be an Admin
or Owner of the team. *)

val remove_user_from_team :
  remove_user_id:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /team/remove/{remove_user_id}]

Removes a user from a team. *)

val get_user_teams :
  unit -> (team list, error_response) Macro_sdk_runtime.Request.t
(** [GET /team/user]

Gets all teams for the authenticated user. *)

val get_user_invites :
  unit -> (team_invites_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /team/user/invites]

Gets all of a user's invitations. *)

val list_team_agents :
  unit -> (team_agents, error_response) Macro_sdk_runtime.Request.t
(** [GET /team_agents]

The caller's team's agents, with their computers' status. *)

val create_team_agent :
  job_description:string ->
  name:string ->
  personality:string ->
  purchase_key:string ->
  size:string ->
  ?avatar_url:string ->
  ?voice:string ->
  unit ->
  (team_agent, error_response) Macro_sdk_runtime.Request.t
(** [POST /team_agents]

Invite an agent teammate and buy its computer. Requires a team admin or
owner using their own credential. The agent comes back [provisioning]. *)

val delete_team_agent :
  agent_user_id:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /team_agents/{agent_user_id}]

Remove an agent teammate: release its computer, take it off the team and
delete its repository and account. Requires a team admin or owner. *)

val get_team_agent_voice :
  agent_user_id:string ->
  unit ->
  (agent_voice, error_response) Macro_sdk_runtime.Request.t
(** [GET /team_agents/{agent_user_id}/voice]

The agent's call voice, as committed in its workspace repository.
Requires a team admin or owner. *)

val set_team_agent_voice :
  agent_user_id:string ->
  model:string ->
  unit ->
  (agent_voice, error_response) Macro_sdk_runtime.Request.t
(** [PUT /team_agents/{agent_user_id}/voice]

Change the agent's call voice: a commit to its workspace repository that
its next call picks up. Requires a team admin or owner. *)

val agent_setup :
  unit -> (agent_setup_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /user/agent_setup]

Finishes an agent's signup: joins the team that invited it and mints its
SDK token. *)

val get_user_names :
  user_ids:string list ->
  unit ->
  (user_names, error_response) Macro_sdk_runtime.Request.t
(** [POST /user/get_names]

Retrieves user names in bulk *)

val get_user_names_with_email :
  user_ids:string list ->
  unit ->
  (user_names, error_response) Macro_sdk_runtime.Request.t
(** [POST /user/get_names_with_email]

Gets names for passed user profile ids, falling back to the requesting user's email contact names *)

val patch_user_group :
  group:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /user/group]

Updates the user's group. *)

val get_user_language :
  unit -> (user_language, error_response) Macro_sdk_runtime.Request.t
(** [GET /user/language]

Get the caller's interface language. *)

val put_user_language :
  ?language:language ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [PUT /user/language]

Set the caller's interface language, or clear it to follow their team's,
else their browser's. *)

val get_legacy_user_permissions :
  unit ->
  ( get_legacy_user_permissions_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [GET /user/legacy_user_permissions]

Gets the calling user's info which matches what was given in the **deprecated**
getUserPermissions query in our graphql api.
This will eventually be removed and optimized to use smaller calls that grab
what is needed for various parts of the UI. *)

val get_user_link_exists :
  idp_name:string ->
  idp_id:string ->
  unit ->
  (user_link_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /user/link_exists]

Returns whether or not a given idp link exists for a user *)

val get_user_info :
  unit -> (get_user_info, error_response) Macro_sdk_runtime.Request.t
(** [GET /user/me]

Gets the calling user's info *)

val delete_user :
  unit -> (generic_success_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /user/me]

Deletes the user who calls this endpoint *)

val get_user_name :
  unit -> (user_name, error_response) Macro_sdk_runtime.Request.t
(** [GET /user/name]

Retrieves the name of a particular user. *)

val put_user_name :
  ?first_name:string ->
  ?last_name:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [PUT /user/name]

Sets the name of a particular user *)

val patch_user_onboarding :
  first_name:string ->
  industry:string ->
  last_name:string ->
  title:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /user/onboarding]

Updates the user's onboarding. *)

val get_user_organization :
  unit ->
  (get_user_organization_reply, error_response) Macro_sdk_runtime.Request.t
(** [GET /user/organization]

Retrieves the users organization if present.
Returns NO_CONTENT if the user is a not part of an organization. *)

val put_profile_picture :
  url:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [PUT /user/profile_picture]

Sets the profile picture URL for a particular user *)

val put_profile_picture_file :
  file_id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [PUT /user/profile_picture/file]

Sets the caller's profile picture to an image they uploaded. *)

val create_profile_picture_upload :
  content_type:string ->
  file_name:string ->
  size_bytes:int64 ->
  unit ->
  (profile_picture_upload, error_response) Macro_sdk_runtime.Request.t
(** [POST /user/profile_picture/file]

Reserves storage for a new profile picture. Static file storage has no
MacroDB, so it cannot check API keys; this route lets key holders upload. *)

val post_profile_pictures :
  user_id_list:string list ->
  unit ->
  (profile_pictures, error_response) Macro_sdk_runtime.Request.t
(** [POST /user/profile_pictures]

Retrieves profile picture URLs for a list of users *)

val get_user_quota :
  unit -> (get_user_quota_reply, error_response) Macro_sdk_runtime.Request.t
(** [GET /user/quota]

Retrieves the users quota.
Returns NO_CONTENT if the user is a premium user with no quota. *)

val create_checkout_session_v2 :
  cancel_url:string ->
  success_url:string ->
  ?discount:string ->
  ?metadata:checkout_session_metadata ->
  ?onboarding_trial:bool ->
  ?plan:seat_plan ->
  unit ->
  (checkout_session_v2_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /user/stripe/checkoutv2]

Creates a Stripe checkout session for the user to subscribe. *)

val get_subscription_status :
  unit -> (subscription_status, error_response) Macro_sdk_runtime.Request.t
(** [GET /user/stripe/plan]

Read subscription state for the authenticated user's seat. *)

val change_plan :
  plan:seat_plan ->
  unit ->
  (change_plan_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /user/stripe/plan]

Changes the caller's paid plan. Upgrades are prorated immediately;
downgrades retain the active plan until renewal. Selecting the active plan
cancels a pending downgrade without charging or resetting usage. *)

val create_portal_session :
  return_url:string ->
  unit ->
  (stripe_session_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /user/stripe/portal]

Creates a Stripe billing portal session. *)

val get_trial_eligibility :
  unit -> (trial_eligibility, error_response) Macro_sdk_runtime.Request.t
(** [GET /user/stripe/trial_eligibility]

Read the caller's eligibility; checkout revalidates before granting a trial. *)

val patch_user_tutorial :
  tutorial_complete:bool ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /user/tutorial]

Updates the user's tutorialComplete flag. *)
