(* Generated from packages/sdk/specs/scheduled-action.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

type nonrec accept_suggestion_request = {
  updated_at : string;
      (** The suggestion's [updatedAt] as the caller read it. A background suggestion runs
only if it is unchanged since and no run of it is still settling;
otherwise the answer is 409. *)
}
(** Acting on a suggestion, as the caller's copy of it shows it. *)

let accept_suggestion_request_of_yojson :
    Yojson.Safe.t -> accept_suggestion_request =
 fun json ->
  let fields = Json.obj json in
  { updated_at = Json.required fields "updatedAt" Json.string }

and yojson_of_accept_suggestion_request :
    accept_suggestion_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("updatedAt", Some (Json.of_string value.updated_at)) ]

let make_accept_suggestion_request ~(updated_at : string) () =
  ({ updated_at } : accept_suggestion_request)

type nonrec action_kind =
  | Agent
  | Unknown of string  (** A value this SDK version does not know. *)

let action_kind_of_yojson : Yojson.Safe.t -> action_kind =
 fun json ->
  match Json.string json with
  | "Agent" -> Agent
  | other -> Json.unknown "action_kind" json (Unknown other)

and yojson_of_action_kind : action_kind -> Yojson.Safe.t =
 fun value ->
  match value with Agent -> `String "Agent" | Unknown other -> `String other

(** Whether a routine's runs are listed in Home and the Agents list. Routines
that run often would bury the owner's own work, so runs start unlisted;
either way they stay in the routine's history. The string form is the
[scheduled_action.run_visibility] column's. *)
type nonrec run_visibility =
  | Listed
  | Unlisted
  | Unknown of string  (** A value this SDK version does not know. *)

let run_visibility_of_yojson : Yojson.Safe.t -> run_visibility =
 fun json ->
  match Json.string json with
  | "listed" -> Listed
  | "unlisted" -> Unlisted
  | other -> Json.unknown "run_visibility" json (Unknown other)

and yojson_of_run_visibility : run_visibility -> Yojson.Safe.t =
 fun value ->
  match value with
  | Listed -> `String "listed"
  | Unlisted -> `String "unlisted"
  | Unknown other -> `String other

type nonrec agent_mcp_server = {
  app_slug : string;  (** Pipedream app slug, e.g. [linear]. *)
  server_name : string;  (** Display name, e.g. [Linear]. *)
}
(** One Pipedream app an agent lists under \[[AgentMcpServers::Selected]\].

Only the catalog identity is stored. Whether a given person has connected
the app is theirs, resolved at call time by the egress proxy, never here. *)

let agent_mcp_server_of_yojson : Yojson.Safe.t -> agent_mcp_server =
 fun json ->
  let fields = Json.obj json in
  {
    app_slug = Json.required fields "app_slug" Json.string;
    server_name = Json.required fields "server_name" Json.string;
  }

and yojson_of_agent_mcp_server : agent_mcp_server -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app_slug", Some (Json.of_string value.app_slug));
      ("server_name", Some (Json.of_string value.server_name));
    ]

let make_agent_mcp_server ~(app_slug : string) ~(server_name : string) () =
  ({ app_slug; server_name } : agent_mcp_server)

type nonrec sdk_fingerprint = string
(** Identifies the SDK API code was type-checked against: its version and a
hash of its declarations, e.g. [0.2.2+18cc1c19c35c]. *)

let sdk_fingerprint_of_yojson : Yojson.Safe.t -> sdk_fingerprint =
 fun json -> Json.string json

and yojson_of_sdk_fingerprint : sdk_fingerprint -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec step_id = string
(** Names a step's output: a lowercase letter, then up to 31 lowercase
letters, digits or underscores. *)

let step_id_of_yojson : Yojson.Safe.t -> step_id = fun json -> Json.string json

and yojson_of_step_id : step_id -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec knob_name = string
(** How code reads a knob: a lowercase letter, then up to 31 letters or
digits, e.g. [dueWithinDays]. *)

let knob_name_of_yojson : Yojson.Safe.t -> knob_name =
 fun json -> Json.string json

and yojson_of_knob_name : knob_name -> Yojson.Safe.t =
 fun value -> Json.of_string value

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

let routine_knob_of_yojson : Yojson.Safe.t -> routine_knob =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "text" ->
      Text
        {
          label = Json.required fields "label" Json.string;
          name = Json.required fields "name" knob_name_of_yojson;
          value = Json.required fields "value" Json.string;
        }
  | "number" ->
      Number
        {
          label = Json.required fields "label" Json.string;
          max = Json.optional fields "max" Json.float;
          min = Json.optional fields "min" Json.float;
          name = Json.required fields "name" knob_name_of_yojson;
          value = Json.required fields "value" Json.float;
        }
  | "boolean" ->
      Boolean
        {
          label = Json.required fields "label" Json.string;
          name = Json.required fields "name" knob_name_of_yojson;
          value = Json.required fields "value" Json.bool;
        }
  | "choice" ->
      Choice
        {
          label = Json.required fields "label" Json.string;
          name = Json.required fields "name" knob_name_of_yojson;
          options = Json.required fields "options" (Json.list Json.string);
          value = Json.required fields "value" Json.string;
        }
  | "question" ->
      Question
        {
          label = Json.required fields "label" Json.string;
          name = Json.required fields "name" knob_name_of_yojson;
          value = Json.required fields "value" Json.string;
        }
  | _ -> Json.unknown "routine_knob" json (Unknown json)

and yojson_of_routine_knob : routine_knob -> Yojson.Safe.t =
 fun value ->
  match value with
  | Text case ->
      Json.record
        [
          ("type", Some (`String "text"));
          ("label", Some (Json.of_string case.label));
          ("name", Some (yojson_of_knob_name case.name));
          ("value", Some (Json.of_string case.value));
        ]
  | Number case ->
      Json.record
        [
          ("type", Some (`String "number"));
          ("label", Some (Json.of_string case.label));
          ("max", Option.map Json.of_float case.max);
          ("min", Option.map Json.of_float case.min);
          ("name", Some (yojson_of_knob_name case.name));
          ("value", Some (Json.of_float case.value));
        ]
  | Boolean case ->
      Json.record
        [
          ("type", Some (`String "boolean"));
          ("label", Some (Json.of_string case.label));
          ("name", Some (yojson_of_knob_name case.name));
          ("value", Some (Json.of_bool case.value));
        ]
  | Choice case ->
      Json.record
        [
          ("type", Some (`String "choice"));
          ("label", Some (Json.of_string case.label));
          ("name", Some (yojson_of_knob_name case.name));
          ("options", Some ((Json.of_list Json.of_string) case.options));
          ("value", Some (Json.of_string case.value));
        ]
  | Question case ->
      Json.record
        [
          ("type", Some (`String "question"));
          ("label", Some (Json.of_string case.label));
          ("name", Some (yojson_of_knob_name case.name));
          ("value", Some (Json.of_string case.value));
        ]
  | Unknown json -> json

let make_routine_knob_text ~(label : string) ~(name : knob_name)
    ~(value : string) () =
  (Text { label; name; value } : routine_knob)

let make_routine_knob_number ~(label : string) ?max ?min ~(name : knob_name)
    ~(value : float) () =
  (Number { label; max; min; name; value } : routine_knob)

let make_routine_knob_boolean ~(label : string) ~(name : knob_name)
    ~(value : bool) () =
  (Boolean { label; name; value } : routine_knob)

let make_routine_knob_choice ~(label : string) ~(name : knob_name)
    ~(options : string list) ~(value : string) () =
  (Choice { label; name; options; value } : routine_knob)

let make_routine_knob_question ~(label : string) ~(name : knob_name)
    ~(value : string) () =
  (Question { label; name; value } : routine_knob)

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

let code_step_of_yojson : Yojson.Safe.t -> code_step =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.optional fields "id" step_id_of_yojson;
    knobs = Json.optional fields "knobs" (Json.list routine_knob_of_yojson);
    sentence = Json.optional fields "sentence" Json.string;
    source = Json.required fields "source" Json.string;
    summary = Json.optional fields "summary" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_code_step : code_step -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Option.map yojson_of_step_id value.id);
      ("knobs", Option.map (Json.of_list yojson_of_routine_knob) value.knobs);
      ("sentence", Option.map Json.of_string value.sentence);
      ("source", Some (Json.of_string value.source));
      ("summary", Option.map Json.of_string value.summary);
      ("title", Some (Json.of_string value.title));
    ]

let make_code_step ?id ?knobs ?sentence ~(source : string) ?summary
    ~(title : string) () =
  ({ id; knobs; sentence; source; summary; title } : code_step)

type nonrec agent_task_agent = { bot_id : string  (** The agent's bot id. *) }
(** A persona selection, independent of its runtime and current default model. *)

let agent_task_agent_of_yojson : Yojson.Safe.t -> agent_task_agent =
 fun json ->
  let fields = Json.obj json in
  { bot_id = Json.required fields "bot_id" Json.string }

and yojson_of_agent_task_agent : agent_task_agent -> Yojson.Safe.t =
 fun value -> Json.record [ ("bot_id", Some (Json.of_string value.bot_id)) ]

let make_agent_task_agent ~(bot_id : string) () =
  ({ bot_id } : agent_task_agent)

type nonrec agent_step = {
  agent : agent_task_agent option;
  instructions : string;
      (** What the model or agent should do. It also sees the triggering event
and what earlier steps in this run did. *)
  model : string option;
      (** Required when no agent is selected; otherwise overrides the agent's default model. *)
}
(** Hand the run to a model running as Macro, or to an agent. *)

let agent_step_of_yojson : Yojson.Safe.t -> agent_step =
 fun json ->
  let fields = Json.obj json in
  {
    agent = Json.optional fields "agent" agent_task_agent_of_yojson;
    instructions = Json.required fields "instructions" Json.string;
    model = Json.optional fields "model" Json.string;
  }

and yojson_of_agent_step : agent_step -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("agent", Option.map yojson_of_agent_task_agent value.agent);
      ("instructions", Some (Json.of_string value.instructions));
      ("model", Option.map Json.of_string value.model);
    ]

let make_agent_step ?agent ~(instructions : string) ?model () =
  ({ agent; instructions; model } : agent_step)

(** One step of a routine. *)
type nonrec routine_step =
  | Code of code_step
      (** Run TypeScript against Macro's SDK, as the routine owner. *)
  | Agent of agent_step
      (** Hand the run to a model or agent with instructions. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let routine_step_of_yojson : Yojson.Safe.t -> routine_step =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "code" -> Code (code_step_of_yojson json)
  | "agent" -> Agent (agent_step_of_yojson json)
  | _ -> Json.unknown "routine_step" json (Unknown json)

and yojson_of_routine_step : routine_step -> Yojson.Safe.t =
 fun value ->
  match value with
  | Code inner -> Json.with_tag "type" "code" (yojson_of_code_step inner)
  | Agent inner -> Json.with_tag "type" "agent" (yojson_of_agent_step inner)
  | Unknown json -> json

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

let routine_program_of_yojson : Yojson.Safe.t -> routine_program =
 fun json ->
  let fields = Json.obj json in
  {
    dangerously_operate_as_user =
      Json.optional fields "dangerously_operate_as_user" Json.bool;
    mcp_servers =
      Json.optional fields "mcp_servers" (Json.list agent_mcp_server_of_yojson);
    sdk = Json.optional fields "sdk" sdk_fingerprint_of_yojson;
    steps = Json.required fields "steps" (Json.list routine_step_of_yojson);
  }

and yojson_of_routine_program : routine_program -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "dangerously_operate_as_user",
        Option.map Json.of_bool value.dangerously_operate_as_user );
      ( "mcp_servers",
        Option.map (Json.of_list yojson_of_agent_mcp_server) value.mcp_servers
      );
      ("sdk", Option.map yojson_of_sdk_fingerprint value.sdk);
      ("steps", Some ((Json.of_list yojson_of_routine_step) value.steps));
    ]

let make_routine_program ?dangerously_operate_as_user ?mcp_servers ?sdk
    ~(steps : routine_step list) () =
  ({ dangerously_operate_as_user; mcp_servers; sdk; steps } : routine_program)

type nonrec routine_model_id = string
(** A nonblank model identifier. Runtime catalogs, not the scheduler, own availability. *)

let routine_model_id_of_yojson : Yojson.Safe.t -> routine_model_id =
 fun json -> Json.string json

and yojson_of_routine_model_id : routine_model_id -> Yojson.Safe.t =
 fun value -> Json.of_string value

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

let agent_task_of_yojson : Yojson.Safe.t -> agent_task =
 fun json ->
  let fields = Json.obj json in
  {
    agent = Json.optional fields "agent" agent_task_agent_of_yojson;
    mcp_servers =
      Json.optional fields "mcp_servers" (Json.list agent_mcp_server_of_yojson);
    model = Json.optional fields "model" routine_model_id_of_yojson;
    prompt = Json.required fields "prompt" Json.string;
    user_prompt = Json.required fields "user_prompt" Json.string;
  }

and yojson_of_agent_task : agent_task -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("agent", Option.map yojson_of_agent_task_agent value.agent);
      ( "mcp_servers",
        Option.map (Json.of_list yojson_of_agent_mcp_server) value.mcp_servers
      );
      ("model", Option.map yojson_of_routine_model_id value.model);
      ("prompt", Some (Json.of_string value.prompt));
      ("user_prompt", Some (Json.of_string value.user_prompt));
    ]

let make_agent_task ?agent ?mcp_servers ?model ~(prompt : string)
    ~(user_prompt : string) () =
  ({ agent; mcp_servers; model; prompt; user_prompt } : agent_task)

(** A stored task's two forms, as the scheduler's API describes [task]:
\[[RoutineProgram::from_task]\] reads them. *)
type nonrec routine_task =
  | Routine_program of routine_program  (** Steps, run in order. *)
  | Agent_task of agent_task  (** A routine that is only an agent. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let routine_task_of_yojson : Yojson.Safe.t -> routine_task =
 fun json ->
  match
    Json.first_ok
      [
        (fun json -> Routine_program (routine_program_of_yojson json));
        (fun json -> Agent_task (agent_task_of_yojson json));
      ]
      json
  with
  | Some value -> value
  | None -> Json.unknown "routine_task" json (Unknown json)

and yojson_of_routine_task : routine_task -> Yojson.Safe.t =
 fun value ->
  match value with
  | Routine_program inner -> yojson_of_routine_program inner
  | Agent_task inner -> yojson_of_agent_task inner
  | Unknown json -> json

type nonrec schedule = string

let schedule_of_yojson : Yojson.Safe.t -> schedule =
 fun json -> Json.string json

and yojson_of_schedule : schedule -> Yojson.Safe.t =
 fun value -> Json.of_string value

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

let event_name_of_yojson : Yojson.Safe.t -> event_name =
 fun json ->
  match Json.string json with
  | "document.created" -> Document_created
  | "document.updated" -> Document_updated
  | "document.deleted" -> Document_deleted
  | "task.created" -> Task_created
  | "task.status_changed" -> Task_status_changed
  | "task.priority_changed" -> Task_priority_changed
  | "task.property_changed" -> Task_property_changed
  | "email.message_received" -> Email_message_received
  | "channel.created" -> Channel_created
  | "channel.message_posted" -> Channel_message_posted
  | "channel.mentioned" -> Channel_mentioned
  | "channel.message_patched" -> Channel_message_patched
  | "channel.message_attachment_created" -> Channel_message_attachment_created
  | "call.started" -> Call_started
  | "call.ended" -> Call_ended
  | "github" -> Github
  | other -> Json.unknown "event_name" json (Unknown other)

and yojson_of_event_name : event_name -> Yojson.Safe.t =
 fun value ->
  match value with
  | Document_created -> `String "document.created"
  | Document_updated -> `String "document.updated"
  | Document_deleted -> `String "document.deleted"
  | Task_created -> `String "task.created"
  | Task_status_changed -> `String "task.status_changed"
  | Task_priority_changed -> `String "task.priority_changed"
  | Task_property_changed -> `String "task.property_changed"
  | Email_message_received -> `String "email.message_received"
  | Channel_created -> `String "channel.created"
  | Channel_message_posted -> `String "channel.message_posted"
  | Channel_mentioned -> `String "channel.mentioned"
  | Channel_message_patched -> `String "channel.message_patched"
  | Channel_message_attachment_created ->
      `String "channel.message_attachment_created"
  | Call_started -> `String "call.started"
  | Call_ended -> `String "call.ended"
  | Github -> `String "github"
  | Unknown other -> `String other

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

let github_selector_of_yojson : Yojson.Safe.t -> github_selector =
 fun json ->
  let fields = Json.obj json in
  {
    actions = Json.optional fields "actions" (Json.list Json.string);
    events = Json.optional fields "events" (Json.list Json.string);
    include_bots = Json.optional fields "includeBots" Json.bool;
    repositories = Json.optional fields "repositories" (Json.list Json.string);
  }

and yojson_of_github_selector : github_selector -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("actions", Option.map (Json.of_list Json.of_string) value.actions);
      ("events", Option.map (Json.of_list Json.of_string) value.events);
      ("includeBots", Option.map Json.of_bool value.include_bots);
      ( "repositories",
        Option.map (Json.of_list Json.of_string) value.repositories );
    ]

let make_github_selector ?actions ?events ?include_bots ?repositories () =
  ({ actions; events; include_bots; repositories } : github_selector)

type nonrec payload_scalar_value =
  | Bool of bool
  | Float of float
  | String of string
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let payload_scalar_value_of_yojson : Yojson.Safe.t -> payload_scalar_value =
 fun json ->
  match
    Json.first_ok
      [
        (fun json -> Bool (Json.bool json));
        (fun json -> Float (Json.float json));
        (fun json -> String (Json.string json));
      ]
      json
  with
  | Some value -> value
  | None -> Json.unknown "payload_scalar_value" json (Unknown json)

and yojson_of_payload_scalar_value : payload_scalar_value -> Yojson.Safe.t =
 fun value ->
  match value with
  | Bool inner -> Json.of_bool inner
  | Float inner -> Json.of_float inner
  | String inner -> Json.of_string inner
  | Unknown json -> json

type nonrec payload_scalar = payload_scalar_value option
(** A JSON text, number, boolean or null that payload values are compared with. *)

let payload_scalar_of_yojson : Yojson.Safe.t -> payload_scalar =
 fun json -> (Json.option payload_scalar_value_of_yojson) json

and yojson_of_payload_scalar : payload_scalar -> Yojson.Safe.t =
 fun value -> (Json.of_option yojson_of_payload_scalar_value) value

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

let payload_condition_of_yojson : Yojson.Safe.t -> payload_condition =
 fun json ->
  let fields = Json.obj json in
  {
    equals = Json.optional fields "equals" payload_scalar_of_yojson;
    exists = Json.optional fields "exists" Json.bool;
    glob = Json.optional fields "glob" Json.string;
    in_ = Json.optional fields "in" (Json.list payload_scalar_of_yojson);
    not_in = Json.optional fields "notIn" (Json.list payload_scalar_of_yojson);
    path = Json.required fields "path" (Json.list Json.string);
  }

and yojson_of_payload_condition : payload_condition -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("equals", Option.map yojson_of_payload_scalar value.equals);
      ("exists", Option.map Json.of_bool value.exists);
      ("glob", Option.map Json.of_string value.glob);
      ("in", Option.map (Json.of_list yojson_of_payload_scalar) value.in_);
      ("notIn", Option.map (Json.of_list yojson_of_payload_scalar) value.not_in);
      ("path", Some ((Json.of_list Json.of_string) value.path));
    ]

let make_payload_condition ?equals ?exists ?glob ?in_ ?not_in
    ~(path : string list) () =
  ({ equals; exists; glob; in_; not_in; path } : payload_condition)

type nonrec property_selector = {
  definition_id : string;
      (** The property definition that must have changed. *)
  values : string list option;
      (** Select option ids or referenced entity ids, one of which the change must
add. Any change to the property matches when empty. *)
}
(** Narrows a task property change filter to one property and, optionally, the
values it must gain. *)

let property_selector_of_yojson : Yojson.Safe.t -> property_selector =
 fun json ->
  let fields = Json.obj json in
  {
    definition_id = Json.required fields "definitionId" Json.string;
    values = Json.optional fields "values" (Json.list Json.string);
  }

and yojson_of_property_selector : property_selector -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("definitionId", Some (Json.of_string value.definition_id));
      ("values", Option.map (Json.of_list Json.of_string) value.values);
    ]

let make_property_selector ~(definition_id : string) ?values () =
  ({ definition_id; values } : property_selector)

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

let event_filter_of_yojson : Yojson.Safe.t -> event_filter =
 fun json ->
  let fields = Json.obj json in
  {
    condition = Json.optional fields "condition" Json.string;
    events = Json.required fields "events" (Json.list event_name_of_yojson);
    github = Json.optional fields "github" github_selector_of_yojson;
    ids = Json.optional fields "ids" (Json.list Json.string);
    match_ =
      Json.optional fields "match" (Json.list payload_condition_of_yojson);
    property = Json.optional fields "property" property_selector_of_yojson;
  }

and yojson_of_event_filter : event_filter -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("condition", Option.map Json.of_string value.condition);
      ("events", Some ((Json.of_list yojson_of_event_name) value.events));
      ("github", Option.map yojson_of_github_selector value.github);
      ("ids", Option.map (Json.of_list Json.of_string) value.ids);
      ( "match",
        Option.map (Json.of_list yojson_of_payload_condition) value.match_ );
      ("property", Option.map yojson_of_property_selector value.property);
    ]

let make_event_filter ?condition ~(events : event_name list) ?github ?ids
    ?match_ ?property () =
  ({ condition; events; github; ids; match_; property } : event_filter)

type nonrec event_filters = event_filter list
(** Bounded nonempty OR of filters, canonicalized to remove duplicates. *)

let event_filters_of_yojson : Yojson.Safe.t -> event_filters =
 fun json -> (Json.list event_filter_of_yojson) json

and yojson_of_event_filters : event_filters -> Yojson.Safe.t =
 fun value -> (Json.of_list yojson_of_event_filter) value

(** An individual trigger in a routine's trigger list. *)
type nonrec routine_trigger =
  | Cron of { schedule : schedule; timezone : string }
  | Events of { filters : event_filters }
  | Once of { at : string }
      (** Fires once at [at], or as soon as it is saved when [at] has passed. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let routine_trigger_of_yojson : Yojson.Safe.t -> routine_trigger =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "cron" ->
      Cron
        {
          schedule = Json.required fields "schedule" schedule_of_yojson;
          timezone = Json.required fields "timezone" Json.string;
        }
  | "events" ->
      Events
        { filters = Json.required fields "filters" event_filters_of_yojson }
  | "once" -> Once { at = Json.required fields "at" Json.string }
  | _ -> Json.unknown "routine_trigger" json (Unknown json)

and yojson_of_routine_trigger : routine_trigger -> Yojson.Safe.t =
 fun value ->
  match value with
  | Cron case ->
      Json.record
        [
          ("type", Some (`String "cron"));
          ("schedule", Some (yojson_of_schedule case.schedule));
          ("timezone", Some (Json.of_string case.timezone));
        ]
  | Events case ->
      Json.record
        [
          ("type", Some (`String "events"));
          ("filters", Some (yojson_of_event_filters case.filters));
        ]
  | Once case ->
      Json.record
        [
          ("type", Some (`String "once")); ("at", Some (Json.of_string case.at));
        ]
  | Unknown json -> json

