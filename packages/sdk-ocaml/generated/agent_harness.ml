(* Generated from packages/sdk/specs/agent-harness.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

(** Ordered from least to most access top -> bottom *)
type nonrec access_level =
  | View
  | Comment
  | Edit
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

let access_level_of_yojson : Yojson.Safe.t -> access_level =
 fun json ->
  match Json.string json with
  | "view" -> View
  | "comment" -> Comment
  | "edit" -> Edit
  | "owner" -> Owner
  | other -> Json.unknown "access_level" json (Unknown other)

and yojson_of_access_level : access_level -> Yojson.Safe.t =
 fun value ->
  match value with
  | View -> `String "view"
  | Comment -> `String "comment"
  | Edit -> `String "edit"
  | Owner -> `String "owner"
  | Unknown other -> `String other

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

type nonrec activity_wire_row = {
  action : string;  (** The stored action tag. *)
  action_payload : Yojson.Safe.t option;
      (** The stored action payload, if any. *)
  actor_id : string;
      (** Who mechanically acted, as a principal string ([macro|…] / [bot|…]). *)
  agent_correlation_id : string option;
      (** Originating code-mode invocation, absent on older events. *)
  agent_verb : string option;  (** SDK display verb, absent on older events. *)
  entity_id : string;  (** The entity acted on. *)
  entity_type : entity_type;  (** The kind of entity acted on. *)
  id : string;  (** The stored activity id. *)
  occurred_at : string;  (** When it happened. *)
  subject_id : string;  (** Whose activity this is (a principal string). *)
}
(** One activity row on the wire — the realtime projection of an inserted
[activity_events] row. *)

let activity_wire_row_of_yojson : Yojson.Safe.t -> activity_wire_row =
 fun json ->
  let fields = Json.obj json in
  {
    action = Json.required fields "action" Json.string;
    action_payload = Json.optional fields "action_payload" Json.json;
    actor_id = Json.required fields "actor_id" Json.string;
    agent_correlation_id =
      Json.optional fields "agent_correlation_id" Json.string;
    agent_verb = Json.optional fields "agent_verb" Json.string;
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    id = Json.required fields "id" Json.string;
    occurred_at = Json.required fields "occurred_at" Json.string;
    subject_id = Json.required fields "subject_id" Json.string;
  }

and yojson_of_activity_wire_row : activity_wire_row -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("action", Some (Json.of_string value.action));
      ("action_payload", Option.map Json.of_json value.action_payload);
      ("actor_id", Some (Json.of_string value.actor_id));
      ( "agent_correlation_id",
        Option.map Json.of_string value.agent_correlation_id );
      ("agent_verb", Option.map Json.of_string value.agent_verb);
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ("id", Some (Json.of_string value.id));
      ("occurred_at", Some (Json.of_string value.occurred_at));
      ("subject_id", Some (Json.of_string value.subject_id));
    ]

let make_activity_wire_row ~(action : string) ?action_payload
    ~(actor_id : string) ?agent_correlation_id ?agent_verb ~(entity_id : string)
    ~(entity_type : entity_type) ~(id : string) ~(occurred_at : string)
    ~(subject_id : string) () =
  ({
     action;
     action_payload;
     actor_id;
     agent_correlation_id;
     agent_verb;
     entity_id;
     entity_type;
     id;
     occurred_at;
     subject_id;
   }
    : activity_wire_row)

type nonrec agent_action_respond_elicitation_type =
  | Respond_elicitation
  | Unknown of string  (** A value this SDK version does not know. *)

let agent_action_respond_elicitation_type_of_yojson :
    Yojson.Safe.t -> agent_action_respond_elicitation_type =
 fun json ->
  match Json.string json with
  | "respondElicitation" -> Respond_elicitation
  | other ->
      Json.unknown "agent_action_respond_elicitation_type" json (Unknown other)

and yojson_of_agent_action_respond_elicitation_type :
    agent_action_respond_elicitation_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Respond_elicitation -> `String "respondElicitation"
  | Unknown other -> `String other

type nonrec prompt_attachment = {
  mime_type : string option;  (** The file's media type, when known. *)
  name : string;  (** Display name, typically the original file name. *)
  size : int64 option;  (** Size in bytes, when known. *)
  uri : string;  (** Where the agent can fetch the file. *)
}
(** A file the prompt refers to, by where the agent can fetch it.

Mirrors ACP's [resource_link] content block, which every agent must
accept: bytes never ride the prompt, only a URI (a static file service URL
in practice) with enough metadata for a client to render a chip and for
the agent to decide whether to fetch it. Keeping the wire shape ACP-native
means the harness translates without resolving anything, and the fold
reads the same fields back off the logged frame. *)

let prompt_attachment_of_yojson : Yojson.Safe.t -> prompt_attachment =
 fun json ->
  let fields = Json.obj json in
  {
    mime_type = Json.optional fields "mimeType" Json.string;
    name = Json.required fields "name" Json.string;
    size = Json.optional fields "size" Json.int64;
    uri = Json.required fields "uri" Json.string;
  }

and yojson_of_prompt_attachment : prompt_attachment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("mimeType", Option.map Json.of_string value.mime_type);
      ("name", Some (Json.of_string value.name));
      ("size", Option.map Json.of_int64 value.size);
      ("uri", Some (Json.of_string value.uri));
    ]

let make_prompt_attachment ?mime_type ~(name : string) ?size ~(uri : string) ()
    =
  ({ mime_type; name; size; uri } : prompt_attachment)

type nonrec agent_prompt_action = {
  attachments : prompt_attachment list option;
      (** Files the prompt refers to, in the order the user attached them.
Delivered after the text as one [resource_link] block each. *)
  prompt : string;  (** What to tell the agent. *)
}
(** Ask the agent to work on something. *)

let agent_prompt_action_of_yojson : Yojson.Safe.t -> agent_prompt_action =
 fun json ->
  let fields = Json.obj json in
  {
    attachments =
      Json.optional fields "attachments" (Json.list prompt_attachment_of_yojson);
    prompt = Json.required fields "prompt" Json.string;
  }

and yojson_of_agent_prompt_action : agent_prompt_action -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attachments",
        Option.map (Json.of_list yojson_of_prompt_attachment) value.attachments
      );
      ("prompt", Some (Json.of_string value.prompt));
    ]

let make_agent_prompt_action ?attachments ~(prompt : string) () =
  ({ attachments; prompt } : agent_prompt_action)

type nonrec agent_set_model_action = {
  model : string;  (** The model slug the agent should switch to. *)
}
(** Ask the agent to run on a different model from here on. *)

let agent_set_model_action_of_yojson : Yojson.Safe.t -> agent_set_model_action =
 fun json ->
  let fields = Json.obj json in
  { model = Json.required fields "model" Json.string }

and yojson_of_agent_set_model_action : agent_set_model_action -> Yojson.Safe.t =
 fun value -> Json.record [ ("model", Some (Json.of_string value.model)) ]

let make_agent_set_model_action ~(model : string) () =
  ({ model } : agent_set_model_action)

type nonrec agent_set_config_option_action = {
  config_id : string;  (** Opaque ACP config id advertised by the agent. *)
  value : string;  (** Opaque select value advertised for that config option. *)
}
(** Ask the agent to change one advertised select-style session setting. *)

let agent_set_config_option_action_of_yojson :
    Yojson.Safe.t -> agent_set_config_option_action =
 fun json ->
  let fields = Json.obj json in
  {
    config_id = Json.required fields "configId" Json.string;
    value = Json.required fields "value" Json.string;
  }

and yojson_of_agent_set_config_option_action :
    agent_set_config_option_action -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("configId", Some (Json.of_string value.config_id));
      ("value", Some (Json.of_string value.value));
    ]

let make_agent_set_config_option_action ~(config_id : string) ~(value : string)
    () =
  ({ config_id; value } : agent_set_config_option_action)

(** A value ACP accepts in an elicitation answer.

Mirrors ACP's [ElicitationContentValue] so that the contract a caller
answers against is the closed union ACP will accept, rather than arbitrary
JSON narrowed on the way out. An object, a null, or a mixed array is
refused when the request is deserialized - where the caller learns of it -
instead of at send time, when the elicitation slot has already been
released. *)
type nonrec elicitation_content_value =
  | String of string
      (** A string, and the shape a whole draft rides in as JSON text. *)
  | Bool of bool  (** A yes/no. *)
  | Int64 of int64  (** A whole number. *)
  | Float of float  (** A number that is not whole. *)
  | List of string list  (** A multi-select's chosen values. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let elicitation_content_value_of_yojson :
    Yojson.Safe.t -> elicitation_content_value =
 fun json ->
  match
    Json.first_ok
      [
        (fun json -> String (Json.string json));
        (fun json -> Bool (Json.bool json));
        (fun json -> Int64 (Json.int64 json));
        (fun json -> Float (Json.float json));
        (fun json -> List ((Json.list Json.string) json));
      ]
      json
  with
  | Some value -> value
  | None -> Json.unknown "elicitation_content_value" json (Unknown json)

and yojson_of_elicitation_content_value :
    elicitation_content_value -> Yojson.Safe.t =
 fun value ->
  match value with
  | String inner -> Json.of_string inner
  | Bool inner -> Json.of_bool inner
  | Int64 inner -> Json.of_int64 inner
  | Float inner -> Json.of_float inner
  | List inner -> (Json.of_list Json.of_string) inner
  | Unknown json -> json

(** What the user decided about an elicitation. Mirrors ACP's three actions;
there is no [Other] because we never originate an action we do not know. *)
type nonrec elicitation_answer =
  | Accept of {
      content : (string * elicitation_content_value) list option;
          (** Form: the submitted values keyed by property. URL: omitted. *)
    }  (** The user submitted the form, or consented to open the URL. *)
  | Decline  (** The user explicitly said no. *)
  | Cancel  (** The user dismissed the request without choosing. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let elicitation_answer_of_yojson : Yojson.Safe.t -> elicitation_answer =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "action" with
  | "accept" ->
      Accept
        {
          content =
            Json.optional fields "content"
              (Json.map elicitation_content_value_of_yojson);
        }
  | "decline" -> Decline
  | "cancel" -> Cancel
  | _ -> Json.unknown "elicitation_answer" json (Unknown json)

and yojson_of_elicitation_answer : elicitation_answer -> Yojson.Safe.t =
 fun value ->
  match value with
  | Accept case ->
      Json.record
        [
          ("action", Some (`String "accept"));
          ( "content",
            Option.map
              (Json.of_map yojson_of_elicitation_content_value)
              case.content );
        ]
  | Decline -> Json.record [ ("action", Some (`String "decline")) ]
  | Cancel -> Json.record [ ("action", Some (`String "cancel")) ]
  | Unknown json -> json

let make_elicitation_answer_accept ?content () =
  (Accept { content } : elicitation_answer)

