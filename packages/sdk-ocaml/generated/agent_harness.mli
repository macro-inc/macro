(* Generated from packages/sdk/specs/agent-harness.json by packages/sdk-ocaml/gen. Do not edit. *)

(** Ordered from least to most access top -> bottom *)
type nonrec access_level =
  | View
  | Comment
  | Edit
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

val access_level_of_yojson : Yojson.Safe.t -> access_level
val yojson_of_access_level : access_level -> Yojson.Safe.t

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

val activity_wire_row_of_yojson : Yojson.Safe.t -> activity_wire_row
val yojson_of_activity_wire_row : activity_wire_row -> Yojson.Safe.t

val make_activity_wire_row :
  action:string ->
  ?action_payload:Yojson.Safe.t ->
  actor_id:string ->
  ?agent_correlation_id:string ->
  ?agent_verb:string ->
  entity_id:string ->
  entity_type:entity_type ->
  id:string ->
  occurred_at:string ->
  subject_id:string ->
  unit ->
  activity_wire_row
(** One activity row on the wire — the realtime projection of an inserted
[activity_events] row. *)

type nonrec agent_action_respond_elicitation_type =
  | Respond_elicitation
  | Unknown of string  (** A value this SDK version does not know. *)

val agent_action_respond_elicitation_type_of_yojson :
  Yojson.Safe.t -> agent_action_respond_elicitation_type

val yojson_of_agent_action_respond_elicitation_type :
  agent_action_respond_elicitation_type -> Yojson.Safe.t

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

val prompt_attachment_of_yojson : Yojson.Safe.t -> prompt_attachment
val yojson_of_prompt_attachment : prompt_attachment -> Yojson.Safe.t

val make_prompt_attachment :
  ?mime_type:string ->
  name:string ->
  ?size:int64 ->
  uri:string ->
  unit ->
  prompt_attachment
(** A file the prompt refers to, by where the agent can fetch it.

Mirrors ACP's [resource_link] content block, which every agent must
accept: bytes never ride the prompt, only a URI (a static file service URL
in practice) with enough metadata for a client to render a chip and for
the agent to decide whether to fetch it. Keeping the wire shape ACP-native
means the harness translates without resolving anything, and the fold
reads the same fields back off the logged frame. *)

type nonrec agent_prompt_action = {
  attachments : prompt_attachment list option;
      (** Files the prompt refers to, in the order the user attached them.
Delivered after the text as one [resource_link] block each. *)
  prompt : string;  (** What to tell the agent. *)
}
(** Ask the agent to work on something. *)

val agent_prompt_action_of_yojson : Yojson.Safe.t -> agent_prompt_action
val yojson_of_agent_prompt_action : agent_prompt_action -> Yojson.Safe.t

val make_agent_prompt_action :
  ?attachments:prompt_attachment list ->
  prompt:string ->
  unit ->
  agent_prompt_action
(** Ask the agent to work on something. *)

type nonrec agent_set_model_action = {
  model : string;  (** The model slug the agent should switch to. *)
}
(** Ask the agent to run on a different model from here on. *)

val agent_set_model_action_of_yojson : Yojson.Safe.t -> agent_set_model_action
val yojson_of_agent_set_model_action : agent_set_model_action -> Yojson.Safe.t

val make_agent_set_model_action : model:string -> unit -> agent_set_model_action
(** Ask the agent to run on a different model from here on. *)

type nonrec agent_set_config_option_action = {
  config_id : string;  (** Opaque ACP config id advertised by the agent. *)
  value : string;  (** Opaque select value advertised for that config option. *)
}
(** Ask the agent to change one advertised select-style session setting. *)

val agent_set_config_option_action_of_yojson :
  Yojson.Safe.t -> agent_set_config_option_action

val yojson_of_agent_set_config_option_action :
  agent_set_config_option_action -> Yojson.Safe.t

val make_agent_set_config_option_action :
  config_id:string -> value:string -> unit -> agent_set_config_option_action
(** Ask the agent to change one advertised select-style session setting. *)

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

val elicitation_content_value_of_yojson :
  Yojson.Safe.t -> elicitation_content_value

val yojson_of_elicitation_content_value :
  elicitation_content_value -> Yojson.Safe.t

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

val elicitation_answer_of_yojson : Yojson.Safe.t -> elicitation_answer
val yojson_of_elicitation_answer : elicitation_answer -> Yojson.Safe.t

val make_elicitation_answer_accept :
  ?content:(string * elicitation_content_value) list ->
  unit ->
  elicitation_answer
(** The user submitted the form, or consented to open the URL. *)

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

val elicitation_request_id_of_yojson : Yojson.Safe.t -> elicitation_request_id
val yojson_of_elicitation_request_id : elicitation_request_id -> Yojson.Safe.t