let make_routine_trigger_cron ~(schedule : schedule) ~(timezone : string) () =
  (Cron { schedule; timezone } : routine_trigger)

let make_routine_trigger_events ~(filters : event_filters) () =
  (Events { filters } : routine_trigger)

let make_routine_trigger_once ~(at : string) () =
  (Once { at } : routine_trigger)

type nonrec routine_triggers = routine_trigger list
(** Bounded schedules and one combined set of event filters. *)

let routine_triggers_of_yojson : Yojson.Safe.t -> routine_triggers =
 fun json -> (Json.list routine_trigger_of_yojson) json

and yojson_of_routine_triggers : routine_triggers -> Yojson.Safe.t =
 fun value -> (Json.of_list yojson_of_routine_trigger) value

(** A routine may run on one trigger or any of several schedules and Macro events. *)
type nonrec action_trigger =
  | Cron of { schedule : schedule; timezone : string }
  | Events of { filters : event_filters }
  | Once of { at : string }
      (** Fires once at [at], or as soon as it is saved when [at] has passed. *)
  | Multiple of { triggers : routine_triggers }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let action_trigger_of_yojson : Yojson.Safe.t -> action_trigger =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "cron" ->
      Cron
        {
          schedule = Json.required fields "schedule" schedule_of_yojson;
          timezone = Json.required fields "timezone" Json.string;
        }
  | "events" ->
      Events
        { filters = Json.required fields "filters" event_filters_of_yojson }
  | "once" -> Once { at = Json.required fields "at" Json.string }
  | "multiple" ->
      Multiple
        {
          triggers = Json.required fields "triggers" routine_triggers_of_yojson;
        }
  | _ -> Json.unknown "action_trigger" json (Unknown json)

and yojson_of_action_trigger : action_trigger -> Yojson.Safe.t =
 fun value ->
  match value with
  | Cron case ->
      Json.record
        [
          ("type", Some (`String "cron"));
          ("schedule", Some (yojson_of_schedule case.schedule));
          ("timezone", Some (Json.of_string case.timezone));
        ]
  | Events case ->
      Json.record
        [
          ("type", Some (`String "events"));
          ("filters", Some (yojson_of_event_filters case.filters));
        ]
  | Once case ->
      Json.record
        [
          ("type", Some (`String "once")); ("at", Some (Json.of_string case.at));
        ]
  | Multiple case ->
      Json.record
        [
          ("type", Some (`String "multiple"));
          ("triggers", Some (yojson_of_routine_triggers case.triggers));
        ]
  | Unknown json -> json

let make_action_trigger_cron ~(schedule : schedule) ~(timezone : string) () =
  (Cron { schedule; timezone } : action_trigger)

let make_action_trigger_events ~(filters : event_filters) () =
  (Events { filters } : action_trigger)

let make_action_trigger_once ~(at : string) () = (Once { at } : action_trigger)

let make_action_trigger_multiple ~(triggers : routine_triggers) () =
  (Multiple { triggers } : action_trigger)

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

let action_configuration_of_yojson : Yojson.Safe.t -> action_configuration =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    enabled = Json.required fields "enabled" Json.bool;
    kind = Json.required fields "kind" action_kind_of_yojson;
    name = Json.required fields "name" Json.string;
    run_visibility =
      Json.optional fields "run_visibility" run_visibility_of_yojson;
    task = Json.required fields "task" routine_task_of_yojson;
    trigger = Json.required fields "trigger" action_trigger_of_yojson;
  }

and yojson_of_action_configuration : action_configuration -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("enabled", Some (Json.of_bool value.enabled));
      ("kind", Some (yojson_of_action_kind value.kind));
      ("name", Some (Json.of_string value.name));
      ( "run_visibility",
        Option.map yojson_of_run_visibility value.run_visibility );
      ("task", Some (yojson_of_routine_task value.task));
      ("trigger", Some (yojson_of_action_trigger value.trigger));
    ]

let make_action_configuration ?description ~(enabled : bool)
    ~(kind : action_kind) ~(name : string) ?run_visibility
    ~(task : routine_task) ~(trigger : action_trigger) () =
  ({ description; enabled; kind; name; run_visibility; task; trigger }
    : action_configuration)

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

let action_configuration_update_of_yojson :
    Yojson.Safe.t -> action_configuration_update =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    enabled = Json.optional fields "enabled" Json.bool;
    kind = Json.required fields "kind" action_kind_of_yojson;
    name = Json.required fields "name" Json.string;
    run_visibility =
      Json.optional fields "run_visibility" run_visibility_of_yojson;
    task = Json.required fields "task" routine_task_of_yojson;
    trigger = Json.required fields "trigger" action_trigger_of_yojson;
  }

and yojson_of_action_configuration_update :
    action_configuration_update -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("enabled", Option.map Json.of_bool value.enabled);
      ("kind", Some (yojson_of_action_kind value.kind));
      ("name", Some (Json.of_string value.name));
      ( "run_visibility",
        Option.map yojson_of_run_visibility value.run_visibility );
      ("task", Some (yojson_of_routine_task value.task));
      ("trigger", Some (yojson_of_action_trigger value.trigger));
    ]

let make_action_configuration_update ?description ?enabled ~(kind : action_kind)
    ~(name : string) ?run_visibility ~(task : routine_task)
    ~(trigger : action_trigger) () =
  ({ description; enabled; kind; name; run_visibility; task; trigger }
    : action_configuration_update)

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

let action_execution_record_of_yojson : Yojson.Safe.t -> action_execution_record
    =
 fun json ->
  let fields = Json.obj json in
  {
    action_id = Json.required fields "action_id" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    end_time = Json.required fields "end_time" Json.string;
    id = Json.optional fields "id" Json.string;
    is_success = Json.required fields "is_success" Json.bool;
    resource_id = Json.optional fields "resource_id" Json.string;
    result = Json.required fields "result" Json.json;
    start_time = Json.required fields "start_time" Json.string;
  }

and yojson_of_action_execution_record : action_execution_record -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("action_id", Some (Json.of_string value.action_id));
      ("created_at", Some (Json.of_string value.created_at));
      ("end_time", Some (Json.of_string value.end_time));
      ("id", Option.map Json.of_string value.id);
      ("is_success", Some (Json.of_bool value.is_success));
      ("resource_id", Option.map Json.of_string value.resource_id);
      ("result", Some (Json.of_json value.result));
      ("start_time", Some (Json.of_string value.start_time));
    ]

let make_action_execution_record ~(action_id : string) ~(created_at : string)
    ~(end_time : string) ?id ~(is_success : bool) ?resource_id
    ~(result : Yojson.Safe.t) ~(start_time : string) () =
  ({
     action_id;
     created_at;
     end_time;
     id;
     is_success;
     resource_id;
     result;
     start_time;
   }
    : action_execution_record)

type nonrec ai_admission_error_body = {
  code : string;  (** Stable denial or unavailability code. *)
  error : string;
      (** Human-readable explanation, without internal billing diagnostics. *)
}
(** Public admission error payload. Handlers with additional fields can reuse the
domain error's code and message and \[[admission_status]\]. *)

let ai_admission_error_body_of_yojson : Yojson.Safe.t -> ai_admission_error_body
    =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" Json.string;
    error = Json.required fields "error" Json.string;
  }

and yojson_of_ai_admission_error_body : ai_admission_error_body -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("code", Some (Json.of_string value.code));
      ("error", Some (Json.of_string value.error));
    ]

let make_ai_admission_error_body ~(code : string) ~(error : string) () =
  ({ code; error } : ai_admission_error_body)

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

let appearance_color_of_yojson : Yojson.Safe.t -> appearance_color =
 fun json ->
  match Json.string json with
  | "gray" -> Gray
  | "red" -> Red
  | "tomato" -> Tomato
  | "orange" -> Orange
  | "amber" -> Amber
  | "yellow" -> Yellow
  | "green" -> Green
  | "teal" -> Teal
  | "blue" -> Blue
  | "indigo" -> Indigo
  | "purple" -> Purple
  | "pink" -> Pink
  | other -> Json.unknown "appearance_color" json (Unknown other)