(** The JSON-RPC id of an agent's [elicitation/create] request, carried whole
so the answer echoes exactly what the agent sent.

Agents pick these, not us: Claude Code counts from [0], others use
strings. [null] is not a legal id for a request that expects a response,
so it is not representable here. *)
type nonrec elicitation_request_id =
  | Int64 of int64
      (** A numeric JSON-RPC id. Specta refuses [i64] (it does not fit a JS
number); agents count their requests from zero, so [i32] is the
honest TypeScript face. *)
  | String of string  (** A string JSON-RPC id. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let elicitation_request_id_of_yojson : Yojson.Safe.t -> elicitation_request_id =
 fun json ->
  match
    Json.first_ok
      [
        (fun json -> Int64 (Json.int64 json));
        (fun json -> String (Json.string json));
      ]
      json
  with
  | Some value -> value
  | None -> Json.unknown "elicitation_request_id" json (Unknown json)

and yojson_of_elicitation_request_id : elicitation_request_id -> Yojson.Safe.t =
 fun value ->
  match value with
  | Int64 inner -> Json.of_int64 inner
  | String inner -> Json.of_string inner
  | Unknown json -> json

(** The decision carried by an \[[AgentPermissionAction]\]. *)
type nonrec permission_answer =
  | Selected of {
      option_id : string;  (** The chosen option's id, as the agent listed it. *)
    }  (** One of the options the agent offered was chosen. *)
  | Cancelled  (** The request was dismissed without choosing. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let permission_answer_of_yojson : Yojson.Safe.t -> permission_answer =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "selected" ->
      Selected { option_id = Json.required fields "optionId" Json.string }
  | "cancelled" -> Cancelled
  | _ -> Json.unknown "permission_answer" json (Unknown json)

and yojson_of_permission_answer : permission_answer -> Yojson.Safe.t =
 fun value ->
  match value with
  | Selected case ->
      Json.record
        [
          ("kind", Some (`String "selected"));
          ("optionId", Some (Json.of_string case.option_id));
        ]
  | Cancelled -> Json.record [ ("kind", Some (`String "cancelled")) ]
  | Unknown json -> json

let make_permission_answer_selected ~(option_id : string) () =
  (Selected { option_id } : permission_answer)

type nonrec agent_permission_action = {
  answer : permission_answer;  (** What the user decided. *)
  request_id : Yojson.Safe.t;
      (** The agent's JSON-RPC request id, echoed verbatim from the folded
permission part. A string or a number on the wire; agents mint both,
and [7] does not answer ["7"]. *)
}
(** A user's answer to the agent's [session/request_permission].

Unlike every other action this is not a new request but the reply to one
the agent made, so it carries the agent's own request id rather than
receiving a server-minted one. *)

let agent_permission_action_of_yojson : Yojson.Safe.t -> agent_permission_action
    =
 fun json ->
  let fields = Json.obj json in
  {
    answer = Json.required fields "answer" permission_answer_of_yojson;
    request_id = Json.required fields "requestId" Json.json;
  }

and yojson_of_agent_permission_action : agent_permission_action -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("answer", Some (yojson_of_permission_answer value.answer));
      ("requestId", Some (Json.of_json value.request_id));
    ]

let make_agent_permission_action ~(answer : permission_answer)
    ~(request_id : Yojson.Safe.t) () =
  ({ answer; request_id } : agent_permission_action)

(** One thing a caller wants an agent to do. *)
type nonrec agent_action =
  | Prompt of agent_prompt_action  (** Send the agent a prompt. *)
  | Set_model of agent_set_model_action
      (** Switch the model the agent runs on. *)
  | Set_config_option of agent_set_config_option_action
      (** Change an agent-advertised select-style session setting. *)
  | Compact  (** Compact the agent's current context. *)
  | Stop  (** Interrupt whatever the agent is doing. *)
  | Respond_elicitation of {
      elicitation_answer : elicitation_answer;  (** The decision. *)
      request_id : elicitation_request_id;
          (** The agent's [elicitation/create] request id - not an
\[[AgentActionId]\], because the agent minted it. *)
    }
      (** Answer an [elicitation/create] the agent sent.

The one action whose wire form is a JSON-RPC *response* rather than a
request or notification: the agent asked, we answer on its id. The
minted \[[AgentActionId]\] therefore never reaches the wire for this
action; the fold correlates on the agent's id instead. *)
  | Respond_to_permission of agent_permission_action
      (** Answer a permission request the agent is waiting on. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let agent_action_of_yojson : Yojson.Safe.t -> agent_action =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "prompt" -> Prompt (agent_prompt_action_of_yojson json)
  | "setModel" -> Set_model (agent_set_model_action_of_yojson json)
  | "setConfigOption" ->
      Set_config_option (agent_set_config_option_action_of_yojson json)
  | "compact" -> Compact
  | "stop" -> Stop
  | "respondElicitation" ->
      Respond_elicitation
        {
          elicitation_answer = elicitation_answer_of_yojson json;
          request_id =
            Json.required fields "requestId" elicitation_request_id_of_yojson;
        }
  | "respondToPermission" ->
      Respond_to_permission (agent_permission_action_of_yojson json)
  | _ -> Json.unknown "agent_action" json (Unknown json)

and yojson_of_agent_action : agent_action -> Yojson.Safe.t =
 fun value ->
  match value with
  | Prompt inner ->
      Json.with_tag "type" "prompt" (yojson_of_agent_prompt_action inner)
  | Set_model inner ->
      Json.with_tag "type" "setModel" (yojson_of_agent_set_model_action inner)
  | Set_config_option inner ->
      Json.with_tag "type" "setConfigOption"
        (yojson_of_agent_set_config_option_action inner)
  | Compact -> Json.record [ ("type", Some (`String "compact")) ]
  | Stop -> Json.record [ ("type", Some (`String "stop")) ]
  | Respond_elicitation case ->
      Json.merge
        [
          Json.record
            [
              ("type", Some (`String "respondElicitation"));
              ( "requestId",
                Some (yojson_of_elicitation_request_id case.request_id) );
            ];
          yojson_of_elicitation_answer case.elicitation_answer;
        ]
  | Respond_to_permission inner ->
      Json.with_tag "type" "respondToPermission"
        (yojson_of_agent_permission_action inner)
  | Unknown json -> json

let make_agent_action_respond_elicitation
    ~(elicitation_answer : elicitation_answer)
    ~(request_id : elicitation_request_id) () =
  (Respond_elicitation { elicitation_answer; request_id } : agent_action)

type nonrec agent_action_id = string
(** Identifies one accepted \[[AgentAction]\] end to end: returned by the
control endpoint, written as the JSON-RPC request id on the action's wire
frame, and read back off that frame as [request_id] on the folded message
it derives.

A v7 uuid, so ids sort by mint time. Minted by the server at accept time,
or by a client that speculated the action and named it in the control
request - either way the server is the only writer of runtime-bound
frames, so a uuid-shaped request id remains the whole ownership test. The
machine's own handshake request ids ([agent_session:{session}:{n}]) are
not uuids and stay [None]. *)

let agent_action_id_of_yojson : Yojson.Safe.t -> agent_action_id =
 fun json -> Json.string json

and yojson_of_agent_action_id : agent_action_id -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec agent_activity_cursor = {
  id : string;  (** Tie-breaking activity identity. *)
  occurred_at : string;  (** Last stored event time. *)
}
(** Stable chronological resume position. *)

let agent_activity_cursor_of_yojson : Yojson.Safe.t -> agent_activity_cursor =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" Json.string;
    occurred_at = Json.required fields "occurredAt" Json.string;
  }

and yojson_of_agent_activity_cursor : agent_activity_cursor -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (Json.of_string value.id));
      ("occurredAt", Some (Json.of_string value.occurred_at));
    ]

let make_agent_activity_cursor ~(id : string) ~(occurred_at : string) () =
  ({ id; occurred_at } : agent_activity_cursor)

type nonrec agent_activity_page = {
  activities : activity_wire_row list;
      (** Original activity rows, also retained in the affected entities' histories. *)
  next_cursor : agent_activity_cursor option;
}
(** One page of the activity caused by this session. *)

let agent_activity_page_of_yojson : Yojson.Safe.t -> agent_activity_page =
 fun json ->
  let fields = Json.obj json in
  {
    activities =
      Json.required fields "activities" (Json.list activity_wire_row_of_yojson);
    next_cursor =
      Json.optional fields "nextCursor" agent_activity_cursor_of_yojson;
  }

and yojson_of_agent_activity_page : agent_activity_page -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "activities",
        Some ((Json.of_list yojson_of_activity_wire_row) value.activities) );
      ( "nextCursor",
        Option.map yojson_of_agent_activity_cursor value.next_cursor );
    ]

let make_agent_activity_page ~(activities : activity_wire_row list) ?next_cursor
    () =
  ({ activities; next_cursor } : agent_activity_page)

type nonrec bot_id = string

let bot_id_of_yojson : Yojson.Safe.t -> bot_id = fun json -> Json.string json

and yojson_of_bot_id : bot_id -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec macro_user_id_str = string

let macro_user_id_str_of_yojson : Yojson.Safe.t -> macro_user_id_str =
 fun json -> Json.string json

and yojson_of_macro_user_id_str : macro_user_id_str -> Yojson.Safe.t =
 fun value -> Json.of_string value

(** The first non-agent cause. An agent cannot be one, so a chain always ends
at a person or a routine. *)
type nonrec root =
  | Person of { user : macro_user_id_str  (** Who. *) }  (** A person. *)
  | Routine of { routine : string  (** The routine. *) }  (** A routine. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let root_of_yojson : Yojson.Safe.t -> root =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "person" ->
      Person { user = Json.required fields "user" macro_user_id_str_of_yojson }
  | "routine" ->
      Routine { routine = Json.required fields "routine" Json.string }
  | _ -> Json.unknown "root" json (Unknown json)

and yojson_of_root : root -> Yojson.Safe.t =
 fun value ->
  match value with
  | Person case ->
      Json.record
        [
          ("type", Some (`String "person"));
          ("user", Some (yojson_of_macro_user_id_str case.user));
        ]
  | Routine case ->
      Json.record
        [
          ("type", Some (`String "routine"));
          ("routine", Some (Json.of_string case.routine));
        ]
  | Unknown json -> json

let make_root_person ~(user : macro_user_id_str) () = (Person { user } : root)
let make_root_routine ~(routine : string) () = (Routine { routine } : root)

(** Where an acting agent's work came from. *)
type nonrec lineage =
  | Session of {
      root : root;  (** The first non-agent cause of its work. *)
      session : string;  (** The acting session. *)
    }  (** The session the agent acted from, and so where the chain started. *)
  | Unattributed  (** An agent acted, but its session was not captured. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let lineage_of_yojson : Yojson.Safe.t -> lineage =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "session" ->
      Session
        {
          root = Json.required fields "root" root_of_yojson;
          session = Json.required fields "session" Json.string;
        }
  | "unattributed" -> Unattributed
  | _ -> Json.unknown "lineage" json (Unknown json)

and yojson_of_lineage : lineage -> Yojson.Safe.t =
 fun value ->
  match value with
  | Session case ->
      Json.record
        [
          ("type", Some (`String "session"));
          ("root", Some (yojson_of_root case.root));
          ("session", Some (Json.of_string case.session));
        ]
  | Unattributed -> Json.record [ ("type", Some (`String "unattributed")) ]
  | Unknown json -> json

let make_lineage_session ~(root : root) ~(session : string) () =
  (Session { root; session } : lineage)

type nonrec agent_actor = {
  bot : bot_id;  (** The agent. *)
  lineage : lineage;  (** Where the agent's own work came from. *)
  on_behalf_of : macro_user_id_str;  (** The person it acts for. *)
}
(** An agent acting for a person. *)

let agent_actor_of_yojson : Yojson.Safe.t -> agent_actor =
 fun json ->
  let fields = Json.obj json in
  {
    bot = Json.required fields "bot" bot_id_of_yojson;
    lineage = Json.required fields "lineage" lineage_of_yojson;
    on_behalf_of =
      Json.required fields "on_behalf_of" macro_user_id_str_of_yojson;
  }

and yojson_of_agent_actor : agent_actor -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bot", Some (yojson_of_bot_id value.bot));
      ("lineage", Some (yojson_of_lineage value.lineage));
      ("on_behalf_of", Some (yojson_of_macro_user_id_str value.on_behalf_of));
    ]

let make_agent_actor ~(bot : bot_id) ~(lineage : lineage)
    ~(on_behalf_of : macro_user_id_str) () =
  ({ bot; lineage; on_behalf_of } : agent_actor)

type nonrec agent_config_select_option_dto = {
  description : string option;
      (** Optional provider description of this value. *)
  group : string option;
      (** Optional group heading supplied by the provider. *)
  name : string;  (** Display label. *)
  value : string;  (** Opaque value returned to the agent when selected. *)
}
(** One value in an agent-advertised select. *)

let agent_config_select_option_dto_of_yojson :
    Yojson.Safe.t -> agent_config_select_option_dto =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    group = Json.optional fields "group" Json.string;
    name = Json.required fields "name" Json.string;
    value = Json.required fields "value" Json.string;
  }

and yojson_of_agent_config_select_option_dto :
    agent_config_select_option_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("group", Option.map Json.of_string value.group);
      ("name", Some (Json.of_string value.name));
      ("value", Some (Json.of_string value.value));
    ]

let make_agent_config_select_option_dto ?description ?group ~(name : string)
    ~(value : string) () =
  ({ description; group; name; value } : agent_config_select_option_dto)

(** Type-specific state for one agent session setting. *)
type nonrec agent_config_kind_dto =
  | Select of {
      current_value : string;  (** Current opaque value. *)
      options : agent_config_select_option_dto list;
          (** Ordered values supplied by the agent. *)
    }  (** A single-value selector. *)
  | Boolean of { current_value : bool  (** Current value. *) }
      (** An on/off setting. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let agent_config_kind_dto_of_yojson : Yojson.Safe.t -> agent_config_kind_dto =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "select" ->
      Select
        {
          current_value = Json.required fields "currentValue" Json.string;
          options =
            Json.required fields "options"
              (Json.list agent_config_select_option_dto_of_yojson);
        }
  | "boolean" ->
      Boolean { current_value = Json.required fields "currentValue" Json.bool }
  | _ -> Json.unknown "agent_config_kind_dto" json (Unknown json)

and yojson_of_agent_config_kind_dto : agent_config_kind_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Select case ->
      Json.record
        [
          ("type", Some (`String "select"));
          ("currentValue", Some (Json.of_string case.current_value));
          ( "options",
            Some
              ((Json.of_list yojson_of_agent_config_select_option_dto)
                 case.options) );
        ]
  | Boolean case ->
      Json.record
        [
          ("type", Some (`String "boolean"));
          ("currentValue", Some (Json.of_bool case.current_value));
        ]
  | Unknown json -> json

let make_agent_config_kind_dto_select ~(current_value : string)
    ~(options : agent_config_select_option_dto list) () =
  (Select { current_value; options } : agent_config_kind_dto)

let make_agent_config_kind_dto_boolean ~(current_value : bool) () =
  (Boolean { current_value } : agent_config_kind_dto)

type nonrec agent_config_option_dto = {
  agent_config_kind_dto : agent_config_kind_dto;
      (** Type-specific current value and choices. *)
  category : string option;
      (** ACP semantic category, such as [model] or [thought_level]. *)
  description : string option;  (** Optional explanatory copy. *)
  id : string;  (** Opaque id used to change this setting. *)
  name : string;  (** Display label supplied by the agent. *)
}
(** One agent-advertised ACP session setting. *)

let agent_config_option_dto_of_yojson : Yojson.Safe.t -> agent_config_option_dto
    =
 fun json ->
  let fields = Json.obj json in
  {
    agent_config_kind_dto = agent_config_kind_dto_of_yojson json;
    category = Json.optional fields "category" Json.string;
    description = Json.optional fields "description" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_agent_config_option_dto : agent_config_option_dto -> Yojson.Safe.t
    =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("category", Option.map Json.of_string value.category);
          ("description", Option.map Json.of_string value.description);
          ("id", Some (Json.of_string value.id));
          ("name", Some (Json.of_string value.name));
        ];
      yojson_of_agent_config_kind_dto value.agent_config_kind_dto;
    ]

let make_agent_config_option_dto
    ~(agent_config_kind_dto : agent_config_kind_dto) ?category ?description
    ~(id : string) ~(name : string) () =
  ({ agent_config_kind_dto; category; description; id; name }
    : agent_config_option_dto)

type nonrec agent_conversation_session_dto = {
  created_at : string;  (** When the session began. *)
  is_current : bool;  (** Whether this is the current agent context. *)
  session_id : string;
      (** Session whose controls and live events belong to this context. *)
}
(** One session a conversation has run on; every channel message stays visible. *)

let agent_conversation_session_dto_of_yojson :
    Yojson.Safe.t -> agent_conversation_session_dto =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "createdAt" Json.string;
    is_current = Json.required fields "isCurrent" Json.bool;
    session_id = Json.required fields "sessionId" Json.string;
  }

and yojson_of_agent_conversation_session_dto :
    agent_conversation_session_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Some (Json.of_string value.created_at));
      ("isCurrent", Some (Json.of_bool value.is_current));
      ("sessionId", Some (Json.of_string value.session_id));
    ]

let make_agent_conversation_session_dto ~(created_at : string)
    ~(is_current : bool) ~(session_id : string) () =
  ({ created_at; is_current; session_id } : agent_conversation_session_dto)

(** The state of one source message, retained after completion for deduplication. *)
type nonrec conversation_turn_state =
  | Queued
  | Running
  | Succeeded
  | Failed
  | Stopped
  | Interrupted
  | Unknown of string  (** A value this SDK version does not know. *)

let conversation_turn_state_of_yojson : Yojson.Safe.t -> conversation_turn_state
    =
 fun json ->
  match Json.string json with
  | "queued" -> Queued
  | "running" -> Running
  | "succeeded" -> Succeeded
  | "failed" -> Failed
  | "stopped" -> Stopped
  | "interrupted" -> Interrupted
  | other -> Json.unknown "conversation_turn_state" json (Unknown other)

and yojson_of_conversation_turn_state : conversation_turn_state -> Yojson.Safe.t
    =
 fun value ->
  match value with
  | Queued -> `String "queued"
  | Running -> `String "running"
  | Succeeded -> `String "succeeded"
  | Failed -> `String "failed"
  | Stopped -> `String "stopped"
  | Interrupted -> `String "interrupted"
  | Unknown other -> `String other

type nonrec agent_conversation_turn_dto = {
  action_id : string;  (** Current runtime attempt identity. *)
  created_at : string;  (** When the source message was first accepted. *)
  reply_message_id : string option;
      (** The associated agent reply, if it has been posted. *)
  retryable : bool;
      (** Whether Retry would be accepted now. A failed attempt is not retryable
until its reply says how it ended. *)
  session_id : string;  (** Session carrying this turn. *)
  source_message_id : string;
      (** The user's message in the channel timeline. *)
  state : conversation_turn_state;  (** Durable execution state. *)
}
(** Execution status without exposing the persona prompt or stored credentials. *)

let agent_conversation_turn_dto_of_yojson :
    Yojson.Safe.t -> agent_conversation_turn_dto =
 fun json ->
  let fields = Json.obj json in
  {
    action_id = Json.required fields "actionId" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    reply_message_id = Json.optional fields "replyMessageId" Json.string;
    retryable = Json.required fields "retryable" Json.bool;
    session_id = Json.required fields "sessionId" Json.string;
    source_message_id = Json.required fields "sourceMessageId" Json.string;
    state = Json.required fields "state" conversation_turn_state_of_yojson;
  }

and yojson_of_agent_conversation_turn_dto :
    agent_conversation_turn_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("actionId", Some (Json.of_string value.action_id));
      ("createdAt", Some (Json.of_string value.created_at));
      ("replyMessageId", Option.map Json.of_string value.reply_message_id);
      ("retryable", Some (Json.of_bool value.retryable));
      ("sessionId", Some (Json.of_string value.session_id));
      ("sourceMessageId", Some (Json.of_string value.source_message_id));
      ("state", Some (yojson_of_conversation_turn_state value.state));
    ]

let make_agent_conversation_turn_dto ~(action_id : string)
    ~(created_at : string) ?reply_message_id ~(retryable : bool)
    ~(session_id : string) ~(source_message_id : string)
    ~(state : conversation_turn_state) () =
  ({
     action_id;
     created_at;
     reply_message_id;
     retryable;
     session_id;
     source_message_id;
     state;
   }
    : agent_conversation_turn_dto)

type nonrec agent_conversation_dto = {
  available : bool;  (** Whether the caller may currently send a new prompt. *)
  avatar_url : string option;  (** Optional persona avatar. *)
  bot_id : string;  (** Persona id (without the bot principal prefix). *)
  channel_id : string;  (** The channel containing the visible transcript. *)
  name : string;  (** Persona's historical display name. *)
  sessions : agent_conversation_session_dto list;
      (** The sessions the conversation has run on, oldest first. *)
  settings_changed : bool;
      (** Whether new persona settings are available to adopt explicitly. *)
  turns : agent_conversation_turn_dto list;
      (** Persistent state of each accepted message and its current attempt. *)
}
(** An agent's conversation in a channel, as the person it is with sees it. *)

let agent_conversation_dto_of_yojson : Yojson.Safe.t -> agent_conversation_dto =
 fun json ->
  let fields = Json.obj json in
  {
    available = Json.required fields "available" Json.bool;
    avatar_url = Json.optional fields "avatarUrl" Json.string;
    bot_id = Json.required fields "botId" Json.string;
    channel_id = Json.required fields "channelId" Json.string;
    name = Json.required fields "name" Json.string;
    sessions =
      Json.required fields "sessions"
        (Json.list agent_conversation_session_dto_of_yojson);
    settings_changed = Json.required fields "settingsChanged" Json.bool;
    turns =
      Json.required fields "turns"
        (Json.list agent_conversation_turn_dto_of_yojson);
  }

and yojson_of_agent_conversation_dto : agent_conversation_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("available", Some (Json.of_bool value.available));
      ("avatarUrl", Option.map Json.of_string value.avatar_url);
      ("botId", Some (Json.of_string value.bot_id));
      ("channelId", Some (Json.of_string value.channel_id));
      ("name", Some (Json.of_string value.name));
      ( "sessions",
        Some
          ((Json.of_list yojson_of_agent_conversation_session_dto)
             value.sessions) );
      ("settingsChanged", Some (Json.of_bool value.settings_changed));
      ( "turns",
        Some ((Json.of_list yojson_of_agent_conversation_turn_dto) value.turns)
      );
    ]

let make_agent_conversation_dto ~(available : bool) ?avatar_url
    ~(bot_id : string) ~(channel_id : string) ~(name : string)
    ~(sessions : agent_conversation_session_dto list) ~(settings_changed : bool)
    ~(turns : agent_conversation_turn_dto list) () =
  ({
     available;
     avatar_url;
     bot_id;
     channel_id;
     name;
     sessions;
     settings_changed;
     turns;
   }
    : agent_conversation_dto)

type nonrec agent_conversations_dto = {
  conversations : agent_conversation_dto list;
      (** Empty for ordinary channels and other people's conversations. *)
}
(** The agent conversations in a channel the caller may see. *)

let agent_conversations_dto_of_yojson : Yojson.Safe.t -> agent_conversations_dto
    =
 fun json ->
  let fields = Json.obj json in
  {
    conversations =
      Json.required fields "conversations"
        (Json.list agent_conversation_dto_of_yojson);
  }

and yojson_of_agent_conversations_dto : agent_conversations_dto -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ( "conversations",
        Some
          ((Json.of_list yojson_of_agent_conversation_dto) value.conversations)
      );
    ]

let make_agent_conversations_dto ~(conversations : agent_conversation_dto list)
    () =
  ({ conversations } : agent_conversations_dto)

(** Which kind of agent a prompt is sent to. *)
type nonrec agent_mode =
  | Chat
  | Code
  | Unknown of string  (** A value this SDK version does not know. *)

let agent_mode_of_yojson : Yojson.Safe.t -> agent_mode =
 fun json ->
  match Json.string json with
  | "chat" -> Chat
  | "code" -> Code
  | other -> Json.unknown "agent_mode" json (Unknown other)

and yojson_of_agent_mode : agent_mode -> Yojson.Safe.t =
 fun value ->
  match value with
  | Chat -> `String "chat"
  | Code -> `String "code"
  | Unknown other -> `String other

type nonrec agent_mode_choice_request = {
  prompt : string;  (** The prompt the composer is about to send. *)
}
(** Request body for [POST /agent-mode-choice]. *)

let agent_mode_choice_request_of_yojson :
    Yojson.Safe.t -> agent_mode_choice_request =
 fun json ->
  let fields = Json.obj json in
  { prompt = Json.required fields "prompt" Json.string }

and yojson_of_agent_mode_choice_request :
    agent_mode_choice_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("prompt", Some (Json.of_string value.prompt)) ]

let make_agent_mode_choice_request ~(prompt : string) () =
  ({ prompt } : agent_mode_choice_request)

type nonrec agent_mode_choice_response = {
  mode : agent_mode;  (** Which kind of agent should receive the prompt. *)
}
(** Response body for [POST /agent-mode-choice]. *)

let agent_mode_choice_response_of_yojson :
    Yojson.Safe.t -> agent_mode_choice_response =
 fun json ->
  let fields = Json.obj json in
  { mode = Json.required fields "mode" agent_mode_of_yojson }

and yojson_of_agent_mode_choice_response :
    agent_mode_choice_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("mode", Some (yojson_of_agent_mode value.mode)) ]

let make_agent_mode_choice_response ~(mode : agent_mode) () =
  ({ mode } : agent_mode_choice_response)

type nonrec agent_model_dto = {
  description : string option;  (** Optional provider description. *)
  group : string option;
      (** Optional group heading supplied by the provider. *)
  id : string;  (** Provider model id. *)
  name : string;  (** Display name. *)
  supports_images : bool option;
      (** Image input support, absent when the runtime does not advertise it. *)
}
(** One model picker option. *)

let agent_model_dto_of_yojson : Yojson.Safe.t -> agent_model_dto =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    group = Json.optional fields "group" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    supports_images = Json.optional fields "supportsImages" Json.bool;
  }

and yojson_of_agent_model_dto : agent_model_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("group", Option.map Json.of_string value.group);
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("supportsImages", Option.map Json.of_bool value.supports_images);
    ]

let make_agent_model_dto ?description ?group ~(id : string) ~(name : string)
    ?supports_images () =
  ({ description; group; id; name; supports_images } : agent_model_dto)

(** Model-selection availability returned over HTTP. *)
type nonrec agent_models_status_dto =
  | Available
  | Unsupported
  | Unknown of string  (** A value this SDK version does not know. *)

let agent_models_status_dto_of_yojson : Yojson.Safe.t -> agent_models_status_dto
    =
 fun json ->
  match Json.string json with
  | "available" -> Available
  | "unsupported" -> Unsupported
  | other -> Json.unknown "agent_models_status_dto" json (Unknown other)

and yojson_of_agent_models_status_dto : agent_models_status_dto -> Yojson.Safe.t
    =
 fun value ->
  match value with
  | Available -> `String "available"
  | Unsupported -> `String "unsupported"
  | Unknown other -> `String other

type nonrec agent_repository_dto = {
  default_branch : string option;
      (** The branch a clone checks out, and where a session starts when its
request selects this repository without a [repoBranch]. Absent for a
repository with no commits. *)
  url : string;
      (** The canonical [https://github.com/owner/name] url, in the form
[POST /agent-sessions] accepts as [repoUrl]. *)
}
(** One repository the caller can select for a coding session. *)

let agent_repository_dto_of_yojson : Yojson.Safe.t -> agent_repository_dto =
 fun json ->
  let fields = Json.obj json in
  {
    default_branch = Json.optional fields "defaultBranch" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_agent_repository_dto : agent_repository_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("defaultBranch", Option.map Json.of_string value.default_branch);
      ("url", Some (Json.of_string value.url));
    ]

let make_agent_repository_dto ?default_branch ~(url : string) () =
  ({ default_branch; url } : agent_repository_dto)

type nonrec agent_repositories_response = {
  repositories : agent_repository_dto list;
      (** Every repository the caller reaches through Macro's GitHub App, sorted
by [owner/name]. Empty when the App is installed nowhere the caller
has a claim to. *)
}
(** Response body for [GET /agent-repositories]. *)

let agent_repositories_response_of_yojson :
    Yojson.Safe.t -> agent_repositories_response =
 fun json ->
  let fields = Json.obj json in
  {
    repositories =
      Json.required fields "repositories"
        (Json.list agent_repository_dto_of_yojson);
  }

and yojson_of_agent_repositories_response :
    agent_repositories_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "repositories",
        Some ((Json.of_list yojson_of_agent_repository_dto) value.repositories)
      );
    ]

let make_agent_repositories_response ~(repositories : agent_repository_dto list)
    () =
  ({ repositories } : agent_repositories_response)

type nonrec agent_repository_branches_response = {
  branches : string list;
      (** Branch names on the repository, in the order GitHub returned them.
Empty when the repository has no commits yet. *)
}
(** Response body for [GET /agent-repositories/branches]. *)

let agent_repository_branches_response_of_yojson :
    Yojson.Safe.t -> agent_repository_branches_response =
 fun json ->
  let fields = Json.obj json in
  { branches = Json.required fields "branches" (Json.list Json.string) }

and yojson_of_agent_repository_branches_response :
    agent_repository_branches_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("branches", Some ((Json.of_list Json.of_string) value.branches)) ]

let make_agent_repository_branches_response ~(branches : string list) () =
  ({ branches } : agent_repository_branches_response)

type nonrec agent_respond_elicitation_action = {
  elicitation_answer : elicitation_answer;  (** The decision. *)
  request_id : elicitation_request_id;
      (** The agent's [elicitation/create] request id - not an
\[[AgentActionId]\], because the agent minted it. *)
}
(** Answer an elicitation the agent is waiting on. *)

let agent_respond_elicitation_action_of_yojson :
    Yojson.Safe.t -> agent_respond_elicitation_action =
 fun json ->
  let fields = Json.obj json in
  {
    elicitation_answer = elicitation_answer_of_yojson json;
    request_id =
      Json.required fields "requestId" elicitation_request_id_of_yojson;
  }

and yojson_of_agent_respond_elicitation_action :
    agent_respond_elicitation_action -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("requestId", Some (yojson_of_elicitation_request_id value.request_id));
        ];
      yojson_of_elicitation_answer value.elicitation_answer;
    ]

let make_agent_respond_elicitation_action
    ~(elicitation_answer : elicitation_answer)
    ~(request_id : elicitation_request_id) () =
  ({ elicitation_answer; request_id } : agent_respond_elicitation_action)

type nonrec agent_session_changes_patch_response = {
  patch : string;  (** The git-style unified diff of the current changeset. *)
}
(** Response body for [GET /agent-sessions/{session_id}/changes/patch].

Clients deserialize this, so both derives are used. *)

let agent_session_changes_patch_response_of_yojson :
    Yojson.Safe.t -> agent_session_changes_patch_response =
 fun json ->
  let fields = Json.obj json in
  { patch = Json.required fields "patch" Json.string }

and yojson_of_agent_session_changes_patch_response :
    agent_session_changes_patch_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("patch", Some (Json.of_string value.patch)) ]

let make_agent_session_changes_patch_response ~(patch : string) () =
  ({ patch } : agent_session_changes_patch_response)

(** How the latest capture attempt ended, on the wire. *)
type nonrec capture_outcome_dto =
  | Captured
  | Not_ready
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let capture_outcome_dto_of_yojson : Yojson.Safe.t -> capture_outcome_dto =
 fun json ->
  match Json.string json with
  | "captured" -> Captured
  | "not_ready" -> Not_ready
  | "failed" -> Failed
  | other -> Json.unknown "capture_outcome_dto" json (Unknown other)

and yojson_of_capture_outcome_dto : capture_outcome_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Captured -> `String "captured"
  | Not_ready -> `String "not_ready"
  | Failed -> `String "failed"
  | Unknown other -> `String other

type nonrec capture_attempt_dto = {
  error : string option;
      (** Why it did not capture, in a sentence the user can read. *)
  finished_at : string option;  (** When it ended; absent while it runs. *)
  outcome : capture_outcome_dto option;
  started_at : string;  (** When it started. *)
}
(** The latest capture attempt.

Clients deserialize this, so both derives are used. *)

let capture_attempt_dto_of_yojson : Yojson.Safe.t -> capture_attempt_dto =
 fun json ->
  let fields = Json.obj json in
  {
    error = Json.optional fields "error" Json.string;
    finished_at = Json.optional fields "finishedAt" Json.string;
    outcome = Json.optional fields "outcome" capture_outcome_dto_of_yojson;
    started_at = Json.required fields "startedAt" Json.string;
  }

and yojson_of_capture_attempt_dto : capture_attempt_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("error", Option.map Json.of_string value.error);
      ("finishedAt", Option.map Json.of_string value.finished_at);
      ("outcome", Option.map yojson_of_capture_outcome_dto value.outcome);
      ("startedAt", Some (Json.of_string value.started_at));
    ]

let make_capture_attempt_dto ?error ?finished_at ?outcome ~(started_at : string)
    () =
  ({ error; finished_at; outcome; started_at } : capture_attempt_dto)

type nonrec git_ref_dto = {
  name : string option;  (** The branch name, when known. *)
  sha : string option;  (** The commit, when known. *)
}
(** One end of the compared range. *)

let git_ref_dto_of_yojson : Yojson.Safe.t -> git_ref_dto =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.optional fields "name" Json.string;
    sha = Json.optional fields "sha" Json.string;
  }

and yojson_of_git_ref_dto : git_ref_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Option.map Json.of_string value.name);
      ("sha", Option.map Json.of_string value.sha);
    ]

let make_git_ref_dto ?name ?sha () = ({ name; sha } : git_ref_dto)

(** What happened to a file, on the wire. *)
type nonrec file_change_kind_dto =
  | Added
  | Modified
  | Deleted
  | Renamed
  | Unknown of string  (** A value this SDK version does not know. *)

let file_change_kind_dto_of_yojson : Yojson.Safe.t -> file_change_kind_dto =
 fun json ->
  match Json.string json with
  | "added" -> Added
  | "modified" -> Modified
  | "deleted" -> Deleted
  | "renamed" -> Renamed
  | other -> Json.unknown "file_change_kind_dto" json (Unknown other)

and yojson_of_file_change_kind_dto : file_change_kind_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Added -> `String "added"
  | Modified -> `String "modified"
  | Deleted -> `String "deleted"
  | Renamed -> `String "renamed"
  | Unknown other -> `String other

type nonrec changed_file_dto = {
  additions : int;  (** Lines added. *)
  binary : bool;  (** The diff carries no text for this file. *)
  deletions : int;  (** Lines removed. *)
  kind : file_change_kind_dto;  (** What happened to the file. *)
  patch_omitted : bool;
      (** The file's hunks were left out of the patch to fit the size budget. *)
  path : string;
      (** The file's path after the change, or before it for a deletion. *)
  previous_path : string option;  (** Where a renamed file came from. *)
}
(** One changed file.

Clients deserialize this, so both derives are used. *)

let changed_file_dto_of_yojson : Yojson.Safe.t -> changed_file_dto =
 fun json ->
  let fields = Json.obj json in
  {
    additions = Json.required fields "additions" Json.int;
    binary = Json.required fields "binary" Json.bool;
    deletions = Json.required fields "deletions" Json.int;
    kind = Json.required fields "kind" file_change_kind_dto_of_yojson;
    patch_omitted = Json.required fields "patchOmitted" Json.bool;
    path = Json.required fields "path" Json.string;
    previous_path = Json.optional fields "previousPath" Json.string;
  }

and yojson_of_changed_file_dto : changed_file_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("additions", Some (Json.of_int value.additions));
      ("binary", Some (Json.of_bool value.binary));
      ("deletions", Some (Json.of_int value.deletions));
      ("kind", Some (yojson_of_file_change_kind_dto value.kind));
      ("patchOmitted", Some (Json.of_bool value.patch_omitted));
      ("path", Some (Json.of_string value.path));
      ("previousPath", Option.map Json.of_string value.previous_path);
    ]

let make_changed_file_dto ~(additions : int) ~(binary : bool) ~(deletions : int)
    ~(kind : file_change_kind_dto) ~(patch_omitted : bool) ~(path : string)
    ?previous_path () =
  ({ additions; binary; deletions; kind; patch_omitted; path; previous_path }
    : changed_file_dto)

(** The source of a changeset's diff, on the wire. *)
type nonrec changeset_source_dto =
  | Github_pull_request
  | Unknown of string  (** A value this SDK version does not know. *)

let changeset_source_dto_of_yojson : Yojson.Safe.t -> changeset_source_dto =
 fun json ->
  match Json.string json with
  | "github_pull_request" -> Github_pull_request
  | other -> Json.unknown "changeset_source_dto" json (Unknown other)

and yojson_of_changeset_source_dto : changeset_source_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Github_pull_request -> `String "github_pull_request"
  | Unknown other -> `String other

type nonrec changeset_dto = {
  additions : int;  (** Lines added across all files. *)
  base : git_ref_dto;  (** The side the work started from. *)
  captured_at : string;  (** When the diff was taken. *)
  deletions : int;  (** Lines removed across all files. *)
  files : changed_file_dto list;  (** Every changed file, in patch order. *)
  head : git_ref_dto;  (** The side carrying the work. *)
  id : string;
      (** The changeset's id; a different id means different changes. *)
  patch_bytes : int64;
      (** Size of the patch the matching patch route serves; zero when nothing
changed. *)
  repository : string option;
      (** [https://github.com/owner/name], when known. *)
  source : changeset_source_dto;  (** Where the diff was read from. *)
  truncated : bool;  (** Some files' hunks were left out of the patch. *)
}
(** One changeset: the files a patch touches and what happened to each.

Clients deserialize this, so both derives are used. *)

let changeset_dto_of_yojson : Yojson.Safe.t -> changeset_dto =
 fun json ->
  let fields = Json.obj json in
  {
    additions = Json.required fields "additions" Json.int;
    base = Json.required fields "base" git_ref_dto_of_yojson;
    captured_at = Json.required fields "capturedAt" Json.string;
    deletions = Json.required fields "deletions" Json.int;
    files = Json.required fields "files" (Json.list changed_file_dto_of_yojson);
    head = Json.required fields "head" git_ref_dto_of_yojson;
    id = Json.required fields "id" Json.string;
    patch_bytes = Json.required fields "patchBytes" Json.int64;
    repository = Json.optional fields "repository" Json.string;
    source = Json.required fields "source" changeset_source_dto_of_yojson;
    truncated = Json.required fields "truncated" Json.bool;
  }

and yojson_of_changeset_dto : changeset_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("additions", Some (Json.of_int value.additions));
      ("base", Some (yojson_of_git_ref_dto value.base));
      ("capturedAt", Some (Json.of_string value.captured_at));
      ("deletions", Some (Json.of_int value.deletions));
      ("files", Some ((Json.of_list yojson_of_changed_file_dto) value.files));
      ("head", Some (yojson_of_git_ref_dto value.head));
      ("id", Some (Json.of_string value.id));
      ("patchBytes", Some (Json.of_int64 value.patch_bytes));
      ("repository", Option.map Json.of_string value.repository);
      ("source", Some (yojson_of_changeset_source_dto value.source));
      ("truncated", Some (Json.of_bool value.truncated));
    ]

let make_changeset_dto ~(additions : int) ~(base : git_ref_dto)
    ~(captured_at : string) ~(deletions : int) ~(files : changed_file_dto list)
    ~(head : git_ref_dto) ~(id : string) ~(patch_bytes : int64) ?repository
    ~(source : changeset_source_dto) ~(truncated : bool) () =
  ({
     additions;
     base;
     captured_at;
     deletions;
     files;
     head;
     id;
     patch_bytes;
     repository;
     source;
     truncated;
   }
    : changeset_dto)

type nonrec agent_session_changes_response = {
  attempt : capture_attempt_dto option;
  capturing : bool;  (** A capture is running right now. *)
  changeset : changeset_dto option;
}
(** Response body for [GET /agent-sessions/{session_id}/changes].

Clients deserialize this, so both derives are used. *)

let agent_session_changes_response_of_yojson :
    Yojson.Safe.t -> agent_session_changes_response =
 fun json ->
  let fields = Json.obj json in
  {
    attempt = Json.optional fields "attempt" capture_attempt_dto_of_yojson;
    capturing = Json.required fields "capturing" Json.bool;
    changeset = Json.optional fields "changeset" changeset_dto_of_yojson;
  }

and yojson_of_agent_session_changes_response :
    agent_session_changes_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attempt", Option.map yojson_of_capture_attempt_dto value.attempt);
      ("capturing", Some (Json.of_bool value.capturing));
      ("changeset", Option.map yojson_of_changeset_dto value.changeset);
    ]

let make_agent_session_changes_response ?attempt ~(capturing : bool) ?changeset
    () =
  ({ attempt; capturing; changeset } : agent_session_changes_response)

type nonrec session_bot = {
  avatar_url : string option;  (** Avatar, when it has one. *)
  handle : string;  (** Stable [@] handle, without a leading [@]. *)
  id : bot_id;
      (** The bot's id. A message it sent has ["bot|{id}"] as its sender. *)
  name : string;  (** Display name. *)
}
(** The agent behind a session, as much of it as rendering a message needs. *)

let session_bot_of_yojson : Yojson.Safe.t -> session_bot =
 fun json ->
  let fields = Json.obj json in
  {
    avatar_url = Json.optional fields "avatarUrl" Json.string;
    handle = Json.required fields "handle" Json.string;
    id = Json.required fields "id" bot_id_of_yojson;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_session_bot : session_bot -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("avatarUrl", Option.map Json.of_string value.avatar_url);
      ("handle", Some (Json.of_string value.handle));
      ("id", Some (yojson_of_bot_id value.id));
      ("name", Some (Json.of_string value.name));
    ]

let make_session_bot ?avatar_url ~(handle : string) ~(id : bot_id)
    ~(name : string) () =
  ({ avatar_url; handle; id; name } : session_bot)

type nonrec agent_session_folded_log_response = {
  bot : session_bot;
      (** The agent whose messages these are; it sent every agent message. *)
  messages : Yojson.Safe.t list;
      (** The conversation, oldest first: prompts, replies, tool calls and their
results, plans, permission requests and how each turn ended. Each
element is a [FoldedMessage] from the fold's TypeScript contract,
which the SDK exports; the schema is opaque here because those types
are described with specta rather than utoipa. *)
}
(** Response body for one session's folded log. *)

let agent_session_folded_log_response_of_yojson :
    Yojson.Safe.t -> agent_session_folded_log_response =
 fun json ->
  let fields = Json.obj json in
  {
    bot = Json.required fields "bot" session_bot_of_yojson;
    messages = Json.required fields "messages" (Json.list Json.json);
  }

and yojson_of_agent_session_folded_log_response :
    agent_session_folded_log_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bot", Some (yojson_of_session_bot value.bot));
      ("messages", Some ((Json.of_list Json.of_json) value.messages));
    ]

let make_agent_session_folded_log_response ~(bot : session_bot)
    ~(messages : Yojson.Safe.t list) () =
  ({ bot; messages } : agent_session_folded_log_response)

(** Which way a logged frame travelled, mirroring \[[Message]\]'s discriminant. *)
type nonrec log_direction_dto =
  | Notification
  | To_server
  | To_runtime
  | Unknown of string  (** A value this SDK version does not know. *)

let log_direction_dto_of_yojson : Yojson.Safe.t -> log_direction_dto =
 fun json ->
  match Json.string json with
  | "notification" -> Notification
  | "to_server" -> To_server
  | "to_runtime" -> To_runtime
  | other -> Json.unknown "log_direction_dto" json (Unknown other)

and yojson_of_log_direction_dto : log_direction_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Notification -> `String "notification"
  | To_server -> `String "to_server"
  | To_runtime -> `String "to_runtime"
  | Unknown other -> `String other

type nonrec agent_session_log_entry_dto = {
  content : Yojson.Safe.t;
      (** The protocol envelope, verbatim. Opaque here: it is Agent Runtime
Protocol, whose shape belongs to the fold rather than this endpoint. *)
  direction : log_direction_dto;  (** Which way the frame travelled. *)
  created_at : string;
      (** When the log recorded the frame.

The frame itself carries no time, so this comes from the log row. It is
what a reader has to order these against anything else it is showing
beside them - the fold derives an order among the messages of one
session and nothing more. *)
  id : string;
      (** Durable transport row identity; together with [createdAt], its order cursor. *)
  user_id : string option;
      (** The user whose action produced the frame, absent when no user did.

Only prompts carry one, and only when the frame was attributed at the
time - a replayed or recorded session's are anonymous. *)
}
(** One entry of a session's protocol log.

Serializes as [{"userId": ..., "direction": ..., "content": ...}] - the
frame's own two fields, flattened in beside the attribution, which is the
same shape a recorded session's JSONL carries. A reader can deserialize the
[direction]/[content] pair straight back into the fold's own log type
rather than through a transport vocabulary of its own.

[agentSessionId] is not repeated per entry: every entry in a response
belongs to the session named once at the top.

[Deserialize] is for the wire-contract tests only - nothing server-side
decodes its own response type. *)

let agent_session_log_entry_dto_of_yojson :
    Yojson.Safe.t -> agent_session_log_entry_dto =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.required fields "content" Json.json;
    direction = Json.required fields "direction" log_direction_dto_of_yojson;
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    user_id = Json.optional fields "userId" Json.string;
  }

and yojson_of_agent_session_log_entry_dto :
    agent_session_log_entry_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Some (Json.of_json value.content));
      ("direction", Some (yojson_of_log_direction_dto value.direction));
      ("createdAt", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("userId", Option.map Json.of_string value.user_id);
    ]

let make_agent_session_log_entry_dto ~(content : Yojson.Safe.t)
    ~(direction : log_direction_dto) ~(created_at : string) ~(id : string)
    ?user_id () =
  ({ content; direction; created_at; id; user_id }
    : agent_session_log_entry_dto)

type nonrec agent_session_log_response = {
  bot : session_bot;
      (** The agent whose messages the log derives.

Here because a client renders those messages and cannot otherwise work
out who sent them: the sender of an agent message is this session's
bot, and nothing else names it. *)
  entries : agent_session_log_entry_dto list;
      (** Effective history in ascending [(createdAt, id)] order.
The first row is the inclusive history boundary cursor: buffered rows
before it are obsolete. Reconcile snapshot overlap by row ID, never content.
An empty history has no boundary or overlapping rows. *)
}
(** Response body for one session's raw protocol log.

A wrapper rather than a bare array so that anything which is about the
response rather than about a frame has somewhere to go later without
breaking every client. *)

let agent_session_log_response_of_yojson :
    Yojson.Safe.t -> agent_session_log_response =
 fun json ->
  let fields = Json.obj json in
  {
    bot = Json.required fields "bot" session_bot_of_yojson;
    entries =
      Json.required fields "entries"
        (Json.list agent_session_log_entry_dto_of_yojson);
  }

and yojson_of_agent_session_log_response :
    agent_session_log_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bot", Some (yojson_of_session_bot value.bot));
      ( "entries",
        Some
          ((Json.of_list yojson_of_agent_session_log_entry_dto) value.entries)
      );
    ]

let make_agent_session_log_response ~(bot : session_bot)
    ~(entries : agent_session_log_entry_dto list) () =
  ({ bot; entries } : agent_session_log_response)

(** Transport representation of a session's status, mirroring
\[[SessionStatus]\]. *)
type nonrec session_status_dto =
  | No_messages  (** No status updates received. *)
  | Event of {
      event : string;
          (** The wire name of the system event, e.g. [acp_ready]. *)
    }  (** The last system event received from the runtime. *)
  | Disconnected
      (** The session disconnected without sending a closed event. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let session_status_dto_of_yojson : Yojson.Safe.t -> session_status_dto =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "no_messages" -> No_messages
  | "event" -> Event { event = Json.required fields "event" Json.string }
  | "disconnected" -> Disconnected
  | _ -> Json.unknown "session_status_dto" json (Unknown json)

and yojson_of_session_status_dto : session_status_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | No_messages -> Json.record [ ("kind", Some (`String "no_messages")) ]
  | Event case ->
      Json.record
        [
          ("kind", Some (`String "event"));
          ("event", Some (Json.of_string case.event));
        ]
  | Disconnected -> Json.record [ ("kind", Some (`String "disconnected")) ]
  | Unknown json -> json

let make_session_status_dto_event ~(event : string) () =
  (Event { event } : session_status_dto)