(** The decision carried by an \[[AgentPermissionAction]\]. *)
type nonrec permission_answer =
  | Selected of {
      option_id : string;  (** The chosen option's id, as the agent listed it. *)
    }  (** One of the options the agent offered was chosen. *)
  | Cancelled  (** The request was dismissed without choosing. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val permission_answer_of_yojson : Yojson.Safe.t -> permission_answer
val yojson_of_permission_answer : permission_answer -> Yojson.Safe.t

val make_permission_answer_selected :
  option_id:string -> unit -> permission_answer
(** One of the options the agent offered was chosen. *)

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

val agent_permission_action_of_yojson : Yojson.Safe.t -> agent_permission_action
val yojson_of_agent_permission_action : agent_permission_action -> Yojson.Safe.t

val make_agent_permission_action :
  answer:permission_answer ->
  request_id:Yojson.Safe.t ->
  unit ->
  agent_permission_action
(** A user's answer to the agent's [session/request_permission].

Unlike every other action this is not a new request but the reply to one
the agent made, so it carries the agent's own request id rather than
receiving a server-minted one. *)

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

val agent_action_of_yojson : Yojson.Safe.t -> agent_action
val yojson_of_agent_action : agent_action -> Yojson.Safe.t

val make_agent_action_respond_elicitation :
  elicitation_answer:elicitation_answer ->
  request_id:elicitation_request_id ->
  unit ->
  agent_action
(** Answer an [elicitation/create] the agent sent.

The one action whose wire form is a JSON-RPC *response* rather than a
request or notification: the agent asked, we answer on its id. The
minted \[[AgentActionId]\] therefore never reaches the wire for this
action; the fold correlates on the agent's id instead. *)

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

val agent_action_id_of_yojson : Yojson.Safe.t -> agent_action_id
val yojson_of_agent_action_id : agent_action_id -> Yojson.Safe.t

type nonrec agent_activity_cursor = {
  id : string;  (** Tie-breaking activity identity. *)
  occurred_at : string;  (** Last stored event time. *)
}
(** Stable chronological resume position. *)

val agent_activity_cursor_of_yojson : Yojson.Safe.t -> agent_activity_cursor
val yojson_of_agent_activity_cursor : agent_activity_cursor -> Yojson.Safe.t

val make_agent_activity_cursor :
  id:string -> occurred_at:string -> unit -> agent_activity_cursor
(** Stable chronological resume position. *)

type nonrec agent_activity_page = {
  activities : activity_wire_row list;
      (** Original activity rows, also retained in the affected entities' histories. *)
  next_cursor : agent_activity_cursor option;
}
(** One page of the activity caused by this session. *)

val agent_activity_page_of_yojson : Yojson.Safe.t -> agent_activity_page
val yojson_of_agent_activity_page : agent_activity_page -> Yojson.Safe.t

val make_agent_activity_page :
  activities:activity_wire_row list ->
  ?next_cursor:agent_activity_cursor ->
  unit ->
  agent_activity_page
(** One page of the activity caused by this session. *)

type nonrec bot_id = string

val bot_id_of_yojson : Yojson.Safe.t -> bot_id
val yojson_of_bot_id : bot_id -> Yojson.Safe.t

type nonrec macro_user_id_str = string

val macro_user_id_str_of_yojson : Yojson.Safe.t -> macro_user_id_str
val yojson_of_macro_user_id_str : macro_user_id_str -> Yojson.Safe.t

(** The first non-agent cause. An agent cannot be one, so a chain always ends
at a person or a routine. *)
type nonrec root =
  | Person of { user : macro_user_id_str  (** Who. *) }  (** A person. *)
  | Routine of { routine : string  (** The routine. *) }  (** A routine. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val root_of_yojson : Yojson.Safe.t -> root
val yojson_of_root : root -> Yojson.Safe.t

val make_root_person : user:macro_user_id_str -> unit -> root
(** A person. *)

val make_root_routine : routine:string -> unit -> root
(** A routine. *)

(** Where an acting agent's work came from. *)
type nonrec lineage =
  | Session of {
      root : root;  (** The first non-agent cause of its work. *)
      session : string;  (** The acting session. *)
    }  (** The session the agent acted from, and so where the chain started. *)
  | Unattributed  (** An agent acted, but its session was not captured. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val lineage_of_yojson : Yojson.Safe.t -> lineage
val yojson_of_lineage : lineage -> Yojson.Safe.t

val make_lineage_session : root:root -> session:string -> unit -> lineage
(** The session the agent acted from, and so where the chain started. *)

type nonrec agent_actor = {
  bot : bot_id;  (** The agent. *)
  lineage : lineage;  (** Where the agent's own work came from. *)
  on_behalf_of : macro_user_id_str;  (** The person it acts for. *)
}
(** An agent acting for a person. *)

val agent_actor_of_yojson : Yojson.Safe.t -> agent_actor
val yojson_of_agent_actor : agent_actor -> Yojson.Safe.t

val make_agent_actor :
  bot:bot_id ->
  lineage:lineage ->
  on_behalf_of:macro_user_id_str ->
  unit ->
  agent_actor
(** An agent acting for a person. *)

type nonrec agent_config_select_option_dto = {
  description : string option;
      (** Optional provider description of this value. *)
  group : string option;
      (** Optional group heading supplied by the provider. *)
  name : string;  (** Display label. *)
  value : string;  (** Opaque value returned to the agent when selected. *)
}
(** One value in an agent-advertised select. *)

val agent_config_select_option_dto_of_yojson :
  Yojson.Safe.t -> agent_config_select_option_dto

val yojson_of_agent_config_select_option_dto :
  agent_config_select_option_dto -> Yojson.Safe.t

val make_agent_config_select_option_dto :
  ?description:string ->
  ?group:string ->
  name:string ->
  value:string ->
  unit ->
  agent_config_select_option_dto
(** One value in an agent-advertised select. *)

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

val agent_config_kind_dto_of_yojson : Yojson.Safe.t -> agent_config_kind_dto
val yojson_of_agent_config_kind_dto : agent_config_kind_dto -> Yojson.Safe.t

val make_agent_config_kind_dto_select :
  current_value:string ->
  options:agent_config_select_option_dto list ->
  unit ->
  agent_config_kind_dto
(** A single-value selector. *)

val make_agent_config_kind_dto_boolean :
  current_value:bool -> unit -> agent_config_kind_dto
(** An on/off setting. *)

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

val agent_config_option_dto_of_yojson : Yojson.Safe.t -> agent_config_option_dto
val yojson_of_agent_config_option_dto : agent_config_option_dto -> Yojson.Safe.t

val make_agent_config_option_dto :
  agent_config_kind_dto:agent_config_kind_dto ->
  ?category:string ->
  ?description:string ->
  id:string ->
  name:string ->
  unit ->
  agent_config_option_dto
(** One agent-advertised ACP session setting. *)

type nonrec agent_conversation_session_dto = {
  created_at : string;  (** When the session began. *)
  is_current : bool;  (** Whether this is the current agent context. *)
  session_id : string;
      (** Session whose controls and live events belong to this context. *)
}
(** One session a conversation has run on; every channel message stays visible. *)

val agent_conversation_session_dto_of_yojson :
  Yojson.Safe.t -> agent_conversation_session_dto

val yojson_of_agent_conversation_session_dto :
  agent_conversation_session_dto -> Yojson.Safe.t

val make_agent_conversation_session_dto :
  created_at:string ->
  is_current:bool ->
  session_id:string ->
  unit ->
  agent_conversation_session_dto
(** One session a conversation has run on; every channel message stays visible. *)

(** The state of one source message, retained after completion for deduplication. *)
type nonrec conversation_turn_state =
  | Queued
  | Running
  | Succeeded
  | Failed
  | Stopped
  | Interrupted
  | Unknown of string  (** A value this SDK version does not know. *)

val conversation_turn_state_of_yojson : Yojson.Safe.t -> conversation_turn_state
val yojson_of_conversation_turn_state : conversation_turn_state -> Yojson.Safe.t

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

val agent_conversation_turn_dto_of_yojson :
  Yojson.Safe.t -> agent_conversation_turn_dto

val yojson_of_agent_conversation_turn_dto :
  agent_conversation_turn_dto -> Yojson.Safe.t

val make_agent_conversation_turn_dto :
  action_id:string ->
  created_at:string ->
  ?reply_message_id:string ->
  retryable:bool ->
  session_id:string ->
  source_message_id:string ->
  state:conversation_turn_state ->
  unit ->
  agent_conversation_turn_dto
(** Execution status without exposing the persona prompt or stored credentials. *)

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

val agent_conversation_dto_of_yojson : Yojson.Safe.t -> agent_conversation_dto
val yojson_of_agent_conversation_dto : agent_conversation_dto -> Yojson.Safe.t

val make_agent_conversation_dto :
  available:bool ->
  ?avatar_url:string ->
  bot_id:string ->
  channel_id:string ->
  name:string ->
  sessions:agent_conversation_session_dto list ->
  settings_changed:bool ->
  turns:agent_conversation_turn_dto list ->
  unit ->
  agent_conversation_dto
(** An agent's conversation in a channel, as the person it is with sees it. *)

type nonrec agent_conversations_dto = {
  conversations : agent_conversation_dto list;
      (** Empty for ordinary channels and other people's conversations. *)
}
(** The agent conversations in a channel the caller may see. *)

val agent_conversations_dto_of_yojson : Yojson.Safe.t -> agent_conversations_dto
val yojson_of_agent_conversations_dto : agent_conversations_dto -> Yojson.Safe.t

val make_agent_conversations_dto :
  conversations:agent_conversation_dto list -> unit -> agent_conversations_dto
(** The agent conversations in a channel the caller may see. *)

(** Which kind of agent a prompt is sent to. *)
type nonrec agent_mode =
  | Chat
  | Code
  | Unknown of string  (** A value this SDK version does not know. *)

val agent_mode_of_yojson : Yojson.Safe.t -> agent_mode
val yojson_of_agent_mode : agent_mode -> Yojson.Safe.t

type nonrec agent_mode_choice_request = {
  prompt : string;  (** The prompt the composer is about to send. *)
}
(** Request body for [POST /agent-mode-choice]. *)

val agent_mode_choice_request_of_yojson :
  Yojson.Safe.t -> agent_mode_choice_request

val yojson_of_agent_mode_choice_request :
  agent_mode_choice_request -> Yojson.Safe.t

val make_agent_mode_choice_request :
  prompt:string -> unit -> agent_mode_choice_request
(** Request body for [POST /agent-mode-choice]. *)

type nonrec agent_mode_choice_response = {
  mode : agent_mode;  (** Which kind of agent should receive the prompt. *)
}
(** Response body for [POST /agent-mode-choice]. *)

val agent_mode_choice_response_of_yojson :
  Yojson.Safe.t -> agent_mode_choice_response

val yojson_of_agent_mode_choice_response :
  agent_mode_choice_response -> Yojson.Safe.t

val make_agent_mode_choice_response :
  mode:agent_mode -> unit -> agent_mode_choice_response
(** Response body for [POST /agent-mode-choice]. *)

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

val agent_model_dto_of_yojson : Yojson.Safe.t -> agent_model_dto
val yojson_of_agent_model_dto : agent_model_dto -> Yojson.Safe.t

val make_agent_model_dto :
  ?description:string ->
  ?group:string ->
  id:string ->
  name:string ->
  ?supports_images:bool ->
  unit ->
  agent_model_dto
(** One model picker option. *)

(** Model-selection availability returned over HTTP. *)
type nonrec agent_models_status_dto =
  | Available
  | Unsupported
  | Unknown of string  (** A value this SDK version does not know. *)

val agent_models_status_dto_of_yojson : Yojson.Safe.t -> agent_models_status_dto
val yojson_of_agent_models_status_dto : agent_models_status_dto -> Yojson.Safe.t

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

val agent_repository_dto_of_yojson : Yojson.Safe.t -> agent_repository_dto
val yojson_of_agent_repository_dto : agent_repository_dto -> Yojson.Safe.t

val make_agent_repository_dto :
  ?default_branch:string -> url:string -> unit -> agent_repository_dto
(** One repository the caller can select for a coding session. *)

type nonrec agent_repositories_response = {
  repositories : agent_repository_dto list;
      (** Every repository the caller reaches through Macro's GitHub App, sorted
by [owner/name]. Empty when the App is installed nowhere the caller
has a claim to. *)
}
(** Response body for [GET /agent-repositories]. *)

val agent_repositories_response_of_yojson :
  Yojson.Safe.t -> agent_repositories_response

val yojson_of_agent_repositories_response :
  agent_repositories_response -> Yojson.Safe.t

val make_agent_repositories_response :
  repositories:agent_repository_dto list -> unit -> agent_repositories_response
(** Response body for [GET /agent-repositories]. *)

type nonrec agent_repository_branches_response = {
  branches : string list;
      (** Branch names on the repository, in the order GitHub returned them.
Empty when the repository has no commits yet. *)
}
(** Response body for [GET /agent-repositories/branches]. *)

val agent_repository_branches_response_of_yojson :
  Yojson.Safe.t -> agent_repository_branches_response

val yojson_of_agent_repository_branches_response :
  agent_repository_branches_response -> Yojson.Safe.t

val make_agent_repository_branches_response :
  branches:string list -> unit -> agent_repository_branches_response
(** Response body for [GET /agent-repositories/branches]. *)

type nonrec agent_respond_elicitation_action = {
  elicitation_answer : elicitation_answer;  (** The decision. *)
  request_id : elicitation_request_id;
      (** The agent's [elicitation/create] request id - not an
\[[AgentActionId]\], because the agent minted it. *)
}
(** Answer an elicitation the agent is waiting on. *)

val agent_respond_elicitation_action_of_yojson :
  Yojson.Safe.t -> agent_respond_elicitation_action

val yojson_of_agent_respond_elicitation_action :
  agent_respond_elicitation_action -> Yojson.Safe.t

val make_agent_respond_elicitation_action :
  elicitation_answer:elicitation_answer ->
  request_id:elicitation_request_id ->
  unit ->
  agent_respond_elicitation_action
(** Answer an elicitation the agent is waiting on. *)

type nonrec agent_session_changes_patch_response = {
  patch : string;  (** The git-style unified diff of the current changeset. *)
}
(** Response body for [GET /agent-sessions/{session_id}/changes/patch].

Clients deserialize this, so both derives are used. *)

val agent_session_changes_patch_response_of_yojson :
  Yojson.Safe.t -> agent_session_changes_patch_response

val yojson_of_agent_session_changes_patch_response :
  agent_session_changes_patch_response -> Yojson.Safe.t

val make_agent_session_changes_patch_response :
  patch:string -> unit -> agent_session_changes_patch_response
(** Response body for [GET /agent-sessions/{session_id}/changes/patch].

Clients deserialize this, so both derives are used. *)

(** How the latest capture attempt ended, on the wire. *)
type nonrec capture_outcome_dto =
  | Captured
  | Not_ready
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val capture_outcome_dto_of_yojson : Yojson.Safe.t -> capture_outcome_dto
val yojson_of_capture_outcome_dto : capture_outcome_dto -> Yojson.Safe.t

type nonrec capture_attempt_dto = {
  error : string option;
      (** Why it did not capture, in a sentence the user can read. *)
  finished_at : string option;  (** When it ended; absent while it runs. *)
  outcome : capture_outcome_dto option;
  started_at : string;  (** When it started. *)
}
(** The latest capture attempt.

Clients deserialize this, so both derives are used. *)

val capture_attempt_dto_of_yojson : Yojson.Safe.t -> capture_attempt_dto
val yojson_of_capture_attempt_dto : capture_attempt_dto -> Yojson.Safe.t

val make_capture_attempt_dto :
  ?error:string ->
  ?finished_at:string ->
  ?outcome:capture_outcome_dto ->
  started_at:string ->
  unit ->
  capture_attempt_dto
(** The latest capture attempt.

Clients deserialize this, so both derives are used. *)

type nonrec git_ref_dto = {
  name : string option;  (** The branch name, when known. *)
  sha : string option;  (** The commit, when known. *)
}
(** One end of the compared range. *)

val git_ref_dto_of_yojson : Yojson.Safe.t -> git_ref_dto
val yojson_of_git_ref_dto : git_ref_dto -> Yojson.Safe.t

val make_git_ref_dto : ?name:string -> ?sha:string -> unit -> git_ref_dto
(** One end of the compared range. *)

(** What happened to a file, on the wire. *)
type nonrec file_change_kind_dto =
  | Added
  | Modified
  | Deleted
  | Renamed
  | Unknown of string  (** A value this SDK version does not know. *)

val file_change_kind_dto_of_yojson : Yojson.Safe.t -> file_change_kind_dto
val yojson_of_file_change_kind_dto : file_change_kind_dto -> Yojson.Safe.t

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

val changed_file_dto_of_yojson : Yojson.Safe.t -> changed_file_dto
val yojson_of_changed_file_dto : changed_file_dto -> Yojson.Safe.t

val make_changed_file_dto :
  additions:int ->
  binary:bool ->
  deletions:int ->
  kind:file_change_kind_dto ->
  patch_omitted:bool ->
  path:string ->
  ?previous_path:string ->
  unit ->
  changed_file_dto
(** One changed file.

Clients deserialize this, so both derives are used. *)

(** The source of a changeset's diff, on the wire. *)
type nonrec changeset_source_dto =
  | Github_pull_request
  | Unknown of string  (** A value this SDK version does not know. *)

val changeset_source_dto_of_yojson : Yojson.Safe.t -> changeset_source_dto
val yojson_of_changeset_source_dto : changeset_source_dto -> Yojson.Safe.t

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

val changeset_dto_of_yojson : Yojson.Safe.t -> changeset_dto
val yojson_of_changeset_dto : changeset_dto -> Yojson.Safe.t

val make_changeset_dto :
  additions:int ->
  base:git_ref_dto ->
  captured_at:string ->
  deletions:int ->
  files:changed_file_dto list ->
  head:git_ref_dto ->
  id:string ->
  patch_bytes:int64 ->
  ?repository:string ->
  source:changeset_source_dto ->
  truncated:bool ->
  unit ->
  changeset_dto
(** One changeset: the files a patch touches and what happened to each.

Clients deserialize this, so both derives are used. *)

type nonrec agent_session_changes_response = {
  attempt : capture_attempt_dto option;
  capturing : bool;  (** A capture is running right now. *)
  changeset : changeset_dto option;
}
(** Response body for [GET /agent-sessions/{session_id}/changes].

Clients deserialize this, so both derives are used. *)

val agent_session_changes_response_of_yojson :
  Yojson.Safe.t -> agent_session_changes_response

val yojson_of_agent_session_changes_response :
  agent_session_changes_response -> Yojson.Safe.t

val make_agent_session_changes_response :
  ?attempt:capture_attempt_dto ->
  capturing:bool ->
  ?changeset:changeset_dto ->
  unit ->
  agent_session_changes_response
(** Response body for [GET /agent-sessions/{session_id}/changes].

Clients deserialize this, so both derives are used. *)

type nonrec session_bot = {
  avatar_url : string option;  (** Avatar, when it has one. *)
  handle : string;  (** Stable [@] handle, without a leading [@]. *)
  id : bot_id;
      (** The bot's id. A message it sent has ["bot|{id}"] as its sender. *)
  name : string;  (** Display name. *)
}
(** The agent behind a session, as much of it as rendering a message needs. *)

val session_bot_of_yojson : Yojson.Safe.t -> session_bot
val yojson_of_session_bot : session_bot -> Yojson.Safe.t

val make_session_bot :
  ?avatar_url:string ->
  handle:string ->
  id:bot_id ->
  name:string ->
  unit ->
  session_bot
(** The agent behind a session, as much of it as rendering a message needs. *)

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

val agent_session_folded_log_response_of_yojson :
  Yojson.Safe.t -> agent_session_folded_log_response

val yojson_of_agent_session_folded_log_response :
  agent_session_folded_log_response -> Yojson.Safe.t

val make_agent_session_folded_log_response :
  bot:session_bot ->
  messages:Yojson.Safe.t list ->
  unit ->
  agent_session_folded_log_response
(** Response body for one session's folded log. *)

(** Which way a logged frame travelled, mirroring \[[Message]\]'s discriminant. *)
type nonrec log_direction_dto =
  | Notification
  | To_server
  | To_runtime
  | Unknown of string  (** A value this SDK version does not know. *)

val log_direction_dto_of_yojson : Yojson.Safe.t -> log_direction_dto
val yojson_of_log_direction_dto : log_direction_dto -> Yojson.Safe.t

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

val agent_session_log_entry_dto_of_yojson :
  Yojson.Safe.t -> agent_session_log_entry_dto

val yojson_of_agent_session_log_entry_dto :
  agent_session_log_entry_dto -> Yojson.Safe.t

val make_agent_session_log_entry_dto :
  content:Yojson.Safe.t ->
  direction:log_direction_dto ->
  created_at:string ->
  id:string ->
  ?user_id:string ->
  unit ->
  agent_session_log_entry_dto
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

val agent_session_log_response_of_yojson :
  Yojson.Safe.t -> agent_session_log_response

val yojson_of_agent_session_log_response :
  agent_session_log_response -> Yojson.Safe.t

val make_agent_session_log_response :
  bot:session_bot ->
  entries:agent_session_log_entry_dto list ->
  unit ->
  agent_session_log_response
(** Response body for one session's raw protocol log.

A wrapper rather than a bare array so that anything which is about the
response rather than about a frame has somewhere to go later without
breaking every client. *)

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

val session_status_dto_of_yojson : Yojson.Safe.t -> session_status_dto
val yojson_of_session_status_dto : session_status_dto -> Yojson.Safe.t

val make_session_status_dto_event : event:string -> unit -> session_status_dto
(** The last system event received from the runtime. *)

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

val agent_session_preview_data_of_yojson :
  Yojson.Safe.t -> agent_session_preview_data

val yojson_of_agent_session_preview_data :
  agent_session_preview_data -> Yojson.Safe.t

val make_agent_session_preview_data :
  ?bot:session_bot ->
  bot_id:string ->
  created_at:string ->
  id:string ->
  modified_at:string ->
  name:string ->
  owner_id:string ->
  status:session_status_dto ->
  unit ->
  agent_session_preview_data
(** The fields a chip renders for a session the caller may view.

Clients deserialize this, so both derives are used. *)

type nonrec with_agent_session_id = { id : string  (** The session id. *) }
(** Just a session id, for the preview variants that carry nothing else.

Clients deserialize this, so both derives are used. *)

val with_agent_session_id_of_yojson : Yojson.Safe.t -> with_agent_session_id
val yojson_of_with_agent_session_id : with_agent_session_id -> Yojson.Safe.t

val make_with_agent_session_id : id:string -> unit -> with_agent_session_id
(** Just a session id, for the preview variants that carry nothing else.

Clients deserialize this, so both derives are used. *)

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

val agent_session_preview_dto_of_yojson :
  Yojson.Safe.t -> agent_session_preview_dto

val yojson_of_agent_session_preview_dto :
  agent_session_preview_dto -> Yojson.Safe.t

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

val queued_action_dto_of_yojson : Yojson.Safe.t -> queued_action_dto
val yojson_of_queued_action_dto : queued_action_dto -> Yojson.Safe.t

val make_queued_action_dto :
  action_id:agent_action_id ->
  ?actor_user_id:string ->
  ?attachments:prompt_attachment list ->
  created_at:string ->
  kind:string ->
  ?prompt:string ->
  unit ->
  queued_action_dto
(** One action waiting in a session's queue.

Clients deserialize this, so both derives are used. *)

type nonrec agent_session_queue_response = {
  entries : queued_action_dto list;
      (** The waiting actions, in dispatch order. *)
}
(** Response body for a session's queue: everything waiting, oldest first.

A wrapper rather than a bare array so that anything which is about the
response rather than about an entry has somewhere to go later without
breaking every client. *)

val agent_session_queue_response_of_yojson :
  Yojson.Safe.t -> agent_session_queue_response

val yojson_of_agent_session_queue_response :
  agent_session_queue_response -> Yojson.Safe.t

val make_agent_session_queue_response :
  entries:queued_action_dto list -> unit -> agent_session_queue_response
(** Response body for a session's queue: everything waiting, oldest first.

A wrapper rather than a bare array so that anything which is about the
response rather than about an entry has somewhere to go later without
breaking every client. *)

(** Who or what archived a session. *)
type nonrec archive_cause =
  | User
  | Pull_request_merged
  | Runtime_closed
  | Unknown of string  (** A value this SDK version does not know. *)

val archive_cause_of_yojson : Yojson.Safe.t -> archive_cause
val yojson_of_archive_cause : archive_cause -> Yojson.Safe.t

type nonrec external_session_response = {
  name : string option;
      (** The provider's display name for the agent, when it reported one. *)
  provider : string;  (** Which provider serves the session, e.g. [cursor]. *)
  url : string option;
      (** The agent's page on the provider's site, for a client to link out to. *)
}
(** The provider-side identity of an externally-served session. *)

val external_session_response_of_yojson :
  Yojson.Safe.t -> external_session_response

val yojson_of_external_session_response :
  external_session_response -> Yojson.Safe.t

val make_external_session_response :
  ?name:string ->
  provider:string ->
  ?url:string ->
  unit ->
  external_session_response
(** The provider-side identity of an externally-served session. *)

(** Who did something that opened a session. *)
type nonrec caller =
  | Person of { user : macro_user_id_str  (** Who. *) }  (** A person. *)
  | Agent of agent_actor
      (** An agent, which always acts for a person on a path that opens a session. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val caller_of_yojson : Yojson.Safe.t -> caller
val yojson_of_caller : caller -> Yojson.Safe.t

val make_caller_person : user:macro_user_id_str -> unit -> caller
(** A person. *)

(** What made a routine fire. *)
type nonrec routine_cause =
  | Scheduled  (** One of its schedules came due. *)
  | Manual  (** Its owner started it by hand. *)
  | Event of { event_id : string  (** The event. *) }
      (** An event it watches happened. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val routine_cause_of_yojson : Yojson.Safe.t -> routine_cause
val yojson_of_routine_cause : routine_cause -> Yojson.Safe.t

val make_routine_cause_event : event_id:string -> unit -> routine_cause
(** An event it watches happened. *)

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

val trigger_origin_of_yojson : Yojson.Safe.t -> trigger_origin
val yojson_of_trigger_origin : trigger_origin -> Yojson.Safe.t

val make_trigger_origin_mentioned :
  by:caller -> message_id:string -> unit -> trigger_origin
(** A message mentioned the agent. *)

val make_trigger_origin_conversation :
  by:macro_user_id_str -> message_id:string -> unit -> trigger_origin
(** A person wrote in their private conversation with the agent. *)

val make_trigger_origin_task_assigned :
  by:caller -> task:string -> unit -> trigger_origin
(** The agent was added to a task's assignees. *)

val make_trigger_origin_project_inherited :
  by:caller -> project:string -> task:string -> unit -> trigger_origin
(** The task joined a project, and inherited the project's agents. *)

val make_trigger_origin_requested :
  by:macro_user_id_str -> unit -> trigger_origin
(** A person opened the session directly: from the composer, or by asking for a routine draft. *)

val make_trigger_origin_dispatched :
  on_behalf_of:macro_user_id_str -> unit -> trigger_origin
(** A tool handed the agent work. The tool knows only whose authority it
runs under, not which agent called it. *)

val make_trigger_origin_routine :
  firing:routine_cause -> routine:string -> unit -> trigger_origin
(** A routine fired. Its owner owns the session, so the owner is not repeated. *)

(** Named compute tier for a managed sandbox.

The API and database store the name. CPU, RAM, and disk live in
[crates/agent_harness/sandbox_sizes.json]. *)
type nonrec sandbox_size =
  | Small
  | Default
  | Large
  | Unknown of string  (** A value this SDK version does not know. *)

val sandbox_size_of_yojson : Yojson.Safe.t -> sandbox_size
val yojson_of_sandbox_size : sandbox_size -> Yojson.Safe.t

type nonrec document_id = string
(** A validated document identifier. Historical document ids need not be UUIDs. *)

val document_id_of_yojson : Yojson.Safe.t -> document_id
val yojson_of_document_id : document_id -> Yojson.Safe.t

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

val message_parent_of_yojson : Yojson.Safe.t -> message_parent
val yojson_of_message_parent : message_parent -> Yojson.Safe.t

val make_message_parent_channel : id:string -> unit -> message_parent
(** A channel, including direct messages. *)

val make_message_parent_document : id:document_id -> unit -> message_parent
(** A document, including tasks and PDFs. *)

val make_message_parent_initiative : id:string -> unit -> message_parent
(** An initiative, presented as a project in the application. *)

val make_message_parent_crm_company : id:string -> unit -> message_parent
(** A CRM company. *)

val make_message_parent_crm_contact : id:string -> unit -> message_parent
(** A CRM contact. *)

val make_message_parent_call : id:string -> unit -> message_parent
(** A video call and its persistent chat thread. *)

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

val agent_session_response_of_yojson : Yojson.Safe.t -> agent_session_response
val yojson_of_agent_session_response : agent_session_response -> Yojson.Safe.t

val make_agent_session_response :
  ?acp_session_id:string ->
  ?archived_at:string ->
  ?archived_by:archive_cause ->
  bot_id:string ->
  can_edit:bool ->
  created_at:string ->
  ?external_:external_session_response ->
  harness:string ->
  id:string ->
  ?instructions:string ->
  model:string ->
  modified_at:string ->
  name:string ->
  ?origin:trigger_origin ->
  ?originating_message_id:string ->
  owner_id:string ->
  ?pull_request_url:string ->
  ?repo_url:string ->
  sandbox_size:sandbox_size ->
  status:session_status_dto ->
  ?task_id:string ->
  ?thread_channel_id:string ->
  ?thread_id:string ->
  ?thread_parent:message_parent ->
  workspace:string ->
  unit ->
  agent_session_response
(** Response body describing an agent session.

Clients deserialize this, so both derives are used. *)

(** A kind of action or inactivity the user should see: [permission] to run a tool, an
[elicitation] question or form, a [tool_approval] held for the owner, or [stalled] with no
activity for over 20 minutes. *)
type nonrec agent_update_kind =
  | Permission
  | Elicitation
  | Tool_approval
  | Stalled
  | Unknown of string  (** A value this SDK version does not know. *)

val agent_update_kind_of_yojson : Yojson.Safe.t -> agent_update_kind
val yojson_of_agent_update_kind : agent_update_kind -> Yojson.Safe.t

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

val agent_update_of_yojson : Yojson.Safe.t -> agent_update
val yojson_of_agent_update : agent_update -> Yojson.Safe.t

val make_agent_update :
  harness:string ->
  kind:agent_update_kind ->
  options:string list ->
  ?pull_request_url:string ->
  session_id:string ->
  session_name:string ->
  since:string ->
  summary:string ->
  unit ->
  agent_update
(** One pending interaction, or one stalled session. *)

type nonrec agent_updates = {
  items : agent_update list;
      (** One entry per pending request or stalled session, newest session activity first. *)
  truncated : bool;
      (** Whether qualifying sessions beyond the 25 most recent were left out. *)
  truncation_notice : string option;
      (** Says what was left out, when truncated. *)
}
(** Bounded results; truncation means older qualifying sessions were not folded. *)

val agent_updates_of_yojson : Yojson.Safe.t -> agent_updates
val yojson_of_agent_updates : agent_updates -> Yojson.Safe.t

val make_agent_updates :
  items:agent_update list ->
  truncated:bool ->
  ?truncation_notice:string ->
  unit ->
  agent_updates
(** Bounded results; truncation means older qualifying sessions were not folded. *)

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

type nonrec ai_suggestions = Yojson.Safe.t
(** Editable fields for ai inference, before submission and identity resolution. *)

val ai_suggestions_of_yojson : Yojson.Safe.t -> ai_suggestions
val yojson_of_ai_suggestions : ai_suggestions -> Yojson.Safe.t

(** How a person answers a held tool call. *)
type nonrec tool_approval_answer_dto =
  | Approve
  | Approve_and_remember
  | Deny
  | Cancel
  | Unknown of string  (** A value this SDK version does not know. *)

val tool_approval_answer_dto_of_yojson :
  Yojson.Safe.t -> tool_approval_answer_dto

val yojson_of_tool_approval_answer_dto :
  tool_approval_answer_dto -> Yojson.Safe.t

type nonrec answer_tool_approval_request = {
  answer : tool_approval_answer_dto;  (** The answer. *)
}
(** Request body for answering a held tool call. *)

val answer_tool_approval_request_of_yojson :
  Yojson.Safe.t -> answer_tool_approval_request

val yojson_of_answer_tool_approval_request :
  answer_tool_approval_request -> Yojson.Safe.t

val make_answer_tool_approval_request :
  answer:tool_approval_answer_dto -> unit -> answer_tool_approval_request
(** Request body for answering a held tool call. *)

(** Where a held tool call stands once answered. *)
type nonrec tool_approval_status_dto =
  | Pending
  | Approved
  | Denied
  | Cancelled
  | Expired
  | Unknown of string  (** A value this SDK version does not know. *)

val tool_approval_status_dto_of_yojson :
  Yojson.Safe.t -> tool_approval_status_dto

val yojson_of_tool_approval_status_dto :
  tool_approval_status_dto -> Yojson.Safe.t

type nonrec answer_tool_approval_response = {
  status : tool_approval_status_dto;  (** Where the call stands now. *)
}
(** Response body for answering a held tool call. *)

val answer_tool_approval_response_of_yojson :
  Yojson.Safe.t -> answer_tool_approval_response

val yojson_of_answer_tool_approval_response :
  answer_tool_approval_response -> Yojson.Safe.t

val make_answer_tool_approval_response :
  status:tool_approval_status_dto -> unit -> answer_tool_approval_response
(** Response body for answering a held tool call. *)

type nonrec app_connected_request = {
  action_id : agent_action_id option;
  app_slug : string;
      (** The Pipedream app slug the owner connected, e.g. [notion]. *)
}
(** Request body for reporting a connected app. *)

val app_connected_request_of_yojson : Yojson.Safe.t -> app_connected_request
val yojson_of_app_connected_request : app_connected_request -> Yojson.Safe.t

val make_app_connected_request :
  ?action_id:agent_action_id -> app_slug:string -> unit -> app_connected_request
(** Request body for reporting a connected app. *)

type nonrec auto_archive_overrides_body = {
  on_pull_request_merged : bool option;
      (** Archive once the session's pull requests merge, or [null] to follow the owner. *)
  on_runtime_closed : bool option;
      (** Archive once the session's runtime session is deliberately closed, or [null] to follow
the owner. *)
}
(** One session's choices over its owner's defaults. [null] follows the owner. *)

val auto_archive_overrides_body_of_yojson :
  Yojson.Safe.t -> auto_archive_overrides_body

val yojson_of_auto_archive_overrides_body :
  auto_archive_overrides_body -> Yojson.Safe.t

val make_auto_archive_overrides_body :
  ?on_pull_request_merged:bool ->
  ?on_runtime_closed:bool ->
  unit ->
  auto_archive_overrides_body
(** One session's choices over its owner's defaults. [null] follows the owner. *)

type nonrec auto_archive_preferences_body = {
  on_pull_request_merged : bool;
      (** Archive a session once every pull request linked to it is closed and at least one merged. *)
  on_runtime_closed : bool;
      (** Archive a session once the runtime session backing it is deliberately closed. *)
}
(** Which triggers archive the caller's sessions when a session has no choice of its own. *)

val auto_archive_preferences_body_of_yojson :
  Yojson.Safe.t -> auto_archive_preferences_body

val yojson_of_auto_archive_preferences_body :
  auto_archive_preferences_body -> Yojson.Safe.t

val make_auto_archive_preferences_body :
  on_pull_request_merged:bool ->
  on_runtime_closed:bool ->
  unit ->
  auto_archive_preferences_body
(** Which triggers archive the caller's sessions when a session has no choice of its own. *)

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

val weekday_code_of_yojson : Yojson.Safe.t -> weekday_code
val yojson_of_weekday_code : weekday_code -> Yojson.Safe.t

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

val recurrence_end_of_yojson : Yojson.Safe.t -> recurrence_end
val yojson_of_recurrence_end : recurrence_end -> Yojson.Safe.t

val make_recurrence_end_after : count:int -> unit -> recurrence_end
(** Explicit occurrence limit. *)

val make_recurrence_end_on : date:string -> unit -> recurrence_end
(** Inclusive local ISO date. *)

(** Repetition units supported by the shared calendar editor. *)
type nonrec recurrence_frequency =
  | Daily
  | Weekly
  | Monthly
  | Yearly
  | Unknown of string  (** A value this SDK version does not know. *)

val recurrence_frequency_of_yojson : Yojson.Safe.t -> recurrence_frequency
val yojson_of_recurrence_frequency : recurrence_frequency -> Yojson.Safe.t

type nonrec monthly_weekday = {
  ordinal : int;  (** One through five, or minus one for last. *)
  weekday : weekday_code;  (** Weekday selected by the ordinal. *)
}
(** Monthly ordinal weekday, such as the first Friday. *)

val monthly_weekday_of_yojson : Yojson.Safe.t -> monthly_weekday
val yojson_of_monthly_weekday : monthly_weekday -> Yojson.Safe.t

val make_monthly_weekday :
  ordinal:int -> weekday:weekday_code -> unit -> monthly_weekday
(** Monthly ordinal weekday, such as the first Friday. *)

type nonrec recurrence_suggestion = {
  by_day : weekday_code list;  (** Weekly weekday selectors. *)
  ends : recurrence_end;  (** Resolved ending condition. *)
  frequency : recurrence_frequency;  (** Repetition unit. *)
  interval : int;  (** Positive interval. *)
  monthly_by_day : monthly_weekday option;
}
(** Resolved, editable repetition values; the existing calendar serializer builds RRULEs. *)

val recurrence_suggestion_of_yojson : Yojson.Safe.t -> recurrence_suggestion
val yojson_of_recurrence_suggestion : recurrence_suggestion -> Yojson.Safe.t

val make_recurrence_suggestion :
  by_day:weekday_code list ->
  ends:recurrence_end ->
  frequency:recurrence_frequency ->
  interval:int ->
  ?monthly_by_day:monthly_weekday ->
  unit ->
  recurrence_suggestion
(** Resolved, editable repetition values; the existing calendar serializer builds RRULEs. *)

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

val calendar_suggestions_of_yojson : Yojson.Safe.t -> calendar_suggestions
val yojson_of_calendar_suggestions : calendar_suggestions -> Yojson.Safe.t

val make_calendar_suggestions :
  ?body:string ->
  ?end_:string ->
  ?guests:string list ->
  ?location:string ->
  ?recurrence:recurrence_suggestion ->
  ?start:string ->
  ?start_assumption:string ->
  ?title:string ->
  unit ->
  calendar_suggestions
(** Editable fields for calendar inference, before submission and identity resolution. *)

type nonrec call_connected_tool = {
  arguments : Yojson.Safe.t option;
      (** The tool's arguments, matching its input schema. *)
  tool : string;  (** The tool's name on its server. *)
}
(** Call one tool of a connected app. *)

val call_connected_tool_of_yojson : Yojson.Safe.t -> call_connected_tool
val yojson_of_call_connected_tool : call_connected_tool -> Yojson.Safe.t

val make_call_connected_tool :
  ?arguments:Yojson.Safe.t -> tool:string -> unit -> call_connected_tool
(** Call one tool of a connected app. *)

type nonrec call_search_suggestions = {
  from : string list;  (** Speaker names or supplied addresses. *)
  in_ : string list;  (** Channel names. *)
  query : string option;  (** Remaining keyword phrase. *)
  status : string option;
      (** Attendance display value, resolved against supported options by the client. *)
}
(** Call search supports speakers, channels and attendance status. *)

val call_search_suggestions_of_yojson : Yojson.Safe.t -> call_search_suggestions
val yojson_of_call_search_suggestions : call_search_suggestions -> Yojson.Safe.t

val make_call_search_suggestions :
  from:string list ->
  in_:string list ->
  ?query:string ->
  ?status:string ->
  unit ->
  call_search_suggestions
(** Call search supports speakers, channels and attendance status. *)

(** Harness names accepted by the capability-discovery endpoint. *)
type nonrec capability_harness_dto =
  | In_memory
  | Cursor
  | Macrod
  | Unknown of string  (** A value this SDK version does not know. *)

val capability_harness_dto_of_yojson : Yojson.Safe.t -> capability_harness_dto
val yojson_of_capability_harness_dto : capability_harness_dto -> Yojson.Safe.t

type nonrec channel_search_suggestions = {
  from : string list;  (** Explicit message sender names or addresses. *)
  in_ : string list;  (** Explicit channel names. *)
  query : string option;  (** Remaining keyword phrase. *)
}
(** Message filters remain display names until resolved against the user's directory. *)

val channel_search_suggestions_of_yojson :
  Yojson.Safe.t -> channel_search_suggestions

val yojson_of_channel_search_suggestions :
  channel_search_suggestions -> Yojson.Safe.t

val make_channel_search_suggestions :
  from:string list ->
  in_:string list ->
  ?query:string ->
  unit ->
  channel_search_suggestions
(** Message filters remain display names until resolved against the user's directory. *)

type nonrec channel_share_permission = {
  access_level : access_level;  (** The access level for the channel *)
  channel_id : string;  (** The channel id *)
}
(** The channel share permission *)

val channel_share_permission_of_yojson :
  Yojson.Safe.t -> channel_share_permission

val yojson_of_channel_share_permission :
  channel_share_permission -> Yojson.Safe.t

val make_channel_share_permission :
  access_level:access_level ->
  channel_id:string ->
  unit ->
  channel_share_permission
(** The channel share permission *)

type nonrec classify_input_request = {
  revision : int;
      (** Opaque client revision used to discard stale predictions. *)
  text : string;  (** Current draft text to classify without executing it. *)
}
(** A draft snapshot. Revisions are opaque to the server and echoed to the client. *)

val classify_input_request_of_yojson : Yojson.Safe.t -> classify_input_request
val yojson_of_classify_input_request : classify_input_request -> Yojson.Safe.t

val make_classify_input_request :
  revision:int -> text:string -> unit -> classify_input_request
(** A draft snapshot. Revisions are opaque to the server and echoed to the client. *)

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

val input_intent_of_yojson : Yojson.Safe.t -> input_intent
val yojson_of_input_intent : input_intent -> Yojson.Safe.t

type nonrec intent_score = {
  intent : input_intent;  (** Destination evaluated by the classifier. *)
  score : float;  (** Independent probability between zero and one. *)
}
(** Independent yes/no probabilities; these do not sum to one. *)

val intent_score_of_yojson : Yojson.Safe.t -> intent_score
val yojson_of_intent_score : intent_score -> Yojson.Safe.t

val make_intent_score :
  intent:input_intent -> score:float -> unit -> intent_score
(** Independent yes/no probabilities; these do not sum to one. *)

type nonrec classify_input_response = {
  revision : int;  (** Revision echoed from the classification request. *)
  scores : intent_score list;
      (** Independent scores in the fixed intent-question order. *)
}
(** Ranked-type evidence for a particular client draft revision. *)

val classify_input_response_of_yojson : Yojson.Safe.t -> classify_input_response
val yojson_of_classify_input_response : classify_input_response -> Yojson.Safe.t

val make_classify_input_response :
  revision:int -> scores:intent_score list -> unit -> classify_input_response
(** Ranked-type evidence for a particular client draft revision. *)

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

val claude_account_status_of_yojson : Yojson.Safe.t -> claude_account_status
val yojson_of_claude_account_status : claude_account_status -> Yojson.Safe.t

val make_claude_account_status :
  ?expires_at:string ->
  signed_in_at:string ->
  ?signed_in_by:string ->
  unit ->
  claude_account_status
(** A computer's active Claude sign-in. Claude's long-lived credential names
no account, so there is no email or plan to show. *)

(** How Claude Code on a Macro computer is paid for: its own Claude account
when it has an active Claude login, otherwise Macro credits. *)
type nonrec claude_mode =
  | Macro_credits
  | Own_account
  | Unknown of string  (** A value this SDK version does not know. *)

val claude_mode_of_yojson : Yojson.Safe.t -> claude_mode
val yojson_of_claude_mode : claude_mode -> Yojson.Safe.t

type nonrec claude_mode_response = {
  account : claude_account_status option;
  mode : claude_mode;  (** How Claude Code is paid for. *)
}
(** How Claude Code on a computer is paid for, and its Claude sign-in when it
uses its own. *)

val claude_mode_response_of_yojson : Yojson.Safe.t -> claude_mode_response
val yojson_of_claude_mode_response : claude_mode_response -> Yojson.Safe.t

val make_claude_mode_response :
  ?account:claude_account_status ->
  mode:claude_mode ->
  unit ->
  claude_mode_response
(** How Claude Code on a computer is paid for, and its Claude sign-in when it
uses its own. *)

type nonrec claude_sign_in_complete = {
  code : string;  (** The code Claude showed after the user signed in. *)
}
(** [POST /harnesses/{harness_id}/claude-sign-in/complete] body. *)

val claude_sign_in_complete_of_yojson : Yojson.Safe.t -> claude_sign_in_complete
val yojson_of_claude_sign_in_complete : claude_sign_in_complete -> Yojson.Safe.t

val make_claude_sign_in_complete :
  code:string -> unit -> claude_sign_in_complete
(** [POST /harnesses/{harness_id}/claude-sign-in/complete] body. *)

type nonrec claude_sign_in_started = {
  url : string;  (** Where the user signs in to Claude, in their own browser. *)
}
(** [POST /harnesses/{harness_id}/claude-sign-in] answer. *)

val claude_sign_in_started_of_yojson : Yojson.Safe.t -> claude_sign_in_started
val yojson_of_claude_sign_in_started : claude_sign_in_started -> Yojson.Safe.t

val make_claude_sign_in_started : url:string -> unit -> claude_sign_in_started
(** [POST /harnesses/{harness_id}/claude-sign-in] answer. *)

type nonrec claude_signed_in = { signed_in : bool  (** Always [true]. *) }
(** [POST /harnesses/{harness_id}/claude-sign-in/complete] answer. *)

val claude_signed_in_of_yojson : Yojson.Safe.t -> claude_signed_in
val yojson_of_claude_signed_in : claude_signed_in -> Yojson.Safe.t

val make_claude_signed_in : signed_in:bool -> unit -> claude_signed_in
(** [POST /harnesses/{harness_id}/claude-sign-in/complete] answer. *)

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

val coding_agent_of_yojson : Yojson.Safe.t -> coding_agent
val yojson_of_coding_agent : coding_agent -> Yojson.Safe.t

val make_coding_agent :
  ?description:string ->
  harness:string ->
  id:string ->
  instructions:string ->
  ?model:string ->
  name:string ->
  unit ->
  coding_agent
(** Information used to choose a coding persona for a task. *)

type nonrec coding_agents_response = {
  agents : coding_agent list;
      (** Available coding personas, built-in ones such as Cursor first. *)
}
(** The coding agents the caller can start a session as right now. *)

val coding_agents_response_of_yojson : Yojson.Safe.t -> coding_agents_response
val yojson_of_coding_agents_response : coding_agents_response -> Yojson.Safe.t

val make_coding_agents_response :
  agents:coding_agent list -> unit -> coding_agents_response
(** The coding agents the caller can start a session as right now. *)

type nonrec coding_preferences_body = {
  create_tasks : bool;
      (** Whether new coding sessions research prior work and link a Macro task. *)
  open_pull_requests : bool;
      (** Whether new coding sessions deliver their work as a pull request. *)
}
(** Request or response body for the caller's coding preferences. *)

val coding_preferences_body_of_yojson : Yojson.Safe.t -> coding_preferences_body
val yojson_of_coding_preferences_body : coding_preferences_body -> Yojson.Safe.t

val make_coding_preferences_body :
  create_tasks:bool ->
  open_pull_requests:bool ->
  unit ->
  coding_preferences_body
(** Request or response body for the caller's coding preferences. *)

type nonrec connect_mcp_server = {
  server_name : string;  (** Display name for the server. *)
  url : string;  (** The server's URL. *)
}
(** Add a custom MCP server to the user's connections. *)

val connect_mcp_server_of_yojson : Yojson.Safe.t -> connect_mcp_server
val yojson_of_connect_mcp_server : connect_mcp_server -> Yojson.Safe.t

val make_connect_mcp_server :
  server_name:string -> url:string -> unit -> connect_mcp_server
(** Add a custom MCP server to the user's connections. *)

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

val connect_mcp_server_response_of_yojson :
  Yojson.Safe.t -> connect_mcp_server_response

val yojson_of_connect_mcp_server_response :
  connect_mcp_server_response -> Yojson.Safe.t

val make_connect_mcp_server_response :
  already_connected:bool ->
  authenticated:bool ->
  enabled:bool ->
  server_name:string ->
  summary:string ->
  url:string ->
  unit ->
  connect_mcp_server_response
(** Response from \[[ConnectMcpServer]\]. *)

(** Which store a connected app comes from. *)
type nonrec connected_app_kind =
  | App
  | Custom
  | Unknown of string  (** A value this SDK version does not know. *)

val connected_app_kind_of_yojson : Yojson.Safe.t -> connected_app_kind
val yojson_of_connected_app_kind : connected_app_kind -> Yojson.Safe.t

type nonrec connected_app = {
  key : string;  (** The app's slug, or its custom server key. *)
  kind : connected_app_kind;  (** Which store the app comes from. *)
  name : string;
      (** Display name, e.g. [Slack] or the owner's name for a custom server. *)
}
(** A connected app the session's agent may use. *)

val connected_app_of_yojson : Yojson.Safe.t -> connected_app
val yojson_of_connected_app : connected_app -> Yojson.Safe.t

val make_connected_app :
  key:string -> kind:connected_app_kind -> name:string -> unit -> connected_app
(** A connected app the session's agent may use. *)

type nonrec connected_tool = {
  description : string option;  (** What the server says the tool does. *)
  input_schema : Yojson.Safe.t;  (** JSON Schema for the tool's arguments. *)
  name : string;  (** The tool's name on its server. *)
}
(** One tool a connected app serves. *)

val connected_tool_of_yojson : Yojson.Safe.t -> connected_tool
val yojson_of_connected_tool : connected_tool -> Yojson.Safe.t

val make_connected_tool :
  ?description:string ->
  input_schema:Yojson.Safe.t ->
  name:string ->
  unit ->
  connected_tool
(** One tool a connected app serves. *)

type nonrec connected_tool_match = {
  app : connected_app;  (** The app serving the tool. *)
  tool : connected_tool;  (** The tool. *)
}
(** One tool found by a search across the agent's connected apps. *)

val connected_tool_match_of_yojson : Yojson.Safe.t -> connected_tool_match
val yojson_of_connected_tool_match : connected_tool_match -> Yojson.Safe.t

val make_connected_tool_match :
  app:connected_app -> tool:connected_tool -> unit -> connected_tool_match
(** One tool found by a search across the agent's connected apps. *)

type nonrec connected_tool_result = {
  content : Yojson.Safe.t list;
      (** MCP content blocks, e.g. [{type: "text", text}]. *)
  is_error : bool;
      (** The tool failed, or could not run; [content] says why. *)
  structured_content : Yojson.Safe.t option;
      (** Structured output, for tools that declare an output schema. *)
}
(** A connected tool's answer: MCP's [CallToolResult]. *)

val connected_tool_result_of_yojson : Yojson.Safe.t -> connected_tool_result
val yojson_of_connected_tool_result : connected_tool_result -> Yojson.Safe.t

val make_connected_tool_result :
  content:Yojson.Safe.t list ->
  is_error:bool ->
  ?structured_content:Yojson.Safe.t ->
  unit ->
  connected_tool_result
(** A connected tool's answer: MCP's [CallToolResult]. *)

type nonrec connected_tool_search = {
  matches : connected_tool_match list;
      (** At most \[[MAX_TOOL_MATCHES]\] tools, best first. *)
  unsearched : connected_app list;  (** Apps whose tools could not be listed. *)
}
(** The best matches across the agent's connected apps, and the apps whose
tools could not be listed, which the search did not cover. *)

val connected_tool_search_of_yojson : Yojson.Safe.t -> connected_tool_search
val yojson_of_connected_tool_search : connected_tool_search -> Yojson.Safe.t

val make_connected_tool_search :
  matches:connected_tool_match list ->
  unsearched:connected_app list ->
  unit ->
  connected_tool_search
(** The best matches across the agent's connected apps, and the apps whose
tools could not be listed, which the search did not cover. *)

type nonrec connector_tool = {
  description : string;  (** What the action supports. *)
  name : string;  (** Upstream tool name. *)
}
(** An advertised action, not a tool loaded into the current turn. *)

val connector_tool_of_yojson : Yojson.Safe.t -> connector_tool
val yojson_of_connector_tool : connector_tool -> Yojson.Safe.t

val make_connector_tool :
  description:string -> name:string -> unit -> connector_tool
(** An advertised action, not a tool loaded into the current turn. *)

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

val control_request_of_yojson : Yojson.Safe.t -> control_request
val yojson_of_control_request : control_request -> Yojson.Safe.t

val make_control_request :
  agent_action:agent_action ->
  ?action_id:agent_action_id ->
  ?client_id:string ->
  ?context:Yojson.Safe.t ->
  unit ->
  control_request
(** Request body for a control operation on a live session.

A wrapper around the operation rather than the bare enum so that fields
which are about the request rather than the operation have somewhere to go.
The acting user is deliberately not one of them: it comes from the caller's
credentials, so that a caller cannot attribute an operation to someone else.

Clients serialize this, so both derives are used. *)

(** What accepting a control operation did with it, on the wire. *)
type nonrec control_status_dto =
  | Sent
  | Queued
  | Unknown of string  (** A value this SDK version does not know. *)

val control_status_dto_of_yojson : Yojson.Safe.t -> control_status_dto
val yojson_of_control_status_dto : control_status_dto -> Yojson.Safe.t

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

val control_response_of_yojson : Yojson.Safe.t -> control_response
val yojson_of_control_response : control_response -> Yojson.Safe.t

val make_control_response :
  action_id:agent_action_id ->
  status:control_status_dto ->
  unit ->
  control_response
(** Response body for a control operation.

Clients deserialize this, so both derives are used. *)

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

val create_session_thread_of_yojson : Yojson.Safe.t -> create_session_thread
val yojson_of_create_session_thread : create_session_thread -> Yojson.Safe.t

val make_create_session_thread :
  ?channel_id:string ->
  ?content:string ->
  message_id:string ->
  ?parent:message_parent ->
  ?reuse_origin_message:bool ->
  ?thread_id:string ->
  unit ->
  create_session_thread
(** The triggering mention on a create request.

Clients serialize this, so both derives are used. *)

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

val create_agent_session_request_of_yojson :
  Yojson.Safe.t -> create_agent_session_request

val yojson_of_create_agent_session_request :
  create_agent_session_request -> Yojson.Safe.t

val make_create_agent_session_request :
  ?bot_id:string ->
  ?id:string ->
  ?instructions:string ->
  ?model:string ->
  ?owner:string ->
  ?prompt:string ->
  ?prompt_action_id:agent_action_id ->
  ?prompt_attachments:prompt_attachment list ->
  ?prompt_client_id:string ->
  ?repo_branch:string ->
  ?repo_url:string ->
  ?thread:create_session_thread ->
  ?workspace:string ->
  unit ->
  create_agent_session_request
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

type nonrec create_agent_session_response = {
  session : agent_session_response;  (** The created session. *)
}
(** Response body for [POST /agent-sessions].

Clients deserialize this, so both derives are used. *)

val create_agent_session_response_of_yojson :
  Yojson.Safe.t -> create_agent_session_response

val yojson_of_create_agent_session_response :
  create_agent_session_response -> Yojson.Safe.t

val make_create_agent_session_response :
  session:agent_session_response -> unit -> create_agent_session_response
(** Response body for [POST /agent-sessions].

Clients deserialize this, so both derives are used. *)

type nonrec execution_id = string
(** Caller-selected UUID persisted in tool input before execution begins. *)

val execution_id_of_yojson : Yojson.Safe.t -> execution_id
val yojson_of_execution_id : execution_id -> Yojson.Safe.t

type nonrec create_review = {
  execution_id : execution_id option;
  title : string;  (** Stack label. *)
}
(** Review creation. Decoding it validates every draft; creating a review only
presents the drafts, and the account holder acts separately. *)

val create_review_of_yojson : Yojson.Safe.t -> create_review
val yojson_of_create_review : create_review -> Yojson.Safe.t

val make_create_review :
  ?execution_id:execution_id -> title:string -> unit -> create_review
(** Review creation. Decoding it validates every draft; creating a review only
presents the drafts, and the account holder acts separately. *)

(** Surface of a review decision. *)
type nonrec decision_via =
  | Card
  | Chat
  | Inbox
  | Unknown of string  (** A value this SDK version does not know. *)

val decision_via_of_yojson : Yojson.Safe.t -> decision_via
val yojson_of_decision_via : decision_via -> Yojson.Safe.t

type nonrec discover_agent_capabilities_request = {
  harness : capability_harness_dto;  (** Provider to probe. *)
  harness_id : string option;
      (** Required for macrod and forbidden for other targets. *)
  model : string option;
      (** Model whose session settings should be inspected. *)
}
(** HTTP request selecting one provider to probe. *)

val discover_agent_capabilities_request_of_yojson :
  Yojson.Safe.t -> discover_agent_capabilities_request

val yojson_of_discover_agent_capabilities_request :
  discover_agent_capabilities_request -> Yojson.Safe.t

val make_discover_agent_capabilities_request :
  harness:capability_harness_dto ->
  ?harness_id:string ->
  ?model:string ->
  unit ->
  discover_agent_capabilities_request
(** HTTP request selecting one provider to probe. *)

type nonrec discover_agent_capabilities_response = {
  config_options : agent_config_option_dto list;
      (** Complete ordered ACP session configuration advertised by the agent. *)
}
(** Successful capability-discovery response. *)

val discover_agent_capabilities_response_of_yojson :
  Yojson.Safe.t -> discover_agent_capabilities_response

val yojson_of_discover_agent_capabilities_response :
  discover_agent_capabilities_response -> Yojson.Safe.t

val make_discover_agent_capabilities_response :
  config_options:agent_config_option_dto list ->
  unit ->
  discover_agent_capabilities_response
(** Successful capability-discovery response. *)

type nonrec discovered_app = {
  app_slug : string;  (** Exact identity to inspect or connect. *)
  description : string option;
      (** Directory description; inspect tools to verify specific capabilities. *)
  name : string;  (** Human-readable app name. *)
}
(** A verified app identity from the directory. *)

val discovered_app_of_yojson : Yojson.Safe.t -> discovered_app
val yojson_of_discovered_app : discovered_app -> Yojson.Safe.t

val make_discovered_app :
  app_slug:string ->
  ?description:string ->
  name:string ->
  unit ->
  discovered_app
(** A verified app identity from the directory. *)

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

val discovery_result_of_yojson : Yojson.Safe.t -> discovery_result
val yojson_of_discovery_result : discovery_result -> Yojson.Safe.t

val make_discovery_result_search :
  apps:discovered_app list -> more_results:bool -> unit -> discovery_result
(** Candidate apps; none has had its capabilities verified yet. *)

val make_discovery_result_inspect :
  app:discovered_app ->
  connected:bool ->
  tools:connector_tool list ->
  tools_truncated:bool ->
  unit ->
  discovery_result
(** Verified identity, capabilities and this caller's connection status. *)

type nonrec discover_connectors_response = {
  connect_markup : string option;
      (** Include verbatim only if an advertised tool supports the requested task. *)
  result : discovery_result;  (** Catalog or capability results. *)
}
(** Discovery metadata and optional markup for a user-controlled auth flow. *)

val discover_connectors_response_of_yojson :
  Yojson.Safe.t -> discover_connectors_response

val yojson_of_discover_connectors_response :
  discover_connectors_response -> Yojson.Safe.t

val make_discover_connectors_response :
  ?connect_markup:string ->
  result:discovery_result ->
  unit ->
  discover_connectors_response
(** Discovery metadata and optional markup for a user-controlled auth flow. *)

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

val discovery_request_of_yojson : Yojson.Safe.t -> discovery_request
val yojson_of_discovery_request : discovery_request -> Yojson.Safe.t

val make_discovery_request_search : query:string -> unit -> discovery_request
(** Find connectable apps by name. *)

val make_discovery_request_inspect :
  app_slug:string -> unit -> discovery_request
(** Verify capabilities and connection status for one catalog app. *)

type nonrec edit_queued_action_request = {
  prompt : string;
      (** The new raw prompt text, replacing the old wholesale. Never blank: a
prompt with nothing to say is a removal, and there is an endpoint for
that. *)
}
(** Request body for editing a queued prompt. *)

val edit_queued_action_request_of_yojson :
  Yojson.Safe.t -> edit_queued_action_request

val yojson_of_edit_queued_action_request :
  edit_queued_action_request -> Yojson.Safe.t

val make_edit_queued_action_request :
  prompt:string -> unit -> edit_queued_action_request
(** Request body for editing a queued prompt. *)

type nonrec email_search_suggestions = {
  importance : string option;
      (** Explicit importance wording, resolved by the client. *)
  inboxes : string list;
      (** Explicit connected inbox addresses, resolved by the client. *)
  query : string option;  (** Remaining keyword phrase. *)
}
(** Email search exposes importance and connected inbox addresses, not sender filters. *)

val email_search_suggestions_of_yojson :
  Yojson.Safe.t -> email_search_suggestions

val yojson_of_email_search_suggestions :
  email_search_suggestions -> Yojson.Safe.t

val make_email_search_suggestions :
  ?importance:string ->
  inboxes:string list ->
  ?query:string ->
  unit ->
  email_search_suggestions
(** Email search exposes importance and connected inbox addresses, not sender filters. *)

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

val email_suggestions_of_yojson : Yojson.Safe.t -> email_suggestions
val yojson_of_email_suggestions : email_suggestions -> Yojson.Safe.t

val make_email_suggestions :
  ?bcc:string list ->
  ?body:string ->
  ?cc:string list ->
  ?recipients:string list ->
  ?subject:string ->
  unit ->
  email_suggestions
(** Editable fields for email inference, before submission and identity resolution. *)

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

(** A dispatch result; unfinished work is never reported as success. *)
type nonrec recorded_call_status =
  | Running
  | Completed
  | Failed
  | Unknown_
  | Unknown of string  (** A value this SDK version does not know. *)

val recorded_call_status_of_yojson : Yojson.Safe.t -> recorded_call_status
val yojson_of_recorded_call_status : recorded_call_status -> Yojson.Safe.t

type nonrec execution_activity = {
  id : int64;  (** Request identity within the execution. *)
  label : string;
      (** Server-selected label from the generated operation catalog. *)
  status : recorded_call_status;
      (** Observed request state; unfinished operations have unknown outcomes. *)
}
(** A bounded SDK operation observed during execution; not an authorization or write receipt. *)

val execution_activity_of_yojson : Yojson.Safe.t -> execution_activity
val yojson_of_execution_activity : execution_activity -> Yojson.Safe.t

val make_execution_activity :
  id:int64 ->
  label:string ->
  status:recorded_call_status ->
  unit ->
  execution_activity
(** A bounded SDK operation observed during execution; not an authorization or write receipt. *)

(** Which authenticated participant's access a tool call requests. *)
type nonrec tool_actor =
  | Requester
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

val tool_actor_of_yojson : Yojson.Safe.t -> tool_actor
val yojson_of_tool_actor : tool_actor -> Yojson.Safe.t

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

val recorded_tool_call_of_yojson : Yojson.Safe.t -> recorded_tool_call
val yojson_of_recorded_tool_call : recorded_tool_call -> Yojson.Safe.t

val make_recorded_tool_call :
  ?error:string ->
  id:string ->
  input:Yojson.Safe.t ->
  name:string ->
  ?output:Yojson.Safe.t ->
  output_omitted:bool ->
  status:recorded_call_status ->
  unit ->
  recorded_tool_call
(** A real inner call, recorded by trusted dispatch for the existing renderers. *)

(** The recorded outcome of a program. *)
type nonrec execution_status =
  | Running
  | Succeeded
  | Failed
  | Cancelled
  | Timed_out
  | Unknown of string  (** A value this SDK version does not know. *)

val execution_status_of_yojson : Yojson.Safe.t -> execution_status
val yojson_of_execution_status : execution_status -> Yojson.Safe.t

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

val execution_record_of_yojson : Yojson.Safe.t -> execution_record
val yojson_of_execution_record : execution_record -> Yojson.Safe.t

val make_execution_record :
  ?acting_as:tool_actor ->
  ?activity:execution_activity list ->
  ?activity_truncated:bool ->
  calls:recorded_tool_call list ->
  ?error:string ->
  execution_id:execution_id ->
  ?result:Yojson.Safe.t ->
  source:string ->
  status:execution_status ->
  ?turn_id:string ->
  unit ->
  execution_record
(** Durable source and final outcome, with historical bridge calls when present.
The full journal is not included in the model's tool result. *)

type nonrec input_property_definition = {
  name : string;  (** Property display name from the client's catalog. *)
  options : string list option;
      (** Allowed display values; an empty list permits free-text suggestions. *)
}
(** A task property and the display values available for extraction. *)

val input_property_definition_of_yojson :
  Yojson.Safe.t -> input_property_definition

val yojson_of_input_property_definition :
  input_property_definition -> Yojson.Safe.t

val make_input_property_definition :
  name:string -> ?options:string list -> unit -> input_property_definition
(** A task property and the display values available for extraction. *)

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

val search_type_of_yojson : Yojson.Safe.t -> search_type
val yojson_of_search_type : search_type -> Yojson.Safe.t

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

val extract_input_request_of_yojson : Yojson.Safe.t -> extract_input_request
val yojson_of_extract_input_request : extract_input_request -> Yojson.Safe.t

val make_extract_input_request :
  intent:input_intent ->
  ?property_definitions:input_property_definition list ->
  reference_time:string ->
  revision:int ->
  ?search_type:search_type ->
  text:string ->
  time_zone:string ->
  unit ->
  extract_input_request
(** Draft snapshot and local context used to suggest editable destination fields. *)

type nonrec query_search_suggestions = {
  query : string option;
      (** Remaining keyword phrase after supported filters and instructions. *)
}
(** A topic for search types without additional supported facets. *)

val query_search_suggestions_of_yojson :
  Yojson.Safe.t -> query_search_suggestions

val yojson_of_query_search_suggestions :
  query_search_suggestions -> Yojson.Safe.t

val make_query_search_suggestions :
  ?query:string -> unit -> query_search_suggestions
(** A topic for search types without additional supported facets. *)

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

val task_search_suggestions_of_yojson : Yojson.Safe.t -> task_search_suggestions
val yojson_of_task_search_suggestions : task_search_suggestions -> Yojson.Safe.t

val make_task_search_suggestions :
  assignees:string list ->
  created_by:string list ->
  priority:string list ->
  ?query:string ->
  status:string list ->
  unit ->
  task_search_suggestions
(** Task facets match the shared search editor; assignee and creator are distinct. *)

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

val search_suggestions_of_yojson : Yojson.Safe.t -> search_suggestions
val yojson_of_search_suggestions : search_suggestions -> Yojson.Safe.t

type nonrec note_suggestions = {
  body : string option;
      (** Suggested Markdown content or outgoing message body. *)
  title : string option;  (** Suggested note, task, or event title. *)
}
(** Editable fields for note inference, before submission and identity resolution. *)

val note_suggestions_of_yojson : Yojson.Safe.t -> note_suggestions
val yojson_of_note_suggestions : note_suggestions -> Yojson.Safe.t

val make_note_suggestions :
  ?body:string -> ?title:string -> unit -> note_suggestions
(** Editable fields for note inference, before submission and identity resolution. *)

type nonrec input_property_suggestion = {
  name : string;  (** Property display name, never an authorized identifier. *)
  values : string list;
      (** Suggested display values, never authorized entity identifiers. *)
}
(** Suggested display values to resolve against a real task-property catalog. *)

val input_property_suggestion_of_yojson :
  Yojson.Safe.t -> input_property_suggestion

val yojson_of_input_property_suggestion :
  input_property_suggestion -> Yojson.Safe.t

val make_input_property_suggestion :
  name:string -> values:string list -> unit -> input_property_suggestion
(** Suggested display values to resolve against a real task-property catalog. *)

type nonrec task_suggestions = {
  body : string option;
      (** Suggested Markdown content or outgoing message body. *)
  due_date : string option;  (** Task deadline as a local ISO date. *)
  properties : input_property_suggestion list option;
      (** Display names/values that the client resolves against available task fields. *)
  title : string option;  (** Suggested note, task, or event title. *)
}
(** Editable fields for task inference, before submission and identity resolution. *)

val task_suggestions_of_yojson : Yojson.Safe.t -> task_suggestions
val yojson_of_task_suggestions : task_suggestions -> Yojson.Safe.t

val make_task_suggestions :
  ?body:string ->
  ?due_date:string ->
  ?properties:input_property_suggestion list ->
  ?title:string ->
  unit ->
  task_suggestions
(** Editable fields for task inference, before submission and identity resolution. *)

type nonrec message_suggestions = {
  body : string option;
      (** Suggested Markdown content or outgoing message body. *)
  recipients : string list option;
      (** Person or channel names for the client to resolve. *)
}
(** Editable fields for message inference, before submission and identity resolution. *)

val message_suggestions_of_yojson : Yojson.Safe.t -> message_suggestions
val yojson_of_message_suggestions : message_suggestions -> Yojson.Safe.t

val make_message_suggestions :
  ?body:string -> ?recipients:string list -> unit -> message_suggestions
(** Editable fields for message inference, before submission and identity resolution. *)

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

val input_suggestions_of_yojson : Yojson.Safe.t -> input_suggestions
val yojson_of_input_suggestions : input_suggestions -> Yojson.Safe.t

val make_input_suggestions_ai :
  suggestions:ai_suggestions -> unit -> input_suggestions
(** Editable ai fields. *)

val make_input_suggestions_search :
  suggestions:search_suggestions -> unit -> input_suggestions
(** Editable search fields. *)

val make_input_suggestions_email :
  suggestions:email_suggestions -> unit -> input_suggestions
(** Editable email fields. *)

val make_input_suggestions_note :
  suggestions:note_suggestions -> unit -> input_suggestions
(** Editable note fields. *)

val make_input_suggestions_task :
  suggestions:task_suggestions -> unit -> input_suggestions
(** Editable task fields. *)

val make_input_suggestions_calendar :
  suggestions:calendar_suggestions -> unit -> input_suggestions
(** Editable calendar fields. *)

val make_input_suggestions_message :
  suggestions:message_suggestions -> unit -> input_suggestions
(** Editable message fields. *)

type nonrec extract_input_response = {
  input_suggestions : input_suggestions;
      (** Destination and applicable editable fields, encoded together. *)
  revision : int;  (** Revision echoed from the extraction request. *)
}
(** Validated suggestions for a particular client draft revision. *)

val extract_input_response_of_yojson : Yojson.Safe.t -> extract_input_response
val yojson_of_extract_input_response : extract_input_response -> Yojson.Safe.t

val make_extract_input_response :
  input_suggestions:input_suggestions ->
  revision:int ->
  unit ->
  extract_input_response
(** Validated suggestions for a particular client draft revision. *)

(** Defines who can access an item through its share link. *)
type nonrec link_share =
  | Public
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

val link_share_of_yojson : Yojson.Safe.t -> link_share
val yojson_of_link_share : link_share -> Yojson.Safe.t

type nonrec link_task_request = {
  task_id : string;  (** The task document's id. *)
}
(** The task to link a session to. *)

val link_task_request_of_yojson : Yojson.Safe.t -> link_task_request
val yojson_of_link_task_request : link_task_request -> Yojson.Safe.t

val make_link_task_request : task_id:string -> unit -> link_task_request
(** The task to link a session to. *)

type nonrec linked_task_response = {
  pull_request_url : string option;
      (** The session's pull request, now linked to the task, if it has one. *)
  reference : string;
      (** Put this in the pull request description so GitHub activity reaches the task. *)
  task_id : string;  (** The task document's id. *)
}
(** The task a session is now linked to. *)

val linked_task_response_of_yojson : Yojson.Safe.t -> linked_task_response
val yojson_of_linked_task_response : linked_task_response -> Yojson.Safe.t

val make_linked_task_response :
  ?pull_request_url:string ->
  reference:string ->
  task_id:string ->
  unit ->
  linked_task_response
(** The task a session is now linked to. *)

(** Harness names accepted by the model discovery endpoint. *)
type nonrec model_harness_dto =
  | In_memory
  | Cursor
  | Macrod
  | Unknown of string  (** A value this SDK version does not know. *)

val model_harness_dto_of_yojson : Yojson.Safe.t -> model_harness_dto
val yojson_of_model_harness_dto : model_harness_dto -> Yojson.Safe.t

type nonrec load_agent_models_request = {
  harness : model_harness_dto;  (** Provider to probe. *)
  harness_id : string option;
      (** Required for macrod and forbidden for other targets. *)
}
(** HTTP request selecting one provider to probe. *)

val load_agent_models_request_of_yojson :
  Yojson.Safe.t -> load_agent_models_request

val yojson_of_load_agent_models_request :
  load_agent_models_request -> Yojson.Safe.t

val make_load_agent_models_request :
  harness:model_harness_dto ->
  ?harness_id:string ->
  unit ->
  load_agent_models_request
(** HTTP request selecting one provider to probe. *)

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

val load_agent_models_response_of_yojson :
  Yojson.Safe.t -> load_agent_models_response

val yojson_of_load_agent_models_response :
  load_agent_models_response -> Yojson.Safe.t

val make_load_agent_models_response :
  ?cached_at:string ->
  ?current_model:string ->
  models:agent_model_dto list ->
  status:agent_models_status_dto ->
  unit ->
  load_agent_models_response
(** Successful model-discovery response. *)

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

val log_frame_dto_of_yojson : Yojson.Safe.t -> log_frame_dto
val yojson_of_log_frame_dto : log_frame_dto -> Yojson.Safe.t

val make_log_frame_dto :
  content:Yojson.Safe.t -> direction:log_direction_dto -> unit -> log_frame_dto
(** The two fields \[[AgentSessionLogEntryDto]\] flattens in.

Schema only. Nothing constructs one: the entry serializes through
\[[Message]\], and this exists so the generated clients see [direction] and
[content] as named fields instead of an open map. A hand-built copy could
drift from the fold's wire format, and the point of the endpoint is that it
cannot - so this describes that format without being able to produce it. *)

(** Where the opened item goes. Neither replaces what the person is reading. *)
type nonrec ui_placement =
  | Beside_agent
  | New
  | Unknown of string  (** A value this SDK version does not know. *)

val ui_placement_of_yojson : Yojson.Safe.t -> ui_placement
val yojson_of_ui_placement : ui_placement -> Yojson.Safe.t

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

val open_in_app_of_yojson : Yojson.Safe.t -> open_in_app
val yojson_of_open_in_app : open_in_app -> Yojson.Safe.t

val make_open_in_app :
  execution_id:execution_id ->
  path:string ->
  ?placement:ui_placement ->
  unit ->
  open_in_app
(** Open an item in the prompting person's app tab. *)

type nonrec present_view = {
  execution_id : execution_id option;
  view : Yojson.Safe.t;
      (** A dynamic-UI view, in the format of the PresentView schema in
ExecuteCode's description. *)
}
(** A view to present. *)

val present_view_of_yojson : Yojson.Safe.t -> present_view
val yojson_of_present_view : present_view -> Yojson.Safe.t

val make_present_view :
  ?execution_id:execution_id -> view:Yojson.Safe.t -> unit -> present_view
(** A view to present. *)

type nonrec preview_agent_sessions_request = {
  session_ids : string list;
      (** The sessions to preview. Duplicates are collapsed server-side; at most
\[[MAX_PREVIEW_SESSION_IDS]\](crate::domain::model::MAX_PREVIEW_SESSION_IDS)
distinct ids per request. *)
}
(** Request body for [POST /agent-sessions/preview].

Clients serialize this, so both derives are used. *)

val preview_agent_sessions_request_of_yojson :
  Yojson.Safe.t -> preview_agent_sessions_request

val yojson_of_preview_agent_sessions_request :
  preview_agent_sessions_request -> Yojson.Safe.t

val make_preview_agent_sessions_request :
  session_ids:string list -> unit -> preview_agent_sessions_request
(** Request body for [POST /agent-sessions/preview].

Clients serialize this, so both derives are used. *)

type nonrec preview_agent_sessions_response = {
  previews : agent_session_preview_dto list;
      (** What the caller may see of each requested session. *)
}
(** Response body for [POST /agent-sessions/preview]: one entry per distinct
requested id, in no particular order.

Clients deserialize this, so both derives are used. *)

val preview_agent_sessions_response_of_yojson :
  Yojson.Safe.t -> preview_agent_sessions_response

val yojson_of_preview_agent_sessions_response :
  preview_agent_sessions_response -> Yojson.Safe.t

val make_preview_agent_sessions_response :
  previews:agent_session_preview_dto list ->
  unit ->
  preview_agent_sessions_response
(** Response body for [POST /agent-sessions/preview]: one entry per distinct
requested id, in no particular order.

Clients deserialize this, so both derives are used. *)

(** Who associated a pull request with a session. *)
type nonrec pull_request_link_source =
  | Agent
  | User
  | Unknown of string  (** A value this SDK version does not know. *)

val pull_request_link_source_of_yojson :
  Yojson.Safe.t -> pull_request_link_source

val yojson_of_pull_request_link_source :
  pull_request_link_source -> Yojson.Safe.t

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

val pull_request_linked_session_of_yojson :
  Yojson.Safe.t -> pull_request_linked_session

val yojson_of_pull_request_linked_session :
  pull_request_linked_session -> Yojson.Safe.t

val make_pull_request_linked_session :
  ?origin_message_id:string ->
  session_id:string ->
  source:pull_request_link_source ->
  ?thread_parent:message_parent ->
  unit ->
  pull_request_linked_session
(** A session linked to a pull request, as a viewer of that session sees it. *)

type nonrec pull_request_sessions = {
  github_key : string;  (** The pull request's [owner/repo/pull/number] key. *)
  sessions : pull_request_linked_session list;
      (** Linked sessions the caller can view, oldest link first. *)
  url : string;  (** The requested pull request URL, canonicalized. *)
}
(** The sessions linked to one pull request that the caller can view. *)

val pull_request_sessions_of_yojson : Yojson.Safe.t -> pull_request_sessions
val yojson_of_pull_request_sessions : pull_request_sessions -> Yojson.Safe.t

val make_pull_request_sessions :
  github_key:string ->
  sessions:pull_request_linked_session list ->
  url:string ->
  unit ->
  pull_request_sessions
(** The sessions linked to one pull request that the caller can view. *)

type nonrec pull_request_sessions_response = {
  session_ids : string list;
      (** Sessions associated with the pull request that the caller can view. *)
}
(** The sessions associated with a pull request. *)

val pull_request_sessions_response_of_yojson :
  Yojson.Safe.t -> pull_request_sessions_response

val yojson_of_pull_request_sessions_response :
  pull_request_sessions_response -> Yojson.Safe.t

val make_pull_request_sessions_response :
  session_ids:string list -> unit -> pull_request_sessions_response
(** The sessions associated with a pull request. *)

type nonrec pull_request_url = {
  url : string;
      (** The pull request's GitHub URL, such as [https://github.com/owner/repo/pull/12]. *)
}
(** A GitHub pull request, by URL. *)

val pull_request_url_of_yojson : Yojson.Safe.t -> pull_request_url
val yojson_of_pull_request_url : pull_request_url -> Yojson.Safe.t

val make_pull_request_url : url:string -> unit -> pull_request_url
(** A GitHub pull request, by URL. *)

type nonrec pull_request_urls = {
  urls : string list;  (** Pull request GitHub URLs, at most 100. *)
}
(** GitHub pull requests, by URL. *)

val pull_request_urls_of_yojson : Yojson.Safe.t -> pull_request_urls
val yojson_of_pull_request_urls : pull_request_urls -> Yojson.Safe.t

val make_pull_request_urls : urls:string list -> unit -> pull_request_urls
(** GitHub pull requests, by URL. *)

type nonrec pull_requests_sessions_response = {
  pull_requests : pull_request_sessions list;
      (** One entry per requested pull request, in request order. *)
}
(** The sessions associated with each requested pull request. *)

val pull_requests_sessions_response_of_yojson :
  Yojson.Safe.t -> pull_requests_sessions_response

val yojson_of_pull_requests_sessions_response :
  pull_requests_sessions_response -> Yojson.Safe.t

val make_pull_requests_sessions_response :
  pull_requests:pull_request_sessions list ->
  unit ->
  pull_requests_sessions_response
(** The sessions associated with each requested pull request. *)

type nonrec rename_agent_session_request = {
  name : string;
      (** New user-facing name. Leading and trailing whitespace is discarded. *)
}
(** Request body for renaming an agent session. *)

val rename_agent_session_request_of_yojson :
  Yojson.Safe.t -> rename_agent_session_request

val yojson_of_rename_agent_session_request :
  rename_agent_session_request -> Yojson.Safe.t

val make_rename_agent_session_request :
  name:string -> unit -> rename_agent_session_request
(** Request body for renaming an agent session. *)

type nonrec retry_agent_conversation_turn_request = {
  action_id : string;  (** Current failed attempt identity. *)
}
(** The attempt the user saw and chose to retry; prevents double-click reruns. *)

val retry_agent_conversation_turn_request_of_yojson :
  Yojson.Safe.t -> retry_agent_conversation_turn_request

val yojson_of_retry_agent_conversation_turn_request :
  retry_agent_conversation_turn_request -> Yojson.Safe.t

val make_retry_agent_conversation_turn_request :
  action_id:string -> unit -> retry_agent_conversation_turn_request
(** The attempt the user saw and chose to retry; prevents double-click reruns. *)

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

val review_decision_of_yojson : Yojson.Safe.t -> review_decision
val yojson_of_review_decision : review_decision -> Yojson.Safe.t

val make_review_decision_edit :
  draft:Yojson.Safe.t ->
  item:string ->
  revision:int64 ->
  unit ->
  review_decision
(** Save one edited draft. *)

val make_review_decision_submit :
  items:string list -> revision:int64 -> unit -> review_decision
(** Send/create selected items, or all pending items when empty. *)

val make_review_decision_dismiss :
  items:string list -> revision:int64 -> unit -> review_decision
(** Dismiss selected pending items, or all pending items when empty. *)

type nonrec review_decision_context = {
  by : string;  (** Authenticated account holder. *)
  items : string list;  (** Items selected by this decision. *)
  revision : int64;
      (** Revision claimed by this batch, used in notification deduplication. *)
  via : decision_via;  (** Entry surface. *)
}
(** Facts about the most recent account-holder decision. *)

val review_decision_context_of_yojson : Yojson.Safe.t -> review_decision_context
val yojson_of_review_decision_context : review_decision_context -> Yojson.Safe.t

val make_review_decision_context :
  by:string ->
  items:string list ->
  revision:int64 ->
  via:decision_via ->
  unit ->
  review_decision_context
(** Facts about the most recent account-holder decision. *)

type nonrec review_id = string
(** Persisted review identity. *)

val review_id_of_yojson : Yojson.Safe.t -> review_id
val yojson_of_review_id : review_id -> Yojson.Safe.t

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

val review_record_of_yojson : Yojson.Safe.t -> review_record
val yojson_of_review_record : review_record -> Yojson.Safe.t

val make_review_record :
  acting_user:string ->
  ?decision:review_decision_context ->
  ?execution_id:execution_id ->
  id:review_id ->
  ?presented_at:int64 ->
  revision:int64 ->
  session_id:string ->
  title:string ->
  updated_at:int64 ->
  unit ->
  review_record
(** Full UI record, fetched outside the model context. *)

type nonrec sandbox_size_body = {
  size : sandbox_size;  (** Named compute tier. *)
}
(** Request or response body for a named sandbox size. *)

val sandbox_size_body_of_yojson : Yojson.Safe.t -> sandbox_size_body
val yojson_of_sandbox_size_body : sandbox_size_body -> Yojson.Safe.t

val make_sandbox_size_body : size:sandbox_size -> unit -> sandbox_size_body
(** Request or response body for a named sandbox size. *)

type nonrec session_auto_archive_response = {
  auto_archived_at : string option;
      (** When a trigger first archived the session. Kept when a person restores it: a session
archives itself at most once. *)
  defaults : auto_archive_preferences_body;
      (** The owner's defaults, which apply where the session has no choice of its own. *)
  overrides : auto_archive_overrides_body;  (** The session's own choices. *)
}
(** A session's auto-archive settings and history. *)

val session_auto_archive_response_of_yojson :
  Yojson.Safe.t -> session_auto_archive_response

val yojson_of_session_auto_archive_response :
  session_auto_archive_response -> Yojson.Safe.t

val make_session_auto_archive_response :
  ?auto_archived_at:string ->
  defaults:auto_archive_preferences_body ->
  overrides:auto_archive_overrides_body ->
  unit ->
  session_auto_archive_response
(** A session's auto-archive settings and history. *)

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

val session_pull_request_link_of_yojson :
  Yojson.Safe.t -> session_pull_request_link

val yojson_of_session_pull_request_link :
  session_pull_request_link -> Yojson.Safe.t

val make_session_pull_request_link :
  created_at:string ->
  github_key:string ->
  ?linked_by:string ->
  source:pull_request_link_source ->
  url:string ->
  unit ->
  session_pull_request_link
(** A pull request associated with a session. *)

type nonrec session_pull_requests_response = {
  pull_requests : session_pull_request_link list;
      (** Pull requests, oldest link first. *)
}
(** The pull requests associated with a session. *)

val session_pull_requests_response_of_yojson :
  Yojson.Safe.t -> session_pull_requests_response

val yojson_of_session_pull_requests_response :
  session_pull_requests_response -> Yojson.Safe.t

val make_session_pull_requests_response :
  pull_requests:session_pull_request_link list ->
  unit ->
  session_pull_requests_response
(** The pull requests associated with a session. *)

type nonrec set_agent_session_archived_request = {
  archived : bool;  (** Archive the session, or restore it. *)
}
(** Request body for archiving or unarchiving an agent session. *)

val set_agent_session_archived_request_of_yojson :
  Yojson.Safe.t -> set_agent_session_archived_request

val yojson_of_set_agent_session_archived_request :
  set_agent_session_archived_request -> Yojson.Safe.t

val make_set_agent_session_archived_request :
  archived:bool -> unit -> set_agent_session_archived_request
(** Request body for archiving or unarchiving an agent session. *)

type nonrec share_permission_v2 = {
  channel_share_permissions : channel_share_permission list option;
      (** The channel share permissions for the item *)
  id : string;  (** The share permission id *)
  link_share : link_share option;
  link_share_access_level : access_level option;
  owner : string;  (** The owner of the item *)
  team_share_access_level : access_level option;
}

val share_permission_v2_of_yojson : Yojson.Safe.t -> share_permission_v2
val yojson_of_share_permission_v2 : share_permission_v2 -> Yojson.Safe.t

val make_share_permission_v2 :
  ?channel_share_permissions:channel_share_permission list ->
  id:string ->
  ?link_share:link_share ->
  ?link_share_access_level:access_level ->
  owner:string ->
  ?team_share_access_level:access_level ->
  unit ->
  share_permission_v2

type nonrec start_fresh_agent_conversation_request = {
  session_id : string;
      (** Current session id shown in the conversation metadata. *)
}
(** The session the user is choosing to leave behind. *)

val start_fresh_agent_conversation_request_of_yojson :
  Yojson.Safe.t -> start_fresh_agent_conversation_request

val yojson_of_start_fresh_agent_conversation_request :
  start_fresh_agent_conversation_request -> Yojson.Safe.t

val make_start_fresh_agent_conversation_request :
  session_id:string -> unit -> start_fresh_agent_conversation_request
(** The session the user is choosing to leave behind. *)

(** Why a command was not sent. *)
type nonrec ui_decline_reason =
  | Turned_off
  | Not_allowed_route
  | Rate_limited
  | Unknown of string  (** A value this SDK version does not know. *)

val ui_decline_reason_of_yojson : Yojson.Safe.t -> ui_decline_reason
val yojson_of_ui_decline_reason : ui_decline_reason -> Yojson.Safe.t

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

val ui_command_outcome_of_yojson : Yojson.Safe.t -> ui_command_outcome
val yojson_of_ui_command_outcome : ui_command_outcome -> Yojson.Safe.t

val make_ui_command_outcome_sent :
  command_id:string -> unit -> ui_command_outcome
(** A connection of the prompting person took it. Their tab opens it
unless it refuses the route or the person is somewhere else. *)

val make_ui_command_outcome_declined :
  reason:ui_decline_reason -> unit -> ui_command_outcome
(** Not sent, for the given reason. *)

type nonrec update_operation =
  | Add
  | Remove
  | Replace
  | Unknown of string  (** A value this SDK version does not know. *)

val update_operation_of_yojson : Yojson.Safe.t -> update_operation
val yojson_of_update_operation : update_operation -> Yojson.Safe.t

type nonrec update_channel_share_permission = {
  access_level : access_level option;
  channel_id : string;  (** The channel id *)
  operation : update_operation;
      (** The type of operation to be performed on the chanel share permission
You can add, remove or replace and existing permission *)
}

val update_channel_share_permission_of_yojson :
  Yojson.Safe.t -> update_channel_share_permission

val yojson_of_update_channel_share_permission :
  update_channel_share_permission -> Yojson.Safe.t

val make_update_channel_share_permission :
  ?access_level:access_level ->
  channel_id:string ->
  operation:update_operation ->
  unit ->
  update_channel_share_permission

type nonrec update_share_permission_request_v2 = {
  channel_share_permissions : update_channel_share_permission list option;
      (** Any channel share permissions to be created/updated/removed *)
  link_share : link_share option;
  link_share_access_level : access_level option;
  team_share_access_level : access_level option;
}

val update_share_permission_request_v2_of_yojson :
  Yojson.Safe.t -> update_share_permission_request_v2

val yojson_of_update_share_permission_request_v2 :
  update_share_permission_request_v2 -> Yojson.Safe.t

val make_update_share_permission_request_v2 :
  ?channel_share_permissions:update_channel_share_permission list ->
  ?link_share:link_share ->
  ?link_share_access_level:access_level ->
  ?team_share_access_level:access_level ->
  unit ->
  update_share_permission_request_v2

type nonrec voice = {
  accent : string;  (** The provider's accent label. *)
  languages : string list;  (** Languages the voice speaks. *)
  model : string;  (** The model to save as the agent's voice. *)
  name : string;  (** The provider's name for the voice. *)
  tags : string list;  (** The provider's gender and character tags. *)
}
(** One voice of the provider's catalog. *)

val voice_of_yojson : Yojson.Safe.t -> voice
val yojson_of_voice : voice -> Yojson.Safe.t

val make_voice :
  accent:string ->
  languages:string list ->
  model:string ->
  name:string ->
  tags:string list ->
  unit ->
  voice
(** One voice of the provider's catalog. *)

type nonrec warm_agent_session_request = {
  id : string;
      (** Id reserved by this browser for its next in-memory conversation. *)
}
(** A client-minted id deduplicates warm calls without creating a conversation. *)

val warm_agent_session_request_of_yojson :
  Yojson.Safe.t -> warm_agent_session_request

val yojson_of_warm_agent_session_request :
  warm_agent_session_request -> Yojson.Safe.t

val make_warm_agent_session_request :
  id:string -> unit -> warm_agent_session_request
(** A client-minted id deduplicates warm calls without creating a conversation. *)

type nonrec warm_agent_session_response = {
  session : agent_session_response option;
}
(** A bounded best-effort warm attempt; absence means normal creation should proceed. *)

val warm_agent_session_response_of_yojson :
  Yojson.Safe.t -> warm_agent_session_response

val yojson_of_warm_agent_session_response :
  warm_agent_session_response -> Yojson.Safe.t

val make_warm_agent_session_response :
  ?session:agent_session_response -> unit -> warm_agent_session_response
(** A bounded best-effort warm attempt; absence means normal creation should proceed. *)

type nonrec work_registration_response = {
  account_id : string;  (** The account whose work this is. *)
  agent_session_id : string;  (** The session registered. *)
  id : string;  (** The registration. *)
  registered_at : string;  (** When the account registered it. *)
}
(** One account's active registration of one session as its work. *)

val work_registration_response_of_yojson :
  Yojson.Safe.t -> work_registration_response

val yojson_of_work_registration_response :
  work_registration_response -> Yojson.Safe.t

val make_work_registration_response :
  account_id:string ->
  agent_session_id:string ->
  id:string ->
  registered_at:string ->
  unit ->
  work_registration_response
(** One account's active registration of one session as its work. *)

val get_agent_auto_archive_preferences :
  unit ->
  ( auto_archive_preferences_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-auto-archive-preferences]

Read which triggers archive the caller's sessions by default. *)

val put_agent_auto_archive_preferences :
  on_pull_request_merged:bool ->
  on_runtime_closed:bool ->
  unit ->
  ( auto_archive_preferences_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /agent-auto-archive-preferences]

Replace which triggers archive the caller's sessions by default. *)

val discover_agent_capabilities_handler :
  harness:capability_harness_dto ->
  ?harness_id:string ->
  ?model:string ->
  unit ->
  ( discover_agent_capabilities_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-capabilities/discover]

Probe one provider's ACP session configuration without persisting a session. *)

val get_agent_coding_preferences :
  unit ->
  ( coding_preferences_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-coding-preferences]

Read what the caller's new coding sessions are told to do beyond their assignment. *)

val put_agent_coding_preferences :
  create_tasks:bool ->
  open_pull_requests:bool ->
  unit ->
  ( coding_preferences_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /agent-coding-preferences]

Replace the caller's coding preferences. *)

val list_agent_conversations :
  channel_id:string ->
  unit ->
  ( agent_conversations_dto,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-conversations/{channel_id}]

The agent conversations in a channel the caller may see. Ordinary channels
and other people's conversations list none. *)

val start_fresh_agent_conversation :
  channel_id:string ->
  bot_id:string ->
  session_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /agent-conversations/{channel_id}/{bot_id}/start-fresh]

Start a fresh agent context, retaining the channel transcript. *)

val retry_agent_conversation_turn :
  channel_id:string ->
  bot_id:string ->
  source:string ->
  action_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /agent-conversations/{channel_id}/{bot_id}/turns/{source}/retry]

Explicitly retry a failed message in the conversation's current session. *)

val choose_agent_mode :
  prompt:string ->
  unit ->
  ( agent_mode_choice_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-mode-choice]

Choose whether a composer prompt goes to a chat or a coding agent. *)

val load_agent_models_handler :
  harness:model_harness_dto ->
  ?harness_id:string ->
  unit ->
  ( load_agent_models_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-models/load]

Probe one provider's model catalog without creating an agent session. *)

val list_agent_repositories :
  unit ->
  ( agent_repositories_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-repositories]

List the GitHub repositories the caller can select for a coding session. *)

val list_agent_repository_branches :
  repo_url:string ->
  unit ->
  ( agent_repository_branches_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-repositories/branches]

List the branches on one repository the caller can start a session from. *)

val get_agent_sandbox_size :
  unit ->
  ( sandbox_size_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sandbox-size]

Read the caller's default sandbox size for new [@coder] sessions. *)

val put_agent_sandbox_size :
  size:sandbox_size ->
  unit ->
  ( sandbox_size_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /agent-sandbox-size]

Set the caller's default sandbox size for the next [@coder] mention. *)

val create_agent_session :
  ?bot_id:string ->
  ?id:string ->
  ?instructions:string ->
  ?model:string ->
  ?owner:string ->
  ?prompt:string ->
  ?prompt_action_id:agent_action_id ->
  ?prompt_attachments:prompt_attachment list ->
  ?prompt_client_id:string ->
  ?repo_branch:string ->
  ?repo_url:string ->
  ?thread:create_session_thread ->
  ?workspace:string ->
  unit ->
  ( create_agent_session_response,
    ai_admission_error_body )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions]

Open an agent session served by an external runtime. *)

val agent_sessions_for_pull_request :
  url:string ->
  unit ->
  ( pull_request_sessions_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/by-pull-request]

List the sessions associated with a pull request that the caller can view. *)

val agent_sessions_for_pull_requests :
  urls:string list ->
  unit ->
  ( pull_requests_sessions_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/by-pull-requests]

List the sessions associated with each of up to 100 pull requests that the caller can view,
with the thread each session was started from. *)

val preview_agent_sessions :
  session_ids:string list ->
  unit ->
  ( preview_agent_sessions_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/preview]

Preview a batch of agent sessions for rendering chips. *)

val list_agent_session_updates :
  unit ->
  ( agent_updates,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/updates]

The caller's coding sessions waiting for their answer, or stalled for over 20 minutes,
newest activity first. *)

val warm_agent_session_handler :
  id:string ->
  unit ->
  ( warm_agent_session_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/warm]

Prepare MCP connections without sending a prompt or creating a visible list row. *)

val get_agent_session :
  session_id:string ->
  unit ->
  ( agent_session_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}]

Get an agent session by id. *)

val delete_agent_session :
  session_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /agent-sessions/{session_id}]

Delete an agent session and its live resources. *)

val get_agent_session_activity :
  session_id:string ->
  ?agent_correlation_id:string ->
  ?before_at:string ->
  ?before_id:string ->
  ?limit:int ->
  unit ->
  ( agent_activity_page,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/activity]

Read activity using the same visibility capability as the session transcript. *)

val report_agent_session_app_connected :
  session_id:string ->
  app_slug:string ->
  ?action_id:agent_action_id ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/app-connections]

Continue the session now that its owner connected an app it asked for. *)

val set_agent_session_archived :
  session_id:string ->
  archived:bool ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PUT /agent-sessions/{session_id}/archived]

Archive or unarchive an agent session. *)

val get_agent_session_auto_archive :
  session_id:string ->
  unit ->
  ( session_auto_archive_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/auto-archive]

Read a session's auto-archive settings and whether a trigger archived it. *)

val put_agent_session_auto_archive :
  session_id:string ->
  ?on_pull_request_merged:bool ->
  ?on_runtime_closed:bool ->
  unit ->
  ( auto_archive_overrides_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /agent-sessions/{session_id}/auto-archive]

Replace a session's own auto-archive choices. Owner only. *)

val get_agent_session_changes :
  session_id:string ->
  unit ->
  ( agent_session_changes_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/changes]

The latest captured changes of an agent session: the changed files with
statuses and line counts, and how the latest capture attempt went. *)

val get_agent_session_changes_patch :
  session_id:string ->
  unit ->
  ( agent_session_changes_patch_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/changes/patch]

The unified diff behind the session's latest changeset. *)

val refresh_agent_session_changes :
  session_id:string ->
  unit ->
  ( agent_session_changes_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/changes/refresh]

Capture the session's changes again now. Answers at once with the state
as it stands; the capture runs on and viewers are told when it lands. *)

val get_code_execution :
  session_id:string ->
  execution_id:string ->
  unit ->
  ( execution_record,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}]

Fetch one execution only after the caller has obtained view access to its session. *)

val list_execution_connected_apps :
  session_id:string ->
  execution_id:string ->
  unit ->
  ( connected_app list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps]

List the connected apps and custom MCP servers the session's agent may use. *)

val discover_connected_apps :
  session_id:string ->
  execution_id:string ->
  body:discovery_request ->
  unit ->
  ( discover_connectors_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/discover]

Search the connectable app catalog, or inspect one app's tools and connection status. *)

val add_connected_mcp_server :
  session_id:string ->
  execution_id:string ->
  server_name:string ->
  url:string ->
  unit ->
  ( connect_mcp_server_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/servers]

Add a custom MCP server to the execution account's connections. *)

val search_connected_app_tools :
  session_id:string ->
  execution_id:string ->
  query:string ->
  unit ->
  ( connected_tool_search,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/tools]

Find tools across the agent's connected apps by keywords. *)

val call_connected_app_tool :
  session_id:string ->
  execution_id:string ->
  kind:connected_app_kind ->
  key:string ->
  tool:string ->
  ?arguments:Yojson.Safe.t ->
  unit ->
  ( connected_tool_result,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/{kind}/{key}/calls]

Call one tool of a connected app as the execution's account. *)

val list_connected_app_tools :
  session_id:string ->
  execution_id:string ->
  kind:connected_app_kind ->
  key:string ->
  unit ->
  ( connected_tool list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/{kind}/{key}/tools]

List the tools one connected app serves. *)

val list_execution_reviews :
  session_id:string ->
  execution_id:string ->
  unit ->
  ( review_record list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/code-executions/{execution_id}/reviews]

List blocks created during an execution, including interrupted executions. *)

val control_agent_session :
  session_id:string ->
  body:control_request ->
  unit ->
  (control_response, ai_admission_error_body) Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/control]

Perform a control operation on a live agent session. *)

val get_agent_session_log :
  session_id:string ->
  unit ->
  ( agent_session_log_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/log]

The raw protocol log of one agent session. *)

val get_agent_session_folded_log :
  session_id:string ->
  unit ->
  ( agent_session_folded_log_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/log/folded]

One agent session's history folded into renderable messages: the same
fold the web client runs over \[[get_agent_session_log_handler]\]'s frames. *)

val rename_agent_session :
  session_id:string ->
  name:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PUT /agent-sessions/{session_id}/name]

Rename an agent session. *)

val get_agent_session_permissions :
  session_id:string ->
  unit ->
  ( share_permission_v2,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/permissions]

Read sharing settings for a session the caller can view. *)

val update_agent_session_permissions :
  session_id:string ->
  ?channel_share_permissions:update_channel_share_permission list ->
  ?link_share:link_share ->
  ?link_share_access_level:access_level ->
  ?team_share_access_level:access_level ->
  unit ->
  ( share_permission_v2,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PATCH /agent-sessions/{session_id}/permissions]

Update link, channel, or team sharing after owner authorization. *)

val list_agent_session_pull_requests :
  session_id:string ->
  unit ->
  ( session_pull_requests_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/pull-requests]

List the pull requests associated with a session the caller can view. *)

val link_agent_session_pull_request :
  session_id:string ->
  url:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PUT /agent-sessions/{session_id}/pull-requests]

Link a pull request to a session the caller can edit. *)

val unlink_agent_session_pull_request :
  session_id:string ->
  url:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /agent-sessions/{session_id}/pull-requests]

Unlink a pull request a person linked to a session the caller can edit. The pull request
the session's agent opened stays linked. *)

val get_agent_session_queue :
  session_id:string ->
  unit ->
  ( agent_session_queue_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/queue]

The actions waiting to dispatch in this session, oldest first. *)

val edit_queued_action :
  session_id:string ->
  action_id:string ->
  prompt:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PUT /agent-sessions/{session_id}/queue/{action_id}]

Replace a queued prompt's text before it dispatches. *)

val remove_queued_action :
  session_id:string ->
  action_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /agent-sessions/{session_id}/queue/{action_id}]

Remove a queued action before it dispatches. There is no un-sending: an
action that already went out answers 404. *)

val steer_queued_action :
  session_id:string ->
  action_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/queue/{action_id}/steer]

Run a queued action next. Moves it ahead of the rest of the queue and
cancels the turn in flight, so this entry dispatches when that turn ends. *)

val create_session_review :
  session_id:string ->
  title:string ->
  ?execution_id:execution_id ->
  unit ->
  ( review_record,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/reviews]

Persist a review without keeping the agent turn blocked. *)

val get_session_review :
  session_id:string ->
  review_id:string ->
  unit ->
  ( review_record,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-sessions/{session_id}/reviews/{review_id}]

Read a persisted interactive block. *)

val decide_session_review :
  session_id:string ->
  review_id:string ->
  body:review_decision ->
  unit ->
  ( review_record,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/reviews/{review_id}]

Save edits or atomically claim the exact draft revision the user submitted. *)

val put_agent_session_sandbox_size :
  session_id:string ->
  size:sandbox_size ->
  unit ->
  ( sandbox_size_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /agent-sessions/{session_id}/sandbox-size]

Resize this session's sandbox and remember the size as the owner's default. *)

val link_agent_session_task :
  session_id:string ->
  task_id:string ->
  unit ->
  ( linked_task_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /agent-sessions/{session_id}/task]

Link a session the caller owns to a task they can view, replacing any earlier link. The
session's pull request, now or later, is linked to the task. *)

val answer_agent_session_tool_approval :
  session_id:string ->
  approval_id:string ->
  answer:tool_approval_answer_dto ->
  unit ->
  ( answer_tool_approval_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/tool-approvals/{approval_id}]

Answer a tool call the agent made in a turn somebody other than the
session's owner prompted. Approve and deny are the owner's; cancel is
anyone's with edit access. *)

val open_in_app :
  session_id:string ->
  execution_id:execution_id ->
  path:string ->
  ?placement:ui_placement ->
  unit ->
  ( ui_command_outcome,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/ui-commands]

Open an item in a new pane of the app tab the person who prompted the
running turn typed in. Only a running execution of the session's current
turn may send, as the account it acts as. *)

val present_session_view :
  session_id:string ->
  view:Yojson.Safe.t ->
  ?execution_id:execution_id ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /agent-sessions/{session_id}/views]

Present a view in the session: a review with nothing saved. *)

val register_agent_session_work :
  session_id:string ->
  unit ->
  ( work_registration_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /agent-sessions/{session_id}/work-registration]

Register a session as the caller's work. Requires edit access. Repeating returns the active
registration. Registering does not share the session: viewers who cannot open it do not see
it, so share it too. *)

val unregister_agent_session_work :
  session_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /agent-sessions/{session_id}/work-registration]

End the caller's own registration of a session. Repeating does nothing. It touches only the
caller's own row, so it needs no access to the session: losing access must not strand it. *)

val list_agent_work_registrations :
  unit ->
  ( work_registration_response list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /agent-work-registrations]

List the caller's active registrations of sessions they can still view, newest first. *)

val list_coding_agents :
  unit ->
  ( coding_agents_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /coding-agents]

List the coding agents the caller can start a session as: the same
personas the [ListCodingAgents] tool offers, including built-in ones whose
runtime the caller has connected (Cursor once its key is saved). *)

val get_claude_mode :
  harness_id:string ->
  unit ->
  ( claude_mode_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /harnesses/{harness_id}/claude-mode]

How Claude Code on the computer is paid for. *)

val start_claude_sign_in :
  harness_id:string ->
  unit ->
  ( claude_sign_in_started,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /harnesses/{harness_id}/claude-sign-in]

Start a Claude sign-in on the computer and return its URL. *)

val complete_claude_sign_in :
  harness_id:string ->
  code:string ->
  unit ->
  ( claude_signed_in,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /harnesses/{harness_id}/claude-sign-in/complete]

Finish the Claude sign-in with what the user pasted. *)

val claude_sign_out :
  harness_id:string ->
  unit ->
  ( claude_mode_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /harnesses/{harness_id}/claude-sign-out]

Forget the computer's Claude credential and return it to Macro credits. *)

val classify :
  revision:int ->
  text:string ->
  unit ->
  ( classify_input_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /universal_input/classify]

Classify a draft for the authenticated user. *)

val extract :
  intent:input_intent ->
  reference_time:string ->
  revision:int ->
  text:string ->
  time_zone:string ->
  ?property_definitions:input_property_definition list ->
  ?search_type:search_type ->
  unit ->
  ( extract_input_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /universal_input/extract]

Extract editable fields for the authenticated user. *)

val get_agent_voices :
  unit -> (voice list, error_response) Macro_sdk_runtime.Request.t
(** [GET /voices]

The voices an agent teammate can speak with on calls. Team admins only. *)

val get_agent_voice_sample :
  model:string -> unit -> (string, error_response) Macro_sdk_runtime.Request.t
(** [GET /voices/{model}/sample]

A catalog voice saying a fixed line, as WAV. Team admins only; the first
play of each voice is billed to the admin's team. *)