and yojson_of_appearance_color : appearance_color -> Yojson.Safe.t =
 fun value ->
  match value with
  | Gray -> `String "gray"
  | Red -> `String "red"
  | Tomato -> `String "tomato"
  | Orange -> `String "orange"
  | Amber -> `String "amber"
  | Yellow -> `String "yellow"
  | Green -> `String "green"
  | Teal -> `String "teal"
  | Blue -> `String "blue"
  | Indigo -> `String "indigo"
  | Purple -> `String "purple"
  | Pink -> `String "pink"
  | Unknown other -> `String other

(** The source of an entity's custom icon. *)
type nonrec appearance_icon =
  | Macro of { name : string  (** Catalog name without the SVG extension. *) }
      (** A stable name from Macro's original, distinct icon catalog. *)
  | Emoji of { value : string  (** Unicode emoji text, not markup or a URL. *) }
      (** A single native emoji, including skin-tone and joined sequences. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let appearance_icon_of_yojson : Yojson.Safe.t -> appearance_icon =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "macro" -> Macro { name = Json.required fields "name" Json.string }
  | "emoji" -> Emoji { value = Json.required fields "value" Json.string }
  | _ -> Json.unknown "appearance_icon" json (Unknown json)

and yojson_of_appearance_icon : appearance_icon -> Yojson.Safe.t =
 fun value ->
  match value with
  | Macro case ->
      Json.record
        [
          ("kind", Some (`String "macro"));
          ("name", Some (Json.of_string case.name));
        ]
  | Emoji case ->
      Json.record
        [
          ("kind", Some (`String "emoji"));
          ("value", Some (Json.of_string case.value));
        ]
  | Unknown json -> json

let make_appearance_icon_macro ~(name : string) () =
  (Macro { name } : appearance_icon)

let make_appearance_icon_emoji ~(value : string) () =
  (Emoji { value } : appearance_icon)

type nonrec attach_draft = {
  email_draft_id : string;
      (** The email draft: an unsent draft in one of the user's own inboxes, in
the thread the suggestion is about. *)
  reason : string;  (** Why, for the change log. *)
}
(** A reply draft a session wrote for an open reply suggestion, as the user,
through [macro.email.createDraft]. It replaces the suggestion's draft, if any;
nothing is ever sent. *)

let attach_draft_of_yojson : Yojson.Safe.t -> attach_draft =
 fun json ->
  let fields = Json.obj json in
  {
    email_draft_id = Json.required fields "emailDraftId" Json.string;
    reason = Json.required fields "reason" Json.string;
  }

and yojson_of_attach_draft : attach_draft -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("emailDraftId", Some (Json.of_string value.email_draft_id));
      ("reason", Some (Json.of_string value.reason));
    ]

let make_attach_draft ~(email_draft_id : string) ~(reason : string) () =
  ({ email_draft_id; reason } : attach_draft)

(** What a text knob's value names: one of its owner's items, which a client
matches by name or lets them pick. *)
type nonrec named_item_kind =
  | Tag
  | Channel
  | Label
  | Unknown of string  (** A value this SDK version does not know. *)

let named_item_kind_of_yojson : Yojson.Safe.t -> named_item_kind =
 fun json ->
  match Json.string json with
  | "tag" -> Tag
  | "channel" -> Channel
  | "label" -> Label
  | other -> Json.unknown "named_item_kind" json (Unknown other)

and yojson_of_named_item_kind : named_item_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Tag -> `String "tag"
  | Channel -> `String "channel"
  | Label -> `String "label"
  | Unknown other -> `String other

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

let surface_of_yojson : Yojson.Safe.t -> surface =
 fun json ->
  match Json.string json with
  | "email" -> Email
  | "calendar" -> Calendar
  | "tasks" -> Tasks
  | "files" -> Files
  | "crm" -> Crm
  | "chat" -> Chat
  | "calls" -> Calls
  | "reviews" -> Reviews
  | "agents" -> Agents
  | other -> Json.unknown "surface" json (Unknown other)

and yojson_of_surface : surface -> Yojson.Safe.t =
 fun value ->
  match value with
  | Email -> `String "email"
  | Calendar -> `String "calendar"
  | Tasks -> `String "tasks"
  | Files -> `String "files"
  | Crm -> `String "crm"
  | Chat -> `String "chat"
  | Calls -> `String "calls"
  | Reviews -> `String "reviews"
  | Agents -> `String "agents"
  | Unknown other -> `String other

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

let catalog_entry_of_yojson : Yojson.Safe.t -> catalog_entry =
 fun json ->
  let fields = Json.obj json in
  {
    action = Json.required fields "action" Json.string;
    affects_others = Json.required fields "affectsOthers" Json.bool;
    code = Json.optional fields "code" routine_step_of_yojson;
    description = Json.required fields "description" Json.string;
    instructions = Json.required fields "instructions" Json.string;
    key = Json.required fields "key" Json.string;
    named_knobs =
      Json.required fields "namedKnobs" (Json.map named_item_kind_of_yojson);
    request = Json.required fields "request" Json.string;
    safe_default = Json.required fields "safeDefault" Json.bool;
    suggest = Json.required fields "suggest" Json.bool;
    surfaces = Json.required fields "surfaces" (Json.list surface_of_yojson);
    template = Json.required fields "template" Json.bool;
    title = Json.required fields "title" Json.string;
    trigger = Json.required fields "trigger" action_trigger_of_yojson;
  }

and yojson_of_catalog_entry : catalog_entry -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("action", Some (Json.of_string value.action));
      ("affectsOthers", Some (Json.of_bool value.affects_others));
      ("code", Option.map yojson_of_routine_step value.code);
      ("description", Some (Json.of_string value.description));
      ("instructions", Some (Json.of_string value.instructions));
      ("key", Some (Json.of_string value.key));
      ( "namedKnobs",
        Some ((Json.of_map yojson_of_named_item_kind) value.named_knobs) );
      ("request", Some (Json.of_string value.request));
      ("safeDefault", Some (Json.of_bool value.safe_default));
      ("suggest", Some (Json.of_bool value.suggest));
      ("surfaces", Some ((Json.of_list yojson_of_surface) value.surfaces));
      ("template", Some (Json.of_bool value.template));
      ("title", Some (Json.of_string value.title));
      ("trigger", Some (yojson_of_action_trigger value.trigger));
    ]

let make_catalog_entry ~(action : string) ~(affects_others : bool) ?code
    ~(description : string) ~(instructions : string) ~(key : string)
    ~(named_knobs : (string * named_item_kind) list) ~(request : string)
    ~(safe_default : bool) ~(suggest : bool) ~(surfaces : surface list)
    ~(template : bool) ~(title : string) ~(trigger : action_trigger) () =
  ({
     action;
     affects_others;
     code;
     description;
     instructions;
     key;
     named_knobs;
     request;
     safe_default;
     suggest;
     surfaces;
     template;
     title;
     trigger;
   }
    : catalog_entry)

(** A filter on the feed. Not kinds: a suggestion may have several. *)
type nonrec category =
  | Important
  | Revisit
  | Save_money
  | Make_money
  | Unknown of string  (** A value this SDK version does not know. *)

let category_of_yojson : Yojson.Safe.t -> category =
 fun json ->
  match Json.string json with
  | "important" -> Important
  | "revisit" -> Revisit
  | "save_money" -> Save_money
  | "make_money" -> Make_money
  | other -> Json.unknown "category" json (Unknown other)

and yojson_of_category : category -> Yojson.Safe.t =
 fun value ->
  match value with
  | Important -> `String "important"
  | Revisit -> `String "revisit"
  | Save_money -> `String "save_money"
  | Make_money -> `String "make_money"
  | Unknown other -> `String other

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

let created_item_entity_type_of_yojson :
    Yojson.Safe.t -> created_item_entity_type =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "chat" -> Chat
  | "channel" -> Channel
  | "channel_message" -> Channel_message
  | "document" -> Document
  | "project" -> Project
  | "email_thread" -> Email_thread
  | "calendar_event" -> Calendar_event
  | "team" -> Team
  | "call" -> Call
  | "foreign_entity" -> Foreign_entity
  | "static_file" -> Static_file
  | "crm_company" -> Crm_company
  | "crm_contact" -> Crm_contact
  | "crm_pipeline" -> Crm_pipeline
  | "reminder" -> Reminder
  | "harness" -> Harness
  | "skill" -> Skill
  | "agent_session" -> Agent_session
  | "scheduled_action" -> Scheduled_action
  | "initiative" -> Initiative
  | "database" -> Database
  | "database_row" -> Database_row
  | "form" -> Form
  | "external_chat" -> External_chat
  | other -> Json.unknown "created_item_entity_type" json (Unknown other)

and yojson_of_created_item_entity_type :
    created_item_entity_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Chat -> `String "chat"
  | Channel -> `String "channel"
  | Channel_message -> `String "channel_message"
  | Document -> `String "document"
  | Project -> `String "project"
  | Email_thread -> `String "email_thread"
  | Calendar_event -> `String "calendar_event"
  | Team -> `String "team"
  | Call -> `String "call"
  | Foreign_entity -> `String "foreign_entity"
  | Static_file -> `String "static_file"
  | Crm_company -> `String "crm_company"
  | Crm_contact -> `String "crm_contact"
  | Crm_pipeline -> `String "crm_pipeline"
  | Reminder -> `String "reminder"
  | Harness -> `String "harness"
  | Skill -> `String "skill"
  | Agent_session -> `String "agent_session"
  | Scheduled_action -> `String "scheduled_action"
  | Initiative -> `String "initiative"
  | Database -> `String "database"
  | Database_row -> `String "database_row"
  | Form -> `String "form"
  | External_chat -> `String "external_chat"
  | Unknown other -> `String other

type nonrec created_item = {
  entity_id : string;  (** Its id. *)
  entity_type : created_item_entity_type;  (** What kind of item. *)
}
(** Something a routine draft's session created for the routine to use, such
as the database it writes to: it exists whether or not the routine is
saved. *)

let created_item_of_yojson : Yojson.Safe.t -> created_item =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entityId" Json.string;
    entity_type =
      Json.required fields "entityType" created_item_entity_type_of_yojson;
  }

and yojson_of_created_item : created_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entityId", Some (Json.of_string value.entity_id));
      ("entityType", Some (yojson_of_created_item_entity_type value.entity_type));
    ]

let make_created_item ~(entity_id : string)
    ~(entity_type : created_item_entity_type) () =
  ({ entity_id; entity_type } : created_item)

type nonrec check_routine_request = {
  created : created_item list option;
      (** What a routine draft's session created for the routine to use, such as
the database it writes to; kept with its draft for the person to see. *)
  routine : action_configuration;
}
(** A routine to check, as the create body takes it. *)

let check_routine_request_of_yojson : Yojson.Safe.t -> check_routine_request =
 fun json ->
  let fields = Json.obj json in
  {
    created = Json.optional fields "created" (Json.list created_item_of_yojson);
    routine = Json.required fields "routine" action_configuration_of_yojson;
  }

and yojson_of_check_routine_request : check_routine_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created", Option.map (Json.of_list yojson_of_created_item) value.created);
      ("routine", Some (yojson_of_action_configuration value.routine));
    ]

let make_check_routine_request ?created ~(routine : action_configuration) () =
  ({ created; routine } : check_routine_request)

(** Code written once, or Ask AI each run. *)
type nonrec step_kind =
  | Code
  | Agent
  | Unknown of string  (** A value this SDK version does not know. *)

let step_kind_of_yojson : Yojson.Safe.t -> step_kind =
 fun json ->
  match Json.string json with
  | "code" -> Code
  | "agent" -> Agent
  | other -> Json.unknown "step_kind" json (Unknown other)

and yojson_of_step_kind : step_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Code -> `String "code"
  | Agent -> `String "agent"
  | Unknown other -> `String other

type nonrec step_title = {
  kind : step_kind;
  title : string;  (** Its title; empty when it has none. *)
}
(** A step of a routine handed back. *)

let step_title_of_yojson : Yojson.Safe.t -> step_title =
 fun json ->
  let fields = Json.obj json in
  {
    kind = Json.required fields "kind" step_kind_of_yojson;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_step_title : step_title -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("kind", Some (yojson_of_step_kind value.kind));
      ("title", Some (Json.of_string value.title));
    ]

let make_step_title ~(kind : step_kind) ~(title : string) () =
  ({ kind; title } : step_title)

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

let check_summary_of_yojson : Yojson.Safe.t -> check_summary =
 fun json ->
  let fields = Json.obj json in
  {
    checks = Json.required fields "checks" Json.int;
    name = Json.required fields "name" Json.string;
    ok = Json.required fields "ok" Json.bool;
    problems = Json.required fields "problems" Json.int;
    steps = Json.required fields "steps" (Json.list step_title_of_yojson);
    trigger = Json.required fields "trigger" action_trigger_of_yojson;
  }

and yojson_of_check_summary : check_summary -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("checks", Some (Json.of_int value.checks));
      ("name", Some (Json.of_string value.name));
      ("ok", Some (Json.of_bool value.ok));
      ("problems", Some (Json.of_int value.problems));
      ("steps", Some ((Json.of_list yojson_of_step_title) value.steps));
      ("trigger", Some (yojson_of_action_trigger value.trigger));
    ]

let make_check_summary ~(checks : int) ~(name : string) ~(ok : bool)
    ~(problems : int) ~(steps : step_title list) ~(trigger : action_trigger) ()
    =
  ({ checks; name; ok; problems; steps; trigger } : check_summary)

type nonrec checked_step_problems = {
  index : int;  (** Its place among the routine's steps, from zero. *)
  problems : string list;
      (** What the type checker reports, first problems first. *)
  title : string;  (** Its title. *)
}
(** A code step that doesn't type-check. *)

let checked_step_problems_of_yojson : Yojson.Safe.t -> checked_step_problems =
 fun json ->
  let fields = Json.obj json in
  {
    index = Json.required fields "index" Json.int;
    problems = Json.required fields "problems" (Json.list Json.string);
    title = Json.required fields "title" Json.string;
  }

and yojson_of_checked_step_problems : checked_step_problems -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("index", Some (Json.of_int value.index));
      ("problems", Some ((Json.of_list Json.of_string) value.problems));
      ("title", Some (Json.of_string value.title));
    ]

let make_checked_step_problems ~(index : int) ~(problems : string list)
    ~(title : string) () =
  ({ index; problems; title } : checked_step_problems)

(** Who a routine's code steps write as. *)
type nonrec code_identity =
  | Agent
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

let code_identity_of_yojson : Yojson.Safe.t -> code_identity =
 fun json ->
  match Json.string json with
  | "agent" -> Agent
  | "owner" -> Owner
  | other -> Json.unknown "code_identity" json (Unknown other)

and yojson_of_code_identity : code_identity -> Yojson.Safe.t =
 fun value ->
  match value with
  | Agent -> `String "agent"
  | Owner -> `String "owner"
  | Unknown other -> `String other

(** How an upgrade went. *)
type nonrec upgrade_outcome =
  | Running
  | Checked
  | Rewritten
  | Needs_update
  | Unknown of string  (** A value this SDK version does not know. *)

let upgrade_outcome_of_yojson : Yojson.Safe.t -> upgrade_outcome =
 fun json ->
  match Json.string json with
  | "running" -> Running
  | "checked" -> Checked
  | "rewritten" -> Rewritten
  | "needs_update" -> Needs_update
  | other -> Json.unknown "upgrade_outcome" json (Unknown other)

and yojson_of_upgrade_outcome : upgrade_outcome -> Yojson.Safe.t =
 fun value ->
  match value with
  | Running -> `String "running"
  | Checked -> `String "checked"
  | Rewritten -> `String "rewritten"
  | Needs_update -> `String "needs_update"
  | Unknown other -> `String other

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

let code_upgrade_of_yojson : Yojson.Safe.t -> code_upgrade =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "createdAt" Json.string;
    from_sdk = Json.optional fields "fromSdk" Json.string;
    id = Json.required fields "id" Json.string;
    outcome = Json.required fields "outcome" upgrade_outcome_of_yojson;
    previous_task = Json.required fields "previousTask" routine_task_of_yojson;
    reason = Json.optional fields "reason" Json.string;
    task = Json.optional fields "task" routine_task_of_yojson;
    to_sdk = Json.required fields "toSdk" Json.string;
    updated_at = Json.required fields "updatedAt" Json.string;
  }

and yojson_of_code_upgrade : code_upgrade -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Some (Json.of_string value.created_at));
      ("fromSdk", Option.map Json.of_string value.from_sdk);
      ("id", Some (Json.of_string value.id));
      ("outcome", Some (yojson_of_upgrade_outcome value.outcome));
      ("previousTask", Some (yojson_of_routine_task value.previous_task));
      ("reason", Option.map Json.of_string value.reason);
      ("task", Option.map yojson_of_routine_task value.task);
      ("toSdk", Some (Json.of_string value.to_sdk));
      ("updatedAt", Some (Json.of_string value.updated_at));
    ]

let make_code_upgrade ~(created_at : string) ?from_sdk ~(id : string)
    ~(outcome : upgrade_outcome) ~(previous_task : routine_task) ?reason ?task
    ~(to_sdk : string) ~(updated_at : string) () =
  ({
     created_at;
     from_sdk;
     id;
     outcome;
     previous_task;
     reason;
     task;
     to_sdk;
     updated_at;
   }
    : code_upgrade)

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

let condition_result_of_yojson : Yojson.Safe.t -> condition_result =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "status" with
  | "not_met" ->
      Not_met { probability = Json.required fields "probability" Json.float }
  | "unavailable" -> Unavailable
  | _ -> Json.unknown "condition_result" json (Unknown json)

and yojson_of_condition_result : condition_result -> Yojson.Safe.t =
 fun value ->
  match value with
  | Not_met case ->
      Json.record
        [
          ("status", Some (`String "not_met"));
          ("probability", Some (Json.of_float case.probability));
        ]
  | Unavailable -> Json.record [ ("status", Some (`String "unavailable")) ]
  | Unknown json -> json

let make_condition_result_not_met ~(probability : float) () =
  (Not_met { probability } : condition_result)

type nonrec created_routine = { id : string; name : string }
(** A routine a run created, as that run's history names it. *)

let created_routine_of_yojson : Yojson.Safe.t -> created_routine =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_created_routine : created_routine -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
    ]

let make_created_routine ~(id : string) ~(name : string) () =
  ({ id; name } : created_routine)

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

let draft_created_entity_type_of_yojson :
    Yojson.Safe.t -> draft_created_entity_type =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "chat" -> Chat
  | "channel" -> Channel
  | "channel_message" -> Channel_message
  | "document" -> Document
  | "project" -> Project
  | "email_thread" -> Email_thread
  | "calendar_event" -> Calendar_event
  | "team" -> Team
  | "call" -> Call
  | "foreign_entity" -> Foreign_entity
  | "static_file" -> Static_file
  | "crm_company" -> Crm_company
  | "crm_contact" -> Crm_contact
  | "crm_pipeline" -> Crm_pipeline
  | "reminder" -> Reminder
  | "harness" -> Harness
  | "skill" -> Skill
  | "agent_session" -> Agent_session
  | "scheduled_action" -> Scheduled_action
  | "initiative" -> Initiative
  | "database" -> Database
  | "database_row" -> Database_row
  | "form" -> Form
  | "external_chat" -> External_chat
  | other -> Json.unknown "draft_created_entity_type" json (Unknown other)

and yojson_of_draft_created_entity_type :
    draft_created_entity_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Chat -> `String "chat"
  | Channel -> `String "channel"
  | Channel_message -> `String "channel_message"
  | Document -> `String "document"
  | Project -> `String "project"
  | Email_thread -> `String "email_thread"
  | Calendar_event -> `String "calendar_event"
  | Team -> `String "team"
  | Call -> `String "call"
  | Foreign_entity -> `String "foreign_entity"
  | Static_file -> `String "static_file"
  | Crm_company -> `String "crm_company"
  | Crm_contact -> `String "crm_contact"
  | Crm_pipeline -> `String "crm_pipeline"
  | Reminder -> `String "reminder"
  | Harness -> `String "harness"
  | Skill -> `String "skill"
  | Agent_session -> `String "agent_session"
  | Scheduled_action -> `String "scheduled_action"
  | Initiative -> `String "initiative"
  | Database -> `String "database"
  | Database_row -> `String "database_row"
  | Form -> `String "form"
  | External_chat -> `String "external_chat"
  | Unknown other -> `String other

type nonrec draft_created = {
  entity_id : string;  (** Its id. *)
  entity_type : draft_created_entity_type;  (** What kind of item. *)
  used : bool;
      (** Whether the drafted routine uses it. One it doesn't use was made for
nothing, or is the routine's own work done early. *)
}
(** Something a draft's session created. It exists whether or not the draft
is saved. *)

let draft_created_of_yojson : Yojson.Safe.t -> draft_created =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entityId" Json.string;
    entity_type =
      Json.required fields "entityType" draft_created_entity_type_of_yojson;
    used = Json.required fields "used" Json.bool;
  }

and yojson_of_draft_created : draft_created -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entityId", Some (Json.of_string value.entity_id));
      ( "entityType",
        Some (yojson_of_draft_created_entity_type value.entity_type) );
      ("used", Some (Json.of_bool value.used));
    ]

let make_draft_created ~(entity_id : string)
    ~(entity_type : draft_created_entity_type) ~(used : bool) () =
  ({ entity_id; entity_type; used } : draft_created)

type nonrec step_problem = {
  index : int;  (** Its place among the steps, from zero. *)
  problems : string list;
}
(** A drafted step whose code still fails the type checker. *)

let step_problem_of_yojson : Yojson.Safe.t -> step_problem =
 fun json ->
  let fields = Json.obj json in
  {
    index = Json.required fields "index" Json.int;
    problems = Json.required fields "problems" (Json.list Json.string);
  }

and yojson_of_step_problem : step_problem -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("index", Some (Json.of_int value.index));
      ("problems", Some ((Json.of_list Json.of_string) value.problems));
    ]

let make_step_problem ~(index : int) ~(problems : string list) () =
  ({ index; problems } : step_problem)

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

let drafted_routine_of_yojson : Yojson.Safe.t -> drafted_routine =
 fun json ->
  let fields = Json.obj json in
  {
    created = Json.required fields "created" (Json.list draft_created_of_yojson);
    name = Json.required fields "name" Json.string;
    problems =
      Json.required fields "problems" (Json.list step_problem_of_yojson);
    steps = Json.required fields "steps" (Json.list routine_step_of_yojson);
    trigger = Json.optional fields "trigger" action_trigger_of_yojson;
  }

and yojson_of_drafted_routine : drafted_routine -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created", Some ((Json.of_list yojson_of_draft_created) value.created));
      ("name", Some (Json.of_string value.name));
      ("problems", Some ((Json.of_list yojson_of_step_problem) value.problems));
      ("steps", Some ((Json.of_list yojson_of_routine_step) value.steps));
      ("trigger", Option.map yojson_of_action_trigger value.trigger);
    ]

let make_drafted_routine ~(created : draft_created list) ~(name : string)
    ~(problems : step_problem list) ~(steps : routine_step list) ?trigger () =
  ({ created; name; problems; steps; trigger } : drafted_routine)

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

let drafted_step_of_yojson : Yojson.Safe.t -> drafted_step =
 fun json ->
  let fields = Json.obj json in
  {
    created = Json.required fields "created" (Json.list draft_created_of_yojson);
    problems = Json.required fields "problems" (Json.list Json.string);
    reason = Json.required fields "reason" Json.string;
    step = Json.required fields "step" routine_step_of_yojson;
  }

and yojson_of_drafted_step : drafted_step -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created", Some ((Json.of_list yojson_of_draft_created) value.created));
      ("problems", Some ((Json.of_list Json.of_string) value.problems));
      ("reason", Some (Json.of_string value.reason));
      ("step", Some (yojson_of_routine_step value.step));
    ]

let make_drafted_step ~(created : draft_created list) ~(problems : string list)
    ~(reason : string) ~(step : routine_step) () =
  ({ created; problems; reason; step } : drafted_step)

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

let draft_of_yojson : Yojson.Safe.t -> draft =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "outcome" with
  | "routine" -> Routine (drafted_routine_of_yojson json)
  | "step" -> Step (drafted_step_of_yojson json)
  | "failed" ->
      Failed
        {
          created =
            Json.optional fields "created" (Json.list draft_created_of_yojson);
          message = Json.required fields "message" Json.string;
        }
  | _ -> Json.unknown "draft" json (Unknown json)

and yojson_of_draft : draft -> Yojson.Safe.t =
 fun value ->
  match value with
  | Routine inner ->
      Json.with_tag "outcome" "routine" (yojson_of_drafted_routine inner)
  | Step inner -> Json.with_tag "outcome" "step" (yojson_of_drafted_step inner)
  | Failed case ->
      Json.record
        [
          ("outcome", Some (`String "failed"));
          ( "created",
            Option.map (Json.of_list yojson_of_draft_created) case.created );
          ("message", Some (Json.of_string case.message));
        ]
  | Unknown json -> json

let make_draft_failed ?created ~(message : string) () =
  (Failed { created; message } : draft)

(** What kind of draft was asked for. *)
type nonrec draft_kind =
  | Routine
  | Add_step
  | Change_step
  | Unknown of string  (** A value this SDK version does not know. *)

let draft_kind_of_yojson : Yojson.Safe.t -> draft_kind =
 fun json ->
  match Json.string json with
  | "routine" -> Routine
  | "add_step" -> Add_step
  | "change_step" -> Change_step
  | other -> Json.unknown "draft_kind" json (Unknown other)

and yojson_of_draft_kind : draft_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Routine -> `String "routine"
  | Add_step -> `String "add_step"
  | Change_step -> `String "change_step"
  | Unknown other -> `String other

type nonrec draft_asked = {
  description : string;
      (** The words they typed: the description, or the change asked for. *)
  kind : draft_kind;
}
(** What a job was asked to draft, as its owner reads it back: the kind of
request and the words they typed, nothing it was sent with them. *)

let draft_asked_of_yojson : Yojson.Safe.t -> draft_asked =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.required fields "description" Json.string;
    kind = Json.required fields "kind" draft_kind_of_yojson;
  }

and yojson_of_draft_asked : draft_asked -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Some (Json.of_string value.description));
      ("kind", Some (yojson_of_draft_kind value.kind));
    ]

let make_draft_asked ~(description : string) ~(kind : draft_kind) () =
  ({ description; kind } : draft_asked)

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

let draft_context_of_yojson : Yojson.Safe.t -> draft_context =
 fun json ->
  let fields = Json.obj json in
  {
    agent_model = Json.required fields "agentModel" Json.string;
    code = Json.optional fields "code" Json.bool;
    conditions = Json.optional fields "conditions" Json.bool;
    timezone = Json.required fields "timezone" Json.string;
  }

and yojson_of_draft_context : draft_context -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("agentModel", Some (Json.of_string value.agent_model));
      ("code", Option.map Json.of_bool value.code);
      ("conditions", Option.map Json.of_bool value.conditions);
      ("timezone", Some (Json.of_string value.timezone));
    ]

let make_draft_context ~(agent_model : string) ?code ?conditions
    ~(timezone : string) () =
  ({ agent_model; code; conditions; timezone } : draft_context)

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