type nonrec agent_session_preview_data = {
  bot : session_bot option;
  bot_id : string;  (** The bot running the agent. *)
  created_at : string;  (** When the session was created. *)
  id : string;  (** The session id. *)
  modified_at : string;  (** When the session was last modified. *)
  name : string;  (** User-facing session name. *)
  owner_id : string;  (** The user who owns the session. *)
  status : session_status_dto;  (** The session's last known status. *)
}
(** The fields a chip renders for a session the caller may view.

Clients deserialize this, so both derives are used. *)

let agent_session_preview_data_of_yojson :
    Yojson.Safe.t -> agent_session_preview_data =
 fun json ->
  let fields = Json.obj json in
  {
    bot = Json.optional fields "bot" session_bot_of_yojson;
    bot_id = Json.required fields "botId" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    modified_at = Json.required fields "modifiedAt" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "ownerId" Json.string;
    status = Json.required fields "status" session_status_dto_of_yojson;
  }

and yojson_of_agent_session_preview_data :
    agent_session_preview_data -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bot", Option.map yojson_of_session_bot value.bot);
      ("botId", Some (Json.of_string value.bot_id));
      ("createdAt", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("modifiedAt", Some (Json.of_string value.modified_at));
      ("name", Some (Json.of_string value.name));
      ("ownerId", Some (Json.of_string value.owner_id));
      ("status", Some (yojson_of_session_status_dto value.status));
    ]

let make_agent_session_preview_data ?bot ~(bot_id : string)
    ~(created_at : string) ~(id : string) ~(modified_at : string)
    ~(name : string) ~(owner_id : string) ~(status : session_status_dto) () =
  ({ bot; bot_id; created_at; id; modified_at; name; owner_id; status }
    : agent_session_preview_data)

type nonrec with_agent_session_id = { id : string  (** The session id. *) }
(** Just a session id, for the preview variants that carry nothing else.

Clients deserialize this, so both derives are used. *)

let with_agent_session_id_of_yojson : Yojson.Safe.t -> with_agent_session_id =
 fun json ->
  let fields = Json.obj json in
  { id = Json.required fields "id" Json.string }

and yojson_of_with_agent_session_id : with_agent_session_id -> Yojson.Safe.t =
 fun value -> Json.record [ ("id", Some (Json.of_string value.id)) ]

let make_with_agent_session_id ~(id : string) () =
  ({ id } : with_agent_session_id)

(** What one requested id resolved to, on the wire.

Tagged the same way the chat and document preview endpoints tag theirs
([type] in [access] / [no_access] / [does_not_exist]), so a client that
renders those chips can render this one with the same branch.

Clients deserialize this, so both derives are used. *)
type nonrec agent_session_preview_dto =
  | Access of agent_session_preview_data
      (** The caller may view the session. *)
  | No_access of with_agent_session_id
      (** The session exists but the caller holds no grant on it. *)
  | Does_not_exist of with_agent_session_id
      (** No session with this id exists. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let agent_session_preview_dto_of_yojson :
    Yojson.Safe.t -> agent_session_preview_dto =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "access" -> Access (agent_session_preview_data_of_yojson json)
  | "no_access" -> No_access (with_agent_session_id_of_yojson json)
  | "does_not_exist" -> Does_not_exist (with_agent_session_id_of_yojson json)
  | _ -> Json.unknown "agent_session_preview_dto" json (Unknown json)

and yojson_of_agent_session_preview_dto :
    agent_session_preview_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Access inner ->
      Json.with_tag "type" "access" (yojson_of_agent_session_preview_data inner)
  | No_access inner ->
      Json.with_tag "type" "no_access" (yojson_of_with_agent_session_id inner)
  | Does_not_exist inner ->
      Json.with_tag "type" "does_not_exist"
        (yojson_of_with_agent_session_id inner)
  | Unknown json -> json

type nonrec queued_action_dto = {
  action_id : agent_action_id;  (** The id the action was accepted under. *)
  actor_user_id : string option;
      (** The user who queued it, absent when a bot acted on nobody's behalf. *)
  attachments : prompt_attachment list option;
      (** Files the prompt refers to, for prompts only. Kept through an edit,
which replaces the text alone. *)
  created_at : string;  (** When it was accepted. *)
  kind : string;
      (** What kind of action waits - [prompt] or [compact]; only
turn-occupying actions are ever queued. *)
  prompt : string option;
      (** The prompt's raw text, present for prompts only. What an edit
replaces. *)
}
(** One action waiting in a session's queue.

Clients deserialize this, so both derives are used. *)

let queued_action_dto_of_yojson : Yojson.Safe.t -> queued_action_dto =
 fun json ->
  let fields = Json.obj json in
  {
    action_id = Json.required fields "actionId" agent_action_id_of_yojson;
    actor_user_id = Json.optional fields "actorUserId" Json.string;
    attachments =
      Json.optional fields "attachments" (Json.list prompt_attachment_of_yojson);
    created_at = Json.required fields "createdAt" Json.string;
    kind = Json.required fields "kind" Json.string;
    prompt = Json.optional fields "prompt" Json.string;
  }

and yojson_of_queued_action_dto : queued_action_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("actionId", Some (yojson_of_agent_action_id value.action_id));
      ("actorUserId", Option.map Json.of_string value.actor_user_id);
      ( "attachments",
        Option.map (Json.of_list yojson_of_prompt_attachment) value.attachments
      );
      ("createdAt", Some (Json.of_string value.created_at));
      ("kind", Some (Json.of_string value.kind));
      ("prompt", Option.map Json.of_string value.prompt);
    ]

let make_queued_action_dto ~(action_id : agent_action_id) ?actor_user_id
    ?attachments ~(created_at : string) ~(kind : string) ?prompt () =
  ({ action_id; actor_user_id; attachments; created_at; kind; prompt }
    : queued_action_dto)

type nonrec agent_session_queue_response = {
  entries : queued_action_dto list;
      (** The waiting actions, in dispatch order. *)
}
(** Response body for a session's queue: everything waiting, oldest first.

A wrapper rather than a bare array so that anything which is about the
response rather than about an entry has somewhere to go later without
breaking every client. *)

let agent_session_queue_response_of_yojson :
    Yojson.Safe.t -> agent_session_queue_response =
 fun json ->
  let fields = Json.obj json in
  {
    entries =
      Json.required fields "entries" (Json.list queued_action_dto_of_yojson);
  }

and yojson_of_agent_session_queue_response :
    agent_session_queue_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "entries",
        Some ((Json.of_list yojson_of_queued_action_dto) value.entries) );
    ]

let make_agent_session_queue_response ~(entries : queued_action_dto list) () =
  ({ entries } : agent_session_queue_response)

(** Who or what archived a session. *)
type nonrec archive_cause =
  | User
  | Pull_request_merged
  | Runtime_closed
  | Unknown of string  (** A value this SDK version does not know. *)

let archive_cause_of_yojson : Yojson.Safe.t -> archive_cause =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "pull_request_merged" -> Pull_request_merged
  | "runtime_closed" -> Runtime_closed
  | other -> Json.unknown "archive_cause" json (Unknown other)

and yojson_of_archive_cause : archive_cause -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Pull_request_merged -> `String "pull_request_merged"
  | Runtime_closed -> `String "runtime_closed"
  | Unknown other -> `String other

type nonrec external_session_response = {
  name : string option;
      (** The provider's display name for the agent, when it reported one. *)
  provider : string;  (** Which provider serves the session, e.g. [cursor]. *)
  url : string option;
      (** The agent's page on the provider's site, for a client to link out to. *)
}
(** The provider-side identity of an externally-served session. *)

let external_session_response_of_yojson :
    Yojson.Safe.t -> external_session_response =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.optional fields "name" Json.string;
    provider = Json.required fields "provider" Json.string;
    url = Json.optional fields "url" Json.string;
  }

and yojson_of_external_session_response :
    external_session_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Option.map Json.of_string value.name);
      ("provider", Some (Json.of_string value.provider));
      ("url", Option.map Json.of_string value.url);
    ]

let make_external_session_response ?name ~(provider : string) ?url () =
  ({ name; provider; url } : external_session_response)

(** Who did something that opened a session. *)
type nonrec caller =
  | Person of { user : macro_user_id_str  (** Who. *) }  (** A person. *)
  | Agent of agent_actor
      (** An agent, which always acts for a person on a path that opens a session. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let caller_of_yojson : Yojson.Safe.t -> caller =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "person" ->
      Person { user = Json.required fields "user" macro_user_id_str_of_yojson }
  | "agent" -> Agent (agent_actor_of_yojson json)
  | _ -> Json.unknown "caller" json (Unknown json)

and yojson_of_caller : caller -> Yojson.Safe.t =
 fun value ->
  match value with
  | Person case ->
      Json.record
        [
          ("type", Some (`String "person"));
          ("user", Some (yojson_of_macro_user_id_str case.user));
        ]
  | Agent inner -> Json.with_tag "type" "agent" (yojson_of_agent_actor inner)
  | Unknown json -> json

let make_caller_person ~(user : macro_user_id_str) () =
  (Person { user } : caller)

