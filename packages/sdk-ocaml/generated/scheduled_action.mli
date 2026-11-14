(* Generated from packages/sdk/specs/scheduled-action.json by packages/sdk-ocaml/gen. Do not edit. *)

type nonrec accept_suggestion_request = {
  updated_at : string;
      (** The suggestion's [updatedAt] as the caller read it. A background suggestion runs
only if it is unchanged since and no run of it is still settling;
otherwise the answer is 409. *)
}
(** Acting on a suggestion, as the caller's copy of it shows it. *)

val accept_suggestion_request_of_yojson :
  Yojson.Safe.t -> accept_suggestion_request

val yojson_of_accept_suggestion_request :
  accept_suggestion_request -> Yojson.Safe.t

val make_accept_suggestion_request :
  updated_at:string -> unit -> accept_suggestion_request
(** Acting on a suggestion, as the caller's copy of it shows it. *)

type nonrec action_kind =
  | Agent
  | Unknown of string  (** A value this SDK version does not know. *)

val action_kind_of_yojson : Yojson.Safe.t -> action_kind
val yojson_of_action_kind : action_kind -> Yojson.Safe.t

(** Whether a routine's runs are listed in Home and the Agents list. Routines
that run often would bury the owner's own work, so runs start unlisted;
either way they stay in the routine's history. The string form is the
[scheduled_action.run_visibility] column's. *)
type nonrec run_visibility =
  | Listed
  | Unlisted
  | Unknown of string  (** A value this SDK version does not know. *)

val run_visibility_of_yojson : Yojson.Safe.t -> run_visibility
val yojson_of_run_visibility : run_visibility -> Yojson.Safe.t

type nonrec agent_mcp_server = {
  app_slug : string;  (** Pipedream app slug, e.g. [linear]. *)
  server_name : string;  (** Display name, e.g. [Linear]. *)
}
(** One Pipedream app an agent lists under \[[AgentMcpServers::Selected]\].

Only the catalog identity is stored. Whether a given person has connected
the app is theirs, resolved at call time by the egress proxy, never here. *)

val agent_mcp_server_of_yojson : Yojson.Safe.t -> agent_mcp_server
val yojson_of_agent_mcp_server : agent_mcp_server -> Yojson.Safe.t

val make_agent_mcp_server :
  app_slug:string -> server_name:string -> unit -> agent_mcp_server
(** One Pipedream app an agent lists under \[[AgentMcpServers::Selected]\].

Only the catalog identity is stored. Whether a given person has connected
the app is theirs, resolved at call time by the egress proxy, never here. *)

type nonrec sdk_fingerprint = string
(** Identifies the SDK API code was type-checked against: its version and a
hash of its declarations, e.g. [0.2.2+18cc1c19c35c]. *)

val sdk_fingerprint_of_yojson : Yojson.Safe.t -> sdk_fingerprint
val yojson_of_sdk_fingerprint : sdk_fingerprint -> Yojson.Safe.t

type nonrec step_id = string
(** Names a step's output: a lowercase letter, then up to 31 lowercase
letters, digits or underscores. *)

val step_id_of_yojson : Yojson.Safe.t -> step_id
val yojson_of_step_id : step_id -> Yojson.Safe.t

type nonrec knob_name = string
(** How code reads a knob: a lowercase letter, then up to 31 letters or
digits, e.g. [dueWithinDays]. *)

val knob_name_of_yojson : Yojson.Safe.t -> knob_name
val yojson_of_knob_name : knob_name -> Yojson.Safe.t

(** A value a code step reads as [knobs.<name>], which its owner can change
without the step being rewritten: the label it adds, a priority, a
number of days, a question it asks AI. Its type is part of the step's
type-checked contract; its value is not, so changing it needs no check. *)
type nonrec routine_knob =
  | Text of {
      label : string;
          (** What it is, for the owner, e.g. "Label for money email". *)
      name : knob_name;  (** How the code reads it: [knobs.<name>]. *)
      value : string;  (** Its value. *)
    }  (** Free text, such as a label or channel name. *)
  | Number of {
      label : string;  (** What it is, for the owner. *)
      max : float option;  (** The largest value the owner may set. *)
      min : float option;  (** The smallest value the owner may set. *)
      name : knob_name;  (** How the code reads it: [knobs.<name>]. *)
      value : float;  (** Its value. *)
    }  (** A number, optionally bounded. *)
  | Boolean of {
      label : string;  (** What it is, for the owner. *)
      name : knob_name;  (** How the code reads it: [knobs.<name>]. *)
      value : bool;  (** Its value. *)
    }  (** On or off. *)
  | Choice of {
      label : string;  (** What it is, for the owner. *)
      name : knob_name;  (** How the code reads it: [knobs.<name>]. *)
      options : string list;
          (** Every option, in the order they are offered. *)
      value : string;  (** The chosen option. *)
    }  (** One of a fixed list of options, such as a priority. *)
  | Question of {
      label : string;
          (** The condition as a short clause that reads inside the step's
sentence, e.g. "it's about money". *)
      name : knob_name;  (** How the code reads it: [knobs.<name>]. *)
      value : string;
          (** The question AI is asked, e.g. "Is this email about money:
investors, fundraising or finance?". *)
    }
      (** A yes/no question the code asks AI with [macro.ai.decide], so the
owner can reword what AI decides. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val routine_knob_of_yojson : Yojson.Safe.t -> routine_knob
val yojson_of_routine_knob : routine_knob -> Yojson.Safe.t

val make_routine_knob_text :
  label:string -> name:knob_name -> value:string -> unit -> routine_knob
(** Free text, such as a label or channel name. *)

val make_routine_knob_number :
  label:string ->
  ?max:float ->
  ?min:float ->
  name:knob_name ->
  value:float ->
  unit ->
  routine_knob
(** A number, optionally bounded. *)

val make_routine_knob_boolean :
  label:string -> name:knob_name -> value:bool -> unit -> routine_knob
(** On or off. *)

val make_routine_knob_choice :
  label:string ->
  name:knob_name ->
  options:string list ->
  value:string ->
  unit ->
  routine_knob
(** One of a fixed list of options, such as a priority. *)

val make_routine_knob_question :
  label:string -> name:knob_name -> value:string -> unit -> routine_knob
(** A yes/no question the code asks AI with [macro.ai.decide], so the
owner can reword what AI decides. *)

type nonrec code_step = {
  id : step_id option;
  knobs : routine_knob list option;
      (** Values its owner can change without new code, which the code reads
as [knobs.<name>]. *)
  sentence : string option;
      (** What it does as one sentence for its owner, with [{name}] where a
knob's value shows and [{?name}] where a question knob's question
shows, e.g. "Label it \{label\} when \{?aboutMoney\}". Saving checks every
slot names one of its knobs. *)
  source : string;
      (** A module exporting `async function main(\{ macro, run, routine,
trigger, steps \}: StepContext)[: ]run` is this run (its time, zone and
the previous run), [trigger] what started it (a schedule, an event and
its item, or a person), [steps] the typed outputs of the steps before
it. What [main] returns, as JSON of at most 64 KB, is the step's output. *)
  summary : string option;
      (** One or two sentences on how, for the routine's owner. *)
  title : string;
      (** What the step does, in a few words, e.g. "Label invoices". *)
}
(** TypeScript written against Macro's SDK, usually by the AI that built the
routine. It is type-checked before it is saved and runs with its owner's
access. *)

val code_step_of_yojson : Yojson.Safe.t -> code_step
val yojson_of_code_step : code_step -> Yojson.Safe.t

val make_code_step :
  ?id:step_id ->
  ?knobs:routine_knob list ->
  ?sentence:string ->
  source:string ->
  ?summary:string ->
  title:string ->
  unit ->
  code_step
(** TypeScript written against Macro's SDK, usually by the AI that built the
routine. It is type-checked before it is saved and runs with its owner's
access. *)

type nonrec agent_task_agent = { bot_id : string  (** The agent's bot id. *) }
(** A persona selection, independent of its runtime and current default model. *)

val agent_task_agent_of_yojson : Yojson.Safe.t -> agent_task_agent
val yojson_of_agent_task_agent : agent_task_agent -> Yojson.Safe.t

val make_agent_task_agent : bot_id:string -> unit -> agent_task_agent
(** A persona selection, independent of its runtime and current default model. *)

type nonrec agent_step = {
  agent : agent_task_agent option;
  instructions : string;
      (** What the model or agent should do. It also sees the triggering event
and what earlier steps in this run did. *)
  model : string option;
      (** Required when no agent is selected; otherwise overrides the agent's default model. *)
}
(** Hand the run to a model running as Macro, or to an agent. *)

val agent_step_of_yojson : Yojson.Safe.t -> agent_step
val yojson_of_agent_step : agent_step -> Yojson.Safe.t

val make_agent_step :
  ?agent:agent_task_agent ->
  instructions:string ->
  ?model:string ->
  unit ->
  agent_step
(** Hand the run to a model running as Macro, or to an agent. *)

(** One step of a routine. *)
type nonrec routine_step =
  | Code of code_step
      (** Run TypeScript against Macro's SDK, as the routine owner. *)
  | Agent of agent_step
      (** Hand the run to a model or agent with instructions. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val routine_step_of_yojson : Yojson.Safe.t -> routine_step
val yojson_of_routine_step : routine_step -> Yojson.Safe.t

type nonrec routine_program = {
  dangerously_operate_as_user : bool option;
      (** Code steps write as the owner, with no agent badge: their posts,
comments and emails appear written by the owner. Set only when the
owner explicitly asked for the routine to act or send as them; by
default code steps' writes are attributed to Macro's agent acting for
the owner. Agent ("Ask AI") steps keep their own agent attribution
either way: an agent session speaking as a person is a different
change. A single agent task has no code steps, so it never applies. *)
  mcp_servers : agent_mcp_server list option;
      (** Apps the routine requires, handed to its agent on top of the agent's
own. The owner must have each one connected to save the routine and
for it to run. *)
  sdk : sdk_fingerprint option;
  steps : routine_step list;
      (** Steps run in order. A failed step stops the run. *)
}
(** What a routine does each time it runs. *)

val routine_program_of_yojson : Yojson.Safe.t -> routine_program
val yojson_of_routine_program : routine_program -> Yojson.Safe.t

val make_routine_program :
  ?dangerously_operate_as_user:bool ->
  ?mcp_servers:agent_mcp_server list ->
  ?sdk:sdk_fingerprint ->
  steps:routine_step list ->
  unit ->
  routine_program
(** What a routine does each time it runs. *)

type nonrec routine_model_id = string
(** A nonblank model identifier. Runtime catalogs, not the scheduler, own availability. *)

val routine_model_id_of_yojson : Yojson.Safe.t -> routine_model_id
val yojson_of_routine_model_id : routine_model_id -> Yojson.Safe.t

type nonrec agent_task = {
  agent : agent_task_agent option;
  mcp_servers : agent_mcp_server list option;
      (** Apps the routine requires on top of the agent's own. The owner must
have each one connected to save the routine and for it to run. *)
  model : routine_model_id option;
  prompt : string;  (** Instructions placed before the user's. *)
  user_prompt : string;  (** What the agent should do. *)
}
(** The single agent task: how routines were stored before they had steps,
and still how a routine that is only an agent is saved. *)

val agent_task_of_yojson : Yojson.Safe.t -> agent_task
val yojson_of_agent_task : agent_task -> Yojson.Safe.t

val make_agent_task :
  ?agent:agent_task_agent ->
  ?mcp_servers:agent_mcp_server list ->
  ?model:routine_model_id ->
  prompt:string ->
  user_prompt:string ->
  unit ->
  agent_task
(** The single agent task: how routines were stored before they had steps,
and still how a routine that is only an agent is saved. *)

(** A stored task's two forms, as the scheduler's API describes [task]:
\[[RoutineProgram::from_task]\] reads them. *)
type nonrec routine_task =
  | Routine_program of routine_program  (** Steps, run in order. *)
  | Agent_task of agent_task  (** A routine that is only an agent. *)

val routine_task_of_yojson : Yojson.Safe.t -> routine_task
val yojson_of_routine_task : routine_task -> Yojson.Safe.t

type nonrec schedule = string

val schedule_of_yojson : Yojson.Safe.t -> schedule
val yojson_of_schedule : schedule -> Yojson.Safe.t

(** Closed allowlist: unknown names, deletions and ambiguous attribution are not
selectors. Adding a broker variant does not automatically enable routines. *)
type nonrec event_name =
  | Document_created
  | Document_updated
  | Document_deleted
  | Task_created
  | Task_status_changed
  | Task_priority_changed
  | Task_property_changed
  | Email_message_received
  | Channel_created
  | Channel_message_posted
  | Channel_mentioned
  | Channel_message_patched
  | Channel_message_attachment_created
  | Call_started
  | Call_ended
  | Github
  | Unknown of string  (** A value this SDK version does not know. *)

val event_name_of_yojson : Yojson.Safe.t -> event_name
val yojson_of_event_name : event_name -> Yojson.Safe.t

type nonrec github_selector = {
  actions : string list option;
      (** Payload actions, such as [completed] or [opened]; any when empty. *)
  events : string list option;
      (** GitHub event names, such as [workflow_run] or [pull_request]; any when empty. *)
  include_bots : bool option;
      (** Also run for deliveries caused by bots and apps, including Macro's own. *)
  repositories : string list option;
      (** Repositories as [owner/name], matched without regard to case; every
repository the owner's installations cover when empty. A renamed
repository stops matching until it is chosen again. *)
}
(** Which GitHub deliveries match. *)

val github_selector_of_yojson : Yojson.Safe.t -> github_selector
val yojson_of_github_selector : github_selector -> Yojson.Safe.t

val make_github_selector :
  ?actions:string list ->
  ?events:string list ->
  ?include_bots:bool ->
  ?repositories:string list ->
  unit ->
  github_selector
(** Which GitHub deliveries match. *)

type nonrec payload_scalar_value =
  | Bool of bool
  | Float of float
  | String of string

val payload_scalar_value_of_yojson : Yojson.Safe.t -> payload_scalar_value
val yojson_of_payload_scalar_value : payload_scalar_value -> Yojson.Safe.t

type nonrec payload_scalar = payload_scalar_value option
(** A JSON text, number, boolean or null that payload values are compared with. *)

val payload_scalar_of_yojson : Yojson.Safe.t -> payload_scalar
val yojson_of_payload_scalar : payload_scalar -> Yojson.Safe.t

type nonrec payload_condition = {
  equals : payload_scalar option;
  exists : bool option;  (** Whether the path finds a non-null value. *)
  glob : string option;
      (** Some text found matches this glob; [*] matches any run of characters. *)
  in_ : payload_scalar list option;  (** Some value found is one of these. *)
  not_in : payload_scalar list option;  (** No value found is one of these. *)
  path : string list;
      (** Keys from the payload's root, e.g. `\["workflow_run", "conclusion"\]`. *)
}
(** [path] walks objects by key; [*] steps into every element of an array and
a number into one. Give exactly one test. [notIn] also passes when the
path finds nothing. *)

val payload_condition_of_yojson : Yojson.Safe.t -> payload_condition
val yojson_of_payload_condition : payload_condition -> Yojson.Safe.t

val make_payload_condition :
  ?equals:payload_scalar ->
  ?exists:bool ->
  ?glob:string ->
  ?in_:payload_scalar list ->
  ?not_in:payload_scalar list ->
  path:string list ->
  unit ->
  payload_condition
(** [path] walks objects by key; [*] steps into every element of an array and
a number into one. Give exactly one test. [notIn] also passes when the
path finds nothing. *)

type nonrec property_selector = {
  definition_id : string;
      (** The property definition that must have changed. *)
  values : string list option;
      (** Select option ids or referenced entity ids, one of which the change must
add. Any change to the property matches when empty. *)
}
(** Narrows a task property change filter to one property and, optionally, the
values it must gain. *)

val property_selector_of_yojson : Yojson.Safe.t -> property_selector
val yojson_of_property_selector : property_selector -> Yojson.Safe.t

val make_property_selector :
  definition_id:string -> ?values:string list -> unit -> property_selector
(** Narrows a task property change filter to one property and, optionally, the
values it must gain. *)

type nonrec event_filter = {
  condition : string option;
      (** Yes/no question about the triggering content, e.g. "Is this email an
invoice?". The routine runs only when the answer is yes. *)
  events : event_name list;
  github : github_selector option;
  ids : string list option;
  match_ : payload_condition list option;
      (** Exact tests on the payload, all of which must pass. *)
  property : property_selector option;
}
(** An event name AND an entity ID must match within the same filter. A
condition further requires the event's content to answer it with yes.

[github] comes from outside Macro and carries its payload: it stands
alone in its filter, takes no ids, and may require
exact payload values with [match]. A [github] filter narrows deliveries
with its [github] selector. *)

val event_filter_of_yojson : Yojson.Safe.t -> event_filter
val yojson_of_event_filter : event_filter -> Yojson.Safe.t

val make_event_filter :
  ?condition:string ->
  events:event_name list ->
  ?github:github_selector ->
  ?ids:string list ->
  ?match_:payload_condition list ->
  ?property:property_selector ->
  unit ->
  event_filter
(** An event name AND an entity ID must match within the same filter. A
condition further requires the event's content to answer it with yes.

[github] comes from outside Macro and carries its payload: it stands
alone in its filter, takes no ids, and may require
exact payload values with [match]. A [github] filter narrows deliveries
with its [github] selector. *)

type nonrec event_filters = event_filter list
(** Bounded nonempty OR of filters, canonicalized to remove duplicates. *)

val event_filters_of_yojson : Yojson.Safe.t -> event_filters
val yojson_of_event_filters : event_filters -> Yojson.Safe.t

(** An individual trigger in a routine's trigger list. *)
type nonrec routine_trigger =
  | Cron of { schedule : schedule; timezone : string }
  | Events of { filters : event_filters }
  | Once of { at : string }
      (** Fires once at [at], or as soon as it is saved when [at] has passed. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val routine_trigger_of_yojson : Yojson.Safe.t -> routine_trigger
val yojson_of_routine_trigger : routine_trigger -> Yojson.Safe.t

val make_routine_trigger_cron :
  schedule:schedule -> timezone:string -> unit -> routine_trigger

val make_routine_trigger_events :
  filters:event_filters -> unit -> routine_trigger

val make_routine_trigger_once : at:string -> unit -> routine_trigger
(** Fires once at [at], or as soon as it is saved when [at] has passed. *)

type nonrec routine_triggers = routine_trigger list
(** Bounded schedules and one combined set of event filters. *)

val routine_triggers_of_yojson : Yojson.Safe.t -> routine_triggers
val yojson_of_routine_triggers : routine_triggers -> Yojson.Safe.t

(** A routine may run on one trigger or any of several schedules and Macro events. *)
type nonrec action_trigger =
  | Cron of { schedule : schedule; timezone : string }
  | Events of { filters : event_filters }
  | Once of { at : string }
      (** Fires once at [at], or as soon as it is saved when [at] has passed. *)
  | Multiple of { triggers : routine_triggers }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val action_trigger_of_yojson : Yojson.Safe.t -> action_trigger
val yojson_of_action_trigger : action_trigger -> Yojson.Safe.t

val make_action_trigger_cron :
  schedule:schedule -> timezone:string -> unit -> action_trigger

val make_action_trigger_events : filters:event_filters -> unit -> action_trigger

val make_action_trigger_once : at:string -> unit -> action_trigger
(** Fires once at [at], or as soon as it is saved when [at] has passed. *)

val make_action_trigger_multiple :
  triggers:routine_triggers -> unit -> action_trigger

type nonrec action_configuration = {
  description : string option;
      (** What the routine is for, in the owner's words; empty when unset. *)
  enabled : bool;
  kind : action_kind;
  name : string;
  run_visibility : run_visibility option;
      (** Omitted by clients that predate the setting; runs then start unlisted. *)
  task : routine_task;
  trigger : action_trigger;
}
(** Client configuration, the create body. Ownership and execution state are
server-owned. *)

val action_configuration_of_yojson : Yojson.Safe.t -> action_configuration
val yojson_of_action_configuration : action_configuration -> Yojson.Safe.t

val make_action_configuration :
  ?description:string ->
  enabled:bool ->
  kind:action_kind ->
  name:string ->
  ?run_visibility:run_visibility ->
  task:routine_task ->
  trigger:action_trigger ->
  unit ->
  action_configuration
(** Client configuration, the create body. Ownership and execution state are
server-owned. *)

type nonrec action_configuration_update = {
  description : string option;  (** An empty string clears it. *)
  enabled : bool option;
      (** Still sent by clients deployed before the activation endpoint. *)
  kind : action_kind;
  name : string;
  run_visibility : run_visibility option;
  task : routine_task;
  trigger : action_trigger;
}
(** Configuration replacement, the update body. Activation has its own endpoint, so
omitting [enabled] keeps the stored value; omitting [run_visibility] or
[description] keeps them too, so clients that predate them do not reset them. *)

val action_configuration_update_of_yojson :
  Yojson.Safe.t -> action_configuration_update

val yojson_of_action_configuration_update :
  action_configuration_update -> Yojson.Safe.t

val make_action_configuration_update :
  ?description:string ->
  ?enabled:bool ->
  kind:action_kind ->
  name:string ->
  ?run_visibility:run_visibility ->
  task:routine_task ->
  trigger:action_trigger ->
  unit ->
  action_configuration_update
(** Configuration replacement, the update body. Activation has its own endpoint, so
omitting [enabled] keeps the stored value; omitting [run_visibility] or
[description] keeps them too, so clients that predate them do not reset them. *)

type nonrec action_execution_record = {
  action_id : string;
  created_at : string;
  end_time : string;
  id : string option;
  is_success : bool;
  resource_id : string option;
      (** ID of the primary resource produced by this run. Its type is recorded in
[result], independently of the routine's current configuration. *)
  result : Yojson.Safe.t;
  start_time : string;
}

val action_execution_record_of_yojson : Yojson.Safe.t -> action_execution_record
val yojson_of_action_execution_record : action_execution_record -> Yojson.Safe.t

val make_action_execution_record :
  action_id:string ->
  created_at:string ->
  end_time:string ->
  ?id:string ->
  is_success:bool ->
  ?resource_id:string ->
  result:Yojson.Safe.t ->
  start_time:string ->
  unit ->
  action_execution_record

type nonrec ai_admission_error_body = {
  code : string;  (** Stable denial or unavailability code. *)
  error : string;
      (** Human-readable explanation, without internal billing diagnostics. *)
}
(** Public admission error payload. Handlers with additional fields can reuse the
domain error's code and message and \[[admission_status]\]. *)

val ai_admission_error_body_of_yojson : Yojson.Safe.t -> ai_admission_error_body
val yojson_of_ai_admission_error_body : ai_admission_error_body -> Yojson.Safe.t

val make_ai_admission_error_body :
  code:string -> error:string -> unit -> ai_admission_error_body
(** Public admission error payload. Handlers with additional fields can reuse the
domain error's code and message and \[[admission_status]\]. *)

(** Named tint keys from the shared tag color palette. *)
type nonrec appearance_color =
  | Gray
  | Red
  | Tomato
  | Orange
  | Amber
  | Yellow
  | Green
  | Teal
  | Blue
  | Indigo
  | Purple
  | Pink
  | Unknown of string  (** A value this SDK version does not know. *)

val appearance_color_of_yojson : Yojson.Safe.t -> appearance_color
val yojson_of_appearance_color : appearance_color -> Yojson.Safe.t

(** The source of an entity's custom icon. *)
type nonrec appearance_icon =
  | Macro of { name : string  (** Catalog name without the SVG extension. *) }
      (** A stable name from Macro's original, distinct icon catalog. *)
  | Emoji of { value : string  (** Unicode emoji text, not markup or a URL. *) }
      (** A single native emoji, including skin-tone and joined sequences. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val appearance_icon_of_yojson : Yojson.Safe.t -> appearance_icon
val yojson_of_appearance_icon : appearance_icon -> Yojson.Safe.t

val make_appearance_icon_macro : name:string -> unit -> appearance_icon
(** A stable name from Macro's original, distinct icon catalog. *)

val make_appearance_icon_emoji : value:string -> unit -> appearance_icon
(** A single native emoji, including skin-tone and joined sequences. *)

type nonrec attach_draft = {
  email_draft_id : string;
      (** The email draft: an unsent draft in one of the user's own inboxes, in
the thread the suggestion is about. *)
  reason : string;  (** Why, for the change log. *)
}
(** A reply draft a session wrote for an open reply suggestion, as the user,
through [macro.email.createDraft]. It replaces the suggestion's draft, if any;
nothing is ever sent. *)

val attach_draft_of_yojson : Yojson.Safe.t -> attach_draft
val yojson_of_attach_draft : attach_draft -> Yojson.Safe.t

val make_attach_draft :
  email_draft_id:string -> reason:string -> unit -> attach_draft
(** A reply draft a session wrote for an open reply suggestion, as the user,
through [macro.email.createDraft]. It replaces the suggestion's draft, if any;
nothing is ever sent. *)

(** What a text knob's value names: one of its owner's items, which a client
matches by name or lets them pick. *)
type nonrec named_item_kind =
  | Tag
  | Channel
  | Label
  | Unknown of string  (** A value this SDK version does not know. *)

val named_item_kind_of_yojson : Yojson.Safe.t -> named_item_kind
val yojson_of_named_item_kind : named_item_kind -> Yojson.Safe.t

(** The part of the app a routine is about, where it is offered. *)
type nonrec surface =
  | Email
  | Calendar
  | Tasks
  | Files
  | Crm
  | Chat
  | Calls
  | Reviews
  | Agents
  | Unknown of string  (** A value this SDK version does not know. *)

val surface_of_yojson : Yojson.Safe.t -> surface
val yojson_of_surface : surface -> Yojson.Safe.t

type nonrec catalog_entry = {
  action : string;
      (** What it does, in a few words, for the line beside its trigger. *)
  affects_others : bool;  (** It changes or sends what other people see. *)
  code : routine_step option;
  description : string;  (** What it does, in a short line. *)
  instructions : string;
      (** The Ask AI step's instructions: its only step without code, and the
step to use where code can't be saved. *)
  key : string;  (** Names it, e.g. [inbox]. *)
  named_knobs : (string * named_item_kind) list;
      (** The code step's text knobs whose value names one of the owner's
items (a tag, channel or label), by knob name. *)
  request : string;  (** What someone asks for, with when it runs. *)
  safe_default : bool;
      (** It may be switched on before its owner changes anything. *)
  suggest : bool;  (** Offered unpicked as a suggestion from Macro. *)
  surfaces : surface list;
      (** Where it is offered, first the part of the app it belongs to most. *)
  template : bool;
      (** Offered among the templates when someone creates a routine. *)
  title : string;  (** Its name once saved. *)
  trigger : action_trigger;
      (** When it runs; schedules are in the zone the catalog was asked for. *)
}
(** One of Macro's routines, ready to start a new routine from. *)

val catalog_entry_of_yojson : Yojson.Safe.t -> catalog_entry
val yojson_of_catalog_entry : catalog_entry -> Yojson.Safe.t

val make_catalog_entry :
  action:string ->
  affects_others:bool ->
  ?code:routine_step ->
  description:string ->
  instructions:string ->
  key:string ->
  named_knobs:(string * named_item_kind) list ->
  request:string ->
  safe_default:bool ->
  suggest:bool ->
  surfaces:surface list ->
  template:bool ->
  title:string ->
  trigger:action_trigger ->
  unit ->
  catalog_entry
(** One of Macro's routines, ready to start a new routine from. *)

(** A filter on the feed. Not kinds: a suggestion may have several. *)
type nonrec category =
  | Important
  | Revisit
  | Save_money
  | Make_money
  | Unknown of string  (** A value this SDK version does not know. *)

val category_of_yojson : Yojson.Safe.t -> category
val yojson_of_category : category -> Yojson.Safe.t

(** The type of an entity in Macro *)
type nonrec created_item_entity_type =
  | User
  | Chat
  | Channel
  | Channel_message
  | Document
  | Project
  | Email_thread
  | Calendar_event
  | Team
  | Call
  | Foreign_entity
  | Static_file
  | Crm_company
  | Crm_contact
  | Crm_pipeline
  | Reminder
  | Harness
  | Skill
  | Agent_session
  | Scheduled_action
  | Initiative
  | Database
  | Database_row
  | Form
  | External_chat
  | Unknown of string  (** A value this SDK version does not know. *)

val created_item_entity_type_of_yojson :
  Yojson.Safe.t -> created_item_entity_type

val yojson_of_created_item_entity_type :
  created_item_entity_type -> Yojson.Safe.t

type nonrec created_item = {
  entity_id : string;  (** Its id. *)
  entity_type : created_item_entity_type;  (** What kind of item. *)
}
(** Something a routine draft's session created for the routine to use, such
as the database it writes to: it exists whether or not the routine is
saved. *)

val created_item_of_yojson : Yojson.Safe.t -> created_item
val yojson_of_created_item : created_item -> Yojson.Safe.t

val make_created_item :
  entity_id:string ->
  entity_type:created_item_entity_type ->
  unit ->
  created_item
(** Something a routine draft's session created for the routine to use, such
as the database it writes to: it exists whether or not the routine is
saved. *)

type nonrec check_routine_request = {
  created : created_item list option;
      (** What a routine draft's session created for the routine to use, such as
the database it writes to; kept with its draft for the person to see. *)
  routine : action_configuration;
}
(** A routine to check, as the create body takes it. *)

val check_routine_request_of_yojson : Yojson.Safe.t -> check_routine_request
val yojson_of_check_routine_request : check_routine_request -> Yojson.Safe.t

val make_check_routine_request :
  ?created:created_item list ->
  routine:action_configuration ->
  unit ->
  check_routine_request
(** A routine to check, as the create body takes it. *)

(** Code written once, or Ask AI each run. *)
type nonrec step_kind =
  | Code
  | Agent
  | Unknown of string  (** A value this SDK version does not know. *)

val step_kind_of_yojson : Yojson.Safe.t -> step_kind
val yojson_of_step_kind : step_kind -> Yojson.Safe.t

type nonrec step_title = {
  kind : step_kind;
  title : string;  (** Its title; empty when it has none. *)
}
(** A step of a routine handed back. *)

val step_title_of_yojson : Yojson.Safe.t -> step_title
val yojson_of_step_title : step_title -> Yojson.Safe.t

val make_step_title : kind:step_kind -> title:string -> unit -> step_title
(** A step of a routine handed back. *)

type nonrec check_summary = {
  checks : int;
      (** How many checks the session made so far, this one included. *)
  name : string;
  ok : bool;  (** Whether it passed. *)
  problems : int;  (** How many problems it has, its code's included. *)
  steps : step_title list;  (** Its steps, in order. *)
  trigger : action_trigger;  (** When it would run. *)
}
(** A routine the session handed back, as a person watching reads it: never
its code. *)

val check_summary_of_yojson : Yojson.Safe.t -> check_summary
val yojson_of_check_summary : check_summary -> Yojson.Safe.t

val make_check_summary :
  checks:int ->
  name:string ->
  ok:bool ->
  problems:int ->
  steps:step_title list ->
  trigger:action_trigger ->
  unit ->
  check_summary
(** A routine the session handed back, as a person watching reads it: never
its code. *)

type nonrec checked_step_problems = {
  index : int;  (** Its place among the routine's steps, from zero. *)
  problems : string list;
      (** What the type checker reports, first problems first. *)
  title : string;  (** Its title. *)
}
(** A code step that doesn't type-check. *)

val checked_step_problems_of_yojson : Yojson.Safe.t -> checked_step_problems
val yojson_of_checked_step_problems : checked_step_problems -> Yojson.Safe.t

val make_checked_step_problems :
  index:int ->
  problems:string list ->
  title:string ->
  unit ->
  checked_step_problems
(** A code step that doesn't type-check. *)

(** Who a routine's code steps write as. *)
type nonrec code_identity =
  | Agent
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

val code_identity_of_yojson : Yojson.Safe.t -> code_identity
val yojson_of_code_identity : code_identity -> Yojson.Safe.t

(** How an upgrade went. *)
type nonrec upgrade_outcome =
  | Running
  | Checked
  | Rewritten
  | Needs_update
  | Unknown of string  (** A value this SDK version does not know. *)

val upgrade_outcome_of_yojson : Yojson.Safe.t -> upgrade_outcome
val yojson_of_upgrade_outcome : upgrade_outcome -> Yojson.Safe.t

type nonrec code_upgrade = {
  created_at : string;
  from_sdk : string option;
      (** The SDK the code was checked against before; none when it never was. *)
  id : string;
  outcome : upgrade_outcome;
  previous_task : routine_task;  (** The task before. *)
  reason : string option;  (** Why the routine needs its owner. *)
  task : routine_task option;
  to_sdk : string;  (** The SDK it was brought to. *)
  updated_at : string;
}
(** One time a routine's code was brought to a new SDK. *)

val code_upgrade_of_yojson : Yojson.Safe.t -> code_upgrade
val yojson_of_code_upgrade : code_upgrade -> Yojson.Safe.t

val make_code_upgrade :
  created_at:string ->
  ?from_sdk:string ->
  id:string ->
  outcome:upgrade_outcome ->
  previous_task:routine_task ->
  ?reason:string ->
  ?task:routine_task ->
  to_sdk:string ->
  updated_at:string ->
  unit ->
  code_upgrade
(** One time a routine's code was brought to a new SDK. *)

(** Why an event-triggered run was skipped before it started. *)
type nonrec condition_result =
  | Not_met of {
      probability : float;
          (** The classifier's probability, from 0 to 1, that the answer was yes. *)
    }  (** The triggering content answered the condition with no. *)
  | Unavailable
      (** The condition could not be checked before the retry window closed. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val condition_result_of_yojson : Yojson.Safe.t -> condition_result
val yojson_of_condition_result : condition_result -> Yojson.Safe.t

val make_condition_result_not_met :
  probability:float -> unit -> condition_result
(** The triggering content answered the condition with no. *)

type nonrec created_routine = { id : string; name : string }
(** A routine a run created, as that run's history names it. *)

val created_routine_of_yojson : Yojson.Safe.t -> created_routine
val yojson_of_created_routine : created_routine -> Yojson.Safe.t

val make_created_routine : id:string -> name:string -> unit -> created_routine
(** A routine a run created, as that run's history names it. *)

(** The type of an entity in Macro *)
type nonrec draft_created_entity_type =
  | User
  | Chat
  | Channel
  | Channel_message
  | Document
  | Project
  | Email_thread
  | Calendar_event
  | Team
  | Call
  | Foreign_entity
  | Static_file
  | Crm_company
  | Crm_contact
  | Crm_pipeline
  | Reminder
  | Harness
  | Skill
  | Agent_session
  | Scheduled_action
  | Initiative
  | Database
  | Database_row
  | Form
  | External_chat
  | Unknown of string  (** A value this SDK version does not know. *)

val draft_created_entity_type_of_yojson :
  Yojson.Safe.t -> draft_created_entity_type

val yojson_of_draft_created_entity_type :
  draft_created_entity_type -> Yojson.Safe.t

type nonrec draft_created = {
  entity_id : string;  (** Its id. *)
  entity_type : draft_created_entity_type;  (** What kind of item. *)
  used : bool;
      (** Whether the drafted routine uses it. One it doesn't use was made for
nothing, or is the routine's own work done early. *)
}
(** Something a draft's session created. It exists whether or not the draft
is saved. *)

val draft_created_of_yojson : Yojson.Safe.t -> draft_created
val yojson_of_draft_created : draft_created -> Yojson.Safe.t

val make_draft_created :
  entity_id:string ->
  entity_type:draft_created_entity_type ->
  used:bool ->
  unit ->
  draft_created
(** Something a draft's session created. It exists whether or not the draft
is saved. *)

type nonrec step_problem = {
  index : int;  (** Its place among the steps, from zero. *)
  problems : string list;
}
(** A drafted step whose code still fails the type checker. *)

val step_problem_of_yojson : Yojson.Safe.t -> step_problem
val yojson_of_step_problem : step_problem -> Yojson.Safe.t

val make_step_problem :
  index:int -> problems:string list -> unit -> step_problem
(** A drafted step whose code still fails the type checker. *)

type nonrec drafted_routine = {
  created : draft_created list;
      (** What AI created while drafting, such as the database the routine
writes to. These exist whether or not the routine is saved. *)
  name : string;
  problems : step_problem list;
      (** Steps whose code still fails the type checker. *)
  steps : routine_step list;
      (** What it does, in the shape a routine's task holds steps, each code
step named as saving names it. *)
  trigger : action_trigger option;
}
(** A drafted routine. *)

val drafted_routine_of_yojson : Yojson.Safe.t -> drafted_routine
val yojson_of_drafted_routine : drafted_routine -> Yojson.Safe.t

val make_drafted_routine :
  created:draft_created list ->
  name:string ->
  problems:step_problem list ->
  steps:routine_step list ->
  ?trigger:action_trigger ->
  unit ->
  drafted_routine
(** A drafted routine. *)

type nonrec drafted_step = {
  created : draft_created list;
      (** What AI created while drafting the step. These exist whether or not
the step is saved. *)
  problems : string list;  (** What the type checker still finds in its code. *)
  reason : string;
      (** Why AI made a step it chose code or Ask AI, in a few words; empty
when it gave no short reason or didn't choose. *)
  step : routine_step;  (** The step, in the shape a routine's task holds it. *)
}
(** A drafted step. *)

val drafted_step_of_yojson : Yojson.Safe.t -> drafted_step
val yojson_of_drafted_step : drafted_step -> Yojson.Safe.t

val make_drafted_step :
  created:draft_created list ->
  problems:string list ->
  reason:string ->
  step:routine_step ->
  unit ->
  drafted_step
(** A drafted step. *)

(** What AI drafted, or why it couldn't. *)
type nonrec draft =
  | Routine of drafted_routine  (** A routine to review before saving. *)
  | Step of drafted_step
      (** A step to add, or to put in place of the one changed. *)
  | Failed of { created : draft_created list option; message : string }
      (** Why there's no draft, for the person, and anything AI created before
it gave up. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val draft_of_yojson : Yojson.Safe.t -> draft
val yojson_of_draft : draft -> Yojson.Safe.t

val make_draft_failed :
  ?created:draft_created list -> message:string -> unit -> draft
(** Why there's no draft, for the person, and anything AI created before
it gave up. *)

(** What kind of draft was asked for. *)
type nonrec draft_kind =
  | Routine
  | Add_step
  | Change_step
  | Unknown of string  (** A value this SDK version does not know. *)

val draft_kind_of_yojson : Yojson.Safe.t -> draft_kind
val yojson_of_draft_kind : draft_kind -> Yojson.Safe.t

type nonrec draft_asked = {
  description : string;
      (** The words they typed: the description, or the change asked for. *)
  kind : draft_kind;
}
(** What a job was asked to draft, as its owner reads it back: the kind of
request and the words they typed, nothing it was sent with them. *)

val draft_asked_of_yojson : Yojson.Safe.t -> draft_asked
val yojson_of_draft_asked : draft_asked -> Yojson.Safe.t

val make_draft_asked :
  description:string -> kind:draft_kind -> unit -> draft_asked
(** What a job was asked to draft, as its owner reads it back: the kind of
request and the words they typed, nothing it was sent with them. *)

type nonrec draft_context = {
  agent_model : string;  (** The model Ask AI steps it writes run on. *)
  code : bool option;
      (** Whether it may write code steps; otherwise it writes Ask AI steps.
Changing a code step needs no permission. *)
  conditions : bool option;
      (** Whether triggers may ask AI a yes/no question before a run. This host
must also be able to answer it. *)
  timezone : string;
      (** IANA time zone schedules are written in, e.g. [America/New_York]. *)
}
(** What the drafter may write. It looks up the items the person's words
name itself, with their access. *)

val draft_context_of_yojson : Yojson.Safe.t -> draft_context
val yojson_of_draft_context : draft_context -> Yojson.Safe.t

val make_draft_context :
  agent_model:string ->
  ?code:bool ->
  ?conditions:bool ->
  timezone:string ->
  unit ->
  draft_context
(** What the drafter may write. It looks up the items the person's words
name itself, with their access. *)

(** Where a background draft is. *)
type nonrec draft_job_state =
  | Drafting  (** Still drafting; its progress says how far it got. *)
  | Ready of { draft : draft; finished_at : string }
      (** A routine or step to review before saving. *)
  | Failed of {
      created : draft_created list;
      finished_at : string;
      message : string;
    }
      (** Why AI couldn't draft it, for the person, and anything it created
before it gave up. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val draft_job_state_of_yojson : Yojson.Safe.t -> draft_job_state
val yojson_of_draft_job_state : draft_job_state -> Yojson.Safe.t

val make_draft_job_state_ready :
  draft:draft -> finished_at:string -> unit -> draft_job_state
(** A routine or step to review before saving. *)

val make_draft_job_state_failed :
  created:draft_created list ->
  finished_at:string ->
  message:string ->
  unit ->
  draft_job_state
(** Why AI couldn't draft it, for the person, and anything it created
before it gave up. *)

(** The stage a draft is at. *)
type nonrec draft_stage =
  | Started
  | Found
  | Writing
  | Checked
  | Fixing
  | Unknown of string  (** A value this SDK version does not know. *)

val draft_stage_of_yojson : Yojson.Safe.t -> draft_stage
val yojson_of_draft_stage : draft_stage -> Yojson.Safe.t

type nonrec draft_job_progress = {
  check : check_summary option;
  found : int option;
      (** How many items the words name were found; absent before they were
looked up. *)
  stage : draft_stage;
}
(** How far a draft has got: its latest stage, and what it reported on the
way. *)

val draft_job_progress_of_yojson : Yojson.Safe.t -> draft_job_progress
val yojson_of_draft_job_progress : draft_job_progress -> Yojson.Safe.t

val make_draft_job_progress :
  ?check:check_summary ->
  ?found:int ->
  stage:draft_stage ->
  unit ->
  draft_job_progress
(** How far a draft has got: its latest stage, and what it reported on the
way. *)

type nonrec draft_job = {
  draft_job_state : draft_job_state;
  created_at : string;
  id : string;  (** Its id: its hidden session's. *)
  progress : draft_job_progress;
  request : draft_asked;
}
(** A background draft, as its owner reads it. *)

val draft_job_of_yojson : Yojson.Safe.t -> draft_job
val yojson_of_draft_job : draft_job -> Yojson.Safe.t

val make_draft_job :
  draft_job_state:draft_job_state ->
  created_at:string ->
  id:string ->
  progress:draft_job_progress ->
  request:draft_asked ->
  unit ->
  draft_job
(** A background draft, as its owner reads it. *)

type nonrec routine_so_far = {
  steps : routine_step list;
      (** Its steps, in the shape a routine's task holds them. *)
  trigger : Yojson.Safe.t option;
      (** Its trigger as it would be saved, for AI to read; absent while it has none. *)
}
(** The routine a step is added to or changed in. *)

val routine_so_far_of_yojson : Yojson.Safe.t -> routine_so_far
val yojson_of_routine_so_far : routine_so_far -> Yojson.Safe.t

val make_routine_so_far :
  steps:routine_step list -> ?trigger:Yojson.Safe.t -> unit -> routine_so_far
(** The routine a step is added to or changed in. *)

(** What to draft. *)
type nonrec draft_request =
  | Routine of { description : string }
      (** A new routine, from what it should do and when. *)
  | Add_step of {
      description : string;
      kind : step_kind option;
      routine : routine_so_far;
    }
      (** One step to add at the end of [routine]. [kind] makes it code or Ask
AI; without it, AI makes it code whenever code can do the job. *)
  | Change_step of {
      index : int;
      instruction : string;
      routine : routine_so_far;
    }
      (** The code step at [index] in [routine]'s steps, rewritten as
[instruction] says. It keeps its place and output name. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val draft_request_of_yojson : Yojson.Safe.t -> draft_request
val yojson_of_draft_request : draft_request -> Yojson.Safe.t

val make_draft_request_routine : description:string -> unit -> draft_request
(** A new routine, from what it should do and when. *)

val make_draft_request_add_step :
  description:string ->
  ?kind:step_kind ->
  routine:routine_so_far ->
  unit ->
  draft_request
(** One step to add at the end of [routine]. [kind] makes it code or Ask
AI; without it, AI makes it code whenever code can do the job. *)

val make_draft_request_change_step :
  index:int ->
  instruction:string ->
  routine:routine_so_far ->
  unit ->
  draft_request
(** The code step at [index] in [routine]'s steps, rewritten as
[instruction] says. It keeps its place and output name. *)

type nonrec draft_routine_request = {
  context : draft_context;
  draft : draft_request;
}
(** What to draft, and what the drafter may write and name. *)

val draft_routine_request_of_yojson : Yojson.Safe.t -> draft_routine_request
val yojson_of_draft_routine_request : draft_routine_request -> Yojson.Safe.t

val make_draft_routine_request :
  context:draft_context -> draft:draft_request -> unit -> draft_routine_request
(** What to draft, and what the drafter may write and name. *)

(** Where a background draft is now; [removed] once cancelled or discarded. *)
type nonrec draft_update_state =
  | Drafting
  | Ready
  | Failed
  | Removed
  | Unknown of string  (** A value this SDK version does not know. *)

val draft_update_state_of_yojson : Yojson.Safe.t -> draft_update_state
val yojson_of_draft_update_state : draft_update_state -> Yojson.Safe.t

type nonrec draft_update = {
  draft_id : string;
  progress : draft_job_progress;
  state : draft_update_state;
}
(** How a background draft is going, for its owner's open apps. *)

val draft_update_of_yojson : Yojson.Safe.t -> draft_update
val yojson_of_draft_update : draft_update -> Yojson.Safe.t

val make_draft_update :
  draft_id:string ->
  progress:draft_job_progress ->
  state:draft_update_state ->
  unit ->
  draft_update
(** How a background draft is going, for its owner's open apps. *)

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

val empty_response_of_yojson : Yojson.Safe.t -> empty_response
val yojson_of_empty_response : empty_response -> Yojson.Safe.t

(** What an entity suggestion suggests doing about its items. *)
type nonrec entity_action =
  | Reply
  | Review
  | Follow_up
  | Unknown of string  (** A value this SDK version does not know. *)

val entity_action_of_yojson : Yojson.Safe.t -> entity_action
val yojson_of_entity_action : entity_action -> Yojson.Safe.t

type nonrec entity_appearance = {
  color : appearance_color option;
  icon : appearance_icon option;
}
(** An entity's optional icon and tint overrides; absent values retain type defaults. *)

val entity_appearance_of_yojson : Yojson.Safe.t -> entity_appearance
val yojson_of_entity_appearance : entity_appearance -> Yojson.Safe.t

val make_entity_appearance :
  ?color:appearance_color -> ?icon:appearance_icon -> unit -> entity_appearance
(** An entity's optional icon and tint overrides; absent values retain type defaults. *)

(** The type of an entity in Macro *)
type nonrec entity_type =
  | User
  | Chat
  | Channel
  | Channel_message
  | Document
  | Project
  | Email_thread
  | Calendar_event
  | Team
  | Call
  | Foreign_entity
  | Static_file
  | Crm_company
  | Crm_contact
  | Crm_pipeline
  | Reminder
  | Harness
  | Skill
  | Agent_session
  | Scheduled_action
  | Initiative
  | Database
  | Database_row
  | Form
  | External_chat
  | Unknown of string  (** A value this SDK version does not know. *)

val entity_type_of_yojson : Yojson.Safe.t -> entity_type
val yojson_of_entity_type : entity_type -> Yojson.Safe.t

type nonrec execution_record_response = {
  action_id : string;
  created_at : string;
  end_time : string;
  id : string option;
  is_success : bool;
  resource_id : string option;
      (** ID of the primary resource produced by this run. Its type is recorded in
[result], independently of the routine's current configuration. *)
  result : Yojson.Safe.t;
  start_time : string;
  created : created_routine list option;
      (** The sub-routines this run created that still follow the routine. *)
}
(** A finished run, with the routines it created. *)

val execution_record_response_of_yojson :
  Yojson.Safe.t -> execution_record_response

val yojson_of_execution_record_response :
  execution_record_response -> Yojson.Safe.t

val make_execution_record_response :
  action_id:string ->
  created_at:string ->
  end_time:string ->
  ?id:string ->
  is_success:bool ->
  ?resource_id:string ->
  result:Yojson.Safe.t ->
  start_time:string ->
  ?created:created_routine list ->
  unit ->
  execution_record_response
(** A finished run, with the routines it created. *)

(** Closed set of transcript destinations understood by routine clients. *)
type nonrec execution_resource_type =
  | Chat
  | Agent
  | Unknown of string  (** A value this SDK version does not know. *)

val execution_resource_type_of_yojson : Yojson.Safe.t -> execution_resource_type
val yojson_of_execution_resource_type : execution_resource_type -> Yojson.Safe.t

type nonrec execution_resource = {
  id : string;
  type_ : execution_resource_type;
}
(** Transcript resource created by a run. Never infer this from current task configuration. *)

val execution_resource_of_yojson : Yojson.Safe.t -> execution_resource
val yojson_of_execution_resource : execution_resource -> Yojson.Safe.t

val make_execution_resource :
  id:string -> type_:execution_resource_type -> unit -> execution_resource
(** Transcript resource created by a run. Never infer this from current task configuration. *)

(** What started a run, for its page. *)
type nonrec run_start =
  | Schedule of {
      schedule : string;  (** The cron expression. *)
      timezone : string;  (** Its IANA time zone. *)
    }  (** One of its schedules came due. *)
  | Event of {
      entity_id : string option;  (** The item the event is about. *)
      event : string;  (** The event's name, e.g. [email.message_received]. *)
    }  (** An event it watches happened. *)
  | Manual of { by : string  (** Who started it. *) }
      (** Its owner started it by hand. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val run_start_of_yojson : Yojson.Safe.t -> run_start
val yojson_of_run_start : run_start -> Yojson.Safe.t

val make_run_start_schedule :
  schedule:string -> timezone:string -> unit -> run_start
(** One of its schedules came due. *)

val make_run_start_event :
  ?entity_id:string -> event:string -> unit -> run_start
(** An event it watches happened. *)

val make_run_start_manual : by:string -> unit -> run_start
(** Its owner started it by hand. *)

type nonrec run_info = {
  at : string;  (** When the run counts as happening: its trigger's time. *)
  code_acts_as : code_identity option;
  previous_at : string option;
      (** When the routine's previous finished run started. *)
  started_by : run_start;  (** What started it. *)
  timezone : string option;
      (** The IANA time zone code reads [at] in, when the run had one. *)
}
(** What the run page says about a run: what started it, when it counts as
happening, and since when. *)

val run_info_of_yojson : Yojson.Safe.t -> run_info
val yojson_of_run_info : run_info -> Yojson.Safe.t

val make_run_info :
  at:string ->
  ?code_acts_as:code_identity ->
  ?previous_at:string ->
  started_by:run_start ->
  ?timezone:string ->
  unit ->
  run_info
(** What the run page says about a run: what started it, when it counts as
happening, and since when. *)

type nonrec execution_result = {
  condition : condition_result option;
  configuration_revision : int64 option;
      (** The routine configuration the run used. Step paths only name the same
steps in that configuration; a later edit can put another step there. *)
  error : string option;
  resource : execution_resource option;
  run : run_info option;
  steps : Yojson.Safe.t list option;
      (** What each step that ran did, in order: decisions, tool calls, the agent. *)
  version : int;
}
(** Version 1 execution metadata stored in the existing JSON result column.
Null/string column values predate this envelope and refer to legacy chats. *)

val execution_result_of_yojson : Yojson.Safe.t -> execution_result
val yojson_of_execution_result : execution_result -> Yojson.Safe.t

val make_execution_result :
  ?condition:condition_result ->
  ?configuration_revision:int64 ->
  ?error:string ->
  ?resource:execution_resource ->
  ?run:run_info ->
  ?steps:Yojson.Safe.t list ->
  version:int ->
  unit ->
  execution_result
(** Version 1 execution metadata stored in the existing JSON result column.
Null/string column values predate this envelope and refer to legacy chats. *)

type nonrec feed_counts = {
  done_ : int;  (** Done in the last 24 hours. *)
  failed : int;  (** Their last run failed. *)
  open_ : int;  (** Open, nothing under way. *)
  running : int;  (** Their run is under way. *)
}
(** How many of a person's shown suggestions have each status. *)

val feed_counts_of_yojson : Yojson.Safe.t -> feed_counts
val yojson_of_feed_counts : feed_counts -> Yojson.Safe.t

val make_feed_counts :
  done_:int -> failed:int -> open_:int -> running:int -> unit -> feed_counts
(** How many of a person's shown suggestions have each status. *)

(** Where a generation is. *)
type nonrec suggestion_generation_status =
  | Generating
  | Ready
  | Partial
  | Failed
  | Cancelled
  | Interrupted
  | Unknown of string  (** A value this SDK version does not know. *)

val suggestion_generation_status_of_yojson :
  Yojson.Safe.t -> suggestion_generation_status

val yojson_of_suggestion_generation_status :
  suggestion_generation_status -> Yojson.Safe.t

(** Whether one of the person's generations is running. *)
type nonrec generation_state =
  | Idle
  | Running
  | Unknown of string  (** A value this SDK version does not know. *)

val generation_state_of_yojson : Yojson.Safe.t -> generation_state
val yojson_of_generation_state : generation_state -> Yojson.Safe.t

(** What starts a generation: a person finishing onboarding, their night, or
the person asking for fresh suggestions. Shared by everything a
generation's sessions write. *)
type nonrec generation_trigger =
  | Onboarding
  | Nightly
  | Manual
  | Unknown of string  (** A value this SDK version does not know. *)

val generation_trigger_of_yojson : Yojson.Safe.t -> generation_trigger
val yojson_of_generation_trigger : generation_trigger -> Yojson.Safe.t

type nonrec generation_overview = {
  last_finished_at : string option;
      (** When the latest one that ended ended. *)
  last_outcome : suggestion_generation_status option;
  regenerate_available_at : string option;
      (** When the person may next ask for fresh suggestions, while they may
not; absent when they may (or must wait only for the running one). *)
  started_at : string option;  (** When the running one started. *)
  state : generation_state;  (** Whether one is running. *)
  trigger : generation_trigger option;
}
(** The person's generations now, for the web app to show and poll. *)

val generation_overview_of_yojson : Yojson.Safe.t -> generation_overview
val yojson_of_generation_overview : generation_overview -> Yojson.Safe.t

val make_generation_overview :
  ?last_finished_at:string ->
  ?last_outcome:suggestion_generation_status ->
  ?regenerate_available_at:string ->
  ?started_at:string ->
  state:generation_state ->
  ?trigger:generation_trigger ->
  unit ->
  generation_overview
(** The person's generations now, for the web app to show and poll. *)

type nonrec generation_started = {
  started : bool;
      (** Whether a run started; false when one ran before or is running. *)
}
(** What starting a generation did. *)

val generation_started_of_yojson : Yojson.Safe.t -> generation_started
val yojson_of_generation_started : generation_started -> Yojson.Safe.t

val make_generation_started : started:bool -> unit -> generation_started
(** What starting a generation did. *)

(** Where a person's suggestions are in being generated. *)
type nonrec generation_status =
  | None_
  | Generating
  | Ready
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val generation_status_of_yojson : Yojson.Safe.t -> generation_status
val yojson_of_generation_status : generation_status -> Yojson.Safe.t

type nonrec in_progress_execution = {
  action_id : string;
  chat_id : string option;
  resource : execution_resource option;
}

val in_progress_execution_of_yojson : Yojson.Safe.t -> in_progress_execution
val yojson_of_in_progress_execution : in_progress_execution -> Yojson.Safe.t

val make_in_progress_execution :
  action_id:string ->
  ?chat_id:string ->
  ?resource:execution_resource ->
  unit ->
  in_progress_execution

(** A suggestion's kind, without its data. *)
type nonrec kind_name =
  | Prompt
  | Entity
  | Routine
  | Unknown of string  (** A value this SDK version does not know. *)

val kind_name_of_yojson : Yojson.Safe.t -> kind_name
val yojson_of_kind_name : kind_name -> Yojson.Safe.t

type nonrec target = {
  entity_id : string;  (** The item's id. *)
  entity_type : entity_type;  (** The item's type. *)
  part_id : string option;
      (** A part of it, such as one message in a channel. *)
}
(** An item, or a part of one such as a message in a thread. *)

val target_of_yojson : Yojson.Safe.t -> target
val yojson_of_target : target -> Yojson.Safe.t

val make_target :
  entity_id:string ->
  entity_type:entity_type ->
  ?part_id:string ->
  unit ->
  target
(** An item, or a part of one such as a message in a thread. *)

(** How a prompt suggestion runs. *)
type nonrec run_mode =
  | Composer
  | Background
  | Unknown of string  (** A value this SDK version does not know. *)

val run_mode_of_yojson : Yojson.Safe.t -> run_mode
val yojson_of_run_mode : run_mode -> Yojson.Safe.t

type nonrec new_suggestion = {
  about : target list option;  (** The items it is about. *)
  action : entity_action option;
  categories : category list option;  (** The feed's filters it shows under. *)
  dedup_key : string;
      (** Names the suggestion across nights; the same key updates the same suggestion. *)
  importance : int;  (** 0 to 100. *)
  kind : kind_name;
      (** [prompt] or [entity]; routine suggestions come from [macro.routines.suggest]. *)
  prompt : string option;  (** A prompt suggestion's prompt. *)
  reason : string option;
      (** Why, for the change log; required to bring back a suggestion the person
dismissed. *)
  run_mode : run_mode option;
  sends : string option;
      (** A background prompt suggestion that posts or sends: what, and where. *)
  summary : string;  (** Why, in a line or two. *)
  title : string;  (** What to do, in a few words. *)
}
(** A new suggestion, or a new version of one with the same [dedupKey], as a
generation session hands it back through [macro.suggestions.suggest]. *)

val new_suggestion_of_yojson : Yojson.Safe.t -> new_suggestion
val yojson_of_new_suggestion : new_suggestion -> Yojson.Safe.t

val make_new_suggestion :
  ?about:target list ->
  ?action:entity_action ->
  ?categories:category list ->
  dedup_key:string ->
  importance:int ->
  kind:kind_name ->
  ?prompt:string ->
  ?reason:string ->
  ?run_mode:run_mode ->
  ?sends:string ->
  summary:string ->
  title:string ->
  unit ->
  new_suggestion
(** A new suggestion, or a new version of one with the same [dedupKey], as a
generation session hands it back through [macro.suggestions.suggest]. *)

type nonrec regeneration_cooldown = {
  available_at : string;  (** When they may ask again. *)
}
(** Fresh suggestions weren't started: the person asked within the hour. *)

val regeneration_cooldown_of_yojson : Yojson.Safe.t -> regeneration_cooldown
val yojson_of_regeneration_cooldown : regeneration_cooldown -> Yojson.Safe.t

val make_regeneration_cooldown :
  available_at:string -> unit -> regeneration_cooldown
(** Fresh suggestions weren't started: the person asked within the hour. *)

(** Why fresh suggestions weren't started. *)
type nonrec regeneration_refusal =
  | Running
  | Unknown of string  (** A value this SDK version does not know. *)

val regeneration_refusal_of_yojson : Yojson.Safe.t -> regeneration_refusal
val yojson_of_regeneration_refusal : regeneration_refusal -> Yojson.Safe.t

type nonrec regeneration_running = {
  reason : regeneration_refusal;  (** Why. *)
}
(** Fresh suggestions weren't started: a generation is running. *)

val regeneration_running_of_yojson : Yojson.Safe.t -> regeneration_running
val yojson_of_regeneration_running : regeneration_running -> Yojson.Safe.t

val make_regeneration_running :
  reason:regeneration_refusal -> unit -> regeneration_running
(** Fresh suggestions weren't started: a generation is running. *)

type nonrec retire_suggestion = {
  reason : string;  (** Why, for the change log. *)
}
(** Retiring an open suggestion that no longer fits. *)

val retire_suggestion_of_yojson : Yojson.Safe.t -> retire_suggestion
val yojson_of_retire_suggestion : retire_suggestion -> Yojson.Safe.t

val make_retire_suggestion : reason:string -> unit -> retire_suggestion
(** Retiring an open suggestion that no longer fits. *)

type nonrec retire_suggestion_request = {
  reason : string;  (** Why, for the change log. *)
}
(** Retiring an open suggestion that no longer matters. *)

val retire_suggestion_request_of_yojson :
  Yojson.Safe.t -> retire_suggestion_request

val yojson_of_retire_suggestion_request :
  retire_suggestion_request -> Yojson.Safe.t

val make_retire_suggestion_request :
  reason:string -> unit -> retire_suggestion_request
(** Retiring an open suggestion that no longer matters. *)

(** Where one of the person's routine suggestions is. *)
type nonrec reviewed_state =
  | Open
  | Dismissed
  | Retired
  | Saved
  | Unknown of string  (** A value this SDK version does not know. *)

val reviewed_state_of_yojson : Yojson.Safe.t -> reviewed_state
val yojson_of_reviewed_state : reviewed_state -> Yojson.Safe.t

(** What is suggested: a catalog routine with its knobs, or a routine AI
drafted and checked. *)
type nonrec suggested_pick =
  | Catalog of {
      key : string;  (** The catalog routine, e.g. [inbox]. *)
      knobs : Yojson.Safe.t;
          (** Knob values by knob name; knobs left out keep the catalog's. *)
    }
      (** A catalog routine ([GET /scheduled-actions/catalog]), with the knob
values AI filled in. Its trigger and steps come from the catalog. *)
  | Routine of { routine : action_configuration }
      (** A routine AI drafted that passed saving's checks, as it would be
saved (switched off), for the person to review first. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val suggested_pick_of_yojson : Yojson.Safe.t -> suggested_pick
val yojson_of_suggested_pick : suggested_pick -> Yojson.Safe.t

val make_suggested_pick_catalog :
  key:string -> knobs:Yojson.Safe.t -> unit -> suggested_pick
(** A catalog routine ([GET /scheduled-actions/catalog]), with the knob
values AI filled in. Its trigger and steps come from the catalog. *)

val make_suggested_pick_routine :
  routine:action_configuration -> unit -> suggested_pick
(** A routine AI drafted that passed saving's checks, as it would be
saved (switched off), for the person to review first. *)

type nonrec reviewed_suggestion = {
  suggested_pick : suggested_pick;
  closed_at : string option;  (** When it was dismissed or retired. *)
  created_at : string;  (** When it was suggested. *)
  id : string;
  keep_probability : float;
  reason : string;
  state : reviewed_state;
  surfaces : surface list;
}
(** One suggestion AI made for the person, as a routines session reviews it. *)

val reviewed_suggestion_of_yojson : Yojson.Safe.t -> reviewed_suggestion
val yojson_of_reviewed_suggestion : reviewed_suggestion -> Yojson.Safe.t

val make_reviewed_suggestion :
  suggested_pick:suggested_pick ->
  ?closed_at:string ->
  created_at:string ->
  id:string ->
  keep_probability:float ->
  reason:string ->
  state:reviewed_state ->
  surfaces:surface list ->
  unit ->
  reviewed_suggestion
(** One suggestion AI made for the person, as a routines session reviews it. *)

type nonrec rewrite_suggestion = {
  about : target list option;  (** New items it is about. *)
  categories : category list option;  (** New categories. *)
  importance : int option;  (** A new importance. *)
  prompt : string option;  (** Only on prompt suggestions. *)
  reason : string;  (** Why, for the change log. *)
  sends : string option;
      (** Only on background prompt suggestions: what the run posts or sends, and
where. *)
  summary : string option;  (** A new summary. *)
  title : string option;  (** A new title. *)
}
(** Changes to an open suggestion; fields left out stay. *)

val rewrite_suggestion_of_yojson : Yojson.Safe.t -> rewrite_suggestion
val yojson_of_rewrite_suggestion : rewrite_suggestion -> Yojson.Safe.t

val make_rewrite_suggestion :
  ?about:target list ->
  ?categories:category list ->
  ?importance:int ->
  ?prompt:string ->
  reason:string ->
  ?sends:string ->
  ?summary:string ->
  ?title:string ->
  unit ->
  rewrite_suggestion
(** Changes to an open suggestion; fields left out stay. *)

type nonrec routine_check = {
  ok : bool;
      (** Whether saving it would succeed: no problems and no failing steps. *)
  problems : string list;
      (** Why saving it would fail, other than its code, for its author. *)
  routine : action_configuration;
      (** The routine as saving would store it: code steps named and the SDK
their code checks against stamped. *)
  steps : checked_step_problems list;
      (** Code steps that don't type-check against Macro's SDK. *)
}
(** What saving a routine would find wrong, without saving it: the answer to
[POST /scheduled-actions/check]. *)

val routine_check_of_yojson : Yojson.Safe.t -> routine_check
val yojson_of_routine_check : routine_check -> Yojson.Safe.t

val make_routine_check :
  ok:bool ->
  problems:string list ->
  routine:action_configuration ->
  steps:checked_step_problems list ->
  unit ->
  routine_check
(** What saving a routine would find wrong, without saving it: the answer to
[POST /scheduled-actions/check]. *)

type nonrec routine_sentence_part = {
  picked : bool;  (** It is a value AI picked, which the person can change. *)
  text : string;  (** What it says. *)
}
(** A part of a routine's sentence. *)

val routine_sentence_part_of_yojson : Yojson.Safe.t -> routine_sentence_part
val yojson_of_routine_sentence_part : routine_sentence_part -> Yojson.Safe.t

val make_routine_sentence_part :
  picked:bool -> text:string -> unit -> routine_sentence_part
(** A part of a routine's sentence. *)

(** Who suggests a routine. *)
type nonrec suggestion_from =
  | For_you
  | Macro
  | Unknown of string  (** A value this SDK version does not know. *)

val suggestion_from_of_yojson : Yojson.Safe.t -> suggestion_from
val yojson_of_suggestion_from : suggestion_from -> Yojson.Safe.t

type nonrec routine_suggestion = {
  suggested_pick : suggested_pick;
  from : suggestion_from;
      (** Who suggests it: AI, for this person, or Macro, as a template. *)
  id : string;
      (** Saving a routine from it passes this as [suggestion_id]; dismissing
it uses it too. *)
  keep_probability : float option;
      (** AI's estimate, from 0 to 1, that the person keeps it on; absent on
Macro's templates. *)
  on_by_default : bool;
      (** Onboarding shows it switched on: one of at most two catalog
routines AI picked that are safe by default and likely kept. Never a
drafted routine or a template. *)
  reason : string option;
      (** Why it fits this person, in a line; absent on Macro's templates. *)
  surfaces : surface list;
      (** The sidebars it shows in, first the one it belongs to most.
Dismissing it in one dismisses it everywhere. *)
}
(** A routine offered to one person: one AI suggested for them, or one of
Macro's catalog routines filling a surface. *)

val routine_suggestion_of_yojson : Yojson.Safe.t -> routine_suggestion
val yojson_of_routine_suggestion : routine_suggestion -> Yojson.Safe.t

val make_routine_suggestion :
  suggested_pick:suggested_pick ->
  from:suggestion_from ->
  id:string ->
  ?keep_probability:float ->
  on_by_default:bool ->
  ?reason:string ->
  surfaces:surface list ->
  unit ->
  routine_suggestion
(** A routine offered to one person: one AI suggested for them, or one of
Macro's catalog routines filling a surface. *)

type nonrec routine_suggestion_card = {
  categories : category list option;  (** The feed's filters it shows under. *)
  importance : int;
      (** 0 to 100: how much the person would regret missing it this week. *)
  title : string;  (** What it does for the person, in a few words. *)
}
(** How a drafted routine suggestion shows in the person's Suggestions feed:
every routine a session drafts is also one suggestion there, kept and
closed with it. *)

val routine_suggestion_card_of_yojson : Yojson.Safe.t -> routine_suggestion_card
val yojson_of_routine_suggestion_card : routine_suggestion_card -> Yojson.Safe.t

val make_routine_suggestion_card :
  ?categories:category list ->
  importance:int ->
  title:string ->
  unit ->
  routine_suggestion_card
(** How a drafted routine suggestion shows in the person's Suggestions feed:
every routine a session drafts is also one suggestion there, kept and
closed with it. *)

type nonrec routine_suggestions = {
  status : generation_status;
  suggestions : routine_suggestion list;
      (** Per surface, AI's first, best first, then Macro's templates, so each
surface has at least one and ideally three. A suggestion with
several surfaces appears once. *)
}
(** A person's suggestions, and whether more are on the way. *)

val routine_suggestions_of_yojson : Yojson.Safe.t -> routine_suggestions
val yojson_of_routine_suggestions : routine_suggestions -> Yojson.Safe.t

val make_routine_suggestions :
  status:generation_status ->
  suggestions:routine_suggestion list ->
  unit ->
  routine_suggestions
(** A person's suggestions, and whether more are on the way. *)

(** How a variable is filled when someone activates the template. *)
type nonrec variable_fill =
  | Activator
  | Shared
  | Choice
  | Unknown of string  (** A value this SDK version does not know. *)

val variable_fill_of_yojson : Yojson.Safe.t -> variable_fill
val yojson_of_variable_fill : variable_fill -> Yojson.Safe.t

(** A user-specific part of a shared routine. *)
type nonrec template_variable =
  | User of { fill : variable_fill; id : string; label : string }
      (** A person mentioned in the instructions, by their user ID. *)
  | Item of {
      block_name : string;
          (** The mention's block name, such as [channel] or [md]. *)
      fill : variable_fill;
      id : string;
      label : string;
    }  (** A document, channel or other item mentioned in the instructions. *)
  | Time_zone of { fill : variable_fill; timezone : string }
      (** The time zone of the routine's schedules. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val template_variable_of_yojson : Yojson.Safe.t -> template_variable
val yojson_of_template_variable : template_variable -> Yojson.Safe.t

val make_template_variable_user :
  fill:variable_fill -> id:string -> label:string -> unit -> template_variable
(** A person mentioned in the instructions, by their user ID. *)

val make_template_variable_item :
  block_name:string ->
  fill:variable_fill ->
  id:string ->
  label:string ->
  unit ->
  template_variable
(** A document, channel or other item mentioned in the instructions. *)

val make_template_variable_time_zone :
  fill:variable_fill -> timezone:string -> unit -> template_variable
(** The time zone of the routine's schedules. *)

type nonrec routine_template = {
  active_count : int;
      (** Routines activated from this template, including stopped ones. *)
  appearance : entity_appearance;
  author : string;  (** Who shared it: the source routine's owner. *)
  created_at : string;
  description : string;
  id : string;  (** The routine it was shared from. *)
  name : string;
  task : routine_task;
  trigger : action_trigger;
  updated_at : string;
  variables : template_variable list;
}
(** A shared routine's snapshot, readable by signed-in users with sharing enabled. *)

val routine_template_of_yojson : Yojson.Safe.t -> routine_template
val yojson_of_routine_template : routine_template -> Yojson.Safe.t

val make_routine_template :
  active_count:int ->
  appearance:entity_appearance ->
  author:string ->
  created_at:string ->
  description:string ->
  id:string ->
  name:string ->
  task:routine_task ->
  trigger:action_trigger ->
  updated_at:string ->
  variables:template_variable list ->
  unit ->
  routine_template
(** A shared routine's snapshot, readable by signed-in users with sharing enabled. *)

type nonrec routine_text = {
  sentence : routine_sentence_part list;
      (** What it does: a step's sentence with the values AI picked marked, or
its description (else its name) as one unmarked part. *)
  when_ : string;
      (** When it runs, e.g. "Fridays at 9:00 AM" or "New email received". *)
}
(** How a routine suggestion's drafted routine reads on its card. *)

val routine_text_of_yojson : Yojson.Safe.t -> routine_text
val yojson_of_routine_text : routine_text -> Yojson.Safe.t

val make_routine_text :
  sentence:routine_sentence_part list -> when_:string -> unit -> routine_text
(** How a routine suggestion's drafted routine reads on its card. *)

(** A run's state without its data: how it is stored and served. *)
type nonrec run_state_name =
  | Starting
  | Running
  | Waiting
  | Stopping
  | Cancelling
  | Finished
  | Failed
  | Cancelled
  | Unknown of string  (** A value this SDK version does not know. *)

val run_state_name_of_yojson : Yojson.Safe.t -> run_state_name
val yojson_of_run_state_name : run_state_name -> Yojson.Safe.t

type nonrec sub_routine = {
  created_by_run_id : string;
      (** The run that created it: the id of that run's history record, which
exists once the run ends. *)
  key : string option;
      (** The name its creating code gave it, when it gave one. *)
  parent_id : string;
      (** The top-level routine it follows: pausing that routine pauses it, and
deleting that routine deletes it. A routine a sub-routine's run
creates follows the same top-level routine. *)
  paused_by_parent : bool option;
      (** It is off because its parent was switched off, and resumes with it. *)
}
(** How a routine created by a routine's run belongs to that routine. *)

val sub_routine_of_yojson : Yojson.Safe.t -> sub_routine
val yojson_of_sub_routine : sub_routine -> Yojson.Safe.t

val make_sub_routine :
  created_by_run_id:string ->
  ?key:string ->
  parent_id:string ->
  ?paused_by_parent:bool ->
  unit ->
  sub_routine
(** How a routine created by a routine's run belongs to that routine. *)

type nonrec scheduled_action = {
  appearance : entity_appearance option;
      (** Optional presentation overrides; absent values use routine defaults. *)
  claimed : string option;
  configuration_revision : int64;
      (** Independent of execution bookkeeping in [updated_at]. *)
  created_at : string;
  description : string option;
      (** What the routine is for, in the owner's words; empty when unset. *)
  enabled : bool;
      (** When false, automatic dispatch skips this action. [run_now] remains
available regardless. *)
  event_activated_at : string option;
      (** Event publication boundary; absent for cron actions. *)
  id : string option;
  kind : action_kind;
  name : string;
  next_run_at : string option;
      (** Next cron firing, absent for event-triggered actions. *)
  owner : string;
      (** Who the action belongs to. Every action is user-owned today, but the
type no longer says so: the principal string on the wire and in the
[owner] column is the same, and a bot- or team-owned row decodes
rather than failing to parse. *)
  run_visibility : run_visibility;
      (** Whether the action's runs are listed in Home and the Agents list. *)
  sub_routine : sub_routine option;
  suggestion_id : string option;
      (** The routine suggestion it was saved from, if any: a plain pointer
that stays after the suggestion is replaced. *)
  task : routine_task;
  template_id : string option;
      (** The shared template this routine was activated from, if any. *)
  trigger : action_trigger;
  updated_at : string;
}

val scheduled_action_of_yojson : Yojson.Safe.t -> scheduled_action
val yojson_of_scheduled_action : scheduled_action -> Yojson.Safe.t

val make_scheduled_action :
  ?appearance:entity_appearance ->
  ?claimed:string ->
  configuration_revision:int64 ->
  created_at:string ->
  ?description:string ->
  enabled:bool ->
  ?event_activated_at:string ->
  ?id:string ->
  kind:action_kind ->
  name:string ->
  ?next_run_at:string ->
  owner:string ->
  run_visibility:run_visibility ->
  ?sub_routine:sub_routine ->
  ?suggestion_id:string ->
  task:routine_task ->
  ?template_id:string ->
  trigger:action_trigger ->
  updated_at:string ->
  unit ->
  scheduled_action

type nonrec scheduled_action_response = {
  appearance : entity_appearance option;
      (** Optional presentation overrides; absent values use routine defaults. *)
  claimed : string option;
  configuration_revision : int64;
      (** Independent of execution bookkeeping in [updated_at]. *)
  created_at : string;
  description : string option;
      (** What the routine is for, in the owner's words; empty when unset. *)
  enabled : bool;
      (** When false, automatic dispatch skips this action. [run_now] remains
available regardless. *)
  event_activated_at : string option;
      (** Event publication boundary; absent for cron actions. *)
  id : string option;
  kind : action_kind;
  name : string;
  next_run_at : string option;
      (** Next cron firing, absent for event-triggered actions. *)
  owner : string;
      (** Who the action belongs to. Every action is user-owned today, but the
type no longer says so: the principal string on the wire and in the
[owner] column is the same, and a bot- or team-owned row decodes
rather than failing to parse. *)
  run_visibility : run_visibility;
      (** Whether the action's runs are listed in Home and the Agents list. *)
  sub_routine : sub_routine option;
  suggestion_id : string option;
      (** The routine suggestion it was saved from, if any: a plain pointer
that stays after the suggestion is replaced. *)
  task : routine_task;
  template_id : string option;
      (** The shared template this routine was activated from, if any. *)
  trigger : action_trigger;
  updated_at : string;
  last_run : action_execution_record option;
  schedule : string option;
      (** Deprecated: use [trigger.schedule]. Present only for cron actions. *)
  timezone : string option;
      (** Deprecated: use [trigger.timezone]. Present only for cron actions. *)
}
(** Canonical trigger plus deprecated cron fields for existing clients. Event
responses omit legacy fields rather than inventing a schedule or timezone. *)

val scheduled_action_response_of_yojson :
  Yojson.Safe.t -> scheduled_action_response

val yojson_of_scheduled_action_response :
  scheduled_action_response -> Yojson.Safe.t

val make_scheduled_action_response :
  ?appearance:entity_appearance ->
  ?claimed:string ->
  configuration_revision:int64 ->
  created_at:string ->
  ?description:string ->
  enabled:bool ->
  ?event_activated_at:string ->
  ?id:string ->
  kind:action_kind ->
  name:string ->
  ?next_run_at:string ->
  owner:string ->
  run_visibility:run_visibility ->
  ?sub_routine:sub_routine ->
  ?suggestion_id:string ->
  task:routine_task ->
  ?template_id:string ->
  trigger:action_trigger ->
  updated_at:string ->
  ?last_run:action_execution_record ->
  ?schedule:string ->
  ?timezone:string ->
  unit ->
  scheduled_action_response
(** Canonical trigger plus deprecated cron fields for existing clients. Event
responses omit legacy fields rather than inventing a schedule or timezone. *)

(** Live status update for a scheduled-action run, broadcast via the connection
gateway to the owner. Clients use the typed resource to navigate to the run
transcript and the variant tag to toggle the running indicator. [chat_id]
remains populated only for chat runs, for older clients.

Serialized with a [type] tag ([started]/[stopped]) and delivered over the
single [scheduled_action_update] message type on the gateway. *)
type nonrec scheduled_action_update =
  | Started of {
      action_id : string;
      chat_id : string option;
      owner : string;
      resource : execution_resource option;
    }
  | Stopped of {
      action_id : string;
      chat_id : string option;
      is_success : bool;
      owner : string;
      resource : execution_resource option;
    }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val scheduled_action_update_of_yojson : Yojson.Safe.t -> scheduled_action_update
val yojson_of_scheduled_action_update : scheduled_action_update -> Yojson.Safe.t

val make_scheduled_action_update_started :
  action_id:string ->
  ?chat_id:string ->
  owner:string ->
  ?resource:execution_resource ->
  unit ->
  scheduled_action_update

val make_scheduled_action_update_stopped :
  action_id:string ->
  ?chat_id:string ->
  is_success:bool ->
  owner:string ->
  ?resource:execution_resource ->
  unit ->
  scheduled_action_update

type nonrec set_scheduled_action_enabled = { enabled : bool }

val set_scheduled_action_enabled_of_yojson :
  Yojson.Safe.t -> set_scheduled_action_enabled

val yojson_of_set_scheduled_action_enabled :
  set_scheduled_action_enabled -> Yojson.Safe.t

val make_set_scheduled_action_enabled :
  enabled:bool -> unit -> set_scheduled_action_enabled

type nonrec share_routine_template = {
  description : string;
  variables : template_variable list;
}
(** What the owner supplies when sharing; the rest is snapshotted from the routine. *)

val share_routine_template_of_yojson : Yojson.Safe.t -> share_routine_template
val yojson_of_share_routine_template : share_routine_template -> Yojson.Safe.t

val make_share_routine_template :
  description:string ->
  variables:template_variable list ->
  unit ->
  share_routine_template
(** What the owner supplies when sharing; the rest is snapshotted from the routine. *)

type nonrec start_draft_job_request = {
  client_id : string;
      (** Made by the client, once per start. Sent again with it (as when the
connection drops before the answer), the start answers with the job
it began, starting nothing, until that job is discarded. *)
  context : draft_context;
  draft : draft_request;
}
(** A background draft to start: what the blocking route takes, and the id
the client made for this start. *)

val start_draft_job_request_of_yojson : Yojson.Safe.t -> start_draft_job_request
val yojson_of_start_draft_job_request : start_draft_job_request -> Yojson.Safe.t

val make_start_draft_job_request :
  client_id:string ->
  context:draft_context ->
  draft:draft_request ->
  unit ->
  start_draft_job_request
(** A background draft to start: what the blocking route takes, and the id
the client made for this start. *)

type nonrec suggest_outcome = {
  check : routine_check option;
  id : string option;  (** The kept suggestion's id. *)
  ok : bool;  (** Whether it was kept. *)
  problems : string list;  (** Why it wasn't, to fix and suggest again. *)
}
(** What became of a suggestion handed back. *)

val suggest_outcome_of_yojson : Yojson.Safe.t -> suggest_outcome
val yojson_of_suggest_outcome : suggest_outcome -> Yojson.Safe.t

val make_suggest_outcome :
  ?check:routine_check ->
  ?id:string ->
  ok:bool ->
  problems:string list ->
  unit ->
  suggest_outcome
(** What became of a suggestion handed back. *)

(** What a suggestion session hands back through [macro.routines.suggest]. *)
type nonrec suggest_request =
  | Catalog of {
      card : routine_suggestion_card option;
      keep_probability : float;
      key : string;
      knobs : Yojson.Safe.t option;
      reason : string;
      surfaces : surface list;
    }  (** A catalog routine, with knob values. *)
  | Routine of {
      card : routine_suggestion_card;
          (** How it shows in the person's Suggestions feed. *)
      created : created_item list option;
          (** What the session created for it, as [macro.routines.check] takes. *)
      keep_probability : float;
      reason : string;
      routine : action_configuration;
      surfaces : surface list;
    }  (** A routine the catalog lacks, checked as saving checks it. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val suggest_request_of_yojson : Yojson.Safe.t -> suggest_request
val yojson_of_suggest_request : suggest_request -> Yojson.Safe.t

val make_suggest_request_catalog :
  ?card:routine_suggestion_card ->
  keep_probability:float ->
  key:string ->
  ?knobs:Yojson.Safe.t ->
  reason:string ->
  surfaces:surface list ->
  unit ->
  suggest_request
(** A catalog routine, with knob values. *)

val make_suggest_request_routine :
  card:routine_suggestion_card ->
  ?created:created_item list ->
  keep_probability:float ->
  reason:string ->
  routine:action_configuration ->
  surfaces:surface list ->
  unit ->
  suggest_request
(** A routine the catalog lacks, checked as saving checks it. *)

type nonrec suggestion_draft = {
  entity_id : string;  (** The item's id. *)
  entity_type : entity_type;  (** The item's type. *)
  part_id : string option;
      (** A part of it, such as one message in a channel. *)
  preview : string option;
      (** The start of its plain text, as it was when attached. *)
}
(** A reply suggestion's draft. *)

val suggestion_draft_of_yojson : Yojson.Safe.t -> suggestion_draft
val yojson_of_suggestion_draft : suggestion_draft -> Yojson.Safe.t

val make_suggestion_draft :
  entity_id:string ->
  entity_type:entity_type ->
  ?part_id:string ->
  ?preview:string ->
  unit ->
  suggestion_draft
(** A reply suggestion's draft. *)

(** What kind of suggestion it is, with that kind's data. A kind never changes. *)
type nonrec suggestion_kind =
  | Prompt of {
      prompt : string;  (** What the agent is asked to do. *)
      run_mode : run_mode;  (** How it runs. *)
      sends : string option;
          (** For a background run that posts or sends something: what, and
where, in plain words. The card shows it before Run, and running
it approves exactly that. None when the run posts and sends
nothing. *)
    }
      (** A prompt for an agent: opened in the composer, or run in the
background. *)
  | Entity of {
      action : entity_action;  (** What to do about the items. *)
      draft : suggestion_draft option;
      from : string option;
          (** A reply suggestion's: that message's sender, by name. *)
      waiting_since : string option;
          (** A reply suggestion's: when the message the person hasn't answered
came, as read from its item when the suggestion was last written. *)
    }  (** A note about specific items, with what to do about them. *)
  | Routine of {
      routine : routine_text option;
      routine_suggestion_id : string;  (** The suggestion it shows. *)
    }  (** A routine suggestion, shown among suggestions. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val suggestion_kind_of_yojson : Yojson.Safe.t -> suggestion_kind
val yojson_of_suggestion_kind : suggestion_kind -> Yojson.Safe.t

val make_suggestion_kind_prompt :
  prompt:string -> run_mode:run_mode -> ?sends:string -> unit -> suggestion_kind
(** A prompt for an agent: opened in the composer, or run in the
background. *)

val make_suggestion_kind_entity :
  action:entity_action ->
  ?draft:suggestion_draft ->
  ?from:string ->
  ?waiting_since:string ->
  unit ->
  suggestion_kind
(** A note about specific items, with what to do about them. *)

val make_suggestion_kind_routine :
  ?routine:routine_text ->
  routine_suggestion_id:string ->
  unit ->
  suggestion_kind
(** A routine suggestion, shown among suggestions. *)

type nonrec suggestion_run = {
  session_id : string;  (** The agent session: open it to see the result. *)
  started_at : string;  (** When it started. *)
  state : run_state_name;
      (** Where it is, as stored: reading it never asks the session. *)
  state_changed_at : string;  (** When it entered [state]. *)
}
(** A run of a background prompt suggestion: a hidden agent session of the
person's, with the full toolset, that never stops to ask. *)

val suggestion_run_of_yojson : Yojson.Safe.t -> suggestion_run
val yojson_of_suggestion_run : suggestion_run -> Yojson.Safe.t

val make_suggestion_run :
  session_id:string ->
  started_at:string ->
  state:run_state_name ->
  state_changed_at:string ->
  unit ->
  suggestion_run
(** A run of a background prompt suggestion: a hidden agent session of the
person's, with the full toolset, that never stops to ask. *)

(** Where a suggestion is for the person. *)
type nonrec suggestion_state =
  | Proposed
  | Accepted
  | Done
  | Dismissed
  | Resolved
  | Retired
  | Unknown of string  (** A value this SDK version does not know. *)

val suggestion_state_of_yojson : Yojson.Safe.t -> suggestion_state
val yojson_of_suggestion_state : suggestion_state -> Yojson.Safe.t

(** What a suggestion's card shows, from its state and its latest run. *)
type nonrec suggestion_status =
  | Open
  | Running
  | Failed
  | Done
  | Closed
  | Unknown of string  (** A value this SDK version does not know. *)

val suggestion_status_of_yojson : Yojson.Safe.t -> suggestion_status
val yojson_of_suggestion_status : suggestion_status -> Yojson.Safe.t

type nonrec suggestion = {
  suggestion_kind : suggestion_kind;  (** Its kind, with that kind's data. *)
  about : target list;  (** The items it is about. *)
  categories : category list;  (** The feed's filters it shows under. *)
  created_at : string;  (** When it was first proposed. *)
  dedup_key : string;
      (** Names the suggestion across nights: proposing the same key again changes
this suggestion instead of adding one. *)
  id : string;  (** The suggestion's id. *)
  importance : int;  (** 0 to 100, for ordering. *)
  is_new : bool;
      (** Proposed since the person last opened their feed. Only the feed sets
it; false everywhere else. *)
  produced : target list;  (** What acting on it produced. *)
  result : target option;
  run : suggestion_run option;
  state : suggestion_state;  (** Where it is for the person. *)
  state_changed_at : string;
      (** When its state last changed, such as when it was dismissed. *)
  state_reason : string option;
      (** Why it was resolved; only on resolved suggestions. *)
  status : suggestion_status;
      (** What the card shows: whether it is open, being run, failed or done. *)
  summary : string;  (** Why, in a line or two. *)
  title : string;  (** What to do, in a few words. *)
  updated_at : string;  (** When it last changed. *)
}
(** One proactive suggestion for one person. *)

val suggestion_of_yojson : Yojson.Safe.t -> suggestion
val yojson_of_suggestion : suggestion -> Yojson.Safe.t

val make_suggestion :
  suggestion_kind:suggestion_kind ->
  about:target list ->
  categories:category list ->
  created_at:string ->
  dedup_key:string ->
  id:string ->
  importance:int ->
  is_new:bool ->
  produced:target list ->
  ?result:target ->
  ?run:suggestion_run ->
  state:suggestion_state ->
  state_changed_at:string ->
  ?state_reason:string ->
  status:suggestion_status ->
  summary:string ->
  title:string ->
  updated_at:string ->
  unit ->
  suggestion
(** One proactive suggestion for one person. *)

type nonrec suggestion_changed = {
  message : string;  (** What happened. *)
  suggestion : suggestion;
      (** The suggestion as it is now, to show before acting on it again. *)
}
(** The suggestion changed since the caller read it, or can't run until its
last run settles. *)

val suggestion_changed_of_yojson : Yojson.Safe.t -> suggestion_changed
val yojson_of_suggestion_changed : suggestion_changed -> Yojson.Safe.t

val make_suggestion_changed :
  message:string -> suggestion:suggestion -> unit -> suggestion_changed
(** The suggestion changed since the caller read it, or can't run until its
last run settles. *)

type nonrec suggestion_feed = {
  counts : feed_counts;
      (** How many suggestions the whole feed holds of each status, whatever the
[limit]. *)
  done_ : suggestion list option;
      (** Suggestions done in the last 24 hours, with what they produced; left
out when the feed was read with a [limit]. *)
  suggestions : suggestion list;
      (** The open suggestions, at most [limit] of them. *)
}
(** A person's feed: their open suggestions, best first, and the ones they
finished in the last day, newest first. Both lists are in the order to
show them. *)

val suggestion_feed_of_yojson : Yojson.Safe.t -> suggestion_feed
val yojson_of_suggestion_feed : suggestion_feed -> Yojson.Safe.t

val make_suggestion_feed :
  counts:feed_counts ->
  ?done_:suggestion list ->
  suggestions:suggestion list ->
  unit ->
  suggestion_feed
(** A person's feed: their open suggestions, best first, and the ones they
finished in the last day, newest first. Both lists are in the order to
show them. *)

type nonrec suggestion_review = {
  kept_left : int;  (** Suggestions this session may still hand back. *)
  suggestions : reviewed_suggestion list;
}
(** Every suggestion AI made for the person, for a routines session. *)

val suggestion_review_of_yojson : Yojson.Safe.t -> suggestion_review
val yojson_of_suggestion_review : suggestion_review -> Yojson.Safe.t

val make_suggestion_review :
  kept_left:int ->
  suggestions:reviewed_suggestion list ->
  unit ->
  suggestion_review
(** Every suggestion AI made for the person, for a routines session. *)

type nonrec suggestion_write_outcome = {
  ok : bool;  (** Whether it was applied. *)
  problems : string list;  (** Why it wasn't, to fix and try again. *)
  suggestion : suggestion option;
}
(** What became of a session's write. *)

val suggestion_write_outcome_of_yojson :
  Yojson.Safe.t -> suggestion_write_outcome

val yojson_of_suggestion_write_outcome :
  suggestion_write_outcome -> Yojson.Safe.t

val make_suggestion_write_outcome :
  ok:bool ->
  problems:string list ->
  ?suggestion:suggestion ->
  unit ->
  suggestion_write_outcome
(** What became of a session's write. *)

type nonrec suggestions_review = {
  new_left : int;
      (** Suggestions this generation may still add or bring back. *)
  open_ : int;
      (** Open suggestions the person has, and the most they may have. *)
  open_limit : int;  (** The most open suggestions a person may have. *)
  suggestions : suggestion list;
      (** Open suggestions first, best first, then closed ones newest first. A
dismissed suggestion's [stateChangedAt] is when the person dismissed it. *)
}
(** What a generation session reads before managing the person's suggestions:
every suggestion they have, open or not, and how many more it may add. *)

val suggestions_review_of_yojson : Yojson.Safe.t -> suggestions_review
val yojson_of_suggestions_review : suggestions_review -> Yojson.Safe.t

val make_suggestions_review :
  new_left:int ->
  open_:int ->
  open_limit:int ->
  suggestions:suggestion list ->
  unit ->
  suggestions_review
(** What a generation session reads before managing the person's suggestions:
every suggestion they have, open or not, and how many more it may add. *)

type nonrec regenerate_suggestions_error =
  | Conflict of regeneration_running  (** HTTP 409. *)
  | Too_many_requests of regeneration_cooldown  (** HTTP 429. *)

val scheduled_action_health :
  unit ->
  ( empty_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /health] *)

val list_scheduled_actions :
  ?include_events:bool ->
  ?include_children:bool ->
  ?parent:string ->
  unit ->
  ( scheduled_action_response list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions] *)

val create_scheduled_action :
  enabled:bool ->
  kind:action_kind ->
  name:string ->
  task:routine_task ->
  trigger:action_trigger ->
  ?suggestion_id:string ->
  ?key:string ->
  ?description:string ->
  ?run_visibility:run_visibility ->
  unit ->
  ( scheduled_action_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions]

Create a routine. A create made by a routine's run, from its code step
or its Ask AI step's session, makes that routine's sub-routine: the
caller's credential says so, never the body. *)

val routine_catalog :
  timezone:string ->
  unit ->
  ( catalog_entry list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/catalog] *)

val check_scheduled_action :
  routine:action_configuration ->
  ?created:created_item list ->
  unit ->
  ( routine_check,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/check]

What saving this routine would find wrong, without saving it: the same
checks as creating it. A routine draft's session hands its draft back
this way. *)

val list_routine_draft_jobs :
  unit ->
  ( draft_job list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/draft-jobs] *)

val start_routine_draft_job :
  client_id:string ->
  context:draft_context ->
  draft:draft_request ->
  unit ->
  (draft_job, ai_admission_error_body) Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/draft-jobs] *)

val get_routine_draft_job :
  id:string ->
  unit ->
  (draft_job, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/draft-jobs/{id}] *)

val discard_routine_draft_job :
  id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /scheduled-actions/draft-jobs/{id}] *)

val draft_routine :
  context:draft_context ->
  draft:draft_request ->
  unit ->
  (draft, ai_admission_error_body) Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/drafts] *)

val list_routine_suggestions :
  ?surface:surface ->
  unit ->
  ( routine_suggestions,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/suggestions] *)

val suggest_routine :
  body:suggest_request ->
  unit ->
  ( suggest_outcome,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/suggestions]

Hand back one routine suggestion from a routine suggestion session, the
way a draft's session checks its routine: a catalog routine with knob
values, or a drafted routine, checked as saving checks it. *)

val review_routine_suggestions :
  unit ->
  ( suggestion_review,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/suggestions/review]

What a routines generation session reads before managing suggestions. *)

val dismiss_routine_suggestion :
  id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/suggestions/{id}/dismiss] *)

val retire_routine_suggestion :
  id:string ->
  reason:string ->
  unit ->
  ( suggest_outcome,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/suggestions/{id}/retire]

Retire an open suggestion that no longer fits, from a routines
generation session. *)

val get_scheduled_action :
  id:string ->
  unit ->
  ( scheduled_action_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/{id}] *)

val update_scheduled_action :
  id:string ->
  kind:action_kind ->
  name:string ->
  task:routine_task ->
  trigger:action_trigger ->
  ?description:string ->
  ?enabled:bool ->
  ?run_visibility:run_visibility ->
  unit ->
  ( scheduled_action_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /scheduled-actions/{id}] *)

val delete_scheduled_action :
  id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /scheduled-actions/{id}] *)

val set_scheduled_action_appearance :
  id:string ->
  ?color:appearance_color ->
  ?icon:appearance_icon ->
  unit ->
  ( entity_appearance,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /scheduled-actions/{id}/appearance] *)

val list_scheduled_action_code_upgrades :
  id:string ->
  unit ->
  ( code_upgrade list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/{id}/code-upgrades] *)

val detach_scheduled_action :
  id:string ->
  unit ->
  ( scheduled_action_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/{id}/detach]

Keep a sub-routine as the owner's own routine: it moves to the main list
and no longer follows the routine whose run created it. *)

val set_scheduled_action_enabled :
  id:string ->
  enabled:bool ->
  unit ->
  ( scheduled_action_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /scheduled-actions/{id}/enabled] *)

val execute_scheduled_action_now :
  id:string ->
  unit ->
  (in_progress_execution, ai_admission_error_body) Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/{id}/execute] *)

val list_scheduled_action_history :
  id:string ->
  unit ->
  ( execution_record_response list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/{id}/history] *)

val get_scheduled_action_template :
  id:string ->
  unit ->
  ( routine_template,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduled-actions/{id}/template] *)

val share_scheduled_action_template :
  id:string ->
  description:string ->
  variables:template_variable list ->
  unit ->
  ( routine_template,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /scheduled-actions/{id}/template] *)

val unshare_scheduled_action_template :
  id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /scheduled-actions/{id}/template] *)

val activate_scheduled_action_template :
  id:string ->
  enabled:bool ->
  kind:action_kind ->
  name:string ->
  task:routine_task ->
  trigger:action_trigger ->
  ?description:string ->
  ?run_visibility:run_visibility ->
  unit ->
  ( scheduled_action_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /scheduled-actions/{id}/template/activate] *)

val list_suggestions :
  ?timezone:string ->
  ?limit:int ->
  unit ->
  ( suggestion_feed,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /suggestions]

The caller's feed, for them or their own agent. *)

val add_suggestion :
  dedup_key:string ->
  importance:int ->
  kind:kind_name ->
  summary:string ->
  title:string ->
  ?about:target list ->
  ?action:entity_action ->
  ?categories:category list ->
  ?prompt:string ->
  ?reason:string ->
  ?run_mode:run_mode ->
  ?sends:string ->
  unit ->
  ( suggestion_write_outcome,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /suggestions]

Add a suggestion from a suggestions generation session, or a new version of the
one with its dedup key. *)

val start_suggestion_generation :
  timezone:string ->
  unit ->
  ( generation_started,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /suggestions/generate]

Start the caller's onboarding generation, once their inbox is connected. *)

val get_suggestion_generation :
  unit ->
  ( generation_overview,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /suggestions/generation]

The caller's suggestion generations now. *)

val regenerate_suggestions :
  timezone:string ->
  unit ->
  (generation_started, regenerate_suggestions_error) Macro_sdk_runtime.Request.t
(** [POST /suggestions/regenerate]

Start fresh suggestions for the caller: at most once an hour, and not
while one of their generations runs. *)

val review_suggestions :
  unit ->
  ( suggestions_review,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /suggestions/review]

What a suggestions generation session reads before managing suggestions. *)

val record_suggestions_seen :
  timezone:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /suggestions/seen]

The caller loaded the app in their time zone. *)

val record_suggestions_viewed :
  unit -> (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /suggestions/viewed]

The caller opened their feed: what it showed as new no longer is. The app
sends it once the feed is on screen. *)

val rewrite_suggestion :
  id:string ->
  reason:string ->
  ?about:target list ->
  ?categories:category list ->
  ?importance:int ->
  ?prompt:string ->
  ?sends:string ->
  ?summary:string ->
  ?title:string ->
  unit ->
  ( suggestion_write_outcome,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PATCH /suggestions/{id}]

Change an open suggestion from a suggestions generation session. *)

val accept_suggestion :
  id:string ->
  updated_at:string ->
  unit ->
  (unit, suggestion_changed) Macro_sdk_runtime.Request.t
(** [POST /suggestions/{id}/accept]

The caller, or someone acting for them, acts on a suggestion: a background
prompt suggestion starts its run when the person accepts it in the app (anyone
else only takes it on); a note or prompt is done once they act on it (open its
item or the composer), and shows in the feed's [done]. A routine suggestion is
refused: the person saves its routine in the app, which makes it done. *)

val dismiss_suggestion :
  id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /suggestions/{id}/dismiss]

The caller, or their own agent, isn't interested in an open suggestion. *)

val attach_suggestion_draft :
  id:string ->
  email_draft_id:string ->
  reason:string ->
  unit ->
  ( suggestion_write_outcome,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /suggestions/{id}/draft]

Make a reply draft a suggestions generation session wrote the draft of an
open reply suggestion. Nothing is sent. *)

val restore_suggestion :
  id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /suggestions/{id}/restore]

The caller, or their own agent, takes back dismissing a suggestion, within
five minutes of it. *)

val retire_suggestion :
  id:string ->
  reason:string ->
  unit ->
  ( suggestion_write_outcome,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /suggestions/{id}/retire]

Retire an open suggestion from a suggestions generation session. *)