let draft_job_state_of_yojson : Yojson.Safe.t -> draft_job_state =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "state" with
  | "drafting" -> Drafting
  | "ready" ->
      Ready
        {
          draft = Json.required fields "draft" draft_of_yojson;
          finished_at = Json.required fields "finishedAt" Json.string;
        }
  | "failed" ->
      Failed
        {
          created =
            Json.required fields "created" (Json.list draft_created_of_yojson);
          finished_at = Json.required fields "finishedAt" Json.string;
          message = Json.required fields "message" Json.string;
        }
  | _ -> Json.unknown "draft_job_state" json (Unknown json)

and yojson_of_draft_job_state : draft_job_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Drafting -> Json.record [ ("state", Some (`String "drafting")) ]
  | Ready case ->
      Json.record
        [
          ("state", Some (`String "ready"));
          ("draft", Some (yojson_of_draft case.draft));
          ("finishedAt", Some (Json.of_string case.finished_at));
        ]
  | Failed case ->
      Json.record
        [
          ("state", Some (`String "failed"));
          ("created", Some ((Json.of_list yojson_of_draft_created) case.created));
          ("finishedAt", Some (Json.of_string case.finished_at));
          ("message", Some (Json.of_string case.message));
        ]
  | Unknown json -> json

let make_draft_job_state_ready ~(draft : draft) ~(finished_at : string) () =
  (Ready { draft; finished_at } : draft_job_state)

let make_draft_job_state_failed ~(created : draft_created list)
    ~(finished_at : string) ~(message : string) () =
  (Failed { created; finished_at; message } : draft_job_state)

(** The stage a draft is at. *)
type nonrec draft_stage =
  | Started
  | Found
  | Writing
  | Checked
  | Fixing
  | Unknown of string  (** A value this SDK version does not know. *)

let draft_stage_of_yojson : Yojson.Safe.t -> draft_stage =
 fun json ->
  match Json.string json with
  | "started" -> Started
  | "found" -> Found
  | "writing" -> Writing
  | "checked" -> Checked
  | "fixing" -> Fixing
  | other -> Json.unknown "draft_stage" json (Unknown other)

and yojson_of_draft_stage : draft_stage -> Yojson.Safe.t =
 fun value ->
  match value with
  | Started -> `String "started"
  | Found -> `String "found"
  | Writing -> `String "writing"
  | Checked -> `String "checked"
  | Fixing -> `String "fixing"
  | Unknown other -> `String other

type nonrec draft_job_progress = {
  check : check_summary option;
  found : int option;
      (** How many items the words name were found; absent before they were
looked up. *)
  stage : draft_stage;
}
(** How far a draft has got: its latest stage, and what it reported on the
way. *)

let draft_job_progress_of_yojson : Yojson.Safe.t -> draft_job_progress =
 fun json ->
  let fields = Json.obj json in
  {
    check = Json.optional fields "check" check_summary_of_yojson;
    found = Json.optional fields "found" Json.int;
    stage = Json.required fields "stage" draft_stage_of_yojson;
  }

and yojson_of_draft_job_progress : draft_job_progress -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("check", Option.map yojson_of_check_summary value.check);
      ("found", Option.map Json.of_int value.found);
      ("stage", Some (yojson_of_draft_stage value.stage));
    ]

let make_draft_job_progress ?check ?found ~(stage : draft_stage) () =
  ({ check; found; stage } : draft_job_progress)

type nonrec draft_job = {
  draft_job_state : draft_job_state;
  created_at : string;
  id : string;  (** Its id: its hidden session's. *)
  progress : draft_job_progress;
  request : draft_asked;
}
(** A background draft, as its owner reads it. *)

let draft_job_of_yojson : Yojson.Safe.t -> draft_job =
 fun json ->
  let fields = Json.obj json in
  {
    draft_job_state = draft_job_state_of_yojson json;
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    progress = Json.required fields "progress" draft_job_progress_of_yojson;
    request = Json.required fields "request" draft_asked_of_yojson;
  }

and yojson_of_draft_job : draft_job -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("createdAt", Some (Json.of_string value.created_at));
          ("id", Some (Json.of_string value.id));
          ("progress", Some (yojson_of_draft_job_progress value.progress));
          ("request", Some (yojson_of_draft_asked value.request));
        ];
      yojson_of_draft_job_state value.draft_job_state;
    ]

let make_draft_job ~(draft_job_state : draft_job_state) ~(created_at : string)
    ~(id : string) ~(progress : draft_job_progress) ~(request : draft_asked) ()
    =
  ({ draft_job_state; created_at; id; progress; request } : draft_job)

type nonrec routine_so_far = {
  steps : routine_step list;
      (** Its steps, in the shape a routine's task holds them. *)
  trigger : Yojson.Safe.t option;
      (** Its trigger as it would be saved, for AI to read; absent while it has none. *)
}
(** The routine a step is added to or changed in. *)

let routine_so_far_of_yojson : Yojson.Safe.t -> routine_so_far =
 fun json ->
  let fields = Json.obj json in
  {
    steps = Json.required fields "steps" (Json.list routine_step_of_yojson);
    trigger = Json.optional fields "trigger" Json.json;
  }

and yojson_of_routine_so_far : routine_so_far -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("steps", Some ((Json.of_list yojson_of_routine_step) value.steps));
      ("trigger", Option.map Json.of_json value.trigger);
    ]

let make_routine_so_far ~(steps : routine_step list) ?trigger () =
  ({ steps; trigger } : routine_so_far)

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

let draft_request_of_yojson : Yojson.Safe.t -> draft_request =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "routine" ->
      Routine { description = Json.required fields "description" Json.string }
  | "add_step" ->
      Add_step
        {
          description = Json.required fields "description" Json.string;
          kind = Json.optional fields "kind" step_kind_of_yojson;
          routine = Json.required fields "routine" routine_so_far_of_yojson;
        }
  | "change_step" ->
      Change_step
        {
          index = Json.required fields "index" Json.int;
          instruction = Json.required fields "instruction" Json.string;
          routine = Json.required fields "routine" routine_so_far_of_yojson;
        }
  | _ -> Json.unknown "draft_request" json (Unknown json)

and yojson_of_draft_request : draft_request -> Yojson.Safe.t =
 fun value ->
  match value with
  | Routine case ->
      Json.record
        [
          ("type", Some (`String "routine"));
          ("description", Some (Json.of_string case.description));
        ]
  | Add_step case ->
      Json.record
        [
          ("type", Some (`String "add_step"));
          ("description", Some (Json.of_string case.description));
          ("kind", Option.map yojson_of_step_kind case.kind);
          ("routine", Some (yojson_of_routine_so_far case.routine));
        ]
  | Change_step case ->
      Json.record
        [
          ("type", Some (`String "change_step"));
          ("index", Some (Json.of_int case.index));
          ("instruction", Some (Json.of_string case.instruction));
          ("routine", Some (yojson_of_routine_so_far case.routine));
        ]
  | Unknown json -> json

let make_draft_request_routine ~(description : string) () =
  (Routine { description } : draft_request)

let make_draft_request_add_step ~(description : string) ?kind
    ~(routine : routine_so_far) () =
  (Add_step { description; kind; routine } : draft_request)

let make_draft_request_change_step ~(index : int) ~(instruction : string)
    ~(routine : routine_so_far) () =
  (Change_step { index; instruction; routine } : draft_request)

type nonrec draft_routine_request = {
  context : draft_context;
  draft : draft_request;
}
(** What to draft, and what the drafter may write and name. *)

let draft_routine_request_of_yojson : Yojson.Safe.t -> draft_routine_request =
 fun json ->
  let fields = Json.obj json in
  {
    context = Json.required fields "context" draft_context_of_yojson;
    draft = Json.required fields "draft" draft_request_of_yojson;
  }

and yojson_of_draft_routine_request : draft_routine_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("context", Some (yojson_of_draft_context value.context));
      ("draft", Some (yojson_of_draft_request value.draft));
    ]

let make_draft_routine_request ~(context : draft_context)
    ~(draft : draft_request) () =
  ({ context; draft } : draft_routine_request)

(** Where a background draft is now; [removed] once cancelled or discarded. *)
type nonrec draft_update_state =
  | Drafting
  | Ready
  | Failed
  | Removed
  | Unknown of string  (** A value this SDK version does not know. *)

let draft_update_state_of_yojson : Yojson.Safe.t -> draft_update_state =
 fun json ->
  match Json.string json with
  | "drafting" -> Drafting
  | "ready" -> Ready
  | "failed" -> Failed
  | "removed" -> Removed
  | other -> Json.unknown "draft_update_state" json (Unknown other)

and yojson_of_draft_update_state : draft_update_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Drafting -> `String "drafting"
  | Ready -> `String "ready"
  | Failed -> `String "failed"
  | Removed -> `String "removed"
  | Unknown other -> `String other

type nonrec draft_update = {
  draft_id : string;
  progress : draft_job_progress;
  state : draft_update_state;
}
(** How a background draft is going, for its owner's open apps. *)

let draft_update_of_yojson : Yojson.Safe.t -> draft_update =
 fun json ->
  let fields = Json.obj json in
  {
    draft_id = Json.required fields "draftId" Json.string;
    progress = Json.required fields "progress" draft_job_progress_of_yojson;
    state = Json.required fields "state" draft_update_state_of_yojson;
  }

and yojson_of_draft_update : draft_update -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("draftId", Some (Json.of_string value.draft_id));
      ("progress", Some (yojson_of_draft_job_progress value.progress));
      ("state", Some (yojson_of_draft_update_state value.state));
    ]

let make_draft_update ~(draft_id : string) ~(progress : draft_job_progress)
    ~(state : draft_update_state) () =
  ({ draft_id; progress; state } : draft_update)

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

let empty_response_of_yojson : Yojson.Safe.t -> empty_response =
 fun json -> Json.json json

and yojson_of_empty_response : empty_response -> Yojson.Safe.t =
 fun value -> Json.of_json value

(** What an entity suggestion suggests doing about its items. *)
type nonrec entity_action =
  | Reply
  | Review
  | Follow_up
  | Unknown of string  (** A value this SDK version does not know. *)

let entity_action_of_yojson : Yojson.Safe.t -> entity_action =
 fun json ->
  match Json.string json with
  | "reply" -> Reply
  | "review" -> Review
  | "follow_up" -> Follow_up
  | other -> Json.unknown "entity_action" json (Unknown other)

and yojson_of_entity_action : entity_action -> Yojson.Safe.t =
 fun value ->
  match value with
  | Reply -> `String "reply"
  | Review -> `String "review"
  | Follow_up -> `String "follow_up"
  | Unknown other -> `String other

type nonrec entity_appearance = {
  color : appearance_color option;
  icon : appearance_icon option;
}
(** An entity's optional icon and tint overrides; absent values retain type defaults. *)

let entity_appearance_of_yojson : Yojson.Safe.t -> entity_appearance =
 fun json ->
  let fields = Json.obj json in
  {
    color = Json.optional fields "color" appearance_color_of_yojson;
    icon = Json.optional fields "icon" appearance_icon_of_yojson;
  }

and yojson_of_entity_appearance : entity_appearance -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("color", Option.map yojson_of_appearance_color value.color);
      ("icon", Option.map yojson_of_appearance_icon value.icon);
    ]

let make_entity_appearance ?color ?icon () =
  ({ color; icon } : entity_appearance)

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

let entity_type_of_yojson : Yojson.Safe.t -> entity_type =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "chat" -> Chat
  | "channel" -> Channel
  | "channel_message" -> Channel_message
  | "document" -> Document
  | "project" -> Project
  | "email_thread" -> Email_thread
  | "calendar_event" -> Calendar_event
  | "team" -> Team
  | "call" -> Call
  | "foreign_entity" -> Foreign_entity
  | "static_file" -> Static_file
  | "crm_company" -> Crm_company
  | "crm_contact" -> Crm_contact
  | "crm_pipeline" -> Crm_pipeline
  | "reminder" -> Reminder
  | "harness" -> Harness
  | "skill" -> Skill
  | "agent_session" -> Agent_session
  | "scheduled_action" -> Scheduled_action
  | "initiative" -> Initiative
  | "database" -> Database
  | "database_row" -> Database_row
  | "form" -> Form
  | "external_chat" -> External_chat
  | other -> Json.unknown "entity_type" json (Unknown other)

and yojson_of_entity_type : entity_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Chat -> `String "chat"
  | Channel -> `String "channel"
  | Channel_message -> `String "channel_message"
  | Document -> `String "document"
  | Project -> `String "project"
  | Email_thread -> `String "email_thread"
  | Calendar_event -> `String "calendar_event"
  | Team -> `String "team"
  | Call -> `String "call"
  | Foreign_entity -> `String "foreign_entity"
  | Static_file -> `String "static_file"
  | Crm_company -> `String "crm_company"
  | Crm_contact -> `String "crm_contact"
  | Crm_pipeline -> `String "crm_pipeline"
  | Reminder -> `String "reminder"
  | Harness -> `String "harness"
  | Skill -> `String "skill"
  | Agent_session -> `String "agent_session"
  | Scheduled_action -> `String "scheduled_action"
  | Initiative -> `String "initiative"
  | Database -> `String "database"
  | Database_row -> `String "database_row"
  | Form -> `String "form"
  | External_chat -> `String "external_chat"
  | Unknown other -> `String other

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

let execution_record_response_of_yojson :
    Yojson.Safe.t -> execution_record_response =
 fun json ->
  let fields = Json.obj json in
  {
    action_id = Json.required fields "action_id" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    end_time = Json.required fields "end_time" Json.string;
    id = Json.optional fields "id" Json.string;
    is_success = Json.required fields "is_success" Json.bool;
    resource_id = Json.optional fields "resource_id" Json.string;
    result = Json.required fields "result" Json.json;
    start_time = Json.required fields "start_time" Json.string;
    created =
      Json.optional fields "created" (Json.list created_routine_of_yojson);
  }

and yojson_of_execution_record_response :
    execution_record_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("action_id", Some (Json.of_string value.action_id));
      ("created_at", Some (Json.of_string value.created_at));
      ("end_time", Some (Json.of_string value.end_time));
      ("id", Option.map Json.of_string value.id);
      ("is_success", Some (Json.of_bool value.is_success));
      ("resource_id", Option.map Json.of_string value.resource_id);
      ("result", Some (Json.of_json value.result));
      ("start_time", Some (Json.of_string value.start_time));
      ( "created",
        Option.map (Json.of_list yojson_of_created_routine) value.created );
    ]

let make_execution_record_response ~(action_id : string) ~(created_at : string)
    ~(end_time : string) ?id ~(is_success : bool) ?resource_id
    ~(result : Yojson.Safe.t) ~(start_time : string) ?created () =
  ({
     action_id;
     created_at;
     end_time;
     id;
     is_success;
     resource_id;
     result;
     start_time;
     created;
   }
    : execution_record_response)

(** Closed set of transcript destinations understood by routine clients. *)
type nonrec execution_resource_type =
  | Chat
  | Agent
  | Unknown of string  (** A value this SDK version does not know. *)

let execution_resource_type_of_yojson : Yojson.Safe.t -> execution_resource_type
    =
 fun json ->
  match Json.string json with
  | "chat" -> Chat
  | "agent" -> Agent
  | other -> Json.unknown "execution_resource_type" json (Unknown other)

and yojson_of_execution_resource_type : execution_resource_type -> Yojson.Safe.t
    =
 fun value ->
  match value with
  | Chat -> `String "chat"
  | Agent -> `String "agent"
  | Unknown other -> `String other

type nonrec execution_resource = {
  id : string;
  type_ : execution_resource_type;
}
(** Transcript resource created by a run. Never infer this from current task configuration. *)

let execution_resource_of_yojson : Yojson.Safe.t -> execution_resource =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" Json.string;
    type_ = Json.required fields "type" execution_resource_type_of_yojson;
  }

and yojson_of_execution_resource : execution_resource -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (Json.of_string value.id));
      ("type", Some (yojson_of_execution_resource_type value.type_));
    ]

let make_execution_resource ~(id : string) ~(type_ : execution_resource_type) ()
    =
  ({ id; type_ } : execution_resource)

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

let run_start_of_yojson : Yojson.Safe.t -> run_start =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "schedule" ->
      Schedule
        {
          schedule = Json.required fields "schedule" Json.string;
          timezone = Json.required fields "timezone" Json.string;
        }
  | "event" ->
      Event
        {
          entity_id = Json.optional fields "entity_id" Json.string;
          event = Json.required fields "event" Json.string;
        }
  | "manual" -> Manual { by = Json.required fields "by" Json.string }
  | _ -> Json.unknown "run_start" json (Unknown json)

and yojson_of_run_start : run_start -> Yojson.Safe.t =
 fun value ->
  match value with
  | Schedule case ->
      Json.record
        [
          ("kind", Some (`String "schedule"));
          ("schedule", Some (Json.of_string case.schedule));
          ("timezone", Some (Json.of_string case.timezone));
        ]
  | Event case ->
      Json.record
        [
          ("kind", Some (`String "event"));
          ("entity_id", Option.map Json.of_string case.entity_id);
          ("event", Some (Json.of_string case.event));
        ]
  | Manual case ->
      Json.record
        [
          ("kind", Some (`String "manual"));
          ("by", Some (Json.of_string case.by));
        ]
  | Unknown json -> json

let make_run_start_schedule ~(schedule : string) ~(timezone : string) () =
  (Schedule { schedule; timezone } : run_start)

let make_run_start_event ?entity_id ~(event : string) () =
  (Event { entity_id; event } : run_start)

let make_run_start_manual ~(by : string) () = (Manual { by } : run_start)

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

let run_info_of_yojson : Yojson.Safe.t -> run_info =
 fun json ->
  let fields = Json.obj json in
  {
    at = Json.required fields "at" Json.string;
    code_acts_as = Json.optional fields "code_acts_as" code_identity_of_yojson;
    previous_at = Json.optional fields "previous_at" Json.string;
    started_by = Json.required fields "started_by" run_start_of_yojson;
    timezone = Json.optional fields "timezone" Json.string;
  }

and yojson_of_run_info : run_info -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("at", Some (Json.of_string value.at));
      ("code_acts_as", Option.map yojson_of_code_identity value.code_acts_as);
      ("previous_at", Option.map Json.of_string value.previous_at);
      ("started_by", Some (yojson_of_run_start value.started_by));
      ("timezone", Option.map Json.of_string value.timezone);
    ]

let make_run_info ~(at : string) ?code_acts_as ?previous_at
    ~(started_by : run_start) ?timezone () =
  ({ at; code_acts_as; previous_at; started_by; timezone } : run_info)

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

let execution_result_of_yojson : Yojson.Safe.t -> execution_result =
 fun json ->
  let fields = Json.obj json in
  {
    condition = Json.optional fields "condition" condition_result_of_yojson;
    configuration_revision =
      Json.optional fields "configuration_revision" Json.int64;
    error = Json.optional fields "error" Json.string;
    resource = Json.optional fields "resource" execution_resource_of_yojson;
    run = Json.optional fields "run" run_info_of_yojson;
    steps = Json.optional fields "steps" (Json.list Json.json);
    version = Json.required fields "version" Json.int;
  }

and yojson_of_execution_result : execution_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("condition", Option.map yojson_of_condition_result value.condition);
      ( "configuration_revision",
        Option.map Json.of_int64 value.configuration_revision );
      ("error", Option.map Json.of_string value.error);
      ("resource", Option.map yojson_of_execution_resource value.resource);
      ("run", Option.map yojson_of_run_info value.run);
      ("steps", Option.map (Json.of_list Json.of_json) value.steps);
      ("version", Some (Json.of_int value.version));
    ]

let make_execution_result ?condition ?configuration_revision ?error ?resource
    ?run ?steps ~(version : int) () =
  ({ condition; configuration_revision; error; resource; run; steps; version }
    : execution_result)