(** What made a routine fire. *)
type nonrec routine_cause =
  | Scheduled  (** One of its schedules came due. *)
  | Manual  (** Its owner started it by hand. *)
  | Event of { event_id : string  (** The event. *) }
      (** An event it watches happened. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let routine_cause_of_yojson : Yojson.Safe.t -> routine_cause =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "scheduled" -> Scheduled
  | "manual" -> Manual
  | "event" -> Event { event_id = Json.required fields "event_id" Json.string }
  | _ -> Json.unknown "routine_cause" json (Unknown json)

and yojson_of_routine_cause : routine_cause -> Yojson.Safe.t =
 fun value ->
  match value with
  | Scheduled -> Json.record [ ("type", Some (`String "scheduled")) ]
  | Manual -> Json.record [ ("type", Some (`String "manual")) ]
  | Event case ->
      Json.record
        [
          ("type", Some (`String "event"));
          ("event_id", Some (Json.of_string case.event_id));
        ]
  | Unknown json -> json

let make_routine_cause_event ~(event_id : string) () =
  (Event { event_id } : routine_cause)

(** What opened a session. *)
type nonrec trigger_origin =
  | Mentioned of {
      by : caller;  (** Who posted it. *)
      message_id : string;  (** The message. *)
    }  (** A message mentioned the agent. *)
  | Conversation of {
      by : macro_user_id_str;  (** Who wrote. *)
      message_id : string;  (** The message. *)
    }  (** A person wrote in their private conversation with the agent. *)
  | Task_assigned of {
      by : caller;  (** Who assigned it. *)
      task : string;  (** The task. *)
    }  (** The agent was added to a task's assignees. *)
  | Project_inherited of {
      by : caller;  (** Who added the task to the project. *)
      project : string;  (** The project. *)
      task : string;  (** The task. *)
    }  (** The task joined a project, and inherited the project's agents. *)
  | Requested of { by : macro_user_id_str  (** Who opened it. *) }
      (** A person opened the session directly: from the composer, or by asking for a routine draft. *)
  | Dispatched of {
      on_behalf_of : macro_user_id_str;
          (** The user whose authority the work runs under. *)
    }
      (** A tool handed the agent work. The tool knows only whose authority it
runs under, not which agent called it. *)
  | Routine of {
      firing : routine_cause;  (** What made it fire. *)
      routine : string;  (** The routine. *)
    }
      (** A routine fired. Its owner owns the session, so the owner is not repeated. *)
  | Unknown_
      (** Not known: an unclaimed warm session, a producer that predates this
record, or a kind this build does not know. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let trigger_origin_of_yojson : Yojson.Safe.t -> trigger_origin =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "origin" with
  | "mentioned" ->
      Mentioned
        {
          by = Json.required fields "by" caller_of_yojson;
          message_id = Json.required fields "message_id" Json.string;
        }
  | "conversation" ->
      Conversation
        {
          by = Json.required fields "by" macro_user_id_str_of_yojson;
          message_id = Json.required fields "message_id" Json.string;
        }
  | "task_assigned" ->
      Task_assigned
        {
          by = Json.required fields "by" caller_of_yojson;
          task = Json.required fields "task" Json.string;
        }
  | "project_inherited" ->
      Project_inherited
        {
          by = Json.required fields "by" caller_of_yojson;
          project = Json.required fields "project" Json.string;
          task = Json.required fields "task" Json.string;
        }
  | "requested" ->
      Requested { by = Json.required fields "by" macro_user_id_str_of_yojson }
  | "dispatched" ->
      Dispatched
        {
          on_behalf_of =
            Json.required fields "on_behalf_of" macro_user_id_str_of_yojson;
        }
  | "routine" ->
      Routine
        {
          firing = Json.required fields "firing" routine_cause_of_yojson;
          routine = Json.required fields "routine" Json.string;
        }
  | "unknown" -> Unknown_
  | _ -> Json.unknown "trigger_origin" json (Unknown json)

and yojson_of_trigger_origin : trigger_origin -> Yojson.Safe.t =
 fun value ->
  match value with
  | Mentioned case ->
      Json.record
        [
          ("origin", Some (`String "mentioned"));
          ("by", Some (yojson_of_caller case.by));
          ("message_id", Some (Json.of_string case.message_id));
        ]
  | Conversation case ->
      Json.record
        [
          ("origin", Some (`String "conversation"));
          ("by", Some (yojson_of_macro_user_id_str case.by));
          ("message_id", Some (Json.of_string case.message_id));
        ]
  | Task_assigned case ->
      Json.record
        [
          ("origin", Some (`String "task_assigned"));
          ("by", Some (yojson_of_caller case.by));
          ("task", Some (Json.of_string case.task));
        ]
  | Project_inherited case ->
      Json.record
        [
          ("origin", Some (`String "project_inherited"));
          ("by", Some (yojson_of_caller case.by));
          ("project", Some (Json.of_string case.project));
          ("task", Some (Json.of_string case.task));
        ]
  | Requested case ->
      Json.record
        [
          ("origin", Some (`String "requested"));
          ("by", Some (yojson_of_macro_user_id_str case.by));
        ]
  | Dispatched case ->
      Json.record
        [
          ("origin", Some (`String "dispatched"));
          ("on_behalf_of", Some (yojson_of_macro_user_id_str case.on_behalf_of));
        ]
  | Routine case ->
      Json.record
        [
          ("origin", Some (`String "routine"));
          ("firing", Some (yojson_of_routine_cause case.firing));
          ("routine", Some (Json.of_string case.routine));
        ]
  | Unknown_ -> Json.record [ ("origin", Some (`String "unknown")) ]
  | Unknown json -> json

let make_trigger_origin_mentioned ~(by : caller) ~(message_id : string) () =
  (Mentioned { by; message_id } : trigger_origin)

let make_trigger_origin_conversation ~(by : macro_user_id_str)
    ~(message_id : string) () =
  (Conversation { by; message_id } : trigger_origin)

let make_trigger_origin_task_assigned ~(by : caller) ~(task : string) () =
  (Task_assigned { by; task } : trigger_origin)

let make_trigger_origin_project_inherited ~(by : caller) ~(project : string)
    ~(task : string) () =
  (Project_inherited { by; project; task } : trigger_origin)

let make_trigger_origin_requested ~(by : macro_user_id_str) () =
  (Requested { by } : trigger_origin)

let make_trigger_origin_dispatched ~(on_behalf_of : macro_user_id_str) () =
  (Dispatched { on_behalf_of } : trigger_origin)

let make_trigger_origin_routine ~(firing : routine_cause) ~(routine : string) ()
    =
  (Routine { firing; routine } : trigger_origin)

(** Named compute tier for a managed sandbox.

The API and database store the name. CPU, RAM, and disk live in
[crates/agent_harness/sandbox_sizes.json]. *)
type nonrec sandbox_size =
  | Small
  | Default
  | Large
  | Unknown of string  (** A value this SDK version does not know. *)

let sandbox_size_of_yojson : Yojson.Safe.t -> sandbox_size =
 fun json ->
  match Json.string json with
  | "small" -> Small
  | "default" -> Default
  | "large" -> Large
  | other -> Json.unknown "sandbox_size" json (Unknown other)

and yojson_of_sandbox_size : sandbox_size -> Yojson.Safe.t =
 fun value ->
  match value with
  | Small -> `String "small"
  | Default -> `String "default"
  | Large -> `String "large"
  | Unknown other -> `String other

type nonrec document_id = string
(** A validated document identifier. Historical document ids need not be UUIDs. *)

let document_id_of_yojson : Yojson.Safe.t -> document_id =
 fun json -> Json.string json

and yojson_of_document_id : document_id -> Yojson.Safe.t =
 fun value -> Json.of_string value

(** The entity whose permissions and lifecycle govern a message. *)
type nonrec message_parent =
  | Channel of { id : string  (** A channel, including direct messages. *) }
      (** A channel, including direct messages. *)
  | Document of {
      id : document_id;  (** A document, including tasks and PDFs. *)
    }  (** A document, including tasks and PDFs. *)
  | Initiative of {
      id : string;
          (** An initiative, presented as a project in the application. *)
    }  (** An initiative, presented as a project in the application. *)
  | Crm_company of { id : string  (** A CRM company. *) }  (** A CRM company. *)
  | Crm_contact of { id : string  (** A CRM contact. *) }  (** A CRM contact. *)
  | Call of { id : string  (** A video call and its persistent chat thread. *) }
      (** A video call and its persistent chat thread. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let message_parent_of_yojson : Yojson.Safe.t -> message_parent =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "channel" -> Channel { id = Json.required fields "id" Json.string }
  | "document" ->
      Document { id = Json.required fields "id" document_id_of_yojson }
  | "initiative" -> Initiative { id = Json.required fields "id" Json.string }
  | "crm_company" -> Crm_company { id = Json.required fields "id" Json.string }
  | "crm_contact" -> Crm_contact { id = Json.required fields "id" Json.string }
  | "call" -> Call { id = Json.required fields "id" Json.string }
  | _ -> Json.unknown "message_parent" json (Unknown json)

and yojson_of_message_parent : message_parent -> Yojson.Safe.t =
 fun value ->
  match value with
  | Channel case ->
      Json.record
        [
          ("type", Some (`String "channel"));
          ("id", Some (Json.of_string case.id));
        ]
  | Document case ->
      Json.record
        [
          ("type", Some (`String "document"));
          ("id", Some (yojson_of_document_id case.id));
        ]
  | Initiative case ->
      Json.record
        [
          ("type", Some (`String "initiative"));
          ("id", Some (Json.of_string case.id));
        ]
  | Crm_company case ->
      Json.record
        [
          ("type", Some (`String "crm_company"));
          ("id", Some (Json.of_string case.id));
        ]
  | Crm_contact case ->
      Json.record
        [
          ("type", Some (`String "crm_contact"));
          ("id", Some (Json.of_string case.id));
        ]
  | Call case ->
      Json.record
        [
          ("type", Some (`String "call")); ("id", Some (Json.of_string case.id));
        ]
  | Unknown json -> json

let make_message_parent_channel ~(id : string) () =
  (Channel { id } : message_parent)

let make_message_parent_document ~(id : document_id) () =
  (Document { id } : message_parent)

let make_message_parent_initiative ~(id : string) () =
  (Initiative { id } : message_parent)

let make_message_parent_crm_company ~(id : string) () =
  (Crm_company { id } : message_parent)

let make_message_parent_crm_contact ~(id : string) () =
  (Crm_contact { id } : message_parent)

let make_message_parent_call ~(id : string) () = (Call { id } : message_parent)

type nonrec agent_session_response = {
  acp_session_id : string option;  (** The ACP session id, if one exists. *)
  archived_at : string option;
      (** When the session was archived, or [None] while it is active. *)
  archived_by : archive_cause option;
  bot_id : string;  (** The bot running the agent. *)
  can_edit : bool;
      (** Whether the caller may drive the session - prompt it, answer its
questions, stop it - rather than only watch. Edit access; the
creator owns the session, so a create response always says so. *)
  created_at : string;  (** When the session was created. *)
  external_ : external_session_response option;
  harness : string;  (** Harness slug. *)
  id : string;  (** The session id. *)
  instructions : string option;
      (** Instructions the session's runtime works under, when any were stated
at creation. Absent otherwise, so existing payloads are unchanged. *)
  model : string;  (** Model slug. *)
  modified_at : string;  (** When the session was last modified. *)
  name : string;  (** User-facing session name. *)
  origin : trigger_origin option;
      (** What opened the session: who or what started it, and what it is about.
[unknown] when nothing recorded it. *)
  originating_message_id : string option;
      (** The exact message that invoked the bot, if any. *)
  owner_id : string;  (** The user who created and owns the session. *)
  pull_request_url : string option;  (** The session's linked pull request. *)
  repo_url : string option;
      (** The repository the session works with, when one was stated. *)
  sandbox_size : sandbox_size;  (** Compute tier of the managed sandbox. *)
  status : session_status_dto;  (** The session's status. *)
  task_id : string option;  (** The Macro task the session was linked to. *)
  thread_channel_id : string option;
      (** The channel [thread_id] lives in, when the session was spawned from a
channel thread. Derived from [thread_parent]. *)
  thread_id : string option;
      (** The root message of the thread the session was created from, if any. *)
  thread_parent : message_parent option;
  workspace : string;
      (** The directory the session's harness runs in on its runtime. *)
}
(** Response body describing an agent session.

Clients deserialize this, so both derives are used. *)

let agent_session_response_of_yojson : Yojson.Safe.t -> agent_session_response =
 fun json ->
  let fields = Json.obj json in
  {
    acp_session_id = Json.optional fields "acpSessionId" Json.string;
    archived_at = Json.optional fields "archivedAt" Json.string;
    archived_by = Json.optional fields "archivedBy" archive_cause_of_yojson;
    bot_id = Json.required fields "botId" Json.string;
    can_edit = Json.required fields "canEdit" Json.bool;
    created_at = Json.required fields "createdAt" Json.string;
    external_ =
      Json.optional fields "external" external_session_response_of_yojson;
    harness = Json.required fields "harness" Json.string;
    id = Json.required fields "id" Json.string;
    instructions = Json.optional fields "instructions" Json.string;
    model = Json.required fields "model" Json.string;
    modified_at = Json.required fields "modifiedAt" Json.string;
    name = Json.required fields "name" Json.string;
    origin = Json.optional fields "origin" trigger_origin_of_yojson;
    originating_message_id =
      Json.optional fields "originatingMessageId" Json.string;
    owner_id = Json.required fields "ownerId" Json.string;
    pull_request_url = Json.optional fields "pullRequestUrl" Json.string;
    repo_url = Json.optional fields "repoUrl" Json.string;
    sandbox_size = Json.required fields "sandboxSize" sandbox_size_of_yojson;
    status = Json.required fields "status" session_status_dto_of_yojson;
    task_id = Json.optional fields "taskId" Json.string;
    thread_channel_id = Json.optional fields "threadChannelId" Json.string;
    thread_id = Json.optional fields "threadId" Json.string;
    thread_parent = Json.optional fields "threadParent" message_parent_of_yojson;
    workspace = Json.required fields "workspace" Json.string;
  }

and yojson_of_agent_session_response : agent_session_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("acpSessionId", Option.map Json.of_string value.acp_session_id);
      ("archivedAt", Option.map Json.of_string value.archived_at);
      ("archivedBy", Option.map yojson_of_archive_cause value.archived_by);
      ("botId", Some (Json.of_string value.bot_id));
      ("canEdit", Some (Json.of_bool value.can_edit));
      ("createdAt", Some (Json.of_string value.created_at));
      ( "external",
        Option.map yojson_of_external_session_response value.external_ );
      ("harness", Some (Json.of_string value.harness));
      ("id", Some (Json.of_string value.id));
      ("instructions", Option.map Json.of_string value.instructions);
      ("model", Some (Json.of_string value.model));
      ("modifiedAt", Some (Json.of_string value.modified_at));
      ("name", Some (Json.of_string value.name));
      ("origin", Option.map yojson_of_trigger_origin value.origin);
      ( "originatingMessageId",
        Option.map Json.of_string value.originating_message_id );
      ("ownerId", Some (Json.of_string value.owner_id));
      ("pullRequestUrl", Option.map Json.of_string value.pull_request_url);
      ("repoUrl", Option.map Json.of_string value.repo_url);
      ("sandboxSize", Some (yojson_of_sandbox_size value.sandbox_size));
      ("status", Some (yojson_of_session_status_dto value.status));
      ("taskId", Option.map Json.of_string value.task_id);
      ("threadChannelId", Option.map Json.of_string value.thread_channel_id);
      ("threadId", Option.map Json.of_string value.thread_id);
      ("threadParent", Option.map yojson_of_message_parent value.thread_parent);
      ("workspace", Some (Json.of_string value.workspace));
    ]

let make_agent_session_response ?acp_session_id ?archived_at ?archived_by
    ~(bot_id : string) ~(can_edit : bool) ~(created_at : string) ?external_
    ~(harness : string) ~(id : string) ?instructions ~(model : string)
    ~(modified_at : string) ~(name : string) ?origin ?originating_message_id
    ~(owner_id : string) ?pull_request_url ?repo_url
    ~(sandbox_size : sandbox_size) ~(status : session_status_dto) ?task_id
    ?thread_channel_id ?thread_id ?thread_parent ~(workspace : string) () =
  ({
     acp_session_id;
     archived_at;
     archived_by;
     bot_id;
     can_edit;
     created_at;
     external_;
     harness;
     id;
     instructions;
     model;
     modified_at;
     name;
     origin;
     originating_message_id;
     owner_id;
     pull_request_url;
     repo_url;
     sandbox_size;
     status;
     task_id;
     thread_channel_id;
     thread_id;
     thread_parent;
     workspace;
   }
    : agent_session_response)

(** A kind of action or inactivity the user should see: [permission] to run a tool, an
[elicitation] question or form, a [tool_approval] held for the owner, or [stalled] with no
activity for over 20 minutes. *)
type nonrec agent_update_kind =
  | Permission
  | Elicitation
  | Tool_approval
  | Stalled
  | Unknown of string  (** A value this SDK version does not know. *)

let agent_update_kind_of_yojson : Yojson.Safe.t -> agent_update_kind =
 fun json ->
  match Json.string json with
  | "permission" -> Permission
  | "elicitation" -> Elicitation
  | "tool_approval" -> Tool_approval
  | "stalled" -> Stalled
  | other -> Json.unknown "agent_update_kind" json (Unknown other)

and yojson_of_agent_update_kind : agent_update_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Permission -> `String "permission"
  | Elicitation -> `String "elicitation"
  | Tool_approval -> `String "tool_approval"
  | Stalled -> `String "stalled"
  | Unknown other -> `String other

type nonrec agent_update = {
  harness : string;  (** The runtime the session runs on. *)
  kind : agent_update_kind;  (** What the session is waiting for. *)
  options : string list;
      (** The choices a permission request offers; empty for other kinds. *)
  pull_request_url : string option;
      (** The session's pull request, if it has one. *)
  session_id : string;  (** The session. *)
  session_name : string;  (** The session's name. *)
  since : string;
      (** When the request was made, or the session's last activity. *)
  summary : string;
      (** What is asked, or why the session looks stalled, in at most 240 characters. *)
}
(** One pending interaction, or one stalled session. *)

let agent_update_of_yojson : Yojson.Safe.t -> agent_update =
 fun json ->
  let fields = Json.obj json in
  {
    harness = Json.required fields "harness" Json.string;
    kind = Json.required fields "kind" agent_update_kind_of_yojson;
    options = Json.required fields "options" (Json.list Json.string);
    pull_request_url = Json.optional fields "pullRequestUrl" Json.string;
    session_id = Json.required fields "sessionId" Json.string;
    session_name = Json.required fields "sessionName" Json.string;
    since = Json.required fields "since" Json.string;
    summary = Json.required fields "summary" Json.string;
  }

and yojson_of_agent_update : agent_update -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("harness", Some (Json.of_string value.harness));
      ("kind", Some (yojson_of_agent_update_kind value.kind));
      ("options", Some ((Json.of_list Json.of_string) value.options));
      ("pullRequestUrl", Option.map Json.of_string value.pull_request_url);
      ("sessionId", Some (Json.of_string value.session_id));
      ("sessionName", Some (Json.of_string value.session_name));
      ("since", Some (Json.of_string value.since));
      ("summary", Some (Json.of_string value.summary));
    ]

let make_agent_update ~(harness : string) ~(kind : agent_update_kind)
    ~(options : string list) ?pull_request_url ~(session_id : string)
    ~(session_name : string) ~(since : string) ~(summary : string) () =
  ({
     harness;
     kind;
     options;
     pull_request_url;
     session_id;
     session_name;
     since;
     summary;
   }
    : agent_update)

type nonrec agent_updates = {
  items : agent_update list;
      (** One entry per pending request or stalled session, newest session activity first. *)
  truncated : bool;
      (** Whether qualifying sessions beyond the 25 most recent were left out. *)
  truncation_notice : string option;
      (** Says what was left out, when truncated. *)
}
(** Bounded results; truncation means older qualifying sessions were not folded. *)

let agent_updates_of_yojson : Yojson.Safe.t -> agent_updates =
 fun json ->
  let fields = Json.obj json in
  {
    items = Json.required fields "items" (Json.list agent_update_of_yojson);
    truncated = Json.required fields "truncated" Json.bool;
    truncation_notice = Json.optional fields "truncationNotice" Json.string;
  }

and yojson_of_agent_updates : agent_updates -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("items", Some ((Json.of_list yojson_of_agent_update) value.items));
      ("truncated", Some (Json.of_bool value.truncated));
      ("truncationNotice", Option.map Json.of_string value.truncation_notice);
    ]

let make_agent_updates ~(items : agent_update list) ~(truncated : bool)
    ?truncation_notice () =
  ({ items; truncated; truncation_notice } : agent_updates)

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

type nonrec ai_suggestions = Yojson.Safe.t
(** Editable fields for ai inference, before submission and identity resolution. *)

let ai_suggestions_of_yojson : Yojson.Safe.t -> ai_suggestions =
 fun json -> Json.json json

and yojson_of_ai_suggestions : ai_suggestions -> Yojson.Safe.t =
 fun value -> Json.of_json value

(** How a person answers a held tool call. *)
type nonrec tool_approval_answer_dto =
  | Approve
  | Approve_and_remember
  | Deny
  | Cancel
  | Unknown of string  (** A value this SDK version does not know. *)

let tool_approval_answer_dto_of_yojson :
    Yojson.Safe.t -> tool_approval_answer_dto =
 fun json ->
  match Json.string json with
  | "approve" -> Approve
  | "approve_and_remember" -> Approve_and_remember
  | "deny" -> Deny
  | "cancel" -> Cancel
  | other -> Json.unknown "tool_approval_answer_dto" json (Unknown other)

and yojson_of_tool_approval_answer_dto :
    tool_approval_answer_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Approve -> `String "approve"
  | Approve_and_remember -> `String "approve_and_remember"
  | Deny -> `String "deny"
  | Cancel -> `String "cancel"
  | Unknown other -> `String other

type nonrec answer_tool_approval_request = {
  answer : tool_approval_answer_dto;  (** The answer. *)
}
(** Request body for answering a held tool call. *)

let answer_tool_approval_request_of_yojson :
    Yojson.Safe.t -> answer_tool_approval_request =
 fun json ->
  let fields = Json.obj json in
  { answer = Json.required fields "answer" tool_approval_answer_dto_of_yojson }

and yojson_of_answer_tool_approval_request :
    answer_tool_approval_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("answer", Some (yojson_of_tool_approval_answer_dto value.answer)) ]

let make_answer_tool_approval_request ~(answer : tool_approval_answer_dto) () =
  ({ answer } : answer_tool_approval_request)

(** Where a held tool call stands once answered. *)
type nonrec tool_approval_status_dto =
  | Pending
  | Approved
  | Denied
  | Cancelled
  | Expired
  | Unknown of string  (** A value this SDK version does not know. *)

let tool_approval_status_dto_of_yojson :
    Yojson.Safe.t -> tool_approval_status_dto =
 fun json ->
  match Json.string json with
  | "pending" -> Pending
  | "approved" -> Approved
  | "denied" -> Denied
  | "cancelled" -> Cancelled
  | "expired" -> Expired
  | other -> Json.unknown "tool_approval_status_dto" json (Unknown other)

and yojson_of_tool_approval_status_dto :
    tool_approval_status_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pending -> `String "pending"
  | Approved -> `String "approved"
  | Denied -> `String "denied"
  | Cancelled -> `String "cancelled"
  | Expired -> `String "expired"
  | Unknown other -> `String other

type nonrec answer_tool_approval_response = {
  status : tool_approval_status_dto;  (** Where the call stands now. *)
}
(** Response body for answering a held tool call. *)

let answer_tool_approval_response_of_yojson :
    Yojson.Safe.t -> answer_tool_approval_response =
 fun json ->
  let fields = Json.obj json in
  { status = Json.required fields "status" tool_approval_status_dto_of_yojson }

and yojson_of_answer_tool_approval_response :
    answer_tool_approval_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("status", Some (yojson_of_tool_approval_status_dto value.status)) ]

let make_answer_tool_approval_response ~(status : tool_approval_status_dto) () =
  ({ status } : answer_tool_approval_response)

type nonrec app_connected_request = {
  action_id : agent_action_id option;
  app_slug : string;
      (** The Pipedream app slug the owner connected, e.g. [notion]. *)
}
(** Request body for reporting a connected app. *)

let app_connected_request_of_yojson : Yojson.Safe.t -> app_connected_request =
 fun json ->
  let fields = Json.obj json in
  {
    action_id = Json.optional fields "actionId" agent_action_id_of_yojson;
    app_slug = Json.required fields "appSlug" Json.string;
  }

and yojson_of_app_connected_request : app_connected_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("actionId", Option.map yojson_of_agent_action_id value.action_id);
      ("appSlug", Some (Json.of_string value.app_slug));
    ]

let make_app_connected_request ?action_id ~(app_slug : string) () =
  ({ action_id; app_slug } : app_connected_request)

type nonrec auto_archive_overrides_body = {
  on_pull_request_merged : bool option;
      (** Archive once the session's pull requests merge, or [null] to follow the owner. *)
  on_runtime_closed : bool option;
      (** Archive once the session's runtime session is deliberately closed, or [null] to follow
the owner. *)
}
(** One session's choices over its owner's defaults. [null] follows the owner. *)

let auto_archive_overrides_body_of_yojson :
    Yojson.Safe.t -> auto_archive_overrides_body =
 fun json ->
  let fields = Json.obj json in
  {
    on_pull_request_merged =
      Json.optional fields "onPullRequestMerged" Json.bool;
    on_runtime_closed = Json.optional fields "onRuntimeClosed" Json.bool;
  }

and yojson_of_auto_archive_overrides_body :
    auto_archive_overrides_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "onPullRequestMerged",
        Option.map Json.of_bool value.on_pull_request_merged );
      ("onRuntimeClosed", Option.map Json.of_bool value.on_runtime_closed);
    ]

let make_auto_archive_overrides_body ?on_pull_request_merged ?on_runtime_closed
    () =
  ({ on_pull_request_merged; on_runtime_closed } : auto_archive_overrides_body)

type nonrec auto_archive_preferences_body = {
  on_pull_request_merged : bool;
      (** Archive a session once every pull request linked to it is closed and at least one merged. *)
  on_runtime_closed : bool;
      (** Archive a session once the runtime session backing it is deliberately closed. *)
}
(** Which triggers archive the caller's sessions when a session has no choice of its own. *)

let auto_archive_preferences_body_of_yojson :
    Yojson.Safe.t -> auto_archive_preferences_body =
 fun json ->
  let fields = Json.obj json in
  {
    on_pull_request_merged =
      Json.required fields "onPullRequestMerged" Json.bool;
    on_runtime_closed = Json.required fields "onRuntimeClosed" Json.bool;
  }

and yojson_of_auto_archive_preferences_body :
    auto_archive_preferences_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("onPullRequestMerged", Some (Json.of_bool value.on_pull_request_merged));
      ("onRuntimeClosed", Some (Json.of_bool value.on_runtime_closed));
    ]

let make_auto_archive_preferences_body ~(on_pull_request_merged : bool)
    ~(on_runtime_closed : bool) () =
  ({ on_pull_request_merged; on_runtime_closed }
    : auto_archive_preferences_body)

(** RFC weekday values used by the existing recurrence UI. *)
type nonrec weekday_code =
  | Mo
  | Tu
  | We
  | Th
  | Fr
  | Sa
  | Su
  | Unknown of string  (** A value this SDK version does not know. *)

let weekday_code_of_yojson : Yojson.Safe.t -> weekday_code =
 fun json ->
  match Json.string json with
  | "MO" -> Mo
  | "TU" -> Tu
  | "WE" -> We
  | "TH" -> Th
  | "FR" -> Fr
  | "SA" -> Sa
  | "SU" -> Su
  | other -> Json.unknown "weekday_code" json (Unknown other)

and yojson_of_weekday_code : weekday_code -> Yojson.Safe.t =
 fun value ->
  match value with
  | Mo -> `String "MO"
  | Tu -> `String "TU"
  | We -> `String "WE"
  | Th -> `String "TH"
  | Fr -> `String "FR"
  | Sa -> `String "SA"
  | Su -> `String "SU"
  | Unknown other -> `String other

(** Resolved recurrence ending condition accepted by the shared calendar editor. *)
type nonrec recurrence_end =
  | Never  (** No ending condition. *)
  | After of { count : int  (** Positive occurrence count. *) }
      (** Explicit occurrence limit. *)
  | On of {
      date : string;
          (** Date resolved against the request's clock and timezone. *)
    }  (** Inclusive local ISO date. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let recurrence_end_of_yojson : Yojson.Safe.t -> recurrence_end =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "never" -> Never
  | "after" -> After { count = Json.required fields "count" Json.int }
  | "on" -> On { date = Json.required fields "date" Json.string }
  | _ -> Json.unknown "recurrence_end" json (Unknown json)

and yojson_of_recurrence_end : recurrence_end -> Yojson.Safe.t =
 fun value ->
  match value with
  | Never -> Json.record [ ("kind", Some (`String "never")) ]
  | After case ->
      Json.record
        [
          ("kind", Some (`String "after"));
          ("count", Some (Json.of_int case.count));
        ]
  | On case ->
      Json.record
        [
          ("kind", Some (`String "on"));
          ("date", Some (Json.of_string case.date));
        ]
  | Unknown json -> json

let make_recurrence_end_after ~(count : int) () =
  (After { count } : recurrence_end)

let make_recurrence_end_on ~(date : string) () = (On { date } : recurrence_end)

(** Repetition units supported by the shared calendar editor. *)
type nonrec recurrence_frequency =
  | Daily
  | Weekly
  | Monthly
  | Yearly
  | Unknown of string  (** A value this SDK version does not know. *)

let recurrence_frequency_of_yojson : Yojson.Safe.t -> recurrence_frequency =
 fun json ->
  match Json.string json with
  | "DAILY" -> Daily
  | "WEEKLY" -> Weekly
  | "MONTHLY" -> Monthly
  | "YEARLY" -> Yearly
  | other -> Json.unknown "recurrence_frequency" json (Unknown other)

and yojson_of_recurrence_frequency : recurrence_frequency -> Yojson.Safe.t =
 fun value ->
  match value with
  | Daily -> `String "DAILY"
  | Weekly -> `String "WEEKLY"
  | Monthly -> `String "MONTHLY"
  | Yearly -> `String "YEARLY"
  | Unknown other -> `String other

type nonrec monthly_weekday = {
  ordinal : int;  (** One through five, or minus one for last. *)
  weekday : weekday_code;  (** Weekday selected by the ordinal. *)
}
(** Monthly ordinal weekday, such as the first Friday. *)

let monthly_weekday_of_yojson : Yojson.Safe.t -> monthly_weekday =
 fun json ->
  let fields = Json.obj json in
  {
    ordinal = Json.required fields "ordinal" Json.int;
    weekday = Json.required fields "weekday" weekday_code_of_yojson;
  }

and yojson_of_monthly_weekday : monthly_weekday -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("ordinal", Some (Json.of_int value.ordinal));
      ("weekday", Some (yojson_of_weekday_code value.weekday));
    ]

let make_monthly_weekday ~(ordinal : int) ~(weekday : weekday_code) () =
  ({ ordinal; weekday } : monthly_weekday)

type nonrec recurrence_suggestion = {
  by_day : weekday_code list;  (** Weekly weekday selectors. *)
  ends : recurrence_end;  (** Resolved ending condition. *)
  frequency : recurrence_frequency;  (** Repetition unit. *)
  interval : int;  (** Positive interval. *)
  monthly_by_day : monthly_weekday option;
}
(** Resolved, editable repetition values; the existing calendar serializer builds RRULEs. *)

let recurrence_suggestion_of_yojson : Yojson.Safe.t -> recurrence_suggestion =
 fun json ->
  let fields = Json.obj json in
  {
    by_day = Json.required fields "by_day" (Json.list weekday_code_of_yojson);
    ends = Json.required fields "ends" recurrence_end_of_yojson;
    frequency = Json.required fields "frequency" recurrence_frequency_of_yojson;
    interval = Json.required fields "interval" Json.int;
    monthly_by_day =
      Json.optional fields "monthly_by_day" monthly_weekday_of_yojson;
  }

and yojson_of_recurrence_suggestion : recurrence_suggestion -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("by_day", Some ((Json.of_list yojson_of_weekday_code) value.by_day));
      ("ends", Some (yojson_of_recurrence_end value.ends));
      ("frequency", Some (yojson_of_recurrence_frequency value.frequency));
      ("interval", Some (Json.of_int value.interval));
      ( "monthly_by_day",
        Option.map yojson_of_monthly_weekday value.monthly_by_day );
    ]

let make_recurrence_suggestion ~(by_day : weekday_code list)
    ~(ends : recurrence_end) ~(frequency : recurrence_frequency)
    ~(interval : int) ?monthly_by_day () =
  ({ by_day; ends; frequency; interval; monthly_by_day }
    : recurrence_suggestion)

type nonrec calendar_suggestions = {
  body : string option;
      (** Suggested Markdown content or outgoing message body. *)
  end_ : string option;
      (** Event end as a local wall-clock value in the request's timezone. *)
  guests : string list option;
      (** Only populated when an invitation was explicitly requested. *)
  location : string option;  (** Human-readable event venue or meeting URL. *)
  recurrence : recurrence_suggestion option;
  start : string option;
      (** Local wall-clock values, interpreted in the request's IANA timezone. *)
  start_assumption : string option;
      (** Verbatim clock phrase whose missing AM/PM required an editable assumption. *)
  title : string option;  (** Suggested note, task, or event title. *)
}
(** Editable fields for calendar inference, before submission and identity resolution. *)

let calendar_suggestions_of_yojson : Yojson.Safe.t -> calendar_suggestions =
 fun json ->
  let fields = Json.obj json in
  {
    body = Json.optional fields "body" Json.string;
    end_ = Json.optional fields "end" Json.string;
    guests = Json.optional fields "guests" (Json.list Json.string);
    location = Json.optional fields "location" Json.string;
    recurrence =
      Json.optional fields "recurrence" recurrence_suggestion_of_yojson;
    start = Json.optional fields "start" Json.string;
    start_assumption = Json.optional fields "start_assumption" Json.string;
    title = Json.optional fields "title" Json.string;
  }

and yojson_of_calendar_suggestions : calendar_suggestions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("body", Option.map Json.of_string value.body);
      ("end", Option.map Json.of_string value.end_);
      ("guests", Option.map (Json.of_list Json.of_string) value.guests);
      ("location", Option.map Json.of_string value.location);
      ("recurrence", Option.map yojson_of_recurrence_suggestion value.recurrence);
      ("start", Option.map Json.of_string value.start);
      ("start_assumption", Option.map Json.of_string value.start_assumption);
      ("title", Option.map Json.of_string value.title);
    ]

let make_calendar_suggestions ?body ?end_ ?guests ?location ?recurrence ?start
    ?start_assumption ?title () =
  ({ body; end_; guests; location; recurrence; start; start_assumption; title }
    : calendar_suggestions)

type nonrec call_connected_tool = {
  arguments : Yojson.Safe.t option;
      (** The tool's arguments, matching its input schema. *)
  tool : string;  (** The tool's name on its server. *)
}
(** Call one tool of a connected app. *)

let call_connected_tool_of_yojson : Yojson.Safe.t -> call_connected_tool =
 fun json ->
  let fields = Json.obj json in
  {
    arguments = Json.optional fields "arguments" Json.json;
    tool = Json.required fields "tool" Json.string;
  }

and yojson_of_call_connected_tool : call_connected_tool -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("arguments", Option.map Json.of_json value.arguments);
      ("tool", Some (Json.of_string value.tool));
    ]

let make_call_connected_tool ?arguments ~(tool : string) () =
  ({ arguments; tool } : call_connected_tool)

type nonrec call_search_suggestions = {
  from : string list;  (** Speaker names or supplied addresses. *)
  in_ : string list;  (** Channel names. *)
  query : string option;  (** Remaining keyword phrase. *)
  status : string option;
      (** Attendance display value, resolved against supported options by the client. *)
}
(** Call search supports speakers, channels and attendance status. *)

let call_search_suggestions_of_yojson : Yojson.Safe.t -> call_search_suggestions
    =
 fun json ->
  let fields = Json.obj json in
  {
    from = Json.required fields "from" (Json.list Json.string);
    in_ = Json.required fields "in" (Json.list Json.string);
    query = Json.optional fields "query" Json.string;
    status = Json.optional fields "status" Json.string;
  }

and yojson_of_call_search_suggestions : call_search_suggestions -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("from", Some ((Json.of_list Json.of_string) value.from));
      ("in", Some ((Json.of_list Json.of_string) value.in_));
      ("query", Option.map Json.of_string value.query);
      ("status", Option.map Json.of_string value.status);
    ]

let make_call_search_suggestions ~(from : string list) ~(in_ : string list)
    ?query ?status () =
  ({ from; in_; query; status } : call_search_suggestions)

(** Harness names accepted by the capability-discovery endpoint. *)
type nonrec capability_harness_dto =
  | In_memory
  | Cursor
  | Macrod
  | Unknown of string  (** A value this SDK version does not know. *)

let capability_harness_dto_of_yojson : Yojson.Safe.t -> capability_harness_dto =
 fun json ->
  match Json.string json with
  | "in-memory" -> In_memory
  | "cursor" -> Cursor
  | "macrod" -> Macrod
  | other -> Json.unknown "capability_harness_dto" json (Unknown other)

and yojson_of_capability_harness_dto : capability_harness_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | In_memory -> `String "in-memory"
  | Cursor -> `String "cursor"
  | Macrod -> `String "macrod"
  | Unknown other -> `String other

type nonrec channel_search_suggestions = {
  from : string list;  (** Explicit message sender names or addresses. *)
  in_ : string list;  (** Explicit channel names. *)
  query : string option;  (** Remaining keyword phrase. *)
}
(** Message filters remain display names until resolved against the user's directory. *)

let channel_search_suggestions_of_yojson :
    Yojson.Safe.t -> channel_search_suggestions =
 fun json ->
  let fields = Json.obj json in
  {
    from = Json.required fields "from" (Json.list Json.string);
    in_ = Json.required fields "in" (Json.list Json.string);
    query = Json.optional fields "query" Json.string;
  }

and yojson_of_channel_search_suggestions :
    channel_search_suggestions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("from", Some ((Json.of_list Json.of_string) value.from));
      ("in", Some ((Json.of_list Json.of_string) value.in_));
      ("query", Option.map Json.of_string value.query);
    ]

let make_channel_search_suggestions ~(from : string list) ~(in_ : string list)
    ?query () =
  ({ from; in_; query } : channel_search_suggestions)

type nonrec channel_share_permission = {
  access_level : access_level;  (** The access level for the channel *)
  channel_id : string;  (** The channel id *)
}
(** The channel share permission *)

let channel_share_permission_of_yojson :
    Yojson.Safe.t -> channel_share_permission =
 fun json ->
  let fields = Json.obj json in
  {
    access_level = Json.required fields "access_level" access_level_of_yojson;
    channel_id = Json.required fields "channel_id" Json.string;
  }

and yojson_of_channel_share_permission :
    channel_share_permission -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("access_level", Some (yojson_of_access_level value.access_level));
      ("channel_id", Some (Json.of_string value.channel_id));
    ]

let make_channel_share_permission ~(access_level : access_level)
    ~(channel_id : string) () =
  ({ access_level; channel_id } : channel_share_permission)

type nonrec classify_input_request = {
  revision : int;
      (** Opaque client revision used to discard stale predictions. *)
  text : string;  (** Current draft text to classify without executing it. *)
}
(** A draft snapshot. Revisions are opaque to the server and echoed to the client. *)

let classify_input_request_of_yojson : Yojson.Safe.t -> classify_input_request =
 fun json ->
  let fields = Json.obj json in
  {
    revision = Json.required fields "revision" Json.int;
    text = Json.required fields "text" Json.string;
  }

and yojson_of_classify_input_request : classify_input_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("revision", Some (Json.of_int value.revision));
      ("text", Some (Json.of_string value.text));
    ]

let make_classify_input_request ~(revision : int) ~(text : string) () =
  ({ revision; text } : classify_input_request)

(** A destination the composer can prepare, but never execute through inference. *)
type nonrec input_intent =
  | Ai
  | Search
  | Email
  | Note
  | Task
  | Calendar
  | Message
  | Unknown of string  (** A value this SDK version does not know. *)

let input_intent_of_yojson : Yojson.Safe.t -> input_intent =
 fun json ->
  match Json.string json with
  | "ai" -> Ai
  | "search" -> Search
  | "email" -> Email
  | "note" -> Note
  | "task" -> Task
  | "calendar" -> Calendar
  | "message" -> Message
  | other -> Json.unknown "input_intent" json (Unknown other)

and yojson_of_input_intent : input_intent -> Yojson.Safe.t =
 fun value ->
  match value with
  | Ai -> `String "ai"
  | Search -> `String "search"
  | Email -> `String "email"
  | Note -> `String "note"
  | Task -> `String "task"
  | Calendar -> `String "calendar"
  | Message -> `String "message"
  | Unknown other -> `String other

type nonrec intent_score = {
  intent : input_intent;  (** Destination evaluated by the classifier. *)
  score : float;  (** Independent probability between zero and one. *)
}
(** Independent yes/no probabilities; these do not sum to one. *)

let intent_score_of_yojson : Yojson.Safe.t -> intent_score =
 fun json ->
  let fields = Json.obj json in
  {
    intent = Json.required fields "intent" input_intent_of_yojson;
    score = Json.required fields "score" Json.float;
  }

and yojson_of_intent_score : intent_score -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("intent", Some (yojson_of_input_intent value.intent));
      ("score", Some (Json.of_float value.score));
    ]

let make_intent_score ~(intent : input_intent) ~(score : float) () =
  ({ intent; score } : intent_score)

type nonrec classify_input_response = {
  revision : int;  (** Revision echoed from the classification request. *)
  scores : intent_score list;
      (** Independent scores in the fixed intent-question order. *)
}
(** Ranked-type evidence for a particular client draft revision. *)

let classify_input_response_of_yojson : Yojson.Safe.t -> classify_input_response
    =
 fun json ->
  let fields = Json.obj json in
  {
    revision = Json.required fields "revision" Json.int;
    scores = Json.required fields "scores" (Json.list intent_score_of_yojson);
  }

and yojson_of_classify_input_response : classify_input_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("revision", Some (Json.of_int value.revision));
      ("scores", Some ((Json.of_list yojson_of_intent_score) value.scores));
    ]

let make_classify_input_response ~(revision : int) ~(scores : intent_score list)
    () =
  ({ revision; scores } : classify_input_response)

type nonrec claude_account_status = {
  expires_at : string option;
      (** When the credential stops working, as the computer last reported it. *)
  signed_in_at : string;  (** When it was signed in. *)
  signed_in_by : string option;
      (** Who signed it in through Macro; absent once that user is deleted or
when it was signed in on the computer itself. *)
}
(** A computer's active Claude sign-in. Claude's long-lived credential names
no account, so there is no email or plan to show. *)

let claude_account_status_of_yojson : Yojson.Safe.t -> claude_account_status =
 fun json ->
  let fields = Json.obj json in
  {
    expires_at = Json.optional fields "expiresAt" Json.string;
    signed_in_at = Json.required fields "signedInAt" Json.string;
    signed_in_by = Json.optional fields "signedInBy" Json.string;
  }

and yojson_of_claude_account_status : claude_account_status -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("expiresAt", Option.map Json.of_string value.expires_at);
      ("signedInAt", Some (Json.of_string value.signed_in_at));
      ("signedInBy", Option.map Json.of_string value.signed_in_by);
    ]

let make_claude_account_status ?expires_at ~(signed_in_at : string)
    ?signed_in_by () =
  ({ expires_at; signed_in_at; signed_in_by } : claude_account_status)

(** How Claude Code on a Macro computer is paid for: its own Claude account
when it has an active Claude login, otherwise Macro credits. *)
type nonrec claude_mode =
  | Macro_credits
  | Own_account
  | Unknown of string  (** A value this SDK version does not know. *)

let claude_mode_of_yojson : Yojson.Safe.t -> claude_mode =
 fun json ->
  match Json.string json with
  | "macro_credits" -> Macro_credits
  | "own_account" -> Own_account
  | other -> Json.unknown "claude_mode" json (Unknown other)

and yojson_of_claude_mode : claude_mode -> Yojson.Safe.t =
 fun value ->
  match value with
  | Macro_credits -> `String "macro_credits"
  | Own_account -> `String "own_account"
  | Unknown other -> `String other

type nonrec claude_mode_response = {
  account : claude_account_status option;
  mode : claude_mode;  (** How Claude Code is paid for. *)
}
(** How Claude Code on a computer is paid for, and its Claude sign-in when it
uses its own. *)

let claude_mode_response_of_yojson : Yojson.Safe.t -> claude_mode_response =
 fun json ->
  let fields = Json.obj json in
  {
    account = Json.optional fields "account" claude_account_status_of_yojson;
    mode = Json.required fields "mode" claude_mode_of_yojson;
  }

and yojson_of_claude_mode_response : claude_mode_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("account", Option.map yojson_of_claude_account_status value.account);
      ("mode", Some (yojson_of_claude_mode value.mode));
    ]

let make_claude_mode_response ?account ~(mode : claude_mode) () =
  ({ account; mode } : claude_mode_response)

type nonrec claude_sign_in_complete = {
  code : string;  (** The code Claude showed after the user signed in. *)
}
(** [POST /harnesses/{harness_id}/claude-sign-in/complete] body. *)

let claude_sign_in_complete_of_yojson : Yojson.Safe.t -> claude_sign_in_complete
    =
 fun json ->
  let fields = Json.obj json in
  { code = Json.required fields "code" Json.string }

and yojson_of_claude_sign_in_complete : claude_sign_in_complete -> Yojson.Safe.t
    =
 fun value -> Json.record [ ("code", Some (Json.of_string value.code)) ]

let make_claude_sign_in_complete ~(code : string) () =
  ({ code } : claude_sign_in_complete)

type nonrec claude_sign_in_started = {
  url : string;  (** Where the user signs in to Claude, in their own browser. *)
}
(** [POST /harnesses/{harness_id}/claude-sign-in] answer. *)

let claude_sign_in_started_of_yojson : Yojson.Safe.t -> claude_sign_in_started =
 fun json ->
  let fields = Json.obj json in
  { url = Json.required fields "url" Json.string }

and yojson_of_claude_sign_in_started : claude_sign_in_started -> Yojson.Safe.t =
 fun value -> Json.record [ ("url", Some (Json.of_string value.url)) ]

let make_claude_sign_in_started ~(url : string) () =
  ({ url } : claude_sign_in_started)

type nonrec claude_signed_in = { signed_in : bool  (** Always [true]. *) }
(** [POST /harnesses/{harness_id}/claude-sign-in/complete] answer. *)

let claude_signed_in_of_yojson : Yojson.Safe.t -> claude_signed_in =
 fun json ->
  let fields = Json.obj json in
  { signed_in = Json.required fields "signedIn" Json.bool }

and yojson_of_claude_signed_in : claude_signed_in -> Yojson.Safe.t =
 fun value -> Json.record [ ("signedIn", Some (Json.of_bool value.signed_in)) ]

let make_claude_signed_in ~(signed_in : bool) () =
  ({ signed_in } : claude_signed_in)

type nonrec coding_agent = {
  description : string option;  (** What the persona is intended to do. *)
  harness : string;  (** Runtime configured for the persona. *)
  id : string;  (** Persona id to pass to dispatch. *)
  instructions : string;
      (** Saved guidance describing the persona's repositories and specialties. *)
  model : string option;
      (** Persona's configured default model, absent when the provider chooses it. *)
  name : string;  (** User-facing persona name. *)
}
(** Information used to choose a coding persona for a task. *)

let coding_agent_of_yojson : Yojson.Safe.t -> coding_agent =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    harness = Json.required fields "harness" Json.string;
    id = Json.required fields "id" Json.string;
    instructions = Json.required fields "instructions" Json.string;
    model = Json.optional fields "model" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_coding_agent : coding_agent -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("harness", Some (Json.of_string value.harness));
      ("id", Some (Json.of_string value.id));
      ("instructions", Some (Json.of_string value.instructions));
      ("model", Option.map Json.of_string value.model);
      ("name", Some (Json.of_string value.name));
    ]

let make_coding_agent ?description ~(harness : string) ~(id : string)
    ~(instructions : string) ?model ~(name : string) () =
  ({ description; harness; id; instructions; model; name } : coding_agent)

type nonrec coding_agents_response = {
  agents : coding_agent list;
      (** Available coding personas, built-in ones such as Cursor first. *)
}
(** The coding agents the caller can start a session as right now. *)

let coding_agents_response_of_yojson : Yojson.Safe.t -> coding_agents_response =
 fun json ->
  let fields = Json.obj json in
  { agents = Json.required fields "agents" (Json.list coding_agent_of_yojson) }

and yojson_of_coding_agents_response : coding_agents_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("agents", Some ((Json.of_list yojson_of_coding_agent) value.agents)) ]

let make_coding_agents_response ~(agents : coding_agent list) () =
  ({ agents } : coding_agents_response)

type nonrec coding_preferences_body = {
  create_tasks : bool;
      (** Whether new coding sessions research prior work and link a Macro task. *)
  open_pull_requests : bool;
      (** Whether new coding sessions deliver their work as a pull request. *)
}
(** Request or response body for the caller's coding preferences. *)

let coding_preferences_body_of_yojson : Yojson.Safe.t -> coding_preferences_body
    =
 fun json ->
  let fields = Json.obj json in
  {
    create_tasks = Json.required fields "createTasks" Json.bool;
    open_pull_requests = Json.required fields "openPullRequests" Json.bool;
  }

and yojson_of_coding_preferences_body : coding_preferences_body -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("createTasks", Some (Json.of_bool value.create_tasks));
      ("openPullRequests", Some (Json.of_bool value.open_pull_requests));
    ]

let make_coding_preferences_body ~(create_tasks : bool)
    ~(open_pull_requests : bool) () =
  ({ create_tasks; open_pull_requests } : coding_preferences_body)

type nonrec connect_mcp_server = {
  server_name : string;  (** Display name for the server. *)
  url : string;  (** The server's URL. *)
}
(** Add a custom MCP server to the user's connections. *)

let connect_mcp_server_of_yojson : Yojson.Safe.t -> connect_mcp_server =
 fun json ->
  let fields = Json.obj json in
  {
    server_name = Json.required fields "serverName" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_connect_mcp_server : connect_mcp_server -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("serverName", Some (Json.of_string value.server_name));
      ("url", Some (Json.of_string value.url));
    ]

let make_connect_mcp_server ~(server_name : string) ~(url : string) () =
  ({ server_name; url } : connect_mcp_server)

type nonrec connect_mcp_server_response = {
  already_connected : bool;
      (** Whether the user already had this server before the call. *)
  authenticated : bool;  (** Whether the server holds the user's sign-in. *)
  enabled : bool;  (** Whether the server's tools are turned on. *)
  server_name : string;  (** The server's display name. *)
  summary : string;  (** What happened and what the user still has to do. *)
  url : string;  (** The server's URL. *)
}
(** Response from \[[ConnectMcpServer]\]. *)

let connect_mcp_server_response_of_yojson :
    Yojson.Safe.t -> connect_mcp_server_response =
 fun json ->
  let fields = Json.obj json in
  {
    already_connected = Json.required fields "alreadyConnected" Json.bool;
    authenticated = Json.required fields "authenticated" Json.bool;
    enabled = Json.required fields "enabled" Json.bool;
    server_name = Json.required fields "serverName" Json.string;
    summary = Json.required fields "summary" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_connect_mcp_server_response :
    connect_mcp_server_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("alreadyConnected", Some (Json.of_bool value.already_connected));
      ("authenticated", Some (Json.of_bool value.authenticated));
      ("enabled", Some (Json.of_bool value.enabled));
      ("serverName", Some (Json.of_string value.server_name));
      ("summary", Some (Json.of_string value.summary));
      ("url", Some (Json.of_string value.url));
    ]

let make_connect_mcp_server_response ~(already_connected : bool)
    ~(authenticated : bool) ~(enabled : bool) ~(server_name : string)
    ~(summary : string) ~(url : string) () =
  ({ already_connected; authenticated; enabled; server_name; summary; url }
    : connect_mcp_server_response)

(** Which store a connected app comes from. *)
type nonrec connected_app_kind =
  | App
  | Custom
  | Unknown of string  (** A value this SDK version does not know. *)

let connected_app_kind_of_yojson : Yojson.Safe.t -> connected_app_kind =
 fun json ->
  match Json.string json with
  | "app" -> App
  | "custom" -> Custom
  | other -> Json.unknown "connected_app_kind" json (Unknown other)

and yojson_of_connected_app_kind : connected_app_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | App -> `String "app"
  | Custom -> `String "custom"
  | Unknown other -> `String other

type nonrec connected_app = {
  key : string;  (** The app's slug, or its custom server key. *)
  kind : connected_app_kind;  (** Which store the app comes from. *)
  name : string;
      (** Display name, e.g. [Slack] or the owner's name for a custom server. *)
}
(** A connected app the session's agent may use. *)

let connected_app_of_yojson : Yojson.Safe.t -> connected_app =
 fun json ->
  let fields = Json.obj json in
  {
    key = Json.required fields "key" Json.string;
    kind = Json.required fields "kind" connected_app_kind_of_yojson;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_connected_app : connected_app -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("key", Some (Json.of_string value.key));
      ("kind", Some (yojson_of_connected_app_kind value.kind));
      ("name", Some (Json.of_string value.name));
    ]

let make_connected_app ~(key : string) ~(kind : connected_app_kind)
    ~(name : string) () =
  ({ key; kind; name } : connected_app)

type nonrec connected_tool = {
  description : string option;  (** What the server says the tool does. *)
  input_schema : Yojson.Safe.t;  (** JSON Schema for the tool's arguments. *)
  name : string;  (** The tool's name on its server. *)
}
(** One tool a connected app serves. *)

let connected_tool_of_yojson : Yojson.Safe.t -> connected_tool =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.optional fields "description" Json.string;
    input_schema = Json.required fields "inputSchema" Json.json;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_connected_tool : connected_tool -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Option.map Json.of_string value.description);
      ("inputSchema", Some (Json.of_json value.input_schema));
      ("name", Some (Json.of_string value.name));
    ]

let make_connected_tool ?description ~(input_schema : Yojson.Safe.t)
    ~(name : string) () =
  ({ description; input_schema; name } : connected_tool)

type nonrec connected_tool_match = {
  app : connected_app;  (** The app serving the tool. *)
  tool : connected_tool;  (** The tool. *)
}
(** One tool found by a search across the agent's connected apps. *)

let connected_tool_match_of_yojson : Yojson.Safe.t -> connected_tool_match =
 fun json ->
  let fields = Json.obj json in
  {
    app = Json.required fields "app" connected_app_of_yojson;
    tool = Json.required fields "tool" connected_tool_of_yojson;
  }

and yojson_of_connected_tool_match : connected_tool_match -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app", Some (yojson_of_connected_app value.app));
      ("tool", Some (yojson_of_connected_tool value.tool));
    ]

let make_connected_tool_match ~(app : connected_app) ~(tool : connected_tool) ()
    =
  ({ app; tool } : connected_tool_match)

type nonrec connected_tool_result = {
  content : Yojson.Safe.t list;
      (** MCP content blocks, e.g. [{type: "text", text}]. *)
  is_error : bool;
      (** The tool failed, or could not run; [content] says why. *)
  structured_content : Yojson.Safe.t option;
      (** Structured output, for tools that declare an output schema. *)
}
(** A connected tool's answer: MCP's [CallToolResult]. *)

let connected_tool_result_of_yojson : Yojson.Safe.t -> connected_tool_result =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.required fields "content" (Json.list Json.json);
    is_error = Json.required fields "isError" Json.bool;
    structured_content = Json.optional fields "structuredContent" Json.json;
  }

and yojson_of_connected_tool_result : connected_tool_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Some ((Json.of_list Json.of_json) value.content));
      ("isError", Some (Json.of_bool value.is_error));
      ("structuredContent", Option.map Json.of_json value.structured_content);
    ]

let make_connected_tool_result ~(content : Yojson.Safe.t list)
    ~(is_error : bool) ?structured_content () =
  ({ content; is_error; structured_content } : connected_tool_result)

type nonrec connected_tool_search = {
  matches : connected_tool_match list;
      (** At most \[[MAX_TOOL_MATCHES]\] tools, best first. *)
  unsearched : connected_app list;  (** Apps whose tools could not be listed. *)
}
(** The best matches across the agent's connected apps, and the apps whose
tools could not be listed, which the search did not cover. *)

let connected_tool_search_of_yojson : Yojson.Safe.t -> connected_tool_search =
 fun json ->
  let fields = Json.obj json in
  {
    matches =
      Json.required fields "matches" (Json.list connected_tool_match_of_yojson);
    unsearched =
      Json.required fields "unsearched" (Json.list connected_app_of_yojson);
  }

and yojson_of_connected_tool_search : connected_tool_search -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "matches",
        Some ((Json.of_list yojson_of_connected_tool_match) value.matches) );
      ( "unsearched",
        Some ((Json.of_list yojson_of_connected_app) value.unsearched) );
    ]

let make_connected_tool_search ~(matches : connected_tool_match list)
    ~(unsearched : connected_app list) () =
  ({ matches; unsearched } : connected_tool_search)

type nonrec connector_tool = {
  description : string;  (** What the action supports. *)
  name : string;  (** Upstream tool name. *)
}
(** An advertised action, not a tool loaded into the current turn. *)

let connector_tool_of_yojson : Yojson.Safe.t -> connector_tool =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.required fields "description" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_connector_tool : connector_tool -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Some (Json.of_string value.description));
      ("name", Some (Json.of_string value.name));
    ]

let make_connector_tool ~(description : string) ~(name : string) () =
  ({ description; name } : connector_tool)

type nonrec control_request = {
  agent_action : agent_action;  (** The operation to perform. *)
  action_id : agent_action_id option;
  client_id : string option;
      (** The app tab the person typed this in (a UUID the tab keeps for its
lifetime), so what the turn opens in the app reaches that tab only.
Only a person's own request may send it; a runtime's is refused. *)
  context : Yojson.Safe.t option;
      (** Why the agent is being asked. Only a runtime forwarding a triggered
prompt may send it; a user's request carrying it is refused. *)
}
(** Request body for a control operation on a live session.

A wrapper around the operation rather than the bare enum so that fields
which are about the request rather than the operation have somewhere to go.
The acting user is deliberately not one of them: it comes from the caller's
credentials, so that a caller cannot attribute an operation to someone else.

Clients serialize this, so both derives are used. *)

let control_request_of_yojson : Yojson.Safe.t -> control_request =
 fun json ->
  let fields = Json.obj json in
  {
    agent_action = agent_action_of_yojson json;
    action_id = Json.optional fields "actionId" agent_action_id_of_yojson;
    client_id = Json.optional fields "clientId" Json.string;
    context = Json.optional fields "context" Json.json;
  }

and yojson_of_control_request : control_request -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("actionId", Option.map yojson_of_agent_action_id value.action_id);
          ("clientId", Option.map Json.of_string value.client_id);
          ("context", Option.map Json.of_json value.context);
        ];
      yojson_of_agent_action value.agent_action;
    ]

let make_control_request ~(agent_action : agent_action) ?action_id ?client_id
    ?context () =
  ({ agent_action; action_id; client_id; context } : control_request)

(** What accepting a control operation did with it, on the wire. *)
type nonrec control_status_dto =
  | Sent
  | Queued
  | Unknown of string  (** A value this SDK version does not know. *)

let control_status_dto_of_yojson : Yojson.Safe.t -> control_status_dto =
 fun json ->
  match Json.string json with
  | "sent" -> Sent
  | "queued" -> Queued
  | other -> Json.unknown "control_status_dto" json (Unknown other)

and yojson_of_control_status_dto : control_status_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | Sent -> `String "sent"
  | Queued -> `String "queued"
  | Unknown other -> `String other

type nonrec control_response = {
  action_id : agent_action_id;
      (** Matches [requestId] on the folded message this action derives once it
dispatches, and names the queue entry until then. The caller's own
[actionId] when it supplied one; a freshly minted id otherwise. *)
  status : control_status_dto;
      (** Whether the action went out or waits in the queue. *)
}
(** Response body for a control operation.

Clients deserialize this, so both derives are used. *)

let control_response_of_yojson : Yojson.Safe.t -> control_response =
 fun json ->
  let fields = Json.obj json in
  {
    action_id = Json.required fields "actionId" agent_action_id_of_yojson;
    status = Json.required fields "status" control_status_dto_of_yojson;
  }

and yojson_of_control_response : control_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("actionId", Some (yojson_of_agent_action_id value.action_id));
      ("status", Some (yojson_of_control_status_dto value.status));
    ]

let make_control_response ~(action_id : agent_action_id)
    ~(status : control_status_dto) () =
  ({ action_id; status } : control_response)

type nonrec create_session_thread = {
  channel_id : string option;
      (** Channel the mentioning message was posted in. Runtimes built before
message parents send this instead of [parent]. *)
  content : string option;
      (** The mention's text, quoted in the session's announcement. *)
  message_id : string;  (** The mentioning message. *)
  parent : message_parent option;
  reuse_origin_message : bool option;
      (** Update the existing bot response reserved by a task assignment. *)
  thread_id : string option;
      (** Thread the session belongs to; defaults to the message itself, which
is how a top-level mention roots its own thread. *)
}
(** The triggering mention on a create request.

Clients serialize this, so both derives are used. *)

let create_session_thread_of_yojson : Yojson.Safe.t -> create_session_thread =
 fun json ->
  let fields = Json.obj json in
  {
    channel_id = Json.optional fields "channelId" Json.string;
    content = Json.optional fields "content" Json.string;
    message_id = Json.required fields "messageId" Json.string;
    parent = Json.optional fields "parent" message_parent_of_yojson;
    reuse_origin_message = Json.optional fields "reuseOriginMessage" Json.bool;
    thread_id = Json.optional fields "threadId" Json.string;
  }

and yojson_of_create_session_thread : create_session_thread -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channelId", Option.map Json.of_string value.channel_id);
      ("content", Option.map Json.of_string value.content);
      ("messageId", Some (Json.of_string value.message_id));
      ("parent", Option.map yojson_of_message_parent value.parent);
      ("reuseOriginMessage", Option.map Json.of_bool value.reuse_origin_message);
      ("threadId", Option.map Json.of_string value.thread_id);
    ]

let make_create_session_thread ?channel_id ?content ~(message_id : string)
    ?parent ?reuse_origin_message ?thread_id () =
  ({ channel_id; content; message_id; parent; reuse_origin_message; thread_id }
    : create_session_thread)

type nonrec create_agent_session_request = {
  bot_id : string option;
      (** Bot the session runs for. On a managed request this optionally selects
a persisted persona the user owns, may use through team membership, or
can [@] mention in a shared channel; omitting it uses the deployment's
default coding persona, or Cursor when [repoUrl] is set. On an
external request, bot callers may omit it (their own identity is used)
and must not name another bot; user callers must supply a bot they own. *)
  id : string option;
      (** Id to create the session under, minted by the caller. Lets a surface
open on the session's final id - URL, history row, references - the
moment the user acts, rather than after this request answers (which
for a managed sandbox can take a while). Omitted, the service mints
one. Answers 409 if a session already holds the id. On an external
request it is how a runtime answering a composer request names the
id it was handed, so the requester waiting on that id finds the session. *)
  instructions : string option;
      (** Instructions the session's runtime works under, for its whole life.

Recorded on the session whichever runtime serves it. Only the
in-process one acts on them today; [agent_harness]'s [AgentKind]
records what each of the others will need to. *)
  model : string option;
      (** Model the managed session runs on, overriding the persona's. Managed
sessions only: an external runtime picks its own.

The session's model from the moment it exists, which is what a caller
choosing one before the first prompt means. Selecting a model *during*
a session is a control action instead, and reads as one in its
transcript. *)
  owner : string option;
      (** The user who owns the session. Ignored for user callers, who always
own their own sessions, for harness callers, whose verified acting
user owns the session, and for bots that already act for a verified
user. A bot without one may name a user here. That claim is trusted
for the bot's own sessions. With no claim, a team bot owns the session
itself only while non-user owners are enabled. Every other bot still
needs an owner. *)
  prompt : string option;
      (** First prompt to deliver once the session is running. The managed shape
only: a persona its operator runs gets it through the session's control
path once its runtime opens the session, while a runtime opening its
own (the [workspace] shape) sends its first prompt through the control
endpoint. Omitted, the session opens idle. *)
  prompt_action_id : agent_action_id option;
  prompt_attachments : prompt_attachment list option;
      (** Files [prompt] refers to, in the order the user attached them.
Requires [prompt]. *)
  prompt_client_id : string option;
      (** The app tab the person typed [prompt] in, as [clientId] on a control
request, so what the first turn opens in the app reaches that tab
only. Requires [prompt]. Only a person's own request may send it; a
runtime's is refused, and a program using a person's credential has
it dropped. *)
  repo_branch : string option;
      (** Starting branch for a managed coding session's selected repository.
Omitted, the session starts on the repository's default branch. *)
  repo_url : string option;
      (** Explicit GitHub repository for a managed Cursor session, as one of the
urls [GET /agent-repositories] lists for the caller. Access is checked
for the session owner. On a managed request that names no [botId],
this starts the session as Cursor — the only managed persona that
honors a repository. For external sessions this is informational:
cloning it is the runtime operator's job. *)
  thread : create_session_thread option;
  workspace : string option;
      (** Absolute directory the bot's harness runs in on its runtime. Present
for an external session, absent for a managed one, which runs in the
path baked into its image. *)
}
(** Request body for [POST /agent-sessions].

Carries two shapes, told apart by [workspace]. Naming one asks for an
external session: the runtime is the bot operator's, so the caller has to
say which bot and which directory, and must own that bot. Omitting it asks
for a managed session, whose runtime this deployment provisions. A managed
request may select an authorized persisted persona with [botId]; omitting
it uses the deployment's default coding persona, or Cursor when [repoUrl]
is set. Fields describing someone else's runtime must still be omitted
rather than quietly ignored. Mixing the two shapes is refused rather
than guessed at.

Clients serialize this, so both derives are used. *)

let create_agent_session_request_of_yojson :
    Yojson.Safe.t -> create_agent_session_request =
 fun json ->
  let fields = Json.obj json in
  {
    bot_id = Json.optional fields "botId" Json.string;
    id = Json.optional fields "id" Json.string;
    instructions = Json.optional fields "instructions" Json.string;
    model = Json.optional fields "model" Json.string;
    owner = Json.optional fields "owner" Json.string;
    prompt = Json.optional fields "prompt" Json.string;
    prompt_action_id =
      Json.optional fields "promptActionId" agent_action_id_of_yojson;
    prompt_attachments =
      Json.optional fields "promptAttachments"
        (Json.list prompt_attachment_of_yojson);
    prompt_client_id = Json.optional fields "promptClientId" Json.string;
    repo_branch = Json.optional fields "repoBranch" Json.string;
    repo_url = Json.optional fields "repoUrl" Json.string;
    thread = Json.optional fields "thread" create_session_thread_of_yojson;
    workspace = Json.optional fields "workspace" Json.string;
  }

and yojson_of_create_agent_session_request :
    create_agent_session_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("botId", Option.map Json.of_string value.bot_id);
      ("id", Option.map Json.of_string value.id);
      ("instructions", Option.map Json.of_string value.instructions);
      ("model", Option.map Json.of_string value.model);
      ("owner", Option.map Json.of_string value.owner);
      ("prompt", Option.map Json.of_string value.prompt);
      ( "promptActionId",
        Option.map yojson_of_agent_action_id value.prompt_action_id );
      ( "promptAttachments",
        Option.map
          (Json.of_list yojson_of_prompt_attachment)
          value.prompt_attachments );
      ("promptClientId", Option.map Json.of_string value.prompt_client_id);
      ("repoBranch", Option.map Json.of_string value.repo_branch);
      ("repoUrl", Option.map Json.of_string value.repo_url);
      ("thread", Option.map yojson_of_create_session_thread value.thread);
      ("workspace", Option.map Json.of_string value.workspace);
    ]

let make_create_agent_session_request ?bot_id ?id ?instructions ?model ?owner
    ?prompt ?prompt_action_id ?prompt_attachments ?prompt_client_id ?repo_branch
    ?repo_url ?thread ?workspace () =
  ({
     bot_id;
     id;
     instructions;
     model;
     owner;
     prompt;
     prompt_action_id;
     prompt_attachments;
     prompt_client_id;
     repo_branch;
     repo_url;
     thread;
     workspace;
   }
    : create_agent_session_request)

type nonrec create_agent_session_response = {
  session : agent_session_response;  (** The created session. *)
}
(** Response body for [POST /agent-sessions].

Clients deserialize this, so both derives are used. *)

let create_agent_session_response_of_yojson :
    Yojson.Safe.t -> create_agent_session_response =
 fun json ->
  let fields = Json.obj json in
  { session = Json.required fields "session" agent_session_response_of_yojson }

and yojson_of_create_agent_session_response :
    create_agent_session_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("session", Some (yojson_of_agent_session_response value.session)) ]

let make_create_agent_session_response ~(session : agent_session_response) () =
  ({ session } : create_agent_session_response)

type nonrec execution_id = string
(** Caller-selected UUID persisted in tool input before execution begins. *)

let execution_id_of_yojson : Yojson.Safe.t -> execution_id =
 fun json -> Json.string json

and yojson_of_execution_id : execution_id -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec create_review = {
  execution_id : execution_id option;
  title : string;  (** Stack label. *)
}
(** Review creation. Decoding it validates every draft; creating a review only
presents the drafts, and the account holder acts separately. *)

let create_review_of_yojson : Yojson.Safe.t -> create_review =
 fun json ->
  let fields = Json.obj json in
  {
    execution_id = Json.optional fields "executionId" execution_id_of_yojson;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_create_review : create_review -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("executionId", Option.map yojson_of_execution_id value.execution_id);
      ("title", Some (Json.of_string value.title));
    ]

let make_create_review ?execution_id ~(title : string) () =
  ({ execution_id; title } : create_review)

(** Surface of a review decision. *)
type nonrec decision_via =
  | Card
  | Chat
  | Inbox
  | Unknown of string  (** A value this SDK version does not know. *)

let decision_via_of_yojson : Yojson.Safe.t -> decision_via =
 fun json ->
  match Json.string json with
  | "card" -> Card
  | "chat" -> Chat
  | "inbox" -> Inbox
  | other -> Json.unknown "decision_via" json (Unknown other)

and yojson_of_decision_via : decision_via -> Yojson.Safe.t =
 fun value ->
  match value with
  | Card -> `String "card"
  | Chat -> `String "chat"
  | Inbox -> `String "inbox"
  | Unknown other -> `String other

type nonrec discover_agent_capabilities_request = {
  harness : capability_harness_dto;  (** Provider to probe. *)
  harness_id : string option;
      (** Required for macrod and forbidden for other targets. *)
  model : string option;
      (** Model whose session settings should be inspected. *)
}
(** HTTP request selecting one provider to probe. *)

let discover_agent_capabilities_request_of_yojson :
    Yojson.Safe.t -> discover_agent_capabilities_request =
 fun json ->
  let fields = Json.obj json in
  {
    harness = Json.required fields "harness" capability_harness_dto_of_yojson;
    harness_id = Json.optional fields "harnessId" Json.string;
    model = Json.optional fields "model" Json.string;
  }

and yojson_of_discover_agent_capabilities_request :
    discover_agent_capabilities_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("harness", Some (yojson_of_capability_harness_dto value.harness));
      ("harnessId", Option.map Json.of_string value.harness_id);
      ("model", Option.map Json.of_string value.model);
    ]

let make_discover_agent_capabilities_request ~(harness : capability_harness_dto)
    ?harness_id ?model () =
  ({ harness; harness_id; model } : discover_agent_capabilities_request)

type nonrec discover_agent_capabilities_response = {
  config_options : agent_config_option_dto list;
      (** Complete ordered ACP session configuration advertised by the agent. *)
}
(** Successful capability-discovery response. *)

let discover_agent_capabilities_response_of_yojson :
    Yojson.Safe.t -> discover_agent_capabilities_response =
 fun json ->
  let fields = Json.obj json in
  {
    config_options =
      Json.required fields "configOptions"
        (Json.list agent_config_option_dto_of_yojson);
  }

and yojson_of_discover_agent_capabilities_response :
    discover_agent_capabilities_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "configOptions",
        Some
          ((Json.of_list yojson_of_agent_config_option_dto)
             value.config_options) );
    ]

let make_discover_agent_capabilities_response
    ~(config_options : agent_config_option_dto list) () =
  ({ config_options } : discover_agent_capabilities_response)

type nonrec discovered_app = {
  app_slug : string;  (** Exact identity to inspect or connect. *)
  description : string option;
      (** Directory description; inspect tools to verify specific capabilities. *)
  name : string;  (** Human-readable app name. *)
}
(** A verified app identity from the directory. *)

let discovered_app_of_yojson : Yojson.Safe.t -> discovered_app =
 fun json ->
  let fields = Json.obj json in
  {
    app_slug = Json.required fields "app_slug" Json.string;
    description = Json.optional fields "description" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_discovered_app : discovered_app -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("app_slug", Some (Json.of_string value.app_slug));
      ("description", Option.map Json.of_string value.description);
      ("name", Some (Json.of_string value.name));
    ]

let make_discovered_app ~(app_slug : string) ?description ~(name : string) () =
  ({ app_slug; description; name } : discovered_app)

(** Discovery results never execute tools or change connections. *)
type nonrec discovery_result =
  | Search of {
      apps : discovered_app list;  (** Matching apps. *)
      more_results : bool;  (** Narrow the app name if this is true. *)
    }  (** Candidate apps; none has had its capabilities verified yet. *)
  | Inspect of {
      app : discovered_app;  (** App from the directory. *)
      connected : bool;
          (** Whether this caller has an enabled connection. For an app that
connects through its own MCP server, that connection is checked
there, not in Pipedream. *)
      tools : connector_tool list;
          (** Advertised tools. Use SearchTools after connecting to load them. *)
      tools_truncated : bool;
          (** True when some advertised tools were omitted. *)
    }
      (** Verified identity, capabilities and this caller's connection status. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let discovery_result_of_yojson : Yojson.Safe.t -> discovery_result =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "operation" with
  | "search" ->
      Search
        {
          apps =
            Json.required fields "apps" (Json.list discovered_app_of_yojson);
          more_results = Json.required fields "more_results" Json.bool;
        }
  | "inspect" ->
      Inspect
        {
          app = Json.required fields "app" discovered_app_of_yojson;
          connected = Json.required fields "connected" Json.bool;
          tools =
            Json.required fields "tools" (Json.list connector_tool_of_yojson);
          tools_truncated = Json.required fields "tools_truncated" Json.bool;
        }
  | _ -> Json.unknown "discovery_result" json (Unknown json)

and yojson_of_discovery_result : discovery_result -> Yojson.Safe.t =
 fun value ->
  match value with
  | Search case ->
      Json.record
        [
          ("operation", Some (`String "search"));
          ("apps", Some ((Json.of_list yojson_of_discovered_app) case.apps));
          ("more_results", Some (Json.of_bool case.more_results));
        ]
  | Inspect case ->
      Json.record
        [
          ("operation", Some (`String "inspect"));
          ("app", Some (yojson_of_discovered_app case.app));
          ("connected", Some (Json.of_bool case.connected));
          ("tools", Some ((Json.of_list yojson_of_connector_tool) case.tools));
          ("tools_truncated", Some (Json.of_bool case.tools_truncated));
        ]
  | Unknown json -> json

let make_discovery_result_search ~(apps : discovered_app list)
    ~(more_results : bool) () =
  (Search { apps; more_results } : discovery_result)

let make_discovery_result_inspect ~(app : discovered_app) ~(connected : bool)
    ~(tools : connector_tool list) ~(tools_truncated : bool) () =
  (Inspect { app; connected; tools; tools_truncated } : discovery_result)

type nonrec discover_connectors_response = {
  connect_markup : string option;
      (** Include verbatim only if an advertised tool supports the requested task. *)
  result : discovery_result;  (** Catalog or capability results. *)
}
(** Discovery metadata and optional markup for a user-controlled auth flow. *)

let discover_connectors_response_of_yojson :
    Yojson.Safe.t -> discover_connectors_response =
 fun json ->
  let fields = Json.obj json in
  {
    connect_markup = Json.optional fields "connect_markup" Json.string;
    result = Json.required fields "result" discovery_result_of_yojson;
  }

and yojson_of_discover_connectors_response :
    discover_connectors_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("connect_markup", Option.map Json.of_string value.connect_markup);
      ("result", Some (yojson_of_discovery_result value.result));
    ]

let make_discover_connectors_response ?connect_markup
    ~(result : discovery_result) () =
  ({ connect_markup; result } : discover_connectors_response)

(** Search by app name, then inspect a returned slug before recommending auth. *)
type nonrec discovery_request =
  | Search of {
      query : string;
          (** App name, e.g. "Notion" or "Linear", not a task description. *)
    }  (** Find connectable apps by name. *)
  | Inspect of { app_slug : string  (** Exact app slug from search results. *) }
      (** Verify capabilities and connection status for one catalog app. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let discovery_request_of_yojson : Yojson.Safe.t -> discovery_request =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "operation" with
  | "search" -> Search { query = Json.required fields "query" Json.string }
  | "inspect" ->
      Inspect { app_slug = Json.required fields "app_slug" Json.string }
  | _ -> Json.unknown "discovery_request" json (Unknown json)

and yojson_of_discovery_request : discovery_request -> Yojson.Safe.t =
 fun value ->
  match value with
  | Search case ->
      Json.record
        [
          ("operation", Some (`String "search"));
          ("query", Some (Json.of_string case.query));
        ]
  | Inspect case ->
      Json.record
        [
          ("operation", Some (`String "inspect"));
          ("app_slug", Some (Json.of_string case.app_slug));
        ]
  | Unknown json -> json

let make_discovery_request_search ~(query : string) () =
  (Search { query } : discovery_request)

let make_discovery_request_inspect ~(app_slug : string) () =
  (Inspect { app_slug } : discovery_request)

type nonrec edit_queued_action_request = {
  prompt : string;
      (** The new raw prompt text, replacing the old wholesale. Never blank: a
prompt with nothing to say is a removal, and there is an endpoint for
that. *)
}
(** Request body for editing a queued prompt. *)

let edit_queued_action_request_of_yojson :
    Yojson.Safe.t -> edit_queued_action_request =
 fun json ->
  let fields = Json.obj json in
  { prompt = Json.required fields "prompt" Json.string }

and yojson_of_edit_queued_action_request :
    edit_queued_action_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("prompt", Some (Json.of_string value.prompt)) ]

let make_edit_queued_action_request ~(prompt : string) () =
  ({ prompt } : edit_queued_action_request)

type nonrec email_search_suggestions = {
  importance : string option;
      (** Explicit importance wording, resolved by the client. *)
  inboxes : string list;
      (** Explicit connected inbox addresses, resolved by the client. *)
  query : string option;  (** Remaining keyword phrase. *)
}
(** Email search exposes importance and connected inbox addresses, not sender filters. *)

let email_search_suggestions_of_yojson :
    Yojson.Safe.t -> email_search_suggestions =
 fun json ->
  let fields = Json.obj json in
  {
    importance = Json.optional fields "importance" Json.string;
    inboxes = Json.required fields "inboxes" (Json.list Json.string);
    query = Json.optional fields "query" Json.string;
  }

and yojson_of_email_search_suggestions :
    email_search_suggestions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("importance", Option.map Json.of_string value.importance);
      ("inboxes", Some ((Json.of_list Json.of_string) value.inboxes));
      ("query", Option.map Json.of_string value.query);
    ]

let make_email_search_suggestions ?importance ~(inboxes : string list) ?query ()
    =
  ({ importance; inboxes; query } : email_search_suggestions)

type nonrec email_suggestions = {
  bcc : string list option;
      (** Explicit blind-carbon-copy recipient names or supplied email addresses. *)
  body : string option;
      (** Suggested Markdown content or outgoing message body. *)
  cc : string list option;
      (** Explicit carbon-copy recipient names or supplied email addresses. *)
  recipients : string list option;
      (** Person or channel names for the client to resolve. *)
  subject : string option;  (** Suggested outgoing email subject. *)
}
(** Editable fields for email inference, before submission and identity resolution. *)

let email_suggestions_of_yojson : Yojson.Safe.t -> email_suggestions =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.optional fields "bcc" (Json.list Json.string);
    body = Json.optional fields "body" Json.string;
    cc = Json.optional fields "cc" (Json.list Json.string);
    recipients = Json.optional fields "recipients" (Json.list Json.string);
    subject = Json.optional fields "subject" Json.string;
  }