type nonrec feed_counts = {
  done_ : int;  (** Done in the last 24 hours. *)
  failed : int;  (** Their last run failed. *)
  open_ : int;  (** Open, nothing under way. *)
  running : int;  (** Their run is under way. *)
}
(** How many of a person's shown suggestions have each status. *)

let feed_counts_of_yojson : Yojson.Safe.t -> feed_counts =
 fun json ->
  let fields = Json.obj json in
  {
    done_ = Json.required fields "done" Json.int;
    failed = Json.required fields "failed" Json.int;
    open_ = Json.required fields "open" Json.int;
    running = Json.required fields "running" Json.int;
  }

and yojson_of_feed_counts : feed_counts -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("done", Some (Json.of_int value.done_));
      ("failed", Some (Json.of_int value.failed));
      ("open", Some (Json.of_int value.open_));
      ("running", Some (Json.of_int value.running));
    ]

let make_feed_counts ~(done_ : int) ~(failed : int) ~(open_ : int)
    ~(running : int) () =
  ({ done_; failed; open_; running } : feed_counts)

(** Where a generation is. *)
type nonrec suggestion_generation_status =
  | Generating
  | Ready
  | Partial
  | Failed
  | Cancelled
  | Interrupted
  | Unknown of string  (** A value this SDK version does not know. *)

let suggestion_generation_status_of_yojson :
    Yojson.Safe.t -> suggestion_generation_status =
 fun json ->
  match Json.string json with
  | "generating" -> Generating
  | "ready" -> Ready
  | "partial" -> Partial
  | "failed" -> Failed
  | "cancelled" -> Cancelled
  | "interrupted" -> Interrupted
  | other -> Json.unknown "suggestion_generation_status" json (Unknown other)

and yojson_of_suggestion_generation_status :
    suggestion_generation_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Generating -> `String "generating"
  | Ready -> `String "ready"
  | Partial -> `String "partial"
  | Failed -> `String "failed"
  | Cancelled -> `String "cancelled"
  | Interrupted -> `String "interrupted"
  | Unknown other -> `String other

(** Whether one of the person's generations is running. *)
type nonrec generation_state =
  | Idle
  | Running
  | Unknown of string  (** A value this SDK version does not know. *)

let generation_state_of_yojson : Yojson.Safe.t -> generation_state =
 fun json ->
  match Json.string json with
  | "idle" -> Idle
  | "running" -> Running
  | other -> Json.unknown "generation_state" json (Unknown other)

and yojson_of_generation_state : generation_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Idle -> `String "idle"
  | Running -> `String "running"
  | Unknown other -> `String other

(** What starts a generation: a person finishing onboarding, their night, or
the person asking for fresh suggestions. Shared by everything a
generation's sessions write. *)
type nonrec generation_trigger =
  | Onboarding
  | Nightly
  | Manual
  | Unknown of string  (** A value this SDK version does not know. *)

let generation_trigger_of_yojson : Yojson.Safe.t -> generation_trigger =
 fun json ->
  match Json.string json with
  | "onboarding" -> Onboarding
  | "nightly" -> Nightly
  | "manual" -> Manual
  | other -> Json.unknown "generation_trigger" json (Unknown other)

and yojson_of_generation_trigger : generation_trigger -> Yojson.Safe.t =
 fun value ->
  match value with
  | Onboarding -> `String "onboarding"
  | Nightly -> `String "nightly"
  | Manual -> `String "manual"
  | Unknown other -> `String other

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

let generation_overview_of_yojson : Yojson.Safe.t -> generation_overview =
 fun json ->
  let fields = Json.obj json in
  {
    last_finished_at = Json.optional fields "lastFinishedAt" Json.string;
    last_outcome =
      Json.optional fields "lastOutcome" suggestion_generation_status_of_yojson;
    regenerate_available_at =
      Json.optional fields "regenerateAvailableAt" Json.string;
    started_at = Json.optional fields "startedAt" Json.string;
    state = Json.required fields "state" generation_state_of_yojson;
    trigger = Json.optional fields "trigger" generation_trigger_of_yojson;
  }

and yojson_of_generation_overview : generation_overview -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("lastFinishedAt", Option.map Json.of_string value.last_finished_at);
      ( "lastOutcome",
        Option.map yojson_of_suggestion_generation_status value.last_outcome );
      ( "regenerateAvailableAt",
        Option.map Json.of_string value.regenerate_available_at );
      ("startedAt", Option.map Json.of_string value.started_at);
      ("state", Some (yojson_of_generation_state value.state));
      ("trigger", Option.map yojson_of_generation_trigger value.trigger);
    ]

let make_generation_overview ?last_finished_at ?last_outcome
    ?regenerate_available_at ?started_at ~(state : generation_state) ?trigger ()
    =
  ({
     last_finished_at;
     last_outcome;
     regenerate_available_at;
     started_at;
     state;
     trigger;
   }
    : generation_overview)

type nonrec generation_started = {
  started : bool;
      (** Whether a run started; false when one ran before or is running. *)
}
(** What starting a generation did. *)

let generation_started_of_yojson : Yojson.Safe.t -> generation_started =
 fun json ->
  let fields = Json.obj json in
  { started = Json.required fields "started" Json.bool }

and yojson_of_generation_started : generation_started -> Yojson.Safe.t =
 fun value -> Json.record [ ("started", Some (Json.of_bool value.started)) ]

let make_generation_started ~(started : bool) () =
  ({ started } : generation_started)