and yojson_of_email_suggestions : email_suggestions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Option.map (Json.of_list Json.of_string) value.bcc);
      ("body", Option.map Json.of_string value.body);
      ("cc", Option.map (Json.of_list Json.of_string) value.cc);
      ("recipients", Option.map (Json.of_list Json.of_string) value.recipients);
      ("subject", Option.map Json.of_string value.subject);
    ]

let make_email_suggestions ?bcc ?body ?cc ?recipients ?subject () =
  ({ bcc; body; cc; recipients; subject } : email_suggestions)

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

(** A dispatch result; unfinished work is never reported as success. *)
type nonrec recorded_call_status =
  | Running
  | Completed
  | Failed
  | Unknown_
  | Unknown of string  (** A value this SDK version does not know. *)

let recorded_call_status_of_yojson : Yojson.Safe.t -> recorded_call_status =
 fun json ->
  match Json.string json with
  | "running" -> Running
  | "completed" -> Completed
  | "failed" -> Failed
  | "unknown" -> Unknown_
  | other -> Json.unknown "recorded_call_status" json (Unknown other)

and yojson_of_recorded_call_status : recorded_call_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Running -> `String "running"
  | Completed -> `String "completed"
  | Failed -> `String "failed"
  | Unknown_ -> `String "unknown"
  | Unknown other -> `String other

type nonrec execution_activity = {
  id : int64;  (** Request identity within the execution. *)
  label : string;
      (** Server-selected label from the generated operation catalog. *)
  status : recorded_call_status;
      (** Observed request state; unfinished operations have unknown outcomes. *)
}
(** A bounded SDK operation observed during execution; not an authorization or write receipt. *)

let execution_activity_of_yojson : Yojson.Safe.t -> execution_activity =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" Json.int64;
    label = Json.required fields "label" Json.string;
    status = Json.required fields "status" recorded_call_status_of_yojson;
  }

and yojson_of_execution_activity : execution_activity -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (Json.of_int64 value.id));
      ("label", Some (Json.of_string value.label));
      ("status", Some (yojson_of_recorded_call_status value.status));
    ]

let make_execution_activity ~(id : int64) ~(label : string)
    ~(status : recorded_call_status) () =
  ({ id; label; status } : execution_activity)

(** Which authenticated participant's access a tool call requests. *)
type nonrec tool_actor =
  | Requester
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

let tool_actor_of_yojson : Yojson.Safe.t -> tool_actor =
 fun json ->
  match Json.string json with
  | "requester" -> Requester
  | "owner" -> Owner
  | other -> Json.unknown "tool_actor" json (Unknown other)

and yojson_of_tool_actor : tool_actor -> Yojson.Safe.t =
 fun value ->
  match value with
  | Requester -> `String "requester"
  | Owner -> `String "owner"
  | Unknown other -> `String other