(** Where a person's suggestions are in being generated. *)
type nonrec generation_status =
  | None_
  | Generating
  | Ready
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let generation_status_of_yojson : Yojson.Safe.t -> generation_status =
 fun json ->
  match Json.string json with
  | "none" -> None_
  | "generating" -> Generating
  | "ready" -> Ready
  | "failed" -> Failed
  | other -> Json.unknown "generation_status" json (Unknown other)

and yojson_of_generation_status : generation_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | None_ -> `String "none"
  | Generating -> `String "generating"
  | Ready -> `String "ready"
  | Failed -> `String "failed"
  | Unknown other -> `String other

type nonrec in_progress_execution = {
  action_id : string;
  chat_id : string option;
  resource : execution_resource option;
}

let in_progress_execution_of_yojson : Yojson.Safe.t -> in_progress_execution =
 fun json ->
  let fields = Json.obj json in
  {
    action_id = Json.required fields "action_id" Json.string;
    chat_id = Json.optional fields "chat_id" Json.string;
    resource = Json.optional fields "resource" execution_resource_of_yojson;
  }

and yojson_of_in_progress_execution : in_progress_execution -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("action_id", Some (Json.of_string value.action_id));
      ("chat_id", Option.map Json.of_string value.chat_id);
      ("resource", Option.map yojson_of_execution_resource value.resource);
    ]

let make_in_progress_execution ~(action_id : string) ?chat_id ?resource () =
  ({ action_id; chat_id; resource } : in_progress_execution)

(** A suggestion's kind, without its data. *)
type nonrec kind_name =
  | Prompt
  | Entity
  | Routine
  | Unknown of string  (** A value this SDK version does not know. *)

let kind_name_of_yojson : Yojson.Safe.t -> kind_name =
 fun json ->
  match Json.string json with
  | "prompt" -> Prompt
  | "entity" -> Entity
  | "routine" -> Routine
  | other -> Json.unknown "kind_name" json (Unknown other)

and yojson_of_kind_name : kind_name -> Yojson.Safe.t =
 fun value ->
  match value with
  | Prompt -> `String "prompt"
  | Entity -> `String "entity"
  | Routine -> `String "routine"
  | Unknown other -> `String other

type nonrec target = {
  entity_id : string;  (** The item's id. *)
  entity_type : entity_type;  (** The item's type. *)
  part_id : string option;
      (** A part of it, such as one message in a channel. *)
}
(** An item, or a part of one such as a message in a thread. *)

let target_of_yojson : Yojson.Safe.t -> target =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entityId" Json.string;
    entity_type = Json.required fields "entityType" entity_type_of_yojson;
    part_id = Json.optional fields "partId" Json.string;
  }

and yojson_of_target : target -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entityId", Some (Json.of_string value.entity_id));
      ("entityType", Some (yojson_of_entity_type value.entity_type));
      ("partId", Option.map Json.of_string value.part_id);
    ]

let make_target ~(entity_id : string) ~(entity_type : entity_type) ?part_id () =
  ({ entity_id; entity_type; part_id } : target)

(** How a prompt suggestion runs. *)
type nonrec run_mode =
  | Composer
  | Background
  | Unknown of string  (** A value this SDK version does not know. *)

let run_mode_of_yojson : Yojson.Safe.t -> run_mode =
 fun json ->
  match Json.string json with
  | "composer" -> Composer
  | "background" -> Background
  | other -> Json.unknown "run_mode" json (Unknown other)

and yojson_of_run_mode : run_mode -> Yojson.Safe.t =
 fun value ->
  match value with
  | Composer -> `String "composer"
  | Background -> `String "background"
  | Unknown other -> `String other

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

let new_suggestion_of_yojson : Yojson.Safe.t -> new_suggestion =
 fun json ->
  let fields = Json.obj json in
  {
    about = Json.optional fields "about" (Json.list target_of_yojson);
    action = Json.optional fields "action" entity_action_of_yojson;
    categories =
      Json.optional fields "categories" (Json.list category_of_yojson);
    dedup_key = Json.required fields "dedupKey" Json.string;
    importance = Json.required fields "importance" Json.int;
    kind = Json.required fields "kind" kind_name_of_yojson;
    prompt = Json.optional fields "prompt" Json.string;
    reason = Json.optional fields "reason" Json.string;
    run_mode = Json.optional fields "runMode" run_mode_of_yojson;
    sends = Json.optional fields "sends" Json.string;
    summary = Json.required fields "summary" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_new_suggestion : new_suggestion -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("about", Option.map (Json.of_list yojson_of_target) value.about);
      ("action", Option.map yojson_of_entity_action value.action);
      ( "categories",
        Option.map (Json.of_list yojson_of_category) value.categories );
      ("dedupKey", Some (Json.of_string value.dedup_key));
      ("importance", Some (Json.of_int value.importance));
      ("kind", Some (yojson_of_kind_name value.kind));
      ("prompt", Option.map Json.of_string value.prompt);
      ("reason", Option.map Json.of_string value.reason);
      ("runMode", Option.map yojson_of_run_mode value.run_mode);
      ("sends", Option.map Json.of_string value.sends);
      ("summary", Some (Json.of_string value.summary));
      ("title", Some (Json.of_string value.title));
    ]

let make_new_suggestion ?about ?action ?categories ~(dedup_key : string)
    ~(importance : int) ~(kind : kind_name) ?prompt ?reason ?run_mode ?sends
    ~(summary : string) ~(title : string) () =
  ({
     about;
     action;
     categories;
     dedup_key;
     importance;
     kind;
     prompt;
     reason;
     run_mode;
     sends;
     summary;
     title;
   }
    : new_suggestion)

type nonrec regeneration_cooldown = {
  available_at : string;  (** When they may ask again. *)
}
(** Fresh suggestions weren't started: the person asked within the hour. *)

let regeneration_cooldown_of_yojson : Yojson.Safe.t -> regeneration_cooldown =
 fun json ->
  let fields = Json.obj json in
  { available_at = Json.required fields "availableAt" Json.string }

and yojson_of_regeneration_cooldown : regeneration_cooldown -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("availableAt", Some (Json.of_string value.available_at)) ]

let make_regeneration_cooldown ~(available_at : string) () =
  ({ available_at } : regeneration_cooldown)

(** Why fresh suggestions weren't started. *)
type nonrec regeneration_refusal =
  | Running
  | Unknown of string  (** A value this SDK version does not know. *)

let regeneration_refusal_of_yojson : Yojson.Safe.t -> regeneration_refusal =
 fun json ->
  match Json.string json with
  | "running" -> Running
  | other -> Json.unknown "regeneration_refusal" json (Unknown other)

and yojson_of_regeneration_refusal : regeneration_refusal -> Yojson.Safe.t =
 fun value ->
  match value with
  | Running -> `String "running"
  | Unknown other -> `String other

type nonrec regeneration_running = {
  reason : regeneration_refusal;  (** Why. *)
}
(** Fresh suggestions weren't started: a generation is running. *)

let regeneration_running_of_yojson : Yojson.Safe.t -> regeneration_running =
 fun json ->
  let fields = Json.obj json in
  { reason = Json.required fields "reason" regeneration_refusal_of_yojson }

and yojson_of_regeneration_running : regeneration_running -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("reason", Some (yojson_of_regeneration_refusal value.reason)) ]

let make_regeneration_running ~(reason : regeneration_refusal) () =
  ({ reason } : regeneration_running)

type nonrec retire_suggestion = {
  reason : string;  (** Why, for the change log. *)
}
(** Retiring an open suggestion that no longer fits. *)

let retire_suggestion_of_yojson : Yojson.Safe.t -> retire_suggestion =
 fun json ->
  let fields = Json.obj json in
  { reason = Json.required fields "reason" Json.string }

and yojson_of_retire_suggestion : retire_suggestion -> Yojson.Safe.t =
 fun value -> Json.record [ ("reason", Some (Json.of_string value.reason)) ]

let make_retire_suggestion ~(reason : string) () =
  ({ reason } : retire_suggestion)

type nonrec retire_suggestion_request = {
  reason : string;  (** Why, for the change log. *)
}
(** Retiring an open suggestion that no longer matters. *)

let retire_suggestion_request_of_yojson :
    Yojson.Safe.t -> retire_suggestion_request =
 fun json ->
  let fields = Json.obj json in
  { reason = Json.required fields "reason" Json.string }

and yojson_of_retire_suggestion_request :
    retire_suggestion_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("reason", Some (Json.of_string value.reason)) ]

let make_retire_suggestion_request ~(reason : string) () =
  ({ reason } : retire_suggestion_request)

(** Where one of the person's routine suggestions is. *)
type nonrec reviewed_state =
  | Open
  | Dismissed
  | Retired
  | Saved
  | Unknown of string  (** A value this SDK version does not know. *)

let reviewed_state_of_yojson : Yojson.Safe.t -> reviewed_state =
 fun json ->
  match Json.string json with
  | "open" -> Open
  | "dismissed" -> Dismissed
  | "retired" -> Retired
  | "saved" -> Saved
  | other -> Json.unknown "reviewed_state" json (Unknown other)

and yojson_of_reviewed_state : reviewed_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Open -> `String "open"
  | Dismissed -> `String "dismissed"
  | Retired -> `String "retired"
  | Saved -> `String "saved"
  | Unknown other -> `String other

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

let suggested_pick_of_yojson : Yojson.Safe.t -> suggested_pick =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "catalog" ->
      Catalog
        {
          key = Json.required fields "key" Json.string;
          knobs = Json.required fields "knobs" Json.json;
        }
  | "routine" ->
      Routine
        {
          routine =
            Json.required fields "routine" action_configuration_of_yojson;
        }
  | _ -> Json.unknown "suggested_pick" json (Unknown json)

and yojson_of_suggested_pick : suggested_pick -> Yojson.Safe.t =
 fun value ->
  match value with
  | Catalog case ->
      Json.record
        [
          ("kind", Some (`String "catalog"));
          ("key", Some (Json.of_string case.key));
          ("knobs", Some (Json.of_json case.knobs));
        ]
  | Routine case ->
      Json.record
        [
          ("kind", Some (`String "routine"));
          ("routine", Some (yojson_of_action_configuration case.routine));
        ]
  | Unknown json -> json

let make_suggested_pick_catalog ~(key : string) ~(knobs : Yojson.Safe.t) () =
  (Catalog { key; knobs } : suggested_pick)

let make_suggested_pick_routine ~(routine : action_configuration) () =
  (Routine { routine } : suggested_pick)

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

let reviewed_suggestion_of_yojson : Yojson.Safe.t -> reviewed_suggestion =
 fun json ->
  let fields = Json.obj json in
  {
    suggested_pick = suggested_pick_of_yojson json;
    closed_at = Json.optional fields "closedAt" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    keep_probability = Json.required fields "keepProbability" Json.float;
    reason = Json.required fields "reason" Json.string;
    state = Json.required fields "state" reviewed_state_of_yojson;
    surfaces = Json.required fields "surfaces" (Json.list surface_of_yojson);
  }

and yojson_of_reviewed_suggestion : reviewed_suggestion -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("closedAt", Option.map Json.of_string value.closed_at);
          ("createdAt", Some (Json.of_string value.created_at));
          ("id", Some (Json.of_string value.id));
          ("keepProbability", Some (Json.of_float value.keep_probability));
          ("reason", Some (Json.of_string value.reason));
          ("state", Some (yojson_of_reviewed_state value.state));
          ("surfaces", Some ((Json.of_list yojson_of_surface) value.surfaces));
        ];
      yojson_of_suggested_pick value.suggested_pick;
    ]

let make_reviewed_suggestion ~(suggested_pick : suggested_pick) ?closed_at
    ~(created_at : string) ~(id : string) ~(keep_probability : float)
    ~(reason : string) ~(state : reviewed_state) ~(surfaces : surface list) () =
  ({
     suggested_pick;
     closed_at;
     created_at;
     id;
     keep_probability;
     reason;
     state;
     surfaces;
   }
    : reviewed_suggestion)

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

let rewrite_suggestion_of_yojson : Yojson.Safe.t -> rewrite_suggestion =
 fun json ->
  let fields = Json.obj json in
  {
    about = Json.optional fields "about" (Json.list target_of_yojson);
    categories =
      Json.optional fields "categories" (Json.list category_of_yojson);
    importance = Json.optional fields "importance" Json.int;
    prompt = Json.optional fields "prompt" Json.string;
    reason = Json.required fields "reason" Json.string;
    sends = Json.optional fields "sends" Json.string;
    summary = Json.optional fields "summary" Json.string;
    title = Json.optional fields "title" Json.string;
  }

and yojson_of_rewrite_suggestion : rewrite_suggestion -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("about", Option.map (Json.of_list yojson_of_target) value.about);
      ( "categories",
        Option.map (Json.of_list yojson_of_category) value.categories );
      ("importance", Option.map Json.of_int value.importance);
      ("prompt", Option.map Json.of_string value.prompt);
      ("reason", Some (Json.of_string value.reason));
      ("sends", Option.map Json.of_string value.sends);
      ("summary", Option.map Json.of_string value.summary);
      ("title", Option.map Json.of_string value.title);
    ]

let make_rewrite_suggestion ?about ?categories ?importance ?prompt
    ~(reason : string) ?sends ?summary ?title () =
  ({ about; categories; importance; prompt; reason; sends; summary; title }
    : rewrite_suggestion)

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

let routine_check_of_yojson : Yojson.Safe.t -> routine_check =
 fun json ->
  let fields = Json.obj json in
  {
    ok = Json.required fields "ok" Json.bool;
    problems = Json.required fields "problems" (Json.list Json.string);
    routine = Json.required fields "routine" action_configuration_of_yojson;
    steps =
      Json.required fields "steps" (Json.list checked_step_problems_of_yojson);
  }

and yojson_of_routine_check : routine_check -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("ok", Some (Json.of_bool value.ok));
      ("problems", Some ((Json.of_list Json.of_string) value.problems));
      ("routine", Some (yojson_of_action_configuration value.routine));
      ( "steps",
        Some ((Json.of_list yojson_of_checked_step_problems) value.steps) );
    ]

let make_routine_check ~(ok : bool) ~(problems : string list)
    ~(routine : action_configuration) ~(steps : checked_step_problems list) () =
  ({ ok; problems; routine; steps } : routine_check)

type nonrec routine_sentence_part = {
  picked : bool;  (** It is a value AI picked, which the person can change. *)
  text : string;  (** What it says. *)
}
(** A part of a routine's sentence. *)

let routine_sentence_part_of_yojson : Yojson.Safe.t -> routine_sentence_part =
 fun json ->
  let fields = Json.obj json in
  {
    picked = Json.required fields "picked" Json.bool;
    text = Json.required fields "text" Json.string;
  }

and yojson_of_routine_sentence_part : routine_sentence_part -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("picked", Some (Json.of_bool value.picked));
      ("text", Some (Json.of_string value.text));
    ]

let make_routine_sentence_part ~(picked : bool) ~(text : string) () =
  ({ picked; text } : routine_sentence_part)

(** Who suggests a routine. *)
type nonrec suggestion_from =
  | For_you
  | Macro
  | Unknown of string  (** A value this SDK version does not know. *)

let suggestion_from_of_yojson : Yojson.Safe.t -> suggestion_from =
 fun json ->
  match Json.string json with
  | "for_you" -> For_you
  | "macro" -> Macro
  | other -> Json.unknown "suggestion_from" json (Unknown other)

and yojson_of_suggestion_from : suggestion_from -> Yojson.Safe.t =
 fun value ->
  match value with
  | For_you -> `String "for_you"
  | Macro -> `String "macro"
  | Unknown other -> `String other

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

let routine_suggestion_of_yojson : Yojson.Safe.t -> routine_suggestion =
 fun json ->
  let fields = Json.obj json in
  {
    suggested_pick = suggested_pick_of_yojson json;
    from = Json.required fields "from" suggestion_from_of_yojson;
    id = Json.required fields "id" Json.string;
    keep_probability = Json.optional fields "keepProbability" Json.float;
    on_by_default = Json.required fields "onByDefault" Json.bool;
    reason = Json.optional fields "reason" Json.string;
    surfaces = Json.required fields "surfaces" (Json.list surface_of_yojson);
  }

and yojson_of_routine_suggestion : routine_suggestion -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("from", Some (yojson_of_suggestion_from value.from));
          ("id", Some (Json.of_string value.id));
          ("keepProbability", Option.map Json.of_float value.keep_probability);
          ("onByDefault", Some (Json.of_bool value.on_by_default));
          ("reason", Option.map Json.of_string value.reason);
          ("surfaces", Some ((Json.of_list yojson_of_surface) value.surfaces));
        ];
      yojson_of_suggested_pick value.suggested_pick;
    ]

let make_routine_suggestion ~(suggested_pick : suggested_pick)
    ~(from : suggestion_from) ~(id : string) ?keep_probability
    ~(on_by_default : bool) ?reason ~(surfaces : surface list) () =
  ({
     suggested_pick;
     from;
     id;
     keep_probability;
     on_by_default;
     reason;
     surfaces;
   }
    : routine_suggestion)

type nonrec routine_suggestion_card = {
  categories : category list option;  (** The feed's filters it shows under. *)
  importance : int;
      (** 0 to 100: how much the person would regret missing it this week. *)
  title : string;  (** What it does for the person, in a few words. *)
}
(** How a drafted routine suggestion shows in the person's Suggestions feed:
every routine a session drafts is also one suggestion there, kept and
closed with it. *)

let routine_suggestion_card_of_yojson : Yojson.Safe.t -> routine_suggestion_card
    =
 fun json ->
  let fields = Json.obj json in
  {
    categories =
      Json.optional fields "categories" (Json.list category_of_yojson);
    importance = Json.required fields "importance" Json.int;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_routine_suggestion_card : routine_suggestion_card -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ( "categories",
        Option.map (Json.of_list yojson_of_category) value.categories );
      ("importance", Some (Json.of_int value.importance));
      ("title", Some (Json.of_string value.title));
    ]

let make_routine_suggestion_card ?categories ~(importance : int)
    ~(title : string) () =
  ({ categories; importance; title } : routine_suggestion_card)

type nonrec routine_suggestions = {
  status : generation_status;
  suggestions : routine_suggestion list;
      (** Per surface, AI's first, best first, then Macro's templates, so each
surface has at least one and ideally three. A suggestion with
several surfaces appears once. *)
}
(** A person's suggestions, and whether more are on the way. *)

let routine_suggestions_of_yojson : Yojson.Safe.t -> routine_suggestions =
 fun json ->
  let fields = Json.obj json in
  {
    status = Json.required fields "status" generation_status_of_yojson;
    suggestions =
      Json.required fields "suggestions"
        (Json.list routine_suggestion_of_yojson);
  }

and yojson_of_routine_suggestions : routine_suggestions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("status", Some (yojson_of_generation_status value.status));
      ( "suggestions",
        Some ((Json.of_list yojson_of_routine_suggestion) value.suggestions) );
    ]

let make_routine_suggestions ~(status : generation_status)
    ~(suggestions : routine_suggestion list) () =
  ({ status; suggestions } : routine_suggestions)

(** How a variable is filled when someone activates the template. *)
type nonrec variable_fill =
  | Activator
  | Shared
  | Choice
  | Unknown of string  (** A value this SDK version does not know. *)

let variable_fill_of_yojson : Yojson.Safe.t -> variable_fill =
 fun json ->
  match Json.string json with
  | "activator" -> Activator
  | "shared" -> Shared
  | "choice" -> Choice
  | other -> Json.unknown "variable_fill" json (Unknown other)

and yojson_of_variable_fill : variable_fill -> Yojson.Safe.t =
 fun value ->
  match value with
  | Activator -> `String "activator"
  | Shared -> `String "shared"
  | Choice -> `String "choice"
  | Unknown other -> `String other

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

let template_variable_of_yojson : Yojson.Safe.t -> template_variable =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "user" ->
      User
        {
          fill = Json.required fields "fill" variable_fill_of_yojson;
          id = Json.required fields "id" Json.string;
          label = Json.required fields "label" Json.string;
        }
  | "item" ->
      Item
        {
          block_name = Json.required fields "block_name" Json.string;
          fill = Json.required fields "fill" variable_fill_of_yojson;
          id = Json.required fields "id" Json.string;
          label = Json.required fields "label" Json.string;
        }
  | "time_zone" ->
      Time_zone
        {
          fill = Json.required fields "fill" variable_fill_of_yojson;
          timezone = Json.required fields "timezone" Json.string;
        }
  | _ -> Json.unknown "template_variable" json (Unknown json)

and yojson_of_template_variable : template_variable -> Yojson.Safe.t =
 fun value ->
  match value with
  | User case ->
      Json.record
        [
          ("kind", Some (`String "user"));
          ("fill", Some (yojson_of_variable_fill case.fill));
          ("id", Some (Json.of_string case.id));
          ("label", Some (Json.of_string case.label));
        ]
  | Item case ->
      Json.record
        [
          ("kind", Some (`String "item"));
          ("block_name", Some (Json.of_string case.block_name));
          ("fill", Some (yojson_of_variable_fill case.fill));
          ("id", Some (Json.of_string case.id));
          ("label", Some (Json.of_string case.label));
        ]
  | Time_zone case ->
      Json.record
        [
          ("kind", Some (`String "time_zone"));
          ("fill", Some (yojson_of_variable_fill case.fill));
          ("timezone", Some (Json.of_string case.timezone));
        ]
  | Unknown json -> json

let make_template_variable_user ~(fill : variable_fill) ~(id : string)
    ~(label : string) () =
  (User { fill; id; label } : template_variable)

let make_template_variable_item ~(block_name : string) ~(fill : variable_fill)
    ~(id : string) ~(label : string) () =
  (Item { block_name; fill; id; label } : template_variable)

let make_template_variable_time_zone ~(fill : variable_fill)
    ~(timezone : string) () =
  (Time_zone { fill; timezone } : template_variable)

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

let routine_template_of_yojson : Yojson.Safe.t -> routine_template =
 fun json ->
  let fields = Json.obj json in
  {
    active_count = Json.required fields "active_count" Json.int;
    appearance = Json.required fields "appearance" entity_appearance_of_yojson;
    author = Json.required fields "author" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    description = Json.required fields "description" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    task = Json.required fields "task" routine_task_of_yojson;
    trigger = Json.required fields "trigger" action_trigger_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
    variables =
      Json.required fields "variables" (Json.list template_variable_of_yojson);
  }

and yojson_of_routine_template : routine_template -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("active_count", Some (Json.of_int value.active_count));
      ("appearance", Some (yojson_of_entity_appearance value.appearance));
      ("author", Some (Json.of_string value.author));
      ("created_at", Some (Json.of_string value.created_at));
      ("description", Some (Json.of_string value.description));
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("task", Some (yojson_of_routine_task value.task));
      ("trigger", Some (yojson_of_action_trigger value.trigger));
      ("updated_at", Some (Json.of_string value.updated_at));
      ( "variables",
        Some ((Json.of_list yojson_of_template_variable) value.variables) );
    ]

let make_routine_template ~(active_count : int)
    ~(appearance : entity_appearance) ~(author : string) ~(created_at : string)
    ~(description : string) ~(id : string) ~(name : string)
    ~(task : routine_task) ~(trigger : action_trigger) ~(updated_at : string)
    ~(variables : template_variable list) () =
  ({
     active_count;
     appearance;
     author;
     created_at;
     description;
     id;
     name;
     task;
     trigger;
     updated_at;
     variables;
   }
    : routine_template)

type nonrec routine_text = {
  sentence : routine_sentence_part list;
      (** What it does: a step's sentence with the values AI picked marked, or
its description (else its name) as one unmarked part. *)
  when_ : string;
      (** When it runs, e.g. "Fridays at 9:00 AM" or "New email received". *)
}
(** How a routine suggestion's drafted routine reads on its card. *)

let routine_text_of_yojson : Yojson.Safe.t -> routine_text =
 fun json ->
  let fields = Json.obj json in
  {
    sentence =
      Json.required fields "sentence"
        (Json.list routine_sentence_part_of_yojson);
    when_ = Json.required fields "when" Json.string;
  }

and yojson_of_routine_text : routine_text -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "sentence",
        Some ((Json.of_list yojson_of_routine_sentence_part) value.sentence) );
      ("when", Some (Json.of_string value.when_));
    ]

let make_routine_text ~(sentence : routine_sentence_part list) ~(when_ : string)
    () =
  ({ sentence; when_ } : routine_text)

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

let run_state_name_of_yojson : Yojson.Safe.t -> run_state_name =
 fun json ->
  match Json.string json with
  | "starting" -> Starting
  | "running" -> Running
  | "waiting" -> Waiting
  | "stopping" -> Stopping
  | "cancelling" -> Cancelling
  | "finished" -> Finished
  | "failed" -> Failed
  | "cancelled" -> Cancelled
  | other -> Json.unknown "run_state_name" json (Unknown other)

and yojson_of_run_state_name : run_state_name -> Yojson.Safe.t =
 fun value ->
  match value with
  | Starting -> `String "starting"
  | Running -> `String "running"
  | Waiting -> `String "waiting"
  | Stopping -> `String "stopping"
  | Cancelling -> `String "cancelling"
  | Finished -> `String "finished"
  | Failed -> `String "failed"
  | Cancelled -> `String "cancelled"
  | Unknown other -> `String other

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

let sub_routine_of_yojson : Yojson.Safe.t -> sub_routine =
 fun json ->
  let fields = Json.obj json in
  {
    created_by_run_id = Json.required fields "created_by_run_id" Json.string;
    key = Json.optional fields "key" Json.string;
    parent_id = Json.required fields "parent_id" Json.string;
    paused_by_parent = Json.optional fields "paused_by_parent" Json.bool;
  }

and yojson_of_sub_routine : sub_routine -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_by_run_id", Some (Json.of_string value.created_by_run_id));
      ("key", Option.map Json.of_string value.key);
      ("parent_id", Some (Json.of_string value.parent_id));
      ("paused_by_parent", Option.map Json.of_bool value.paused_by_parent);
    ]

let make_sub_routine ~(created_by_run_id : string) ?key ~(parent_id : string)
    ?paused_by_parent () =
  ({ created_by_run_id; key; parent_id; paused_by_parent } : sub_routine)

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

let scheduled_action_of_yojson : Yojson.Safe.t -> scheduled_action =
 fun json ->
  let fields = Json.obj json in
  {
    appearance = Json.optional fields "appearance" entity_appearance_of_yojson;
    claimed = Json.optional fields "claimed" Json.string;
    configuration_revision =
      Json.required fields "configuration_revision" Json.int64;
    created_at = Json.required fields "created_at" Json.string;
    description = Json.optional fields "description" Json.string;
    enabled = Json.required fields "enabled" Json.bool;
    event_activated_at = Json.optional fields "event_activated_at" Json.string;
    id = Json.optional fields "id" Json.string;
    kind = Json.required fields "kind" action_kind_of_yojson;
    name = Json.required fields "name" Json.string;
    next_run_at = Json.optional fields "next_run_at" Json.string;
    owner = Json.required fields "owner" Json.string;
    run_visibility =
      Json.required fields "run_visibility" run_visibility_of_yojson;
    sub_routine = Json.optional fields "sub_routine" sub_routine_of_yojson;
    suggestion_id = Json.optional fields "suggestion_id" Json.string;
    task = Json.required fields "task" routine_task_of_yojson;
    template_id = Json.optional fields "template_id" Json.string;
    trigger = Json.required fields "trigger" action_trigger_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_scheduled_action : scheduled_action -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("appearance", Option.map yojson_of_entity_appearance value.appearance);
      ("claimed", Option.map Json.of_string value.claimed);
      ( "configuration_revision",
        Some (Json.of_int64 value.configuration_revision) );
      ("created_at", Some (Json.of_string value.created_at));
      ("description", Option.map Json.of_string value.description);
      ("enabled", Some (Json.of_bool value.enabled));
      ("event_activated_at", Option.map Json.of_string value.event_activated_at);
      ("id", Option.map Json.of_string value.id);
      ("kind", Some (yojson_of_action_kind value.kind));
      ("name", Some (Json.of_string value.name));
      ("next_run_at", Option.map Json.of_string value.next_run_at);
      ("owner", Some (Json.of_string value.owner));
      ("run_visibility", Some (yojson_of_run_visibility value.run_visibility));
      ("sub_routine", Option.map yojson_of_sub_routine value.sub_routine);
      ("suggestion_id", Option.map Json.of_string value.suggestion_id);
      ("task", Some (yojson_of_routine_task value.task));
      ("template_id", Option.map Json.of_string value.template_id);
      ("trigger", Some (yojson_of_action_trigger value.trigger));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_scheduled_action ?appearance ?claimed ~(configuration_revision : int64)
    ~(created_at : string) ?description ~(enabled : bool) ?event_activated_at
    ?id ~(kind : action_kind) ~(name : string) ?next_run_at ~(owner : string)
    ~(run_visibility : run_visibility) ?sub_routine ?suggestion_id
    ~(task : routine_task) ?template_id ~(trigger : action_trigger)
    ~(updated_at : string) () =
  ({
     appearance;
     claimed;
     configuration_revision;
     created_at;
     description;
     enabled;
     event_activated_at;
     id;
     kind;
     name;
     next_run_at;
     owner;
     run_visibility;
     sub_routine;
     suggestion_id;
     task;
     template_id;
     trigger;
     updated_at;
   }
    : scheduled_action)

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

let scheduled_action_response_of_yojson :
    Yojson.Safe.t -> scheduled_action_response =
 fun json ->
  let fields = Json.obj json in
  {
    appearance = Json.optional fields "appearance" entity_appearance_of_yojson;
    claimed = Json.optional fields "claimed" Json.string;
    configuration_revision =
      Json.required fields "configuration_revision" Json.int64;
    created_at = Json.required fields "created_at" Json.string;
    description = Json.optional fields "description" Json.string;
    enabled = Json.required fields "enabled" Json.bool;
    event_activated_at = Json.optional fields "event_activated_at" Json.string;
    id = Json.optional fields "id" Json.string;
    kind = Json.required fields "kind" action_kind_of_yojson;
    name = Json.required fields "name" Json.string;
    next_run_at = Json.optional fields "next_run_at" Json.string;
    owner = Json.required fields "owner" Json.string;
    run_visibility =
      Json.required fields "run_visibility" run_visibility_of_yojson;
    sub_routine = Json.optional fields "sub_routine" sub_routine_of_yojson;
    suggestion_id = Json.optional fields "suggestion_id" Json.string;
    task = Json.required fields "task" routine_task_of_yojson;
    template_id = Json.optional fields "template_id" Json.string;
    trigger = Json.required fields "trigger" action_trigger_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
    last_run = Json.optional fields "last_run" action_execution_record_of_yojson;
    schedule = Json.optional fields "schedule" Json.string;
    timezone = Json.optional fields "timezone" Json.string;
  }

and yojson_of_scheduled_action_response :
    scheduled_action_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("appearance", Option.map yojson_of_entity_appearance value.appearance);
      ("claimed", Option.map Json.of_string value.claimed);
      ( "configuration_revision",
        Some (Json.of_int64 value.configuration_revision) );
      ("created_at", Some (Json.of_string value.created_at));
      ("description", Option.map Json.of_string value.description);
      ("enabled", Some (Json.of_bool value.enabled));
      ("event_activated_at", Option.map Json.of_string value.event_activated_at);
      ("id", Option.map Json.of_string value.id);
      ("kind", Some (yojson_of_action_kind value.kind));
      ("name", Some (Json.of_string value.name));
      ("next_run_at", Option.map Json.of_string value.next_run_at);
      ("owner", Some (Json.of_string value.owner));
      ("run_visibility", Some (yojson_of_run_visibility value.run_visibility));
      ("sub_routine", Option.map yojson_of_sub_routine value.sub_routine);
      ("suggestion_id", Option.map Json.of_string value.suggestion_id);
      ("task", Some (yojson_of_routine_task value.task));
      ("template_id", Option.map Json.of_string value.template_id);
      ("trigger", Some (yojson_of_action_trigger value.trigger));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("last_run", Option.map yojson_of_action_execution_record value.last_run);
      ("schedule", Option.map Json.of_string value.schedule);
      ("timezone", Option.map Json.of_string value.timezone);
    ]

let make_scheduled_action_response ?appearance ?claimed
    ~(configuration_revision : int64) ~(created_at : string) ?description
    ~(enabled : bool) ?event_activated_at ?id ~(kind : action_kind)
    ~(name : string) ?next_run_at ~(owner : string)
    ~(run_visibility : run_visibility) ?sub_routine ?suggestion_id
    ~(task : routine_task) ?template_id ~(trigger : action_trigger)
    ~(updated_at : string) ?last_run ?schedule ?timezone () =
  ({
     appearance;
     claimed;
     configuration_revision;
     created_at;
     description;
     enabled;
     event_activated_at;
     id;
     kind;
     name;
     next_run_at;
     owner;
     run_visibility;
     sub_routine;
     suggestion_id;
     task;
     template_id;
     trigger;
     updated_at;
     last_run;
     schedule;
     timezone;
   }
    : scheduled_action_response)

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

let scheduled_action_update_of_yojson : Yojson.Safe.t -> scheduled_action_update
    =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "started" ->
      Started
        {
          action_id = Json.required fields "action_id" Json.string;
          chat_id = Json.optional fields "chat_id" Json.string;
          owner = Json.required fields "owner" Json.string;
          resource =
            Json.optional fields "resource" execution_resource_of_yojson;
        }
  | "stopped" ->
      Stopped
        {
          action_id = Json.required fields "action_id" Json.string;
          chat_id = Json.optional fields "chat_id" Json.string;
          is_success = Json.required fields "is_success" Json.bool;
          owner = Json.required fields "owner" Json.string;
          resource =
            Json.optional fields "resource" execution_resource_of_yojson;
        }
  | _ -> Json.unknown "scheduled_action_update" json (Unknown json)

and yojson_of_scheduled_action_update : scheduled_action_update -> Yojson.Safe.t
    =
 fun value ->
  match value with
  | Started case ->
      Json.record
        [
          ("type", Some (`String "started"));
          ("action_id", Some (Json.of_string case.action_id));
          ("chat_id", Option.map Json.of_string case.chat_id);
          ("owner", Some (Json.of_string case.owner));
          ("resource", Option.map yojson_of_execution_resource case.resource);
        ]
  | Stopped case ->
      Json.record
        [
          ("type", Some (`String "stopped"));
          ("action_id", Some (Json.of_string case.action_id));
          ("chat_id", Option.map Json.of_string case.chat_id);
          ("is_success", Some (Json.of_bool case.is_success));
          ("owner", Some (Json.of_string case.owner));
          ("resource", Option.map yojson_of_execution_resource case.resource);
        ]
  | Unknown json -> json

let make_scheduled_action_update_started ~(action_id : string) ?chat_id
    ~(owner : string) ?resource () =
  (Started { action_id; chat_id; owner; resource } : scheduled_action_update)

let make_scheduled_action_update_stopped ~(action_id : string) ?chat_id
    ~(is_success : bool) ~(owner : string) ?resource () =
  (Stopped { action_id; chat_id; is_success; owner; resource }
    : scheduled_action_update)

type nonrec set_scheduled_action_enabled = { enabled : bool }

let set_scheduled_action_enabled_of_yojson :
    Yojson.Safe.t -> set_scheduled_action_enabled =
 fun json ->
  let fields = Json.obj json in
  { enabled = Json.required fields "enabled" Json.bool }

and yojson_of_set_scheduled_action_enabled :
    set_scheduled_action_enabled -> Yojson.Safe.t =
 fun value -> Json.record [ ("enabled", Some (Json.of_bool value.enabled)) ]

let make_set_scheduled_action_enabled ~(enabled : bool) () =
  ({ enabled } : set_scheduled_action_enabled)

type nonrec share_routine_template = {
  description : string;
  variables : template_variable list;
}
(** What the owner supplies when sharing; the rest is snapshotted from the routine. *)

let share_routine_template_of_yojson : Yojson.Safe.t -> share_routine_template =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.required fields "description" Json.string;
    variables =
      Json.required fields "variables" (Json.list template_variable_of_yojson);
  }

and yojson_of_share_routine_template : share_routine_template -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Some (Json.of_string value.description));
      ( "variables",
        Some ((Json.of_list yojson_of_template_variable) value.variables) );
    ]

let make_share_routine_template ~(description : string)
    ~(variables : template_variable list) () =
  ({ description; variables } : share_routine_template)

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

let start_draft_job_request_of_yojson : Yojson.Safe.t -> start_draft_job_request
    =
 fun json ->
  let fields = Json.obj json in
  {
    client_id = Json.required fields "clientId" Json.string;
    context = Json.required fields "context" draft_context_of_yojson;
    draft = Json.required fields "draft" draft_request_of_yojson;
  }

and yojson_of_start_draft_job_request : start_draft_job_request -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("clientId", Some (Json.of_string value.client_id));
      ("context", Some (yojson_of_draft_context value.context));
      ("draft", Some (yojson_of_draft_request value.draft));
    ]