type nonrec recorded_tool_call = {
  error : string option;  (** Safe tool failure, if one was returned. *)
  id : string;  (** Stable, execution-scoped component identity. *)
  input : Yojson.Safe.t;  (** Arguments passed to the actual tool. *)
  name : string;
      (** Canonical Macro tool name from the allowlisted registry. *)
  output : Yojson.Safe.t option;
      (** Original tool output, retained independently of the program's return value. *)
  output_omitted : bool;
      (** Whether the response was omitted to keep the durable journal bounded. *)
  status : recorded_call_status;
      (** A started call that never replied has an unknown side-effect outcome. *)
}
(** A real inner call, recorded by trusted dispatch for the existing renderers. *)

let recorded_tool_call_of_yojson : Yojson.Safe.t -> recorded_tool_call =
 fun json ->
  let fields = Json.obj json in
  {
    error = Json.optional fields "error" Json.string;
    id = Json.required fields "id" Json.string;
    input = Json.required fields "input" Json.json;
    name = Json.required fields "name" Json.string;
    output = Json.optional fields "output" Json.json;
    output_omitted = Json.required fields "outputOmitted" Json.bool;
    status = Json.required fields "status" recorded_call_status_of_yojson;
  }

and yojson_of_recorded_tool_call : recorded_tool_call -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("error", Option.map Json.of_string value.error);
      ("id", Some (Json.of_string value.id));
      ("input", Some (Json.of_json value.input));
      ("name", Some (Json.of_string value.name));
      ("output", Option.map Json.of_json value.output);
      ("outputOmitted", Some (Json.of_bool value.output_omitted));
      ("status", Some (yojson_of_recorded_call_status value.status));
    ]

let make_recorded_tool_call ?error ~(id : string) ~(input : Yojson.Safe.t)
    ~(name : string) ?output ~(output_omitted : bool)
    ~(status : recorded_call_status) () =
  ({ error; id; input; name; output; output_omitted; status }
    : recorded_tool_call)

(** The recorded outcome of a program. *)
type nonrec execution_status =
  | Running
  | Succeeded
  | Failed
  | Cancelled
  | Timed_out
  | Unknown of string  (** A value this SDK version does not know. *)

let execution_status_of_yojson : Yojson.Safe.t -> execution_status =
 fun json ->
  match Json.string json with
  | "running" -> Running
  | "succeeded" -> Succeeded
  | "failed" -> Failed
  | "cancelled" -> Cancelled
  | "timed_out" -> Timed_out
  | other -> Json.unknown "execution_status" json (Unknown other)

and yojson_of_execution_status : execution_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Running -> `String "running"
  | Succeeded -> `String "succeeded"
  | Failed -> `String "failed"
  | Cancelled -> `String "cancelled"
  | Timed_out -> `String "timed_out"
  | Unknown other -> `String other

type nonrec execution_record = {
  acting_as : tool_actor option;
  activity : execution_activity list option;
      (** Advisory SDK operation activity, without arguments or response contents. *)
  activity_truncated : bool option;
      (** Additional request activity was omitted at the bounded observation limit. *)
  calls : recorded_tool_call list;
      (** Historical bridge calls. Direct HTTP executions leave this empty. *)
  error : string option;  (** Safe execution failure text. *)
  execution_id : execution_id;  (** Execution identity. *)
  result : Yojson.Safe.t option;
      (** JSON returned by the program, if successful. *)
  source : string;  (** The submitted JavaScript module. *)
  status : execution_status;  (** Overall execution state. *)
  turn_id : string option;
      (** Original turn, preventing another requester from replaying a saved result. *)
}
(** Durable source and final outcome, with historical bridge calls when present.
The full journal is not included in the model's tool result. *)

let execution_record_of_yojson : Yojson.Safe.t -> execution_record =
 fun json ->
  let fields = Json.obj json in
  {
    acting_as = Json.optional fields "actingAs" tool_actor_of_yojson;
    activity =
      Json.optional fields "activity" (Json.list execution_activity_of_yojson);
    activity_truncated = Json.optional fields "activityTruncated" Json.bool;
    calls =
      Json.required fields "calls" (Json.list recorded_tool_call_of_yojson);
    error = Json.optional fields "error" Json.string;
    execution_id = Json.required fields "executionId" execution_id_of_yojson;
    result = Json.optional fields "result" Json.json;
    source = Json.required fields "source" Json.string;
    status = Json.required fields "status" execution_status_of_yojson;
    turn_id = Json.optional fields "turnId" Json.string;
  }

and yojson_of_execution_record : execution_record -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("actingAs", Option.map yojson_of_tool_actor value.acting_as);
      ( "activity",
        Option.map (Json.of_list yojson_of_execution_activity) value.activity );
      ("activityTruncated", Option.map Json.of_bool value.activity_truncated);
      ("calls", Some ((Json.of_list yojson_of_recorded_tool_call) value.calls));
      ("error", Option.map Json.of_string value.error);
      ("executionId", Some (yojson_of_execution_id value.execution_id));
      ("result", Option.map Json.of_json value.result);
      ("source", Some (Json.of_string value.source));
      ("status", Some (yojson_of_execution_status value.status));
      ("turnId", Option.map Json.of_string value.turn_id);
    ]

let make_execution_record ?acting_as ?activity ?activity_truncated
    ~(calls : recorded_tool_call list) ?error ~(execution_id : execution_id)
    ?result ~(source : string) ~(status : execution_status) ?turn_id () =
  ({
     acting_as;
     activity;
     activity_truncated;
     calls;
     error;
     execution_id;
     result;
     source;
     status;
     turn_id;
   }
    : execution_record)

type nonrec input_property_definition = {
  name : string;  (** Property display name from the client's catalog. *)
  options : string list option;
      (** Allowed display values; an empty list permits free-text suggestions. *)
}
(** A task property and the display values available for extraction. *)

let input_property_definition_of_yojson :
    Yojson.Safe.t -> input_property_definition =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.required fields "name" Json.string;
    options = Json.optional fields "options" (Json.list Json.string);
  }

and yojson_of_input_property_definition :
    input_property_definition -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Some (Json.of_string value.name));
      ("options", Option.map (Json.of_list Json.of_string) value.options);
    ]

let make_input_property_definition ~(name : string) ?options () =
  ({ name; options } : input_property_definition)

(** Search indexes supported by the shared search editor. *)
type nonrec search_type =
  | All
  | Channels
  | Document_or_file
  | Task
  | Email
  | Calls
  | Folders
  | Agent
  | Calendar
  | Unknown of string  (** A value this SDK version does not know. *)

let search_type_of_yojson : Yojson.Safe.t -> search_type =
 fun json ->
  match Json.string json with
  | "all" -> All
  | "channels" -> Channels
  | "document-or-file" -> Document_or_file
  | "task" -> Task
  | "email" -> Email
  | "calls" -> Calls
  | "folders" -> Folders
  | "agent" -> Agent
  | "calendar" -> Calendar
  | other -> Json.unknown "search_type" json (Unknown other)

and yojson_of_search_type : search_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | All -> `String "all"
  | Channels -> `String "channels"
  | Document_or_file -> `String "document-or-file"
  | Task -> `String "task"
  | Email -> `String "email"
  | Calls -> `String "calls"
  | Folders -> `String "folders"
  | Agent -> `String "agent"
  | Calendar -> `String "calendar"
  | Unknown other -> `String other

type nonrec extract_input_request = {
  intent : input_intent;  (** Destination whose fields should be extracted. *)
  property_definitions : input_property_definition list option;
      (** Available task fields and display values, never authorized entity IDs. *)
  reference_time : string;
      (** Reference instant for interpreting relative dates. *)
  revision : int;
      (** Opaque client revision used to discard stale suggestions. *)
  search_type : search_type option;
  text : string;
      (** Original draft text; inference must not execute its instructions. *)
  time_zone : string;
      (** IANA timezone for interpreting local dates and clock times. *)
}
(** Draft snapshot and local context used to suggest editable destination fields. *)

let extract_input_request_of_yojson : Yojson.Safe.t -> extract_input_request =
 fun json ->
  let fields = Json.obj json in
  {
    intent = Json.required fields "intent" input_intent_of_yojson;
    property_definitions =
      Json.optional fields "property_definitions"
        (Json.list input_property_definition_of_yojson);
    reference_time = Json.required fields "reference_time" Json.string;
    revision = Json.required fields "revision" Json.int;
    search_type = Json.optional fields "search_type" search_type_of_yojson;
    text = Json.required fields "text" Json.string;
    time_zone = Json.required fields "time_zone" Json.string;
  }

and yojson_of_extract_input_request : extract_input_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("intent", Some (yojson_of_input_intent value.intent));
      ( "property_definitions",
        Option.map
          (Json.of_list yojson_of_input_property_definition)
          value.property_definitions );
      ("reference_time", Some (Json.of_string value.reference_time));
      ("revision", Some (Json.of_int value.revision));
      ("search_type", Option.map yojson_of_search_type value.search_type);
      ("text", Some (Json.of_string value.text));
      ("time_zone", Some (Json.of_string value.time_zone));
    ]

let make_extract_input_request ~(intent : input_intent) ?property_definitions
    ~(reference_time : string) ~(revision : int) ?search_type ~(text : string)
    ~(time_zone : string) () =
  ({
     intent;
     property_definitions;
     reference_time;
     revision;
     search_type;
     text;
     time_zone;
   }
    : extract_input_request)

type nonrec query_search_suggestions = {
  query : string option;
      (** Remaining keyword phrase after supported filters and instructions. *)
}
(** A topic for search types without additional supported facets. *)

let query_search_suggestions_of_yojson :
    Yojson.Safe.t -> query_search_suggestions =
 fun json ->
  let fields = Json.obj json in
  { query = Json.optional fields "query" Json.string }

and yojson_of_query_search_suggestions :
    query_search_suggestions -> Yojson.Safe.t =
 fun value -> Json.record [ ("query", Option.map Json.of_string value.query) ]

let make_query_search_suggestions ?query () =
  ({ query } : query_search_suggestions)

type nonrec task_search_suggestions = {
  assignees : string list;
      (** Assigned people's names or supplied addresses. *)
  created_by : string list;  (** Task creators' names or supplied addresses. *)
  priority : string list;
      (** Priority display values for client-side option resolution. *)
  query : string option;  (** Remaining keyword phrase. *)
  status : string list;
      (** Status display values for client-side option resolution. *)
}
(** Task facets match the shared search editor; assignee and creator are distinct. *)

let task_search_suggestions_of_yojson : Yojson.Safe.t -> task_search_suggestions
    =
 fun json ->
  let fields = Json.obj json in
  {
    assignees = Json.required fields "assignees" (Json.list Json.string);
    created_by = Json.required fields "created_by" (Json.list Json.string);
    priority = Json.required fields "priority" (Json.list Json.string);
    query = Json.optional fields "query" Json.string;
    status = Json.required fields "status" (Json.list Json.string);
  }

and yojson_of_task_search_suggestions : task_search_suggestions -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("assignees", Some ((Json.of_list Json.of_string) value.assignees));
      ("created_by", Some ((Json.of_list Json.of_string) value.created_by));
      ("priority", Some ((Json.of_list Json.of_string) value.priority));
      ("query", Option.map Json.of_string value.query);
      ("status", Some ((Json.of_list Json.of_string) value.status));
    ]

let make_task_search_suggestions ~(assignees : string list)
    ~(created_by : string list) ~(priority : string list) ?query
    ~(status : string list) () =
  ({ assignees; created_by; priority; query; status } : task_search_suggestions)

(** Only the selected type's fields can appear in a search suggestion. *)
type nonrec search_suggestions =
  | All of query_search_suggestions  (** Query across content types. *)
  | Channels of channel_search_suggestions
      (** Message topic, senders and channels. *)
  | Document_or_file of query_search_suggestions  (** Document or file topic. *)
  | Task of task_search_suggestions
      (** Task topic and supported task facets. *)
  | Email of email_search_suggestions
      (** Email topic, importance and inbox addresses. *)
  | Calls of call_search_suggestions
      (** Call topic, speakers, channels and attendance. *)
  | Folders of query_search_suggestions  (** Folder topic. *)
  | Agent of query_search_suggestions  (** AI conversation topic. *)
  | Calendar of query_search_suggestions  (** Calendar event topic. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let search_suggestions_of_yojson : Yojson.Safe.t -> search_suggestions =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "all" -> All (query_search_suggestions_of_yojson json)
  | "channels" -> Channels (channel_search_suggestions_of_yojson json)
  | "document-or-file" ->
      Document_or_file (query_search_suggestions_of_yojson json)
  | "task" -> Task (task_search_suggestions_of_yojson json)
  | "email" -> Email (email_search_suggestions_of_yojson json)
  | "calls" -> Calls (call_search_suggestions_of_yojson json)
  | "folders" -> Folders (query_search_suggestions_of_yojson json)
  | "agent" -> Agent (query_search_suggestions_of_yojson json)
  | "calendar" -> Calendar (query_search_suggestions_of_yojson json)
  | _ -> Json.unknown "search_suggestions" json (Unknown json)

and yojson_of_search_suggestions : search_suggestions -> Yojson.Safe.t =
 fun value ->
  match value with
  | All inner ->
      Json.with_tag "type" "all" (yojson_of_query_search_suggestions inner)
  | Channels inner ->
      Json.with_tag "type" "channels"
        (yojson_of_channel_search_suggestions inner)
  | Document_or_file inner ->
      Json.with_tag "type" "document-or-file"
        (yojson_of_query_search_suggestions inner)
  | Task inner ->
      Json.with_tag "type" "task" (yojson_of_task_search_suggestions inner)
  | Email inner ->
      Json.with_tag "type" "email" (yojson_of_email_search_suggestions inner)
  | Calls inner ->
      Json.with_tag "type" "calls" (yojson_of_call_search_suggestions inner)
  | Folders inner ->
      Json.with_tag "type" "folders" (yojson_of_query_search_suggestions inner)
  | Agent inner ->
      Json.with_tag "type" "agent" (yojson_of_query_search_suggestions inner)
  | Calendar inner ->
      Json.with_tag "type" "calendar" (yojson_of_query_search_suggestions inner)
  | Unknown json -> json

type nonrec note_suggestions = {
  body : string option;
      (** Suggested Markdown content or outgoing message body. *)
  title : string option;  (** Suggested note, task, or event title. *)
}
(** Editable fields for note inference, before submission and identity resolution. *)

let note_suggestions_of_yojson : Yojson.Safe.t -> note_suggestions =
 fun json ->
  let fields = Json.obj json in
  {
    body = Json.optional fields "body" Json.string;
    title = Json.optional fields "title" Json.string;
  }

and yojson_of_note_suggestions : note_suggestions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("body", Option.map Json.of_string value.body);
      ("title", Option.map Json.of_string value.title);
    ]

let make_note_suggestions ?body ?title () = ({ body; title } : note_suggestions)

type nonrec input_property_suggestion = {
  name : string;  (** Property display name, never an authorized identifier. *)
  values : string list;
      (** Suggested display values, never authorized entity identifiers. *)
}
(** Suggested display values to resolve against a real task-property catalog. *)

let input_property_suggestion_of_yojson :
    Yojson.Safe.t -> input_property_suggestion =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.required fields "name" Json.string;
    values = Json.required fields "values" (Json.list Json.string);
  }

and yojson_of_input_property_suggestion :
    input_property_suggestion -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Some (Json.of_string value.name));
      ("values", Some ((Json.of_list Json.of_string) value.values));
    ]

let make_input_property_suggestion ~(name : string) ~(values : string list) () =
  ({ name; values } : input_property_suggestion)

type nonrec task_suggestions = {
  body : string option;
      (** Suggested Markdown content or outgoing message body. *)
  due_date : string option;  (** Task deadline as a local ISO date. *)
  properties : input_property_suggestion list option;
      (** Display names/values that the client resolves against available task fields. *)
  title : string option;  (** Suggested note, task, or event title. *)
}
(** Editable fields for task inference, before submission and identity resolution. *)

let task_suggestions_of_yojson : Yojson.Safe.t -> task_suggestions =
 fun json ->
  let fields = Json.obj json in
  {
    body = Json.optional fields "body" Json.string;
    due_date = Json.optional fields "due_date" Json.string;
    properties =
      Json.optional fields "properties"
        (Json.list input_property_suggestion_of_yojson);
    title = Json.optional fields "title" Json.string;
  }

and yojson_of_task_suggestions : task_suggestions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("body", Option.map Json.of_string value.body);
      ("due_date", Option.map Json.of_string value.due_date);
      ( "properties",
        Option.map
          (Json.of_list yojson_of_input_property_suggestion)
          value.properties );
      ("title", Option.map Json.of_string value.title);
    ]

let make_task_suggestions ?body ?due_date ?properties ?title () =
  ({ body; due_date; properties; title } : task_suggestions)

type nonrec message_suggestions = {
  body : string option;
      (** Suggested Markdown content or outgoing message body. *)
  recipients : string list option;
      (** Person or channel names for the client to resolve. *)
}
(** Editable fields for message inference, before submission and identity resolution. *)

let message_suggestions_of_yojson : Yojson.Safe.t -> message_suggestions =
 fun json ->
  let fields = Json.obj json in
  {
    body = Json.optional fields "body" Json.string;
    recipients = Json.optional fields "recipients" (Json.list Json.string);
  }

and yojson_of_message_suggestions : message_suggestions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("body", Option.map Json.of_string value.body);
      ("recipients", Option.map (Json.of_list Json.of_string) value.recipients);
    ]

let make_message_suggestions ?body ?recipients () =
  ({ body; recipients } : message_suggestions)

(** A single inferred destination together with only its applicable fields. *)
type nonrec input_suggestions =
  | Ai of { suggestions : ai_suggestions  (** Editable ai fields. *) }
      (** Editable ai fields. *)
  | Search of {
      suggestions : search_suggestions;  (** Editable search fields. *)
    }  (** Editable search fields. *)
  | Email of { suggestions : email_suggestions  (** Editable email fields. *) }
      (** Editable email fields. *)
  | Note of { suggestions : note_suggestions  (** Editable note fields. *) }
      (** Editable note fields. *)
  | Task of { suggestions : task_suggestions  (** Editable task fields. *) }
      (** Editable task fields. *)
  | Calendar of {
      suggestions : calendar_suggestions;  (** Editable calendar fields. *)
    }  (** Editable calendar fields. *)
  | Message of {
      suggestions : message_suggestions;  (** Editable message fields. *)
    }  (** Editable message fields. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let input_suggestions_of_yojson : Yojson.Safe.t -> input_suggestions =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "intent" with
  | "ai" ->
      Ai
        {
          suggestions =
            Json.required fields "suggestions" ai_suggestions_of_yojson;
        }
  | "search" ->
      Search
        {
          suggestions =
            Json.required fields "suggestions" search_suggestions_of_yojson;
        }
  | "email" ->
      Email
        {
          suggestions =
            Json.required fields "suggestions" email_suggestions_of_yojson;
        }
  | "note" ->
      Note
        {
          suggestions =
            Json.required fields "suggestions" note_suggestions_of_yojson;
        }
  | "task" ->
      Task
        {
          suggestions =
            Json.required fields "suggestions" task_suggestions_of_yojson;
        }
  | "calendar" ->
      Calendar
        {
          suggestions =
            Json.required fields "suggestions" calendar_suggestions_of_yojson;
        }
  | "message" ->
      Message
        {
          suggestions =
            Json.required fields "suggestions" message_suggestions_of_yojson;
        }
  | _ -> Json.unknown "input_suggestions" json (Unknown json)

and yojson_of_input_suggestions : input_suggestions -> Yojson.Safe.t =
 fun value ->
  match value with
  | Ai case ->
      Json.record
        [
          ("intent", Some (`String "ai"));
          ("suggestions", Some (yojson_of_ai_suggestions case.suggestions));
        ]
  | Search case ->
      Json.record
        [
          ("intent", Some (`String "search"));
          ("suggestions", Some (yojson_of_search_suggestions case.suggestions));
        ]
  | Email case ->
      Json.record
        [
          ("intent", Some (`String "email"));
          ("suggestions", Some (yojson_of_email_suggestions case.suggestions));
        ]
  | Note case ->
      Json.record
        [
          ("intent", Some (`String "note"));
          ("suggestions", Some (yojson_of_note_suggestions case.suggestions));
        ]
  | Task case ->
      Json.record
        [
          ("intent", Some (`String "task"));
          ("suggestions", Some (yojson_of_task_suggestions case.suggestions));
        ]
  | Calendar case ->
      Json.record
        [
          ("intent", Some (`String "calendar"));
          ("suggestions", Some (yojson_of_calendar_suggestions case.suggestions));
        ]
  | Message case ->
      Json.record
        [
          ("intent", Some (`String "message"));
          ("suggestions", Some (yojson_of_message_suggestions case.suggestions));
        ]
  | Unknown json -> json

let make_input_suggestions_ai ~(suggestions : ai_suggestions) () =
  (Ai { suggestions } : input_suggestions)

let make_input_suggestions_search ~(suggestions : search_suggestions) () =
  (Search { suggestions } : input_suggestions)

let make_input_suggestions_email ~(suggestions : email_suggestions) () =
  (Email { suggestions } : input_suggestions)

let make_input_suggestions_note ~(suggestions : note_suggestions) () =
  (Note { suggestions } : input_suggestions)

let make_input_suggestions_task ~(suggestions : task_suggestions) () =
  (Task { suggestions } : input_suggestions)

let make_input_suggestions_calendar ~(suggestions : calendar_suggestions) () =
  (Calendar { suggestions } : input_suggestions)

let make_input_suggestions_message ~(suggestions : message_suggestions) () =
  (Message { suggestions } : input_suggestions)

type nonrec extract_input_response = {
  input_suggestions : input_suggestions;
      (** Destination and applicable editable fields, encoded together. *)
  revision : int;  (** Revision echoed from the extraction request. *)
}
(** Validated suggestions for a particular client draft revision. *)

let extract_input_response_of_yojson : Yojson.Safe.t -> extract_input_response =
 fun json ->
  let fields = Json.obj json in
  {
    input_suggestions = input_suggestions_of_yojson json;
    revision = Json.required fields "revision" Json.int;
  }

and yojson_of_extract_input_response : extract_input_response -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record [ ("revision", Some (Json.of_int value.revision)) ];
      yojson_of_input_suggestions value.input_suggestions;
    ]

let make_extract_input_response ~(input_suggestions : input_suggestions)
    ~(revision : int) () =
  ({ input_suggestions; revision } : extract_input_response)

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

type nonrec link_task_request = {
  task_id : string;  (** The task document's id. *)
}
(** The task to link a session to. *)

let link_task_request_of_yojson : Yojson.Safe.t -> link_task_request =
 fun json ->
  let fields = Json.obj json in
  { task_id = Json.required fields "taskId" Json.string }

and yojson_of_link_task_request : link_task_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("taskId", Some (Json.of_string value.task_id)) ]

let make_link_task_request ~(task_id : string) () =
  ({ task_id } : link_task_request)

type nonrec linked_task_response = {
  pull_request_url : string option;
      (** The session's pull request, now linked to the task, if it has one. *)
  reference : string;
      (** Put this in the pull request description so GitHub activity reaches the task. *)
  task_id : string;  (** The task document's id. *)
}
(** The task a session is now linked to. *)

let linked_task_response_of_yojson : Yojson.Safe.t -> linked_task_response =
 fun json ->
  let fields = Json.obj json in
  {
    pull_request_url = Json.optional fields "pullRequestUrl" Json.string;
    reference = Json.required fields "reference" Json.string;
    task_id = Json.required fields "taskId" Json.string;
  }

and yojson_of_linked_task_response : linked_task_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("pullRequestUrl", Option.map Json.of_string value.pull_request_url);
      ("reference", Some (Json.of_string value.reference));
      ("taskId", Some (Json.of_string value.task_id));
    ]

let make_linked_task_response ?pull_request_url ~(reference : string)
    ~(task_id : string) () =
  ({ pull_request_url; reference; task_id } : linked_task_response)

(** Harness names accepted by the model discovery endpoint. *)
type nonrec model_harness_dto =
  | In_memory
  | Cursor
  | Macrod
  | Unknown of string  (** A value this SDK version does not know. *)

let model_harness_dto_of_yojson : Yojson.Safe.t -> model_harness_dto =
 fun json ->
  match Json.string json with
  | "in-memory" -> In_memory
  | "cursor" -> Cursor
  | "macrod" -> Macrod
  | other -> Json.unknown "model_harness_dto" json (Unknown other)

and yojson_of_model_harness_dto : model_harness_dto -> Yojson.Safe.t =
 fun value ->
  match value with
  | In_memory -> `String "in-memory"
  | Cursor -> `String "cursor"
  | Macrod -> `String "macrod"
  | Unknown other -> `String other

type nonrec load_agent_models_request = {
  harness : model_harness_dto;  (** Provider to probe. *)
  harness_id : string option;
      (** Required for macrod and forbidden for other targets. *)
}
(** HTTP request selecting one provider to probe. *)

let load_agent_models_request_of_yojson :
    Yojson.Safe.t -> load_agent_models_request =
 fun json ->
  let fields = Json.obj json in
  {
    harness = Json.required fields "harness" model_harness_dto_of_yojson;
    harness_id = Json.optional fields "harnessId" Json.string;
  }

and yojson_of_load_agent_models_request :
    load_agent_models_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("harness", Some (yojson_of_model_harness_dto value.harness));
      ("harnessId", Option.map Json.of_string value.harness_id);
    ]

let make_load_agent_models_request ~(harness : model_harness_dto) ?harness_id ()
    =
  ({ harness; harness_id } : load_agent_models_request)

type nonrec load_agent_models_response = {
  cached_at : string option;
      (** When a paired runtime that is off or unreachable last reported this
catalog; null when it was probed live. *)
  current_model : string option;
      (** Current provider model, if model selection is available. *)
  models : agent_model_dto list;  (** Ordered model catalog. *)
  status : agent_models_status_dto;  (** Model-selection availability. *)
}
(** Successful model-discovery response. *)

let load_agent_models_response_of_yojson :
    Yojson.Safe.t -> load_agent_models_response =
 fun json ->
  let fields = Json.obj json in
  {
    cached_at = Json.optional fields "cachedAt" Json.string;
    current_model = Json.optional fields "currentModel" Json.string;
    models = Json.required fields "models" (Json.list agent_model_dto_of_yojson);
    status = Json.required fields "status" agent_models_status_dto_of_yojson;
  }

and yojson_of_load_agent_models_response :
    load_agent_models_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("cachedAt", Option.map Json.of_string value.cached_at);
      ("currentModel", Option.map Json.of_string value.current_model);
      ("models", Some ((Json.of_list yojson_of_agent_model_dto) value.models));
      ("status", Some (yojson_of_agent_models_status_dto value.status));
    ]

let make_load_agent_models_response ?cached_at ?current_model
    ~(models : agent_model_dto list) ~(status : agent_models_status_dto) () =
  ({ cached_at; current_model; models; status } : load_agent_models_response)

type nonrec log_frame_dto = {
  content : Yojson.Safe.t;
      (** The protocol envelope, verbatim. Opaque here: it is Agent Runtime
Protocol, whose shape belongs to the fold rather than this endpoint. *)
  direction : log_direction_dto;  (** Which way the frame travelled. *)
}
(** The two fields \[[AgentSessionLogEntryDto]\] flattens in.

Schema only. Nothing constructs one: the entry serializes through
\[[Message]\], and this exists so the generated clients see [direction] and
[content] as named fields instead of an open map. A hand-built copy could
drift from the fold's wire format, and the point of the endpoint is that it
cannot - so this describes that format without being able to produce it. *)

let log_frame_dto_of_yojson : Yojson.Safe.t -> log_frame_dto =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.required fields "content" Json.json;
    direction = Json.required fields "direction" log_direction_dto_of_yojson;
  }

and yojson_of_log_frame_dto : log_frame_dto -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Some (Json.of_json value.content));
      ("direction", Some (yojson_of_log_direction_dto value.direction));
    ]

let make_log_frame_dto ~(content : Yojson.Safe.t)
    ~(direction : log_direction_dto) () =
  ({ content; direction } : log_frame_dto)

(** Where the opened item goes. Neither replaces what the person is reading. *)
type nonrec ui_placement =
  | Beside_agent
  | New
  | Unknown of string  (** A value this SDK version does not know. *)

let ui_placement_of_yojson : Yojson.Safe.t -> ui_placement =
 fun json ->
  match Json.string json with
  | "beside-agent" -> Beside_agent
  | "new" -> New
  | other -> Json.unknown "ui_placement" json (Unknown other)

and yojson_of_ui_placement : ui_placement -> Yojson.Safe.t =
 fun value ->
  match value with
  | Beside_agent -> `String "beside-agent"
  | New -> `String "new"
  | Unknown other -> `String other

type nonrec open_in_app = {
  execution_id : execution_id;
      (** The running execution asking; it must belong to the session's
current turn. *)
  path : string;
      (** An app path, such as [/md/<id>] or [/channels/<id>?s0.channels.messageId=<id>]:
what follows [/app] in a Macro link. Never an origin. *)
  placement : ui_placement option;
      (** Where to put it; beside the agent by default. *)
}
(** Open an item in the prompting person's app tab. *)

let open_in_app_of_yojson : Yojson.Safe.t -> open_in_app =
 fun json ->
  let fields = Json.obj json in
  {
    execution_id = Json.required fields "executionId" execution_id_of_yojson;
    path = Json.required fields "path" Json.string;
    placement = Json.optional fields "placement" ui_placement_of_yojson;
  }

and yojson_of_open_in_app : open_in_app -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("executionId", Some (yojson_of_execution_id value.execution_id));
      ("path", Some (Json.of_string value.path));
      ("placement", Option.map yojson_of_ui_placement value.placement);
    ]

let make_open_in_app ~(execution_id : execution_id) ~(path : string) ?placement
    () =
  ({ execution_id; path; placement } : open_in_app)

type nonrec present_view = {
  execution_id : execution_id option;
  view : Yojson.Safe.t;
      (** A dynamic-UI view, in the format of the PresentView schema in
ExecuteCode's description. *)
}
(** A view to present. *)

let present_view_of_yojson : Yojson.Safe.t -> present_view =
 fun json ->
  let fields = Json.obj json in
  {
    execution_id = Json.optional fields "executionId" execution_id_of_yojson;
    view = Json.required fields "view" Json.json;
  }

and yojson_of_present_view : present_view -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("executionId", Option.map yojson_of_execution_id value.execution_id);
      ("view", Some (Json.of_json value.view));
    ]

let make_present_view ?execution_id ~(view : Yojson.Safe.t) () =
  ({ execution_id; view } : present_view)

type nonrec preview_agent_sessions_request = {
  session_ids : string list;
      (** The sessions to preview. Duplicates are collapsed server-side; at most
\[[MAX_PREVIEW_SESSION_IDS]\](crate::domain::model::MAX_PREVIEW_SESSION_IDS)
distinct ids per request. *)
}
(** Request body for [POST /agent-sessions/preview].

Clients serialize this, so both derives are used. *)

let preview_agent_sessions_request_of_yojson :
    Yojson.Safe.t -> preview_agent_sessions_request =
 fun json ->
  let fields = Json.obj json in
  { session_ids = Json.required fields "sessionIds" (Json.list Json.string) }

and yojson_of_preview_agent_sessions_request :
    preview_agent_sessions_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("sessionIds", Some ((Json.of_list Json.of_string) value.session_ids)) ]

let make_preview_agent_sessions_request ~(session_ids : string list) () =
  ({ session_ids } : preview_agent_sessions_request)

type nonrec preview_agent_sessions_response = {
  previews : agent_session_preview_dto list;
      (** What the caller may see of each requested session. *)
}
(** Response body for [POST /agent-sessions/preview]: one entry per distinct
requested id, in no particular order.

Clients deserialize this, so both derives are used. *)

let preview_agent_sessions_response_of_yojson :
    Yojson.Safe.t -> preview_agent_sessions_response =
 fun json ->
  let fields = Json.obj json in
  {
    previews =
      Json.required fields "previews"
        (Json.list agent_session_preview_dto_of_yojson);
  }

and yojson_of_preview_agent_sessions_response :
    preview_agent_sessions_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "previews",
        Some ((Json.of_list yojson_of_agent_session_preview_dto) value.previews)
      );
    ]

let make_preview_agent_sessions_response
    ~(previews : agent_session_preview_dto list) () =
  ({ previews } : preview_agent_sessions_response)

(** Who associated a pull request with a session. *)
type nonrec pull_request_link_source =
  | Agent
  | User
  | Unknown of string  (** A value this SDK version does not know. *)

let pull_request_link_source_of_yojson :
    Yojson.Safe.t -> pull_request_link_source =
 fun json ->
  match Json.string json with
  | "agent" -> Agent
  | "user" -> User
  | other -> Json.unknown "pull_request_link_source" json (Unknown other)

and yojson_of_pull_request_link_source :
    pull_request_link_source -> Yojson.Safe.t =
 fun value ->
  match value with
  | Agent -> `String "agent"
  | User -> `String "user"
  | Unknown other -> `String other

type nonrec pull_request_linked_session = {
  origin_message_id : string option;
      (** The message that started the session, such as an \@mention, when it was
started from a thread. A mention inside a thread is that reply, not the root. *)
  session_id : string;  (** The session id. *)
  source : pull_request_link_source;
      (** Who associated the pull request with the session. *)
  thread_parent : message_parent option;
}
(** A session linked to a pull request, as a viewer of that session sees it. *)

let pull_request_linked_session_of_yojson :
    Yojson.Safe.t -> pull_request_linked_session =
 fun json ->
  let fields = Json.obj json in
  {
    origin_message_id = Json.optional fields "originMessageId" Json.string;
    session_id = Json.required fields "sessionId" Json.string;
    source = Json.required fields "source" pull_request_link_source_of_yojson;
    thread_parent = Json.optional fields "threadParent" message_parent_of_yojson;
  }

and yojson_of_pull_request_linked_session :
    pull_request_linked_session -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("originMessageId", Option.map Json.of_string value.origin_message_id);
      ("sessionId", Some (Json.of_string value.session_id));
      ("source", Some (yojson_of_pull_request_link_source value.source));
      ("threadParent", Option.map yojson_of_message_parent value.thread_parent);
    ]

let make_pull_request_linked_session ?origin_message_id ~(session_id : string)
    ~(source : pull_request_link_source) ?thread_parent () =
  ({ origin_message_id; session_id; source; thread_parent }
    : pull_request_linked_session)

type nonrec pull_request_sessions = {
  github_key : string;  (** The pull request's [owner/repo/pull/number] key. *)
  sessions : pull_request_linked_session list;
      (** Linked sessions the caller can view, oldest link first. *)
  url : string;  (** The requested pull request URL, canonicalized. *)
}
(** The sessions linked to one pull request that the caller can view. *)

let pull_request_sessions_of_yojson : Yojson.Safe.t -> pull_request_sessions =
 fun json ->
  let fields = Json.obj json in
  {
    github_key = Json.required fields "githubKey" Json.string;
    sessions =
      Json.required fields "sessions"
        (Json.list pull_request_linked_session_of_yojson);
    url = Json.required fields "url" Json.string;
  }

and yojson_of_pull_request_sessions : pull_request_sessions -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("githubKey", Some (Json.of_string value.github_key));
      ( "sessions",
        Some
          ((Json.of_list yojson_of_pull_request_linked_session) value.sessions)
      );
      ("url", Some (Json.of_string value.url));
    ]

let make_pull_request_sessions ~(github_key : string)
    ~(sessions : pull_request_linked_session list) ~(url : string) () =
  ({ github_key; sessions; url } : pull_request_sessions)

type nonrec pull_request_sessions_response = {
  session_ids : string list;
      (** Sessions associated with the pull request that the caller can view. *)
}
(** The sessions associated with a pull request. *)

let pull_request_sessions_response_of_yojson :
    Yojson.Safe.t -> pull_request_sessions_response =
 fun json ->
  let fields = Json.obj json in
  { session_ids = Json.required fields "sessionIds" (Json.list Json.string) }

and yojson_of_pull_request_sessions_response :
    pull_request_sessions_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("sessionIds", Some ((Json.of_list Json.of_string) value.session_ids)) ]

let make_pull_request_sessions_response ~(session_ids : string list) () =
  ({ session_ids } : pull_request_sessions_response)

type nonrec pull_request_url = {
  url : string;
      (** The pull request's GitHub URL, such as [https://github.com/owner/repo/pull/12]. *)
}
(** A GitHub pull request, by URL. *)

let pull_request_url_of_yojson : Yojson.Safe.t -> pull_request_url =
 fun json ->
  let fields = Json.obj json in
  { url = Json.required fields "url" Json.string }

and yojson_of_pull_request_url : pull_request_url -> Yojson.Safe.t =
 fun value -> Json.record [ ("url", Some (Json.of_string value.url)) ]

let make_pull_request_url ~(url : string) () = ({ url } : pull_request_url)

type nonrec pull_request_urls = {
  urls : string list;  (** Pull request GitHub URLs, at most 100. *)
}
(** GitHub pull requests, by URL. *)

let pull_request_urls_of_yojson : Yojson.Safe.t -> pull_request_urls =
 fun json ->
  let fields = Json.obj json in
  { urls = Json.required fields "urls" (Json.list Json.string) }

and yojson_of_pull_request_urls : pull_request_urls -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("urls", Some ((Json.of_list Json.of_string) value.urls)) ]

let make_pull_request_urls ~(urls : string list) () =
  ({ urls } : pull_request_urls)

type nonrec pull_requests_sessions_response = {
  pull_requests : pull_request_sessions list;
      (** One entry per requested pull request, in request order. *)
}
(** The sessions associated with each requested pull request. *)

let pull_requests_sessions_response_of_yojson :
    Yojson.Safe.t -> pull_requests_sessions_response =
 fun json ->
  let fields = Json.obj json in
  {
    pull_requests =
      Json.required fields "pullRequests"
        (Json.list pull_request_sessions_of_yojson);
  }

and yojson_of_pull_requests_sessions_response :
    pull_requests_sessions_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "pullRequests",
        Some
          ((Json.of_list yojson_of_pull_request_sessions) value.pull_requests)
      );
    ]

let make_pull_requests_sessions_response
    ~(pull_requests : pull_request_sessions list) () =
  ({ pull_requests } : pull_requests_sessions_response)

type nonrec rename_agent_session_request = {
  name : string;
      (** New user-facing name. Leading and trailing whitespace is discarded. *)
}
(** Request body for renaming an agent session. *)

let rename_agent_session_request_of_yojson :
    Yojson.Safe.t -> rename_agent_session_request =
 fun json ->
  let fields = Json.obj json in
  { name = Json.required fields "name" Json.string }

and yojson_of_rename_agent_session_request :
    rename_agent_session_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("name", Some (Json.of_string value.name)) ]

let make_rename_agent_session_request ~(name : string) () =
  ({ name } : rename_agent_session_request)

type nonrec retry_agent_conversation_turn_request = {
  action_id : string;  (** Current failed attempt identity. *)
}
(** The attempt the user saw and chose to retry; prevents double-click reruns. *)

let retry_agent_conversation_turn_request_of_yojson :
    Yojson.Safe.t -> retry_agent_conversation_turn_request =
 fun json ->
  let fields = Json.obj json in
  { action_id = Json.required fields "actionId" Json.string }

and yojson_of_retry_agent_conversation_turn_request :
    retry_agent_conversation_turn_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("actionId", Some (Json.of_string value.action_id)) ]

let make_retry_agent_conversation_turn_request ~(action_id : string) () =
  ({ action_id } : retry_agent_conversation_turn_request)

(** One atomic user decision against the displayed revision. *)
type nonrec review_decision =
  | Edit of {
      draft : Yojson.Safe.t;
          (** Replacement action arguments, keyed by the review's kind. *)
      item : string;  (** Pending item to update. *)
      revision : int64;  (** Revision displayed by the caller. *)
    }  (** Save one edited draft. *)
  | Submit of {
      items : string list;
          (** Pending items, or an empty list to select all pending items. *)
      revision : int64;  (** Revision displayed by the caller. *)
    }  (** Send/create selected items, or all pending items when empty. *)
  | Dismiss of {
      items : string list;
          (** Pending items, or an empty list to select all pending items. *)
      revision : int64;  (** Revision displayed by the caller. *)
    }  (** Dismiss selected pending items, or all pending items when empty. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let review_decision_of_yojson : Yojson.Safe.t -> review_decision =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "action" with
  | "edit" ->
      Edit
        {
          draft = Json.required fields "draft" Json.json;
          item = Json.required fields "item" Json.string;
          revision = Json.required fields "revision" Json.int64;
        }
  | "submit" ->
      Submit
        {
          items = Json.required fields "items" (Json.list Json.string);
          revision = Json.required fields "revision" Json.int64;
        }
  | "dismiss" ->
      Dismiss
        {
          items = Json.required fields "items" (Json.list Json.string);
          revision = Json.required fields "revision" Json.int64;
        }
  | _ -> Json.unknown "review_decision" json (Unknown json)

and yojson_of_review_decision : review_decision -> Yojson.Safe.t =
 fun value ->
  match value with
  | Edit case ->
      Json.record
        [
          ("action", Some (`String "edit"));
          ("draft", Some (Json.of_json case.draft));
          ("item", Some (Json.of_string case.item));
          ("revision", Some (Json.of_int64 case.revision));
        ]
  | Submit case ->
      Json.record
        [
          ("action", Some (`String "submit"));
          ("items", Some ((Json.of_list Json.of_string) case.items));
          ("revision", Some (Json.of_int64 case.revision));
        ]
  | Dismiss case ->
      Json.record
        [
          ("action", Some (`String "dismiss"));
          ("items", Some ((Json.of_list Json.of_string) case.items));
          ("revision", Some (Json.of_int64 case.revision));
        ]
  | Unknown json -> json

let make_review_decision_edit ~(draft : Yojson.Safe.t) ~(item : string)
    ~(revision : int64) () =
  (Edit { draft; item; revision } : review_decision)

let make_review_decision_submit ~(items : string list) ~(revision : int64) () =
  (Submit { items; revision } : review_decision)

let make_review_decision_dismiss ~(items : string list) ~(revision : int64) () =
  (Dismiss { items; revision } : review_decision)

type nonrec review_decision_context = {
  by : string;  (** Authenticated account holder. *)
  items : string list;  (** Items selected by this decision. *)
  revision : int64;
      (** Revision claimed by this batch, used in notification deduplication. *)
  via : decision_via;  (** Entry surface. *)
}
(** Facts about the most recent account-holder decision. *)

let review_decision_context_of_yojson : Yojson.Safe.t -> review_decision_context
    =
 fun json ->
  let fields = Json.obj json in
  {
    by = Json.required fields "by" Json.string;
    items = Json.required fields "items" (Json.list Json.string);
    revision = Json.required fields "revision" Json.int64;
    via = Json.required fields "via" decision_via_of_yojson;
  }

and yojson_of_review_decision_context : review_decision_context -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("by", Some (Json.of_string value.by));
      ("items", Some ((Json.of_list Json.of_string) value.items));
      ("revision", Some (Json.of_int64 value.revision));
      ("via", Some (yojson_of_decision_via value.via));
    ]

let make_review_decision_context ~(by : string) ~(items : string list)
    ~(revision : int64) ~(via : decision_via) () =
  ({ by; items; revision; via } : review_decision_context)

type nonrec review_id = string
(** Persisted review identity. *)

let review_id_of_yojson : Yojson.Safe.t -> review_id =
 fun json -> Json.string json

and yojson_of_review_id : review_id -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec review_record = {
  acting_user : string;  (** Account whose email/calendar the drafts use. *)
  decision : review_decision_context option;
  execution_id : execution_id option;
  id : review_id;  (** Review identity. *)
  presented_at : int64 option;
      (** Durable presentation acknowledgment, separate from user decisions. *)
  revision : int64;  (** Compare-and-swap revision for edits and submissions. *)
  session_id : string;  (** Owning session. *)
  title : string;  (** Stack label. *)
  updated_at : int64;  (** Milliseconds since epoch of the last state change. *)
}
(** Full UI record, fetched outside the model context. *)

let review_record_of_yojson : Yojson.Safe.t -> review_record =
 fun json ->
  let fields = Json.obj json in
  {
    acting_user = Json.required fields "actingUser" Json.string;
    decision = Json.optional fields "decision" review_decision_context_of_yojson;
    execution_id = Json.optional fields "executionId" execution_id_of_yojson;
    id = Json.required fields "id" review_id_of_yojson;
    presented_at = Json.optional fields "presentedAt" Json.int64;
    revision = Json.required fields "revision" Json.int64;
    session_id = Json.required fields "sessionId" Json.string;
    title = Json.required fields "title" Json.string;
    updated_at = Json.required fields "updatedAt" Json.int64;
  }

and yojson_of_review_record : review_record -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("actingUser", Some (Json.of_string value.acting_user));
      ("decision", Option.map yojson_of_review_decision_context value.decision);
      ("executionId", Option.map yojson_of_execution_id value.execution_id);
      ("id", Some (yojson_of_review_id value.id));
      ("presentedAt", Option.map Json.of_int64 value.presented_at);
      ("revision", Some (Json.of_int64 value.revision));
      ("sessionId", Some (Json.of_string value.session_id));
      ("title", Some (Json.of_string value.title));
      ("updatedAt", Some (Json.of_int64 value.updated_at));
    ]

let make_review_record ~(acting_user : string) ?decision ?execution_id
    ~(id : review_id) ?presented_at ~(revision : int64) ~(session_id : string)
    ~(title : string) ~(updated_at : int64) () =
  ({
     acting_user;
     decision;
     execution_id;
     id;
     presented_at;
     revision;
     session_id;
     title;
     updated_at;
   }
    : review_record)

type nonrec sandbox_size_body = {
  size : sandbox_size;  (** Named compute tier. *)
}
(** Request or response body for a named sandbox size. *)

let sandbox_size_body_of_yojson : Yojson.Safe.t -> sandbox_size_body =
 fun json ->
  let fields = Json.obj json in
  { size = Json.required fields "size" sandbox_size_of_yojson }

and yojson_of_sandbox_size_body : sandbox_size_body -> Yojson.Safe.t =
 fun value -> Json.record [ ("size", Some (yojson_of_sandbox_size value.size)) ]

let make_sandbox_size_body ~(size : sandbox_size) () =
  ({ size } : sandbox_size_body)

type nonrec session_auto_archive_response = {
  auto_archived_at : string option;
      (** When a trigger first archived the session. Kept when a person restores it: a session
archives itself at most once. *)
  defaults : auto_archive_preferences_body;
      (** The owner's defaults, which apply where the session has no choice of its own. *)
  overrides : auto_archive_overrides_body;  (** The session's own choices. *)
}
(** A session's auto-archive settings and history. *)

let session_auto_archive_response_of_yojson :
    Yojson.Safe.t -> session_auto_archive_response =
 fun json ->
  let fields = Json.obj json in
  {
    auto_archived_at = Json.optional fields "autoArchivedAt" Json.string;
    defaults =
      Json.required fields "defaults" auto_archive_preferences_body_of_yojson;
    overrides =
      Json.required fields "overrides" auto_archive_overrides_body_of_yojson;
  }

and yojson_of_session_auto_archive_response :
    session_auto_archive_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("autoArchivedAt", Option.map Json.of_string value.auto_archived_at);
      ("defaults", Some (yojson_of_auto_archive_preferences_body value.defaults));
      ("overrides", Some (yojson_of_auto_archive_overrides_body value.overrides));
    ]

let make_session_auto_archive_response ?auto_archived_at
    ~(defaults : auto_archive_preferences_body)
    ~(overrides : auto_archive_overrides_body) () =
  ({ auto_archived_at; defaults; overrides } : session_auto_archive_response)

type nonrec session_pull_request_link = {
  created_at : string;
      (** When the pull request was associated with the session. *)
  github_key : string;  (** The pull request's [owner/repo/pull/number] key. *)
  linked_by : string option;
      (** The Macro user who linked it, for links a person made. *)
  source : pull_request_link_source;
      (** Who associated the pull request with the session. *)
  url : string;  (** The pull request's GitHub URL. *)
}
(** A pull request associated with a session. *)

let session_pull_request_link_of_yojson :
    Yojson.Safe.t -> session_pull_request_link =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "createdAt" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    linked_by = Json.optional fields "linkedBy" Json.string;
    source = Json.required fields "source" pull_request_link_source_of_yojson;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_session_pull_request_link :
    session_pull_request_link -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Some (Json.of_string value.created_at));
      ("githubKey", Some (Json.of_string value.github_key));
      ("linkedBy", Option.map Json.of_string value.linked_by);
      ("source", Some (yojson_of_pull_request_link_source value.source));
      ("url", Some (Json.of_string value.url));
    ]

let make_session_pull_request_link ~(created_at : string) ~(github_key : string)
    ?linked_by ~(source : pull_request_link_source) ~(url : string) () =
  ({ created_at; github_key; linked_by; source; url }
    : session_pull_request_link)

type nonrec session_pull_requests_response = {
  pull_requests : session_pull_request_link list;
      (** Pull requests, oldest link first. *)
}
(** The pull requests associated with a session. *)

let session_pull_requests_response_of_yojson :
    Yojson.Safe.t -> session_pull_requests_response =
 fun json ->
  let fields = Json.obj json in
  {
    pull_requests =
      Json.required fields "pullRequests"
        (Json.list session_pull_request_link_of_yojson);
  }

and yojson_of_session_pull_requests_response :
    session_pull_requests_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "pullRequests",
        Some
          ((Json.of_list yojson_of_session_pull_request_link)
             value.pull_requests) );
    ]

let make_session_pull_requests_response
    ~(pull_requests : session_pull_request_link list) () =
  ({ pull_requests } : session_pull_requests_response)

type nonrec set_agent_session_archived_request = {
  archived : bool;  (** Archive the session, or restore it. *)
}
(** Request body for archiving or unarchiving an agent session. *)

let set_agent_session_archived_request_of_yojson :
    Yojson.Safe.t -> set_agent_session_archived_request =
 fun json ->
  let fields = Json.obj json in
  { archived = Json.required fields "archived" Json.bool }

and yojson_of_set_agent_session_archived_request :
    set_agent_session_archived_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("archived", Some (Json.of_bool value.archived)) ]

let make_set_agent_session_archived_request ~(archived : bool) () =
  ({ archived } : set_agent_session_archived_request)

type nonrec share_permission_v2 = {
  channel_share_permissions : channel_share_permission list option;
      (** The channel share permissions for the item *)
  id : string;  (** The share permission id *)
  link_share : link_share option;
  link_share_access_level : access_level option;
  owner : string;  (** The owner of the item *)
  team_share_access_level : access_level option;
}

let share_permission_v2_of_yojson : Yojson.Safe.t -> share_permission_v2 =
 fun json ->
  let fields = Json.obj json in
  {
    channel_share_permissions =
      Json.optional fields "channelSharePermissions"
        (Json.list channel_share_permission_of_yojson);
    id = Json.required fields "id" Json.string;
    link_share = Json.optional fields "linkShare" link_share_of_yojson;
    link_share_access_level =
      Json.optional fields "linkShareAccessLevel" access_level_of_yojson;
    owner = Json.required fields "owner" Json.string;
    team_share_access_level =
      Json.optional fields "teamShareAccessLevel" access_level_of_yojson;
  }

and yojson_of_share_permission_v2 : share_permission_v2 -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "channelSharePermissions",
        Option.map
          (Json.of_list yojson_of_channel_share_permission)
          value.channel_share_permissions );
      ("id", Some (Json.of_string value.id));
      ("linkShare", Option.map yojson_of_link_share value.link_share);
      ( "linkShareAccessLevel",
        Option.map yojson_of_access_level value.link_share_access_level );
      ("owner", Some (Json.of_string value.owner));
      ( "teamShareAccessLevel",
        Option.map yojson_of_access_level value.team_share_access_level );
    ]

let make_share_permission_v2 ?channel_share_permissions ~(id : string)
    ?link_share ?link_share_access_level ~(owner : string)
    ?team_share_access_level () =
  ({
     channel_share_permissions;
     id;
     link_share;
     link_share_access_level;
     owner;
     team_share_access_level;
   }
    : share_permission_v2)

type nonrec start_fresh_agent_conversation_request = {
  session_id : string;
      (** Current session id shown in the conversation metadata. *)
}
(** The session the user is choosing to leave behind. *)

let start_fresh_agent_conversation_request_of_yojson :
    Yojson.Safe.t -> start_fresh_agent_conversation_request =
 fun json ->
  let fields = Json.obj json in
  { session_id = Json.required fields "sessionId" Json.string }

and yojson_of_start_fresh_agent_conversation_request :
    start_fresh_agent_conversation_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("sessionId", Some (Json.of_string value.session_id)) ]

let make_start_fresh_agent_conversation_request ~(session_id : string) () =
  ({ session_id } : start_fresh_agent_conversation_request)

(** Why a command was not sent. *)
type nonrec ui_decline_reason =
  | Turned_off
  | Not_allowed_route
  | Rate_limited
  | Unknown of string  (** A value this SDK version does not know. *)

let ui_decline_reason_of_yojson : Yojson.Safe.t -> ui_decline_reason =
 fun json ->
  match Json.string json with
  | "turned_off" -> Turned_off
  | "not_allowed_route" -> Not_allowed_route
  | "rate_limited" -> Rate_limited
  | other -> Json.unknown "ui_decline_reason" json (Unknown other)

and yojson_of_ui_decline_reason : ui_decline_reason -> Yojson.Safe.t =
 fun value ->
  match value with
  | Turned_off -> `String "turned_off"
  | Not_allowed_route -> `String "not_allowed_route"
  | Rate_limited -> `String "rate_limited"
  | Unknown other -> `String other