let make_start_draft_job_request ~(client_id : string)
    ~(context : draft_context) ~(draft : draft_request) () =
  ({ client_id; context; draft } : start_draft_job_request)

type nonrec suggest_outcome = {
  check : routine_check option;
  id : string option;  (** The kept suggestion's id. *)
  ok : bool;  (** Whether it was kept. *)
  problems : string list;  (** Why it wasn't, to fix and suggest again. *)
}
(** What became of a suggestion handed back. *)

let suggest_outcome_of_yojson : Yojson.Safe.t -> suggest_outcome =
 fun json ->
  let fields = Json.obj json in
  {
    check = Json.optional fields "check" routine_check_of_yojson;
    id = Json.optional fields "id" Json.string;
    ok = Json.required fields "ok" Json.bool;
    problems = Json.required fields "problems" (Json.list Json.string);
  }

and yojson_of_suggest_outcome : suggest_outcome -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("check", Option.map yojson_of_routine_check value.check);
      ("id", Option.map Json.of_string value.id);
      ("ok", Some (Json.of_bool value.ok));
      ("problems", Some ((Json.of_list Json.of_string) value.problems));
    ]

let make_suggest_outcome ?check ?id ~(ok : bool) ~(problems : string list) () =
  ({ check; id; ok; problems } : suggest_outcome)

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

let suggest_request_of_yojson : Yojson.Safe.t -> suggest_request =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "catalog" ->
      Catalog
        {
          card = Json.optional fields "card" routine_suggestion_card_of_yojson;
          keep_probability = Json.required fields "keepProbability" Json.float;
          key = Json.required fields "key" Json.string;
          knobs = Json.optional fields "knobs" Json.json;
          reason = Json.required fields "reason" Json.string;
          surfaces =
            Json.required fields "surfaces" (Json.list surface_of_yojson);
        }
  | "routine" ->
      Routine
        {
          card = Json.required fields "card" routine_suggestion_card_of_yojson;
          created =
            Json.optional fields "created" (Json.list created_item_of_yojson);
          keep_probability = Json.required fields "keepProbability" Json.float;
          reason = Json.required fields "reason" Json.string;
          routine =
            Json.required fields "routine" action_configuration_of_yojson;
          surfaces =
            Json.required fields "surfaces" (Json.list surface_of_yojson);
        }
  | _ -> Json.unknown "suggest_request" json (Unknown json)

and yojson_of_suggest_request : suggest_request -> Yojson.Safe.t =
 fun value ->
  match value with
  | Catalog case ->
      Json.record
        [
          ("kind", Some (`String "catalog"));
          ("card", Option.map yojson_of_routine_suggestion_card case.card);
          ("keepProbability", Some (Json.of_float case.keep_probability));
          ("key", Some (Json.of_string case.key));
          ("knobs", Option.map Json.of_json case.knobs);
          ("reason", Some (Json.of_string case.reason));
          ("surfaces", Some ((Json.of_list yojson_of_surface) case.surfaces));
        ]
  | Routine case ->
      Json.record
        [
          ("kind", Some (`String "routine"));
          ("card", Some (yojson_of_routine_suggestion_card case.card));
          ( "created",
            Option.map (Json.of_list yojson_of_created_item) case.created );
          ("keepProbability", Some (Json.of_float case.keep_probability));
          ("reason", Some (Json.of_string case.reason));
          ("routine", Some (yojson_of_action_configuration case.routine));
          ("surfaces", Some ((Json.of_list yojson_of_surface) case.surfaces));
        ]
  | Unknown json -> json

let make_suggest_request_catalog ?card ~(keep_probability : float)
    ~(key : string) ?knobs ~(reason : string) ~(surfaces : surface list) () =
  (Catalog { card; keep_probability; key; knobs; reason; surfaces }
    : suggest_request)

let make_suggest_request_routine ~(card : routine_suggestion_card) ?created
    ~(keep_probability : float) ~(reason : string)
    ~(routine : action_configuration) ~(surfaces : surface list) () =
  (Routine { card; created; keep_probability; reason; routine; surfaces }
    : suggest_request)

type nonrec suggestion_draft = {
  entity_id : string;  (** The item's id. *)
  entity_type : entity_type;  (** The item's type. *)
  part_id : string option;
      (** A part of it, such as one message in a channel. *)
  preview : string option;
      (** The start of its plain text, as it was when attached. *)
}
(** A reply suggestion's draft. *)

let suggestion_draft_of_yojson : Yojson.Safe.t -> suggestion_draft =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entityId" Json.string;
    entity_type = Json.required fields "entityType" entity_type_of_yojson;
    part_id = Json.optional fields "partId" Json.string;
    preview = Json.optional fields "preview" Json.string;
  }

and yojson_of_suggestion_draft : suggestion_draft -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entityId", Some (Json.of_string value.entity_id));
      ("entityType", Some (yojson_of_entity_type value.entity_type));
      ("partId", Option.map Json.of_string value.part_id);
      ("preview", Option.map Json.of_string value.preview);
    ]

let make_suggestion_draft ~(entity_id : string) ~(entity_type : entity_type)
    ?part_id ?preview () =
  ({ entity_id; entity_type; part_id; preview } : suggestion_draft)

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

let suggestion_kind_of_yojson : Yojson.Safe.t -> suggestion_kind =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "prompt" ->
      Prompt
        {
          prompt = Json.required fields "prompt" Json.string;
          run_mode = Json.required fields "runMode" run_mode_of_yojson;
          sends = Json.optional fields "sends" Json.string;
        }
  | "entity" ->
      Entity
        {
          action = Json.required fields "action" entity_action_of_yojson;
          draft = Json.optional fields "draft" suggestion_draft_of_yojson;
          from = Json.optional fields "from" Json.string;
          waiting_since = Json.optional fields "waitingSince" Json.string;
        }
  | "routine" ->
      Routine
        {
          routine = Json.optional fields "routine" routine_text_of_yojson;
          routine_suggestion_id =
            Json.required fields "routineSuggestionId" Json.string;
        }
  | _ -> Json.unknown "suggestion_kind" json (Unknown json)

and yojson_of_suggestion_kind : suggestion_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Prompt case ->
      Json.record
        [
          ("kind", Some (`String "prompt"));
          ("prompt", Some (Json.of_string case.prompt));
          ("runMode", Some (yojson_of_run_mode case.run_mode));
          ("sends", Option.map Json.of_string case.sends);
        ]
  | Entity case ->
      Json.record
        [
          ("kind", Some (`String "entity"));
          ("action", Some (yojson_of_entity_action case.action));
          ("draft", Option.map yojson_of_suggestion_draft case.draft);
          ("from", Option.map Json.of_string case.from);
          ("waitingSince", Option.map Json.of_string case.waiting_since);
        ]
  | Routine case ->
      Json.record
        [
          ("kind", Some (`String "routine"));
          ("routine", Option.map yojson_of_routine_text case.routine);
          ( "routineSuggestionId",
            Some (Json.of_string case.routine_suggestion_id) );
        ]
  | Unknown json -> json

let make_suggestion_kind_prompt ~(prompt : string) ~(run_mode : run_mode) ?sends
    () =
  (Prompt { prompt; run_mode; sends } : suggestion_kind)

let make_suggestion_kind_entity ~(action : entity_action) ?draft ?from
    ?waiting_since () =
  (Entity { action; draft; from; waiting_since } : suggestion_kind)

let make_suggestion_kind_routine ?routine ~(routine_suggestion_id : string) () =
  (Routine { routine; routine_suggestion_id } : suggestion_kind)

type nonrec suggestion_run = {
  session_id : string;  (** The agent session: open it to see the result. *)
  started_at : string;  (** When it started. *)
  state : run_state_name;
      (** Where it is, as stored: reading it never asks the session. *)
  state_changed_at : string;  (** When it entered [state]. *)
}
(** A run of a background prompt suggestion: a hidden agent session of the
person's, with the full toolset, that never stops to ask. *)

let suggestion_run_of_yojson : Yojson.Safe.t -> suggestion_run =
 fun json ->
  let fields = Json.obj json in
  {
    session_id = Json.required fields "sessionId" Json.string;
    started_at = Json.required fields "startedAt" Json.string;
    state = Json.required fields "state" run_state_name_of_yojson;
    state_changed_at = Json.required fields "stateChangedAt" Json.string;
  }

and yojson_of_suggestion_run : suggestion_run -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("sessionId", Some (Json.of_string value.session_id));
      ("startedAt", Some (Json.of_string value.started_at));
      ("state", Some (yojson_of_run_state_name value.state));
      ("stateChangedAt", Some (Json.of_string value.state_changed_at));
    ]

let make_suggestion_run ~(session_id : string) ~(started_at : string)
    ~(state : run_state_name) ~(state_changed_at : string) () =
  ({ session_id; started_at; state; state_changed_at } : suggestion_run)

(** Where a suggestion is for the person. *)
type nonrec suggestion_state =
  | Proposed
  | Accepted
  | Done
  | Dismissed
  | Resolved
  | Retired
  | Unknown of string  (** A value this SDK version does not know. *)

let suggestion_state_of_yojson : Yojson.Safe.t -> suggestion_state =
 fun json ->
  match Json.string json with
  | "proposed" -> Proposed
  | "accepted" -> Accepted
  | "done" -> Done
  | "dismissed" -> Dismissed
  | "resolved" -> Resolved
  | "retired" -> Retired
  | other -> Json.unknown "suggestion_state" json (Unknown other)

and yojson_of_suggestion_state : suggestion_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Proposed -> `String "proposed"
  | Accepted -> `String "accepted"
  | Done -> `String "done"
  | Dismissed -> `String "dismissed"
  | Resolved -> `String "resolved"
  | Retired -> `String "retired"
  | Unknown other -> `String other

(** What a suggestion's card shows, from its state and its latest run. *)
type nonrec suggestion_status =
  | Open
  | Running
  | Failed
  | Done
  | Closed
  | Unknown of string  (** A value this SDK version does not know. *)

let suggestion_status_of_yojson : Yojson.Safe.t -> suggestion_status =
 fun json ->
  match Json.string json with
  | "open" -> Open
  | "running" -> Running
  | "failed" -> Failed
  | "done" -> Done
  | "closed" -> Closed
  | other -> Json.unknown "suggestion_status" json (Unknown other)

and yojson_of_suggestion_status : suggestion_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Open -> `String "open"
  | Running -> `String "running"
  | Failed -> `String "failed"
  | Done -> `String "done"
  | Closed -> `String "closed"
  | Unknown other -> `String other

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

let suggestion_of_yojson : Yojson.Safe.t -> suggestion =
 fun json ->
  let fields = Json.obj json in
  {
    suggestion_kind = suggestion_kind_of_yojson json;
    about = Json.required fields "about" (Json.list target_of_yojson);
    categories =
      Json.required fields "categories" (Json.list category_of_yojson);
    created_at = Json.required fields "createdAt" Json.string;
    dedup_key = Json.required fields "dedupKey" Json.string;
    id = Json.required fields "id" Json.string;
    importance = Json.required fields "importance" Json.int;
    is_new = Json.required fields "isNew" Json.bool;
    produced = Json.required fields "produced" (Json.list target_of_yojson);
    result = Json.optional fields "result" target_of_yojson;
    run = Json.optional fields "run" suggestion_run_of_yojson;
    state = Json.required fields "state" suggestion_state_of_yojson;
    state_changed_at = Json.required fields "stateChangedAt" Json.string;
    state_reason = Json.optional fields "stateReason" Json.string;
    status = Json.required fields "status" suggestion_status_of_yojson;
    summary = Json.required fields "summary" Json.string;
    title = Json.required fields "title" Json.string;
    updated_at = Json.required fields "updatedAt" Json.string;
  }

and yojson_of_suggestion : suggestion -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("about", Some ((Json.of_list yojson_of_target) value.about));
          ( "categories",
            Some ((Json.of_list yojson_of_category) value.categories) );
          ("createdAt", Some (Json.of_string value.created_at));
          ("dedupKey", Some (Json.of_string value.dedup_key));
          ("id", Some (Json.of_string value.id));
          ("importance", Some (Json.of_int value.importance));
          ("isNew", Some (Json.of_bool value.is_new));
          ("produced", Some ((Json.of_list yojson_of_target) value.produced));
          ("result", Option.map yojson_of_target value.result);
          ("run", Option.map yojson_of_suggestion_run value.run);
          ("state", Some (yojson_of_suggestion_state value.state));
          ("stateChangedAt", Some (Json.of_string value.state_changed_at));
          ("stateReason", Option.map Json.of_string value.state_reason);
          ("status", Some (yojson_of_suggestion_status value.status));
          ("summary", Some (Json.of_string value.summary));
          ("title", Some (Json.of_string value.title));
          ("updatedAt", Some (Json.of_string value.updated_at));
        ];
      yojson_of_suggestion_kind value.suggestion_kind;
    ]

let make_suggestion ~(suggestion_kind : suggestion_kind) ~(about : target list)
    ~(categories : category list) ~(created_at : string) ~(dedup_key : string)
    ~(id : string) ~(importance : int) ~(is_new : bool)
    ~(produced : target list) ?result ?run ~(state : suggestion_state)
    ~(state_changed_at : string) ?state_reason ~(status : suggestion_status)
    ~(summary : string) ~(title : string) ~(updated_at : string) () =
  ({
     suggestion_kind;
     about;
     categories;
     created_at;
     dedup_key;
     id;
     importance;
     is_new;
     produced;
     result;
     run;
     state;
     state_changed_at;
     state_reason;
     status;
     summary;
     title;
     updated_at;
   }
    : suggestion)

type nonrec suggestion_changed = {
  message : string;  (** What happened. *)
  suggestion : suggestion;
      (** The suggestion as it is now, to show before acting on it again. *)
}
(** The suggestion changed since the caller read it, or can't run until its
last run settles. *)

let suggestion_changed_of_yojson : Yojson.Safe.t -> suggestion_changed =
 fun json ->
  let fields = Json.obj json in
  {
    message = Json.required fields "message" Json.string;
    suggestion = Json.required fields "suggestion" suggestion_of_yojson;
  }

and yojson_of_suggestion_changed : suggestion_changed -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("message", Some (Json.of_string value.message));
      ("suggestion", Some (yojson_of_suggestion value.suggestion));
    ]

let make_suggestion_changed ~(message : string) ~(suggestion : suggestion) () =
  ({ message; suggestion } : suggestion_changed)

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

let suggestion_feed_of_yojson : Yojson.Safe.t -> suggestion_feed =
 fun json ->
  let fields = Json.obj json in
  {
    counts = Json.required fields "counts" feed_counts_of_yojson;
    done_ = Json.optional fields "done" (Json.list suggestion_of_yojson);
    suggestions =
      Json.required fields "suggestions" (Json.list suggestion_of_yojson);
  }

and yojson_of_suggestion_feed : suggestion_feed -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("counts", Some (yojson_of_feed_counts value.counts));
      ("done", Option.map (Json.of_list yojson_of_suggestion) value.done_);
      ( "suggestions",
        Some ((Json.of_list yojson_of_suggestion) value.suggestions) );
    ]

let make_suggestion_feed ~(counts : feed_counts) ?done_
    ~(suggestions : suggestion list) () =
  ({ counts; done_; suggestions } : suggestion_feed)

type nonrec suggestion_review = {
  kept_left : int;  (** Suggestions this session may still hand back. *)
  suggestions : reviewed_suggestion list;
}
(** Every suggestion AI made for the person, for a routines session. *)

let suggestion_review_of_yojson : Yojson.Safe.t -> suggestion_review =
 fun json ->
  let fields = Json.obj json in
  {
    kept_left = Json.required fields "keptLeft" Json.int;
    suggestions =
      Json.required fields "suggestions"
        (Json.list reviewed_suggestion_of_yojson);
  }

and yojson_of_suggestion_review : suggestion_review -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("keptLeft", Some (Json.of_int value.kept_left));
      ( "suggestions",
        Some ((Json.of_list yojson_of_reviewed_suggestion) value.suggestions) );
    ]

let make_suggestion_review ~(kept_left : int)
    ~(suggestions : reviewed_suggestion list) () =
  ({ kept_left; suggestions } : suggestion_review)

type nonrec suggestion_write_outcome = {
  ok : bool;  (** Whether it was applied. *)
  problems : string list;  (** Why it wasn't, to fix and try again. *)
  suggestion : suggestion option;
}
(** What became of a session's write. *)

let suggestion_write_outcome_of_yojson :
    Yojson.Safe.t -> suggestion_write_outcome =
 fun json ->
  let fields = Json.obj json in
  {
    ok = Json.required fields "ok" Json.bool;
    problems = Json.required fields "problems" (Json.list Json.string);
    suggestion = Json.optional fields "suggestion" suggestion_of_yojson;
  }

and yojson_of_suggestion_write_outcome :
    suggestion_write_outcome -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("ok", Some (Json.of_bool value.ok));
      ("problems", Some ((Json.of_list Json.of_string) value.problems));
      ("suggestion", Option.map yojson_of_suggestion value.suggestion);
    ]

let make_suggestion_write_outcome ~(ok : bool) ~(problems : string list)
    ?suggestion () =
  ({ ok; problems; suggestion } : suggestion_write_outcome)

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

let suggestions_review_of_yojson : Yojson.Safe.t -> suggestions_review =
 fun json ->
  let fields = Json.obj json in
  {
    new_left = Json.required fields "newLeft" Json.int;
    open_ = Json.required fields "open" Json.int;
    open_limit = Json.required fields "openLimit" Json.int;
    suggestions =
      Json.required fields "suggestions" (Json.list suggestion_of_yojson);
  }

and yojson_of_suggestions_review : suggestions_review -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("newLeft", Some (Json.of_int value.new_left));
      ("open", Some (Json.of_int value.open_));
      ("openLimit", Some (Json.of_int value.open_limit));
      ( "suggestions",
        Some ((Json.of_list yojson_of_suggestion) value.suggestions) );
    ]

let make_suggestions_review ~(new_left : int) ~(open_ : int) ~(open_limit : int)
    ~(suggestions : suggestion list) () =
  ({ new_left; open_; open_limit; suggestions } : suggestions_review)

type nonrec regenerate_suggestions_error =
  | Conflict of regeneration_running  (** HTTP 409. *)
  | Too_many_requests of regeneration_cooldown  (** HTTP 429. *)

(** [GET /health] *)
let scheduled_action_health () =
  ({
     Request.service = "scheduled-action";
     operation = "scheduled_action_health";
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

(** [GET /scheduled-actions] *)
let list_scheduled_actions ?include_events ?include_children ?parent () =
  ({
     Request.service = "scheduled-action";
     operation = "list_scheduled_actions";
     meth = `GET;
     path = "/scheduled-actions";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "include_events",
             match include_events with
             | None -> []
             | Some value -> [ string_of_bool value ] );
           ( "include_children",
             match include_children with
             | None -> []
             | Some value -> [ string_of_bool value ] );
           ( "parent",
             match parent with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list scheduled_action_response_of_yojson);
     decode_error = Request.no_error;
   }
    : ( scheduled_action_response list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduled-actions]

Create a routine. A create made by a routine's run, from its code step
or its Ask AI step's session, makes that routine's sub-routine: the
caller's credential says so, never the body. *)
let create_scheduled_action ~(enabled : bool) ~(kind : action_kind)
    ~(name : string) ~(task : routine_task) ~(trigger : action_trigger)
    ?suggestion_id ?key ?description ?run_visibility () =
  ({
     Request.service = "scheduled-action";
     operation = "create_scheduled_action";
     meth = `POST;
     path = "/scheduled-actions";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "suggestion_id",
             match suggestion_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "key",
             match key with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_action_configuration
               ({
                  description;
                  enabled;
                  kind;
                  name;
                  run_visibility;
                  task;
                  trigger;
                }
                 : action_configuration)));
     decode_reply = Request.json scheduled_action_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( scheduled_action_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/catalog] *)
let routine_catalog ~(timezone : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "routine_catalog";
     meth = `GET;
     path = "/scheduled-actions/catalog";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("timezone", [ (fun value -> value) timezone ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list catalog_entry_of_yojson);
     decode_error = Request.no_error;
   }
    : ( catalog_entry list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduled-actions/check]

What saving this routine would find wrong, without saving it: the same
checks as creating it. A routine draft's session hands its draft back
this way. *)
let check_scheduled_action ~(routine : action_configuration) ?created () =
  ({
     Request.service = "scheduled-action";
     operation = "check_scheduled_action";
     meth = `POST;
     path = "/scheduled-actions/check";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_check_routine_request
               ({ created; routine } : check_routine_request)));
     decode_reply = Request.json routine_check_of_yojson;
     decode_error = Request.no_error;
   }
    : ( routine_check,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/draft-jobs] *)