(** What happened to a command. *)
type nonrec ui_command_outcome =
  | Sent of {
      command_id : string;  (** The command's id, as the tab sees it. *)
    }
      (** A connection of the prompting person took it. Their tab opens it
unless it refuses the route or the person is somewhere else. *)
  | No_client
      (** Nobody to show it to: a turn nobody typed in a tab, or the tab is
not connected. Link the item in the reply instead. *)
  | Declined of { reason : ui_decline_reason  (** Why. *) }
      (** Not sent, for the given reason. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let ui_command_outcome_of_yojson : Yojson.Safe.t -> ui_command_outcome =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "status" with
  | "sent" -> Sent { command_id = Json.required fields "commandId" Json.string }
  | "no_client" -> No_client
  | "declined" ->
      Declined
        { reason = Json.required fields "reason" ui_decline_reason_of_yojson }
  | _ -> Json.unknown "ui_command_outcome" json (Unknown json)

and yojson_of_ui_command_outcome : ui_command_outcome -> Yojson.Safe.t =
 fun value ->
  match value with
  | Sent case ->
      Json.record
        [
          ("status", Some (`String "sent"));
          ("commandId", Some (Json.of_string case.command_id));
        ]
  | No_client -> Json.record [ ("status", Some (`String "no_client")) ]
  | Declined case ->
      Json.record
        [
          ("status", Some (`String "declined"));
          ("reason", Some (yojson_of_ui_decline_reason case.reason));
        ]
  | Unknown json -> json

let make_ui_command_outcome_sent ~(command_id : string) () =
  (Sent { command_id } : ui_command_outcome)

let make_ui_command_outcome_declined ~(reason : ui_decline_reason) () =
  (Declined { reason } : ui_command_outcome)

type nonrec update_operation =
  | Add
  | Remove
  | Replace
  | Unknown of string  (** A value this SDK version does not know. *)

let update_operation_of_yojson : Yojson.Safe.t -> update_operation =
 fun json ->
  match Json.string json with
  | "add" -> Add
  | "remove" -> Remove
  | "replace" -> Replace
  | other -> Json.unknown "update_operation" json (Unknown other)

and yojson_of_update_operation : update_operation -> Yojson.Safe.t =
 fun value ->
  match value with
  | Add -> `String "add"
  | Remove -> `String "remove"
  | Replace -> `String "replace"
  | Unknown other -> `String other

type nonrec update_channel_share_permission = {
  access_level : access_level option;
  channel_id : string;  (** The channel id *)
  operation : update_operation;
      (** The type of operation to be performed on the chanel share permission
You can add, remove or replace and existing permission *)
}

let update_channel_share_permission_of_yojson :
    Yojson.Safe.t -> update_channel_share_permission =
 fun json ->
  let fields = Json.obj json in
  {
    access_level = Json.optional fields "accessLevel" access_level_of_yojson;
    channel_id = Json.required fields "channelId" Json.string;
    operation = Json.required fields "operation" update_operation_of_yojson;
  }

and yojson_of_update_channel_share_permission :
    update_channel_share_permission -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("accessLevel", Option.map yojson_of_access_level value.access_level);
      ("channelId", Some (Json.of_string value.channel_id));
      ("operation", Some (yojson_of_update_operation value.operation));
    ]

let make_update_channel_share_permission ?access_level ~(channel_id : string)
    ~(operation : update_operation) () =
  ({ access_level; channel_id; operation } : update_channel_share_permission)

type nonrec update_share_permission_request_v2 = {
  channel_share_permissions : update_channel_share_permission list option;
      (** Any channel share permissions to be created/updated/removed *)
  link_share : link_share option;
  link_share_access_level : access_level option;
  team_share_access_level : access_level option;
}

let update_share_permission_request_v2_of_yojson :
    Yojson.Safe.t -> update_share_permission_request_v2 =
 fun json ->
  let fields = Json.obj json in
  {
    channel_share_permissions =
      Json.optional fields "channelSharePermissions"
        (Json.list update_channel_share_permission_of_yojson);
    link_share = Json.optional fields "linkShare" link_share_of_yojson;
    link_share_access_level =
      Json.optional fields "linkShareAccessLevel" access_level_of_yojson;
    team_share_access_level =
      Json.optional fields "teamShareAccessLevel" access_level_of_yojson;
  }

and yojson_of_update_share_permission_request_v2 :
    update_share_permission_request_v2 -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "channelSharePermissions",
        Option.map
          (Json.of_list yojson_of_update_channel_share_permission)
          value.channel_share_permissions );
      ("linkShare", Option.map yojson_of_link_share value.link_share);
      ( "linkShareAccessLevel",
        Option.map yojson_of_access_level value.link_share_access_level );
      ( "teamShareAccessLevel",
        Option.map yojson_of_access_level value.team_share_access_level );
    ]

let make_update_share_permission_request_v2 ?channel_share_permissions
    ?link_share ?link_share_access_level ?team_share_access_level () =
  ({
     channel_share_permissions;
     link_share;
     link_share_access_level;
     team_share_access_level;
   }
    : update_share_permission_request_v2)

type nonrec voice = {
  accent : string;  (** The provider's accent label. *)
  languages : string list;  (** Languages the voice speaks. *)
  model : string;  (** The model to save as the agent's voice. *)
  name : string;  (** The provider's name for the voice. *)
  tags : string list;  (** The provider's gender and character tags. *)
}
(** One voice of the provider's catalog. *)

let voice_of_yojson : Yojson.Safe.t -> voice =
 fun json ->
  let fields = Json.obj json in
  {
    accent = Json.required fields "accent" Json.string;
    languages = Json.required fields "languages" (Json.list Json.string);
    model = Json.required fields "model" Json.string;
    name = Json.required fields "name" Json.string;
    tags = Json.required fields "tags" (Json.list Json.string);
  }

and yojson_of_voice : voice -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("accent", Some (Json.of_string value.accent));
      ("languages", Some ((Json.of_list Json.of_string) value.languages));
      ("model", Some (Json.of_string value.model));
      ("name", Some (Json.of_string value.name));
      ("tags", Some ((Json.of_list Json.of_string) value.tags));
    ]

let make_voice ~(accent : string) ~(languages : string list) ~(model : string)
    ~(name : string) ~(tags : string list) () =
  ({ accent; languages; model; name; tags } : voice)

type nonrec warm_agent_session_request = {
  id : string;
      (** Id reserved by this browser for its next in-memory conversation. *)
}
(** A client-minted id deduplicates warm calls without creating a conversation. *)

let warm_agent_session_request_of_yojson :
    Yojson.Safe.t -> warm_agent_session_request =
 fun json ->
  let fields = Json.obj json in
  { id = Json.required fields "id" Json.string }

and yojson_of_warm_agent_session_request :
    warm_agent_session_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("id", Some (Json.of_string value.id)) ]

let make_warm_agent_session_request ~(id : string) () =
  ({ id } : warm_agent_session_request)

type nonrec warm_agent_session_response = {
  session : agent_session_response option;
}
(** A bounded best-effort warm attempt; absence means normal creation should proceed. *)

let warm_agent_session_response_of_yojson :
    Yojson.Safe.t -> warm_agent_session_response =
 fun json ->
  let fields = Json.obj json in
  { session = Json.optional fields "session" agent_session_response_of_yojson }

and yojson_of_warm_agent_session_response :
    warm_agent_session_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("session", Option.map yojson_of_agent_session_response value.session) ]

let make_warm_agent_session_response ?session () =
  ({ session } : warm_agent_session_response)

type nonrec work_registration_response = {
  account_id : string;  (** The account whose work this is. *)
  agent_session_id : string;  (** The session registered. *)
  id : string;  (** The registration. *)
  registered_at : string;  (** When the account registered it. *)
}
(** One account's active registration of one session as its work. *)

let work_registration_response_of_yojson :
    Yojson.Safe.t -> work_registration_response =
 fun json ->
  let fields = Json.obj json in
  {
    account_id = Json.required fields "accountId" Json.string;
    agent_session_id = Json.required fields "agentSessionId" Json.string;
    id = Json.required fields "id" Json.string;
    registered_at = Json.required fields "registeredAt" Json.string;
  }

and yojson_of_work_registration_response :
    work_registration_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("accountId", Some (Json.of_string value.account_id));
      ("agentSessionId", Some (Json.of_string value.agent_session_id));
      ("id", Some (Json.of_string value.id));
      ("registeredAt", Some (Json.of_string value.registered_at));
    ]

let make_work_registration_response ~(account_id : string)
    ~(agent_session_id : string) ~(id : string) ~(registered_at : string) () =
  ({ account_id; agent_session_id; id; registered_at }
    : work_registration_response)

(** [GET /agent-auto-archive-preferences]

Read which triggers archive the caller's sessions by default. *)
let get_agent_auto_archive_preferences () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_auto_archive_preferences";
     meth = `GET;
     path = "/agent-auto-archive-preferences";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json auto_archive_preferences_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( auto_archive_preferences_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-auto-archive-preferences]

Replace which triggers archive the caller's sessions by default. *)
let put_agent_auto_archive_preferences ~(on_pull_request_merged : bool)
    ~(on_runtime_closed : bool) () =
  ({
     Request.service = "agent-harness";
     operation = "put_agent_auto_archive_preferences";
     meth = `PUT;
     path = "/agent-auto-archive-preferences";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_auto_archive_preferences_body
               ({ on_pull_request_merged; on_runtime_closed }
                 : auto_archive_preferences_body)));
     decode_reply = Request.json auto_archive_preferences_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( auto_archive_preferences_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-capabilities/discover]

Probe one provider's ACP session configuration without persisting a session. *)
let discover_agent_capabilities_handler ~(harness : capability_harness_dto)
    ?harness_id ?model () =
  ({
     Request.service = "agent-harness";
     operation = "discover_agent_capabilities_handler";
     meth = `POST;
     path = "/agent-capabilities/discover";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_discover_agent_capabilities_request
               ({ harness; harness_id; model }
                 : discover_agent_capabilities_request)));
     decode_reply = Request.json discover_agent_capabilities_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( discover_agent_capabilities_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-coding-preferences]

Read what the caller's new coding sessions are told to do beyond their assignment. *)
let get_agent_coding_preferences () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_coding_preferences";
     meth = `GET;
     path = "/agent-coding-preferences";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json coding_preferences_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( coding_preferences_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-coding-preferences]

Replace the caller's coding preferences. *)
let put_agent_coding_preferences ~(create_tasks : bool)
    ~(open_pull_requests : bool) () =
  ({
     Request.service = "agent-harness";
     operation = "put_agent_coding_preferences";
     meth = `PUT;
     path = "/agent-coding-preferences";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_coding_preferences_body
               ({ create_tasks; open_pull_requests } : coding_preferences_body)));
     decode_reply = Request.json coding_preferences_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( coding_preferences_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-conversations/{channel_id}]

The agent conversations in a channel the caller may see. Ordinary channels
and other people's conversations list none. *)
let list_agent_conversations ~(channel_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "list_agent_conversations";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-conversations/";
           Request.segment ((fun value -> value) channel_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_conversations_dto_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_conversations_dto,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-conversations/{channel_id}/{bot_id}/start-fresh]

Start a fresh agent context, retaining the channel transcript. *)
let start_fresh_agent_conversation ~(channel_id : string) ~(bot_id : string)
    ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "start_fresh_agent_conversation";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-conversations/";
           Request.segment ((fun value -> value) channel_id);
           "/";
           Request.segment ((fun value -> value) bot_id);
           "/start-fresh";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_start_fresh_agent_conversation_request
               ({ session_id } : start_fresh_agent_conversation_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /agent-conversations/{channel_id}/{bot_id}/turns/{source}/retry]

Explicitly retry a failed message in the conversation's current session. *)
let retry_agent_conversation_turn ~(channel_id : string) ~(bot_id : string)
    ~(source : string) ~(action_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "retry_agent_conversation_turn";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-conversations/";
           Request.segment ((fun value -> value) channel_id);
           "/";
           Request.segment ((fun value -> value) bot_id);
           "/turns/";
           Request.segment ((fun value -> value) source);
           "/retry";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_retry_agent_conversation_turn_request
               ({ action_id } : retry_agent_conversation_turn_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /agent-mode-choice]

Choose whether a composer prompt goes to a chat or a coding agent. *)
let choose_agent_mode ~(prompt : string) () =
  ({
     Request.service = "agent-harness";
     operation = "choose_agent_mode";
     meth = `POST;
     path = "/agent-mode-choice";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_agent_mode_choice_request
               ({ prompt } : agent_mode_choice_request)));
     decode_reply = Request.json agent_mode_choice_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_mode_choice_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-models/load]

Probe one provider's model catalog without creating an agent session. *)
let load_agent_models_handler ~(harness : model_harness_dto) ?harness_id () =
  ({
     Request.service = "agent-harness";
     operation = "load_agent_models_handler";
     meth = `POST;
     path = "/agent-models/load";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_load_agent_models_request
               ({ harness; harness_id } : load_agent_models_request)));
     decode_reply = Request.json load_agent_models_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( load_agent_models_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-repositories]

List the GitHub repositories the caller can select for a coding session. *)
let list_agent_repositories () =
  ({
     Request.service = "agent-harness";
     operation = "list_agent_repositories";
     meth = `GET;
     path = "/agent-repositories";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_repositories_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_repositories_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-repositories/branches]

List the branches on one repository the caller can start a session from. *)
let list_agent_repository_branches ~(repo_url : string) () =
  ({
     Request.service = "agent-harness";
     operation = "list_agent_repository_branches";
     meth = `GET;
     path = "/agent-repositories/branches";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("repoUrl", [ (fun value -> value) repo_url ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_repository_branches_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_repository_branches_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sandbox-size]

Read the caller's default sandbox size for new [@coder] sessions. *)
let get_agent_sandbox_size () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_sandbox_size";
     meth = `GET;
     path = "/agent-sandbox-size";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json sandbox_size_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( sandbox_size_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-sandbox-size]

Set the caller's default sandbox size for the next [@coder] mention. *)
let put_agent_sandbox_size ~(size : sandbox_size) () =
  ({
     Request.service = "agent-harness";
     operation = "put_agent_sandbox_size";
     meth = `PUT;
     path = "/agent-sandbox-size";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_sandbox_size_body ({ size } : sandbox_size_body)));
     decode_reply = Request.json sandbox_size_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( sandbox_size_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions]

Open an agent session served by an external runtime. *)
let create_agent_session ?bot_id ?id ?instructions ?model ?owner ?prompt
    ?prompt_action_id ?prompt_attachments ?prompt_client_id ?repo_branch
    ?repo_url ?thread ?workspace () =
  ({
     Request.service = "agent-harness";
     operation = "create_agent_session";
     meth = `POST;
     path = "/agent-sessions";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_agent_session_request
               ({
                  bot_id;
                  id;
                  instructions;
                  model;
                  owner;
                  prompt;
                  prompt_action_id;
                  prompt_attachments;
                  prompt_client_id;
                  repo_branch;
                  repo_url;
                  thread;
                  workspace;
                }
                 : create_agent_session_request)));
     decode_reply = Request.json create_agent_session_response_of_yojson;
     decode_error =
       Request.error_json [ 402; 503 ] ai_admission_error_body_of_yojson;
   }
    : ( create_agent_session_response,
        ai_admission_error_body )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/by-pull-request]

List the sessions associated with a pull request that the caller can view. *)
let agent_sessions_for_pull_request ~(url : string) () =
  ({
     Request.service = "agent-harness";
     operation = "agent_sessions_for_pull_request";
     meth = `POST;
     path = "/agent-sessions/by-pull-request";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json (yojson_of_pull_request_url ({ url } : pull_request_url)));
     decode_reply = Request.json pull_request_sessions_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( pull_request_sessions_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/by-pull-requests]

List the sessions associated with each of up to 100 pull requests that the caller can view,
with the thread each session was started from. *)
let agent_sessions_for_pull_requests ~(urls : string list) () =
  ({
     Request.service = "agent-harness";
     operation = "agent_sessions_for_pull_requests";
     meth = `POST;
     path = "/agent-sessions/by-pull-requests";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_pull_request_urls ({ urls } : pull_request_urls)));
     decode_reply = Request.json pull_requests_sessions_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( pull_requests_sessions_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/preview]

Preview a batch of agent sessions for rendering chips. *)
let preview_agent_sessions ~(session_ids : string list) () =
  ({
     Request.service = "agent-harness";
     operation = "preview_agent_sessions";
     meth = `POST;
     path = "/agent-sessions/preview";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_preview_agent_sessions_request
               ({ session_ids } : preview_agent_sessions_request)));
     decode_reply = Request.json preview_agent_sessions_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( preview_agent_sessions_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/updates]

The caller's coding sessions waiting for their answer, or stalled for over 20 minutes,
newest activity first. *)
let list_agent_session_updates () =
  ({
     Request.service = "agent-harness";
     operation = "list_agent_session_updates";
     meth = `GET;
     path = "/agent-sessions/updates";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_updates_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_updates,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/warm]

Prepare MCP connections without sending a prompt or creating a visible list row. *)
let warm_agent_session_handler ~(id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "warm_agent_session_handler";
     meth = `POST;
     path = "/agent-sessions/warm";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_warm_agent_session_request
               ({ id } : warm_agent_session_request)));
     decode_reply = Request.json warm_agent_session_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( warm_agent_session_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}]

Get an agent session by id. *)
let get_agent_session ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/"; Request.segment ((fun value -> value) session_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_session_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_session_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /agent-sessions/{session_id}]

Delete an agent session and its live resources. *)
let delete_agent_session ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "delete_agent_session";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/agent-sessions/"; Request.segment ((fun value -> value) session_id);
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

(** [GET /agent-sessions/{session_id}/activity]

Read activity using the same visibility capability as the session transcript. *)
let get_agent_session_activity ~(session_id : string) ?agent_correlation_id
    ?before_at ?before_id ?limit () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session_activity";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/activity";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "agentCorrelationId",
             match agent_correlation_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "beforeAt",
             match before_at with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "beforeId",
             match before_id with
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
     decode_reply = Request.json agent_activity_page_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_activity_page,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/app-connections]

Continue the session now that its owner connected an app it asked for. *)
let report_agent_session_app_connected ~(session_id : string)
    ~(app_slug : string) ?action_id () =
  ({
     Request.service = "agent-harness";
     operation = "report_agent_session_app_connected";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/app-connections";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_app_connected_request
               ({ action_id; app_slug } : app_connected_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [PUT /agent-sessions/{session_id}/archived]

Archive or unarchive an agent session. *)
let set_agent_session_archived ~(session_id : string) ~(archived : bool) () =
  ({
     Request.service = "agent-harness";
     operation = "set_agent_session_archived";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/archived";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_set_agent_session_archived_request
               ({ archived } : set_agent_session_archived_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/auto-archive]

Read a session's auto-archive settings and whether a trigger archived it. *)
let get_agent_session_auto_archive ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session_auto_archive";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/auto-archive";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json session_auto_archive_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( session_auto_archive_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-sessions/{session_id}/auto-archive]

Replace a session's own auto-archive choices. Owner only. *)
let put_agent_session_auto_archive ~(session_id : string)
    ?on_pull_request_merged ?on_runtime_closed () =
  ({
     Request.service = "agent-harness";
     operation = "put_agent_session_auto_archive";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/auto-archive";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_auto_archive_overrides_body
               ({ on_pull_request_merged; on_runtime_closed }
                 : auto_archive_overrides_body)));
     decode_reply = Request.json auto_archive_overrides_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( auto_archive_overrides_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/changes]

The latest captured changes of an agent session: the changed files with
statuses and line counts, and how the latest capture attempt went. *)
let get_agent_session_changes ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session_changes";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/changes";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_session_changes_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_session_changes_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/changes/patch]

The unified diff behind the session's latest changeset. *)
let get_agent_session_changes_patch ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session_changes_patch";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/changes/patch";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_session_changes_patch_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_session_changes_patch_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/changes/refresh]

Capture the session's changes again now. Answers at once with the state
as it stands; the capture runs on and viewers are told when it lands. *)
let refresh_agent_session_changes ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "refresh_agent_session_changes";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/changes/refresh";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_session_changes_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_session_changes_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}]

Fetch one execution only after the caller has obtained view access to its session. *)
let get_code_execution ~(session_id : string) ~(execution_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_code_execution";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/code-executions/";
           Request.segment ((fun value -> value) execution_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json execution_record_of_yojson;
     decode_error = Request.no_error;
   }
    : ( execution_record,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps]

List the connected apps and custom MCP servers the session's agent may use. *)
let list_execution_connected_apps ~(session_id : string)
    ~(execution_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "list_execution_connected_apps";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/code-executions/";
           Request.segment ((fun value -> value) execution_id);
           "/connected-apps";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list connected_app_of_yojson);
     decode_error = Request.no_error;
   }
    : ( connected_app list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/discover]

Search the connectable app catalog, or inspect one app's tools and connection status. *)
let discover_connected_apps ~(session_id : string) ~(execution_id : string)
    ~(body : discovery_request) () =
  ({
     Request.service = "agent-harness";
     operation = "discover_connected_apps";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/code-executions/";
           Request.segment ((fun value -> value) execution_id);
           "/connected-apps/discover";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (yojson_of_discovery_request body));
     decode_reply = Request.json discover_connectors_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( discover_connectors_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/servers]

Add a custom MCP server to the execution account's connections. *)
let add_connected_mcp_server ~(session_id : string) ~(execution_id : string)
    ~(server_name : string) ~(url : string) () =
  ({
     Request.service = "agent-harness";
     operation = "add_connected_mcp_server";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/code-executions/";
           Request.segment ((fun value -> value) execution_id);
           "/connected-apps/servers";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_connect_mcp_server
               ({ server_name; url } : connect_mcp_server)));
     decode_reply = Request.json connect_mcp_server_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( connect_mcp_server_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/tools]

Find tools across the agent's connected apps by keywords. *)
let search_connected_app_tools ~(session_id : string) ~(execution_id : string)
    ~(query : string) () =
  ({
     Request.service = "agent-harness";
     operation = "search_connected_app_tools";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/code-executions/";
           Request.segment ((fun value -> value) execution_id);
           "/connected-apps/tools";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("query", [ (fun value -> value) query ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json connected_tool_search_of_yojson;
     decode_error = Request.no_error;
   }
    : ( connected_tool_search,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/{kind}/{key}/calls]

Call one tool of a connected app as the execution's account. *)
let call_connected_app_tool ~(session_id : string) ~(execution_id : string)
    ~(kind : connected_app_kind) ~(key : string) ~(tool : string) ?arguments ()
    =
  ({
     Request.service = "agent-harness";
     operation = "call_connected_app_tool";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/code-executions/";
           Request.segment ((fun value -> value) execution_id);
           "/connected-apps/";
           Request.segment
             ((fun value -> Json.string (yojson_of_connected_app_kind value))
                kind);
           "/";
           Request.segment ((fun value -> value) key);
           "/calls";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_call_connected_tool
               ({ arguments; tool } : call_connected_tool)));
     decode_reply = Request.json connected_tool_result_of_yojson;
     decode_error = Request.no_error;
   }
    : ( connected_tool_result,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/{kind}/{key}/tools]

List the tools one connected app serves. *)
let list_connected_app_tools ~(session_id : string) ~(execution_id : string)
    ~(kind : connected_app_kind) ~(key : string) () =
  ({
     Request.service = "agent-harness";
     operation = "list_connected_app_tools";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/code-executions/";
           Request.segment ((fun value -> value) execution_id);
           "/connected-apps/";
           Request.segment
             ((fun value -> Json.string (yojson_of_connected_app_kind value))
                kind);
           "/";
           Request.segment ((fun value -> value) key);
           "/tools";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list connected_tool_of_yojson);
     decode_error = Request.no_error;
   }
    : ( connected_tool list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}/reviews]

List blocks created during an execution, including interrupted executions. *)
let list_execution_reviews ~(session_id : string) ~(execution_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "list_execution_reviews";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/code-executions/";
           Request.segment ((fun value -> value) execution_id);
           "/reviews";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list review_record_of_yojson);
     decode_error = Request.no_error;
   }
    : ( review_record list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/control]

Perform a control operation on a live agent session. *)
let control_agent_session ~(session_id : string) ~(body : control_request) () =
  ({
     Request.service = "agent-harness";
     operation = "control_agent_session";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/control";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (yojson_of_control_request body));
     decode_reply = Request.json control_response_of_yojson;
     decode_error =
       Request.error_json [ 402; 503 ] ai_admission_error_body_of_yojson;
   }
    : (control_response, ai_admission_error_body) Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/log]

The raw protocol log of one agent session. *)
let get_agent_session_log ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session_log";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/log";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_session_log_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_session_log_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/log/folded]

One agent session's history folded into renderable messages: the same
fold the web client runs over \[[get_agent_session_log_handler]\]'s frames. *)
let get_agent_session_folded_log ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session_folded_log";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/log/folded";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_session_folded_log_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_session_folded_log_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-sessions/{session_id}/name]

Rename an agent session. *)
let rename_agent_session ~(session_id : string) ~(name : string) () =
  ({
     Request.service = "agent-harness";
     operation = "rename_agent_session";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/name";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_rename_agent_session_request
               ({ name } : rename_agent_session_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/permissions]

Read sharing settings for a session the caller can view. *)
let get_agent_session_permissions ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session_permissions";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/permissions";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json share_permission_v2_of_yojson;
     decode_error = Request.no_error;
   }
    : ( share_permission_v2,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PATCH /agent-sessions/{session_id}/permissions]

Update link, channel, or team sharing after owner authorization. *)
let update_agent_session_permissions ~(session_id : string)
    ?channel_share_permissions ?link_share ?link_share_access_level
    ?team_share_access_level () =
  ({
     Request.service = "agent-harness";
     operation = "update_agent_session_permissions";
     meth = `PATCH;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/permissions";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_share_permission_request_v2
               ({
                  channel_share_permissions;
                  link_share;
                  link_share_access_level;
                  team_share_access_level;
                }
                 : update_share_permission_request_v2)));
     decode_reply = Request.json share_permission_v2_of_yojson;
     decode_error = Request.no_error;
   }
    : ( share_permission_v2,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/pull-requests]

List the pull requests associated with a session the caller can view. *)
let list_agent_session_pull_requests ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "list_agent_session_pull_requests";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/pull-requests";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json session_pull_requests_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( session_pull_requests_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-sessions/{session_id}/pull-requests]

Link a pull request to a session the caller can edit. *)
let link_agent_session_pull_request ~(session_id : string) ~(url : string) () =
  ({
     Request.service = "agent-harness";
     operation = "link_agent_session_pull_request";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/pull-requests";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json (yojson_of_pull_request_url ({ url } : pull_request_url)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [DELETE /agent-sessions/{session_id}/pull-requests]

Unlink a pull request a person linked to a session the caller can edit. The pull request
the session's agent opened stays linked. *)
let unlink_agent_session_pull_request ~(session_id : string) ~(url : string) ()
    =
  ({
     Request.service = "agent-harness";
     operation = "unlink_agent_session_pull_request";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/pull-requests";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("url", [ (fun value -> value) url ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/queue]

The actions waiting to dispatch in this session, oldest first. *)
let get_agent_session_queue ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_session_queue";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/queue";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json agent_session_queue_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( agent_session_queue_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-sessions/{session_id}/queue/{action_id}]

Replace a queued prompt's text before it dispatches. *)
let edit_queued_action ~(session_id : string) ~(action_id : string)
    ~(prompt : string) () =
  ({
     Request.service = "agent-harness";
     operation = "edit_queued_action";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/queue/";
           Request.segment ((fun value -> value) action_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_edit_queued_action_request
               ({ prompt } : edit_queued_action_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [DELETE /agent-sessions/{session_id}/queue/{action_id}]

Remove a queued action before it dispatches. There is no un-sending: an
action that already went out answers 404. *)
let remove_queued_action ~(session_id : string) ~(action_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "remove_queued_action";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/queue/";
           Request.segment ((fun value -> value) action_id);
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

(** [POST /agent-sessions/{session_id}/queue/{action_id}/steer]

Run a queued action next. Moves it ahead of the rest of the queue and
cancels the turn in flight, so this entry dispatches when that turn ends. *)
let steer_queued_action ~(session_id : string) ~(action_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "steer_queued_action";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/queue/";
           Request.segment ((fun value -> value) action_id);
           "/steer";
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

(** [POST /agent-sessions/{session_id}/reviews]

Persist a review without keeping the agent turn blocked. *)
let create_session_review ~(session_id : string) ~(title : string) ?execution_id
    () =
  ({
     Request.service = "agent-harness";
     operation = "create_session_review";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/reviews";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_review ({ execution_id; title } : create_review)));
     decode_reply = Request.json review_record_of_yojson;
     decode_error = Request.no_error;
   }
    : ( review_record,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /agent-sessions/{session_id}/reviews/{review_id}]

Read a persisted interactive block. *)
let get_session_review ~(session_id : string) ~(review_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_session_review";
     meth = `GET;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/reviews/";
           Request.segment ((fun value -> value) review_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json review_record_of_yojson;
     decode_error = Request.no_error;
   }
    : ( review_record,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/reviews/{review_id}]

Save edits or atomically claim the exact draft revision the user submitted. *)
let decide_session_review ~(session_id : string) ~(review_id : string)
    ~(body : review_decision) () =
  ({
     Request.service = "agent-harness";
     operation = "decide_session_review";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/reviews/";
           Request.segment ((fun value -> value) review_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (yojson_of_review_decision body));
     decode_reply = Request.json review_record_of_yojson;
     decode_error = Request.no_error;
   }
    : ( review_record,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-sessions/{session_id}/sandbox-size]

Resize this session's sandbox and remember the size as the owner's default. *)
let put_agent_session_sandbox_size ~(session_id : string) ~(size : sandbox_size)
    () =
  ({
     Request.service = "agent-harness";
     operation = "put_agent_session_sandbox_size";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/sandbox-size";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_sandbox_size_body ({ size } : sandbox_size_body)));
     decode_reply = Request.json sandbox_size_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( sandbox_size_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /agent-sessions/{session_id}/task]

Link a session the caller owns to a task they can view, replacing any earlier link. The
session's pull request, now or later, is linked to the task. *)
let link_agent_session_task ~(session_id : string) ~(task_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "link_agent_session_task";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/task";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_link_task_request ({ task_id } : link_task_request)));
     decode_reply = Request.json linked_task_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( linked_task_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/tool-approvals/{approval_id}]

Answer a tool call the agent made in a turn somebody other than the
session's owner prompted. Approve and deny are the owner's; cancel is
anyone's with edit access. *)
let answer_agent_session_tool_approval ~(session_id : string)
    ~(approval_id : string) ~(answer : tool_approval_answer_dto) () =
  ({
     Request.service = "agent-harness";
     operation = "answer_agent_session_tool_approval";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/tool-approvals/";
           Request.segment ((fun value -> value) approval_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_answer_tool_approval_request
               ({ answer } : answer_tool_approval_request)));
     decode_reply = Request.json answer_tool_approval_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( answer_tool_approval_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/ui-commands]

Open an item in a new pane of the app tab the person who prompted the
running turn typed in. Only a running execution of the session's current
turn may send, as the account it acts as. *)
let open_in_app ~(session_id : string) ~(execution_id : execution_id)
    ~(path : string) ?placement () =
  ({
     Request.service = "agent-harness";
     operation = "open_in_app";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/ui-commands";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_open_in_app
               ({ execution_id; path; placement } : open_in_app)));
     decode_reply = Request.json ui_command_outcome_of_yojson;
     decode_error = Request.no_error;
   }
    : ( ui_command_outcome,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /agent-sessions/{session_id}/views]

Present a view in the session: a review with nothing saved. *)
let present_session_view ~(session_id : string) ~(view : Yojson.Safe.t)
    ?execution_id () =
  ({
     Request.service = "agent-harness";
     operation = "present_session_view";
     meth = `POST;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/views";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_present_view ({ execution_id; view } : present_view)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [PUT /agent-sessions/{session_id}/work-registration]

Register a session as the caller's work. Requires edit access. Repeating returns the active
registration. Registering does not share the session: viewers who cannot open it do not see
it, so share it too. *)
let register_agent_session_work ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "register_agent_session_work";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/work-registration";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json work_registration_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( work_registration_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /agent-sessions/{session_id}/work-registration]

End the caller's own registration of a session. Repeating does nothing. It touches only the
caller's own row, so it needs no access to the session: losing access must not strand it. *)
let unregister_agent_session_work ~(session_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "unregister_agent_session_work";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/agent-sessions/";
           Request.segment ((fun value -> value) session_id);
           "/work-registration";
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

(** [GET /agent-work-registrations]

List the caller's active registrations of sessions they can still view, newest first. *)
let list_agent_work_registrations () =
  ({
     Request.service = "agent-harness";
     operation = "list_agent_work_registrations";
     meth = `GET;
     path = "/agent-work-registrations";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.json (Json.list work_registration_response_of_yojson);
     decode_error = Request.no_error;
   }
    : ( work_registration_response list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /coding-agents]

List the coding agents the caller can start a session as: the same
personas the [ListCodingAgents] tool offers, including built-in ones whose
runtime the caller has connected (Cursor once its key is saved). *)
let list_coding_agents () =
  ({
     Request.service = "agent-harness";
     operation = "list_coding_agents";
     meth = `GET;
     path = "/coding-agents";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json coding_agents_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( coding_agents_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /harnesses/{harness_id}/claude-mode]

How Claude Code on the computer is paid for. *)
let get_claude_mode ~(harness_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_claude_mode";
     meth = `GET;
     path =
       String.concat ""
         [
           "/harnesses/";
           Request.segment ((fun value -> value) harness_id);
           "/claude-mode";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json claude_mode_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( claude_mode_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /harnesses/{harness_id}/claude-sign-in]

Start a Claude sign-in on the computer and return its URL. *)
let start_claude_sign_in ~(harness_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "start_claude_sign_in";
     meth = `POST;
     path =
       String.concat ""
         [
           "/harnesses/";
           Request.segment ((fun value -> value) harness_id);
           "/claude-sign-in";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json claude_sign_in_started_of_yojson;
     decode_error = Request.no_error;
   }
    : ( claude_sign_in_started,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /harnesses/{harness_id}/claude-sign-in/complete]

Finish the Claude sign-in with what the user pasted. *)
let complete_claude_sign_in ~(harness_id : string) ~(code : string) () =
  ({
     Request.service = "agent-harness";
     operation = "complete_claude_sign_in";
     meth = `POST;
     path =
       String.concat ""
         [
           "/harnesses/";
           Request.segment ((fun value -> value) harness_id);
           "/claude-sign-in/complete";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_claude_sign_in_complete
               ({ code } : claude_sign_in_complete)));
     decode_reply = Request.json claude_signed_in_of_yojson;
     decode_error = Request.no_error;
   }
    : ( claude_signed_in,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /harnesses/{harness_id}/claude-sign-out]

Forget the computer's Claude credential and return it to Macro credits. *)
let claude_sign_out ~(harness_id : string) () =
  ({
     Request.service = "agent-harness";
     operation = "claude_sign_out";
     meth = `POST;
     path =
       String.concat ""
         [
           "/harnesses/";
           Request.segment ((fun value -> value) harness_id);
           "/claude-sign-out";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json claude_mode_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( claude_mode_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /universal_input/classify]

Classify a draft for the authenticated user. *)
let classify ~(revision : int) ~(text : string) () =
  ({
     Request.service = "agent-harness";
     operation = "classify";
     meth = `POST;
     path = "/universal_input/classify";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_classify_input_request
               ({ revision; text } : classify_input_request)));
     decode_reply = Request.json classify_input_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( classify_input_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /universal_input/extract]

Extract editable fields for the authenticated user. *)
let extract ~(intent : input_intent) ~(reference_time : string)
    ~(revision : int) ~(text : string) ~(time_zone : string)
    ?property_definitions ?search_type () =
  ({
     Request.service = "agent-harness";
     operation = "extract";
     meth = `POST;
     path = "/universal_input/extract";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_extract_input_request
               ({
                  intent;
                  property_definitions;
                  reference_time;
                  revision;
                  search_type;
                  text;
                  time_zone;
                }
                 : extract_input_request)));
     decode_reply = Request.json extract_input_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( extract_input_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /voices]

The voices an agent teammate can speak with on calls. Team admins only. *)
let get_agent_voices () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_voices";
     meth = `GET;
     path = "/voices";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list voice_of_yojson);
     decode_error =
       Request.error_json [ 401; 403; 502 ] error_response_of_yojson;
   }
    : (voice list, error_response) Macro_sdk_runtime.Request.t)

(** [GET /voices/{model}/sample]

A catalog voice saying a fixed line, as WAV. Team admins only; the first
play of each voice is billed to the admin's team. *)
let get_agent_voice_sample ~(model : string) () =
  ({
     Request.service = "agent-harness";
     operation = "get_agent_voice_sample";
     meth = `GET;
     path =
       String.concat ""
         [ "/voices/"; Request.segment ((fun value -> value) model); "/sample" ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.text;
     decode_error =
       Request.error_json [ 400; 401; 403; 502 ] error_response_of_yojson;
   }
    : (string, error_response) Macro_sdk_runtime.Request.t)