let list_routine_draft_jobs () =
  ({
     Request.service = "scheduled-action";
     operation = "list_routine_draft_jobs";
     meth = `GET;
     path = "/scheduled-actions/draft-jobs";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list draft_job_of_yojson);
     decode_error = Request.no_error;
   }
    : ( draft_job list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduled-actions/draft-jobs] *)
let start_routine_draft_job ~(client_id : string) ~(context : draft_context)
    ~(draft : draft_request) () =
  ({
     Request.service = "scheduled-action";
     operation = "start_routine_draft_job";
     meth = `POST;
     path = "/scheduled-actions/draft-jobs";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_start_draft_job_request
               ({ client_id; context; draft } : start_draft_job_request)));
     decode_reply = Request.json draft_job_of_yojson;
     decode_error =
       Request.error_json [ 402; 503 ] ai_admission_error_body_of_yojson;
   }
    : (draft_job, ai_admission_error_body) Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/draft-jobs/{id}] *)
let get_routine_draft_job ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "get_routine_draft_job";
     meth = `GET;
     path =
       String.concat ""
         [
           "/scheduled-actions/draft-jobs/";
           Request.segment ((fun value -> value) id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json draft_job_of_yojson;
     decode_error = Request.no_error;
   }
    : ( draft_job,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /scheduled-actions/draft-jobs/{id}] *)
let discard_routine_draft_job ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "discard_routine_draft_job";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/scheduled-actions/draft-jobs/";
           Request.segment ((fun value -> value) id);
         ];
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

(** [POST /scheduled-actions/drafts] *)
let draft_routine ~(context : draft_context) ~(draft : draft_request) () =
  ({
     Request.service = "scheduled-action";
     operation = "draft_routine";
     meth = `POST;
     path = "/scheduled-actions/drafts";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_draft_routine_request
               ({ context; draft } : draft_routine_request)));
     decode_reply = Request.json draft_of_yojson;
     decode_error =
       Request.error_json [ 402; 503 ] ai_admission_error_body_of_yojson;
   }
    : (draft, ai_admission_error_body) Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/suggestions] *)
let list_routine_suggestions ?surface () =
  ({
     Request.service = "scheduled-action";
     operation = "list_routine_suggestions";
     meth = `GET;
     path = "/scheduled-actions/suggestions";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "surface",
             match surface with
             | None -> []
             | Some value ->
                 [ (fun value -> Json.string (yojson_of_surface value)) value ]
           );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json routine_suggestions_of_yojson;
     decode_error = Request.no_error;
   }
    : ( routine_suggestions,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduled-actions/suggestions]

Hand back one routine suggestion from a routine suggestion session, the
way a draft's session checks its routine: a catalog routine with knob
values, or a drafted routine, checked as saving checks it. *)
let suggest_routine ~(body : suggest_request) () =
  ({
     Request.service = "scheduled-action";
     operation = "suggest_routine";
     meth = `POST;
     path = "/scheduled-actions/suggestions";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (yojson_of_suggest_request body));
     decode_reply = Request.json suggest_outcome_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggest_outcome,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/suggestions/review]

What a routines generation session reads before managing suggestions. *)
let review_routine_suggestions () =
  ({
     Request.service = "scheduled-action";
     operation = "review_routine_suggestions";
     meth = `GET;
     path = "/scheduled-actions/suggestions/review";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json suggestion_review_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggestion_review,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduled-actions/suggestions/{id}/dismiss] *)
let dismiss_routine_suggestion ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "dismiss_routine_suggestion";
     meth = `POST;
     path =
       String.concat ""
         [
           "/scheduled-actions/suggestions/";
           Request.segment ((fun value -> value) id);
           "/dismiss";
         ];
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

(** [POST /scheduled-actions/suggestions/{id}/retire]

Retire an open suggestion that no longer fits, from a routines
generation session. *)
let retire_routine_suggestion ~(id : string) ~(reason : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "retire_routine_suggestion";
     meth = `POST;
     path =
       String.concat ""
         [
           "/scheduled-actions/suggestions/";
           Request.segment ((fun value -> value) id);
           "/retire";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_retire_suggestion ({ reason } : retire_suggestion)));
     decode_reply = Request.json suggest_outcome_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggest_outcome,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/{id}] *)
let get_scheduled_action ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "get_scheduled_action";
     meth = `GET;
     path =
       String.concat ""
         [ "/scheduled-actions/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json scheduled_action_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( scheduled_action_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /scheduled-actions/{id}] *)
let update_scheduled_action ~(id : string) ~(kind : action_kind)
    ~(name : string) ~(task : routine_task) ~(trigger : action_trigger)
    ?description ?enabled ?run_visibility () =
  ({
     Request.service = "scheduled-action";
     operation = "update_scheduled_action";
     meth = `PUT;
     path =
       String.concat ""
         [ "/scheduled-actions/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_action_configuration_update
               ({
                  description;
                  enabled;
                  kind;
                  name;
                  run_visibility;
                  task;
                  trigger;
                }
                 : action_configuration_update)));
     decode_reply = Request.json scheduled_action_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( scheduled_action_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /scheduled-actions/{id}] *)
let delete_scheduled_action ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "delete_scheduled_action";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/scheduled-actions/"; Request.segment ((fun value -> value) id) ];
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

(** [PUT /scheduled-actions/{id}/appearance] *)
let set_scheduled_action_appearance ~(id : string) ?color ?icon () =
  ({
     Request.service = "scheduled-action";
     operation = "set_scheduled_action_appearance";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/appearance";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_entity_appearance ({ color; icon } : entity_appearance)));
     decode_reply = Request.json entity_appearance_of_yojson;
     decode_error = Request.no_error;
   }
    : ( entity_appearance,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/{id}/code-upgrades] *)
let list_scheduled_action_code_upgrades ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "list_scheduled_action_code_upgrades";
     meth = `GET;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/code-upgrades";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list code_upgrade_of_yojson);
     decode_error = Request.no_error;
   }
    : ( code_upgrade list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduled-actions/{id}/detach]

Keep a sub-routine as the owner's own routine: it moves to the main list
and no longer follows the routine whose run created it. *)
let detach_scheduled_action ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "detach_scheduled_action";
     meth = `POST;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/detach";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json scheduled_action_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( scheduled_action_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /scheduled-actions/{id}/enabled] *)
let set_scheduled_action_enabled ~(id : string) ~(enabled : bool) () =
  ({
     Request.service = "scheduled-action";
     operation = "set_scheduled_action_enabled";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/enabled";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_set_scheduled_action_enabled
               ({ enabled } : set_scheduled_action_enabled)));
     decode_reply = Request.json scheduled_action_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( scheduled_action_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduled-actions/{id}/execute] *)
let execute_scheduled_action_now ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "execute_scheduled_action_now";
     meth = `POST;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/execute";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json in_progress_execution_of_yojson;
     decode_error =
       Request.error_json [ 402; 503 ] ai_admission_error_body_of_yojson;
   }
    : ( in_progress_execution,
        ai_admission_error_body )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/{id}/history] *)
let list_scheduled_action_history ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "list_scheduled_action_history";
     meth = `GET;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/history";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list execution_record_response_of_yojson);
     decode_error = Request.no_error;
   }
    : ( execution_record_response list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduled-actions/{id}/template] *)
let get_scheduled_action_template ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "get_scheduled_action_template";
     meth = `GET;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/template";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json routine_template_of_yojson;
     decode_error = Request.no_error;
   }
    : ( routine_template,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /scheduled-actions/{id}/template] *)
let share_scheduled_action_template ~(id : string) ~(description : string)
    ~(variables : template_variable list) () =
  ({
     Request.service = "scheduled-action";
     operation = "share_scheduled_action_template";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/template";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_share_routine_template
               ({ description; variables } : share_routine_template)));
     decode_reply = Request.json routine_template_of_yojson;
     decode_error = Request.no_error;
   }
    : ( routine_template,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /scheduled-actions/{id}/template] *)
let unshare_scheduled_action_template ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "unshare_scheduled_action_template";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/template";
         ];
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

(** [POST /scheduled-actions/{id}/template/activate] *)
let activate_scheduled_action_template ~(id : string) ~(enabled : bool)
    ~(kind : action_kind) ~(name : string) ~(task : routine_task)
    ~(trigger : action_trigger) ?description ?run_visibility () =
  ({
     Request.service = "scheduled-action";
     operation = "activate_scheduled_action_template";
     meth = `POST;
     path =
       String.concat ""
         [
           "/scheduled-actions/";
           Request.segment ((fun value -> value) id);
           "/template/activate";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_action_configuration
               ({
                  description;
                  enabled;
                  kind;
                  name;
                  run_visibility;
                  task;
                  trigger;
                }
                 : action_configuration)));
     decode_reply = Request.json scheduled_action_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( scheduled_action_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /suggestions]

The caller's feed, for them or their own agent. *)
let list_suggestions ?timezone ?limit () =
  ({
     Request.service = "scheduled-action";
     operation = "list_suggestions";
     meth = `GET;
     path = "/suggestions";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "timezone",
             match timezone with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "limit",
             match limit with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json suggestion_feed_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggestion_feed,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /suggestions]

Add a suggestion from a suggestions generation session, or a new version of the
one with its dedup key. *)
let add_suggestion ~(dedup_key : string) ~(importance : int) ~(kind : kind_name)
    ~(summary : string) ~(title : string) ?about ?action ?categories ?prompt
    ?reason ?run_mode ?sends () =
  ({
     Request.service = "scheduled-action";
     operation = "add_suggestion";
     meth = `POST;
     path = "/suggestions";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_new_suggestion
               ({
                  about;
                  action;
                  categories;
                  dedup_key;
                  importance;
                  kind;
                  prompt;
                  reason;
                  run_mode;
                  sends;
                  summary;
                  title;
                }
                 : new_suggestion)));
     decode_reply = Request.json suggestion_write_outcome_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggestion_write_outcome,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /suggestions/generate]

Start the caller's onboarding generation, once their inbox is connected. *)
let start_suggestion_generation ~(timezone : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "start_suggestion_generation";
     meth = `POST;
     path = "/suggestions/generate";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("timezone", [ (fun value -> value) timezone ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json generation_started_of_yojson;
     decode_error = Request.no_error;
   }
    : ( generation_started,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /suggestions/generation]

The caller's suggestion generations now. *)
let get_suggestion_generation () =
  ({
     Request.service = "scheduled-action";
     operation = "get_suggestion_generation";
     meth = `GET;
     path = "/suggestions/generation";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json generation_overview_of_yojson;
     decode_error = Request.no_error;
   }
    : ( generation_overview,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /suggestions/regenerate]

Start fresh suggestions for the caller: at most once an hour, and not
while one of their generations runs. *)
let regenerate_suggestions ~(timezone : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "regenerate_suggestions";
     meth = `POST;
     path = "/suggestions/regenerate";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("timezone", [ (fun value -> value) timezone ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json generation_started_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 409 ->
             Some
               (Conflict
                  (regeneration_running_of_yojson
                     (Yojson.Safe.from_string body))
                 : regenerate_suggestions_error)
         | 429 ->
             Some
               (Too_many_requests
                  (regeneration_cooldown_of_yojson
                     (Yojson.Safe.from_string body))
                 : regenerate_suggestions_error)
         | _ -> None);
   }
    : ( generation_started,
        regenerate_suggestions_error )
      Macro_sdk_runtime.Request.t)

(** [GET /suggestions/review]

What a suggestions generation session reads before managing suggestions. *)
let review_suggestions () =
  ({
     Request.service = "scheduled-action";
     operation = "review_suggestions";
     meth = `GET;
     path = "/suggestions/review";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json suggestions_review_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggestions_review,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /suggestions/seen]

The caller loaded the app in their time zone. *)
let record_suggestions_seen ~(timezone : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "record_suggestions_seen";
     meth = `POST;
     path = "/suggestions/seen";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("timezone", [ (fun value -> value) timezone ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /suggestions/viewed]

The caller opened their feed: what it showed as new no longer is. The app
sends it once the feed is on screen. *)
let record_suggestions_viewed () =
  ({
     Request.service = "scheduled-action";
     operation = "record_suggestions_viewed";
     meth = `POST;
     path = "/suggestions/viewed";
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

(** [PATCH /suggestions/{id}]

Change an open suggestion from a suggestions generation session. *)
let rewrite_suggestion ~(id : string) ~(reason : string) ?about ?categories
    ?importance ?prompt ?sends ?summary ?title () =
  ({
     Request.service = "scheduled-action";
     operation = "rewrite_suggestion";
     meth = `PATCH;
     path =
       String.concat ""
         [ "/suggestions/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_rewrite_suggestion
               ({
                  about;
                  categories;
                  importance;
                  prompt;
                  reason;
                  sends;
                  summary;
                  title;
                }
                 : rewrite_suggestion)));
     decode_reply = Request.json suggestion_write_outcome_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggestion_write_outcome,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /suggestions/{id}/accept]

The caller, or someone acting for them, acts on a suggestion: a background
prompt suggestion starts its run when the person accepts it in the app (anyone
else only takes it on); a note or prompt is done once they act on it (open its
item or the composer), and shows in the feed's [done]. A routine suggestion is
refused: the person saves its routine in the app, which makes it done. *)
let accept_suggestion ~(id : string) ~(updated_at : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "accept_suggestion";
     meth = `POST;
     path =
       String.concat ""
         [
           "/suggestions/"; Request.segment ((fun value -> value) id); "/accept";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_accept_suggestion_request
               ({ updated_at } : accept_suggestion_request)));
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 409 ] suggestion_changed_of_yojson;
   }
    : (unit, suggestion_changed) Macro_sdk_runtime.Request.t)

(** [POST /suggestions/{id}/dismiss]

The caller, or their own agent, isn't interested in an open suggestion. *)
let dismiss_suggestion ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "dismiss_suggestion";
     meth = `POST;
     path =
       String.concat ""
         [
           "/suggestions/";
           Request.segment ((fun value -> value) id);
           "/dismiss";
         ];
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

(** [PUT /suggestions/{id}/draft]

Make a reply draft a suggestions generation session wrote the draft of an
open reply suggestion. Nothing is sent. *)
let attach_suggestion_draft ~(id : string) ~(email_draft_id : string)
    ~(reason : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "attach_suggestion_draft";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/suggestions/"; Request.segment ((fun value -> value) id); "/draft";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_attach_draft ({ email_draft_id; reason } : attach_draft)));
     decode_reply = Request.json suggestion_write_outcome_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggestion_write_outcome,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /suggestions/{id}/restore]

The caller, or their own agent, takes back dismissing a suggestion, within
five minutes of it. *)
let restore_suggestion ~(id : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "restore_suggestion";
     meth = `POST;
     path =
       String.concat ""
         [
           "/suggestions/";
           Request.segment ((fun value -> value) id);
           "/restore";
         ];
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

(** [POST /suggestions/{id}/retire]

Retire an open suggestion from a suggestions generation session. *)
let retire_suggestion ~(id : string) ~(reason : string) () =
  ({
     Request.service = "scheduled-action";
     operation = "retire_suggestion";
     meth = `POST;
     path =
       String.concat ""
         [
           "/suggestions/"; Request.segment ((fun value -> value) id); "/retire";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_retire_suggestion_request
               ({ reason } : retire_suggestion_request)));
     decode_reply = Request.json suggestion_write_outcome_of_yojson;
     decode_error = Request.no_error;
   }
    : ( suggestion_write_outcome,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)
