(* Generated from packages/sdk/specs/notification.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

(** Whose account an agent signs in to: the Postgres [agent_provider] enum of
[provider_accounts.provider] and [harness_account_logins.provider]. New
providers add a value there. *)
type nonrec agent_provider =
  | Claude
  | Unknown of string  (** A value this SDK version does not know. *)

let agent_provider_of_yojson : Yojson.Safe.t -> agent_provider =
 fun json ->
  match Json.string json with "claude" -> Claude | other -> Unknown other

and yojson_of_agent_provider : agent_provider -> Yojson.Safe.t =
 fun value ->
  match value with Claude -> `String "claude" | Unknown other -> `String other

type nonrec agent_session_origin_parent = {
  id : string;  (** The parent entity id. *)
  type_ : string;  (** [channel], [document], or [initiative]. *)
}
(** The session an agent-session notification is about, and where its magic
chip lives when it was opened from a thread.

The conversation an agent session was opened from: a channel, document,
or initiative. Spelled like the message API's parent for client routing. *)

let agent_session_origin_parent_of_yojson :
    Yojson.Safe.t -> agent_session_origin_parent =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" Json.string;
    type_ = Json.required fields "type" Json.string;
  }

and yojson_of_agent_session_origin_parent :
    agent_session_origin_parent -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (Json.of_string value.id));
      ("type", Some (Json.of_string value.type_));
    ]

let make_agent_session_origin_parent ~(id : string) ~(type_ : string) () =
  ({ id; type_ } : agent_session_origin_parent)

type nonrec agent_session_mentioned_metadata = {
  announcement_message_id : string option;
      (** The magic-chip message for the turn in question, when one was posted. *)
  bot_id : string;
      (** The bot the session runs for. A string on the wire: system bots have
fixed ids like [00000000-0000-0000-0000-00000000a2a2], which are not
RFC 4122 uuids and fail a [format: uuid] check on the client. *)
  bot_name : string;
      (** The bot's display name; agent notifications have no user sender, so
this is who they read as being from. *)
  channel_id : string option;
      (** The channel the session was opened from, when it was opened from a
channel thread. *)
  parent : agent_session_origin_parent option;
  session_id : string;  (** The session; what a click opens. *)
  session_name : string;  (** The session's name at the time of the event. *)
  thread_id : string option;
      (** The thread the session was opened from, when it was. *)
  action_id : string;  (** The action carrying the prompt. *)
  mentioned_by : string option;
      (** Who wrote the prompt, absent when a bot acted on nobody's behalf. *)
}
(** Someone named the recipient in a prompt to an agent session. *)

let agent_session_mentioned_metadata_of_yojson :
    Yojson.Safe.t -> agent_session_mentioned_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    announcement_message_id =
      Json.optional fields "announcementMessageId" Json.string;
    bot_id = Json.required fields "botId" Json.string;
    bot_name = Json.required fields "botName" Json.string;
    channel_id = Json.optional fields "channelId" Json.string;
    parent = Json.optional fields "parent" agent_session_origin_parent_of_yojson;
    session_id = Json.required fields "sessionId" Json.string;
    session_name = Json.required fields "sessionName" Json.string;
    thread_id = Json.optional fields "threadId" Json.string;
    action_id = Json.required fields "actionId" Json.string;
    mentioned_by = Json.optional fields "mentionedBy" Json.string;
  }

and yojson_of_agent_session_mentioned_metadata :
    agent_session_mentioned_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "announcementMessageId",
        Option.map Json.of_string value.announcement_message_id );
      ("botId", Some (Json.of_string value.bot_id));
      ("botName", Some (Json.of_string value.bot_name));
      ("channelId", Option.map Json.of_string value.channel_id);
      ("parent", Option.map yojson_of_agent_session_origin_parent value.parent);
      ("sessionId", Some (Json.of_string value.session_id));
      ("sessionName", Some (Json.of_string value.session_name));
      ("threadId", Option.map Json.of_string value.thread_id);
      ("actionId", Some (Json.of_string value.action_id));
      ("mentionedBy", Option.map Json.of_string value.mentioned_by);
    ]

let make_agent_session_mentioned_metadata ?announcement_message_id
    ~(bot_id : string) ~(bot_name : string) ?channel_id ?parent
    ~(session_id : string) ~(session_name : string) ?thread_id
    ~(action_id : string) ?mentioned_by () =
  ({
     announcement_message_id;
     bot_id;
     bot_name;
     channel_id;
     parent;
     session_id;
     session_name;
     thread_id;
     action_id;
     mentioned_by;
   }
    : agent_session_mentioned_metadata)

type nonrec agent_session_notification_ref = {
  announcement_message_id : string option;
      (** The magic-chip message for the turn in question, when one was posted. *)
  bot_id : string;
      (** The bot the session runs for. A string on the wire: system bots have
fixed ids like [00000000-0000-0000-0000-00000000a2a2], which are not
RFC 4122 uuids and fail a [format: uuid] check on the client. *)
  bot_name : string;
      (** The bot's display name; agent notifications have no user sender, so
this is who they read as being from. *)
  channel_id : string option;
      (** The channel the session was opened from, when it was opened from a
channel thread. *)
  parent : agent_session_origin_parent option;
  session_id : string;  (** The session; what a click opens. *)
  session_name : string;  (** The session's name at the time of the event. *)
  thread_id : string option;
      (** The thread the session was opened from, when it was. *)
}
(** Flattened into each agent-session kind so the wire keeps these keys at the
top level of the metadata, the way \[[CommonChannelMetadata]\] does. *)

let agent_session_notification_ref_of_yojson :
    Yojson.Safe.t -> agent_session_notification_ref =
 fun json ->
  let fields = Json.obj json in
  {
    announcement_message_id =
      Json.optional fields "announcementMessageId" Json.string;
    bot_id = Json.required fields "botId" Json.string;
    bot_name = Json.required fields "botName" Json.string;
    channel_id = Json.optional fields "channelId" Json.string;
    parent = Json.optional fields "parent" agent_session_origin_parent_of_yojson;
    session_id = Json.required fields "sessionId" Json.string;
    session_name = Json.required fields "sessionName" Json.string;
    thread_id = Json.optional fields "threadId" Json.string;
  }

and yojson_of_agent_session_notification_ref :
    agent_session_notification_ref -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "announcementMessageId",
        Option.map Json.of_string value.announcement_message_id );
      ("botId", Some (Json.of_string value.bot_id));
      ("botName", Some (Json.of_string value.bot_name));
      ("channelId", Option.map Json.of_string value.channel_id);
      ("parent", Option.map yojson_of_agent_session_origin_parent value.parent);
      ("sessionId", Some (Json.of_string value.session_id));
      ("sessionName", Some (Json.of_string value.session_name));
      ("threadId", Option.map Json.of_string value.thread_id);
    ]

let make_agent_session_notification_ref ?announcement_message_id
    ~(bot_id : string) ~(bot_name : string) ?channel_id ?parent
    ~(session_id : string) ~(session_name : string) ?thread_id () =
  ({
     announcement_message_id;
     bot_id;
     bot_name;
     channel_id;
     parent;
     session_id;
     session_name;
     thread_id;
   }
    : agent_session_notification_ref)

type nonrec agent_session_settled_metadata = {
  announcement_message_id : string option;
      (** The magic-chip message for the turn in question, when one was posted. *)
  bot_id : string;
      (** The bot the session runs for. A string on the wire: system bots have
fixed ids like [00000000-0000-0000-0000-00000000a2a2], which are not
RFC 4122 uuids and fail a [format: uuid] check on the client. *)
  bot_name : string;
      (** The bot's display name; agent notifications have no user sender, so
this is who they read as being from. *)
  channel_id : string option;
      (** The channel the session was opened from, when it was opened from a
channel thread. *)
  parent : agent_session_origin_parent option;
  session_id : string;  (** The session; what a click opens. *)
  session_name : string;  (** The session's name at the time of the event. *)
  thread_id : string option;
      (** The thread the session was opened from, when it was. *)
  actor : string option;
      (** Who prompted the turn, absent when a bot acted on nobody's behalf. *)
  excerpt : string option;
      (** The agent's last prose in the turn, whole; [None] when it wrote none. *)
  stop_reason : string;  (** The ACP stop reason, or [error]. *)
  turn : int;  (** The turn that ended. *)
}
(** An agent finished a turn with nothing queued behind it. *)

let agent_session_settled_metadata_of_yojson :
    Yojson.Safe.t -> agent_session_settled_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    announcement_message_id =
      Json.optional fields "announcementMessageId" Json.string;
    bot_id = Json.required fields "botId" Json.string;
    bot_name = Json.required fields "botName" Json.string;
    channel_id = Json.optional fields "channelId" Json.string;
    parent = Json.optional fields "parent" agent_session_origin_parent_of_yojson;
    session_id = Json.required fields "sessionId" Json.string;
    session_name = Json.required fields "sessionName" Json.string;
    thread_id = Json.optional fields "threadId" Json.string;
    actor = Json.optional fields "actor" Json.string;
    excerpt = Json.optional fields "excerpt" Json.string;
    stop_reason = Json.required fields "stopReason" Json.string;
    turn = Json.required fields "turn" Json.int;
  }

and yojson_of_agent_session_settled_metadata :
    agent_session_settled_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "announcementMessageId",
        Option.map Json.of_string value.announcement_message_id );
      ("botId", Some (Json.of_string value.bot_id));
      ("botName", Some (Json.of_string value.bot_name));
      ("channelId", Option.map Json.of_string value.channel_id);
      ("parent", Option.map yojson_of_agent_session_origin_parent value.parent);
      ("sessionId", Some (Json.of_string value.session_id));
      ("sessionName", Some (Json.of_string value.session_name));
      ("threadId", Option.map Json.of_string value.thread_id);
      ("actor", Option.map Json.of_string value.actor);
      ("excerpt", Option.map Json.of_string value.excerpt);
      ("stopReason", Some (Json.of_string value.stop_reason));
      ("turn", Some (Json.of_int value.turn));
    ]

let make_agent_session_settled_metadata ?announcement_message_id
    ~(bot_id : string) ~(bot_name : string) ?channel_id ?parent
    ~(session_id : string) ~(session_name : string) ?thread_id ?actor ?excerpt
    ~(stop_reason : string) ~(turn : int) () =
  ({
     announcement_message_id;
     bot_id;
     bot_name;
     channel_id;
     parent;
     session_id;
     session_name;
     thread_id;
     actor;
     excerpt;
     stop_reason;
     turn;
   }
    : agent_session_settled_metadata)

type nonrec agent_session_waiting_for_input_metadata = {
  announcement_message_id : string option;
      (** The magic-chip message for the turn in question, when one was posted. *)
  bot_id : string;
      (** The bot the session runs for. A string on the wire: system bots have
fixed ids like [00000000-0000-0000-0000-00000000a2a2], which are not
RFC 4122 uuids and fail a [format: uuid] check on the client. *)
  bot_name : string;
      (** The bot's display name; agent notifications have no user sender, so
this is who they read as being from. *)
  channel_id : string option;
      (** The channel the session was opened from, when it was opened from a
channel thread. *)
  parent : agent_session_origin_parent option;
  session_id : string;  (** The session; what a click opens. *)
  session_name : string;  (** The session's name at the time of the event. *)
  thread_id : string option;
      (** The thread the session was opened from, when it was. *)
  question : string;  (** The question, as the agent phrased it. *)
  turn : int;  (** The turn asking. *)
}
(** An agent is blocked on a question only the session's owner can answer. *)

let agent_session_waiting_for_input_metadata_of_yojson :
    Yojson.Safe.t -> agent_session_waiting_for_input_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    announcement_message_id =
      Json.optional fields "announcementMessageId" Json.string;
    bot_id = Json.required fields "botId" Json.string;
    bot_name = Json.required fields "botName" Json.string;
    channel_id = Json.optional fields "channelId" Json.string;
    parent = Json.optional fields "parent" agent_session_origin_parent_of_yojson;
    session_id = Json.required fields "sessionId" Json.string;
    session_name = Json.required fields "sessionName" Json.string;
    thread_id = Json.optional fields "threadId" Json.string;
    question = Json.required fields "question" Json.string;
    turn = Json.required fields "turn" Json.int;
  }

and yojson_of_agent_session_waiting_for_input_metadata :
    agent_session_waiting_for_input_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "announcementMessageId",
        Option.map Json.of_string value.announcement_message_id );
      ("botId", Some (Json.of_string value.bot_id));
      ("botName", Some (Json.of_string value.bot_name));
      ("channelId", Option.map Json.of_string value.channel_id);
      ("parent", Option.map yojson_of_agent_session_origin_parent value.parent);
      ("sessionId", Some (Json.of_string value.session_id));
      ("sessionName", Some (Json.of_string value.session_name));
      ("threadId", Option.map Json.of_string value.thread_id);
      ("question", Some (Json.of_string value.question));
      ("turn", Some (Json.of_int value.turn));
    ]

let make_agent_session_waiting_for_input_metadata ?announcement_message_id
    ~(bot_id : string) ~(bot_name : string) ?channel_id ?parent
    ~(session_id : string) ~(session_name : string) ?thread_id
    ~(question : string) ~(turn : int) () =
  ({
     announcement_message_id;
     bot_id;
     bot_name;
     channel_id;
     parent;
     session_id;
     session_name;
     thread_id;
     question;
     turn;
   }
    : agent_session_waiting_for_input_metadata)

(** How close a computer's agent sign-in is to no longer working. *)
type nonrec agent_sign_in_expiry_stage =
  | Expires_soon
  | Expires_today
  | Expired
  | Unknown of string  (** A value this SDK version does not know. *)

let agent_sign_in_expiry_stage_of_yojson :
    Yojson.Safe.t -> agent_sign_in_expiry_stage =
 fun json ->
  match Json.string json with
  | "expires_soon" -> Expires_soon
  | "expires_today" -> Expires_today
  | "expired" -> Expired
  | other -> Unknown other

and yojson_of_agent_sign_in_expiry_stage :
    agent_sign_in_expiry_stage -> Yojson.Safe.t =
 fun value ->
  match value with
  | Expires_soon -> `String "expires_soon"
  | Expires_today -> `String "expires_today"
  | Expired -> `String "expired"
  | Unknown other -> `String other

type nonrec agent_sign_in_expiry_metadata = {
  agent : agent_provider;  (** The agent whose sign-in is running out. *)
  computer_name : string;  (** The computer's name when the notice was sent. *)
  expires_at : string option;
      (** When the sign-in expires or expired; absent when the agent rejected it. *)
  harness_id : string;
      (** The computer's harness, whose runtime row holds the sign-in. *)
  stage : agent_sign_in_expiry_stage;
      (** How close the sign-in is to no longer working. *)
}
(** The account a team's Macro computer signed an agent in to is about to
stop working, or has. Sent to whoever signed it in and to the team's
admins and owner, who can sign it in again from Settings → Machines. *)

let agent_sign_in_expiry_metadata_of_yojson :
    Yojson.Safe.t -> agent_sign_in_expiry_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    agent = Json.required fields "agent" agent_provider_of_yojson;
    computer_name = Json.required fields "computerName" Json.string;
    expires_at = Json.optional fields "expiresAt" Json.string;
    harness_id = Json.required fields "harnessId" Json.string;
    stage = Json.required fields "stage" agent_sign_in_expiry_stage_of_yojson;
  }

and yojson_of_agent_sign_in_expiry_metadata :
    agent_sign_in_expiry_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("agent", Some (yojson_of_agent_provider value.agent));
      ("computerName", Some (Json.of_string value.computer_name));
      ("expiresAt", Option.map Json.of_string value.expires_at);
      ("harnessId", Some (Json.of_string value.harness_id));
      ("stage", Some (yojson_of_agent_sign_in_expiry_stage value.stage));
    ]

let make_agent_sign_in_expiry_metadata ~(agent : agent_provider)
    ~(computer_name : string) ?expires_at ~(harness_id : string)
    ~(stage : agent_sign_in_expiry_stage) () =
  ({ agent; computer_name; expires_at; harness_id; stage }
    : agent_sign_in_expiry_metadata)

type nonrec ai_response_metadata = { message_id : string; summary : string }

let ai_response_metadata_of_yojson : Yojson.Safe.t -> ai_response_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    message_id = Json.required fields "messageId" Json.string;
    summary = Json.required fields "summary" Json.string;
  }

and yojson_of_ai_response_metadata : ai_response_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("messageId", Some (Json.of_string value.message_id));
      ("summary", Some (Json.of_string value.summary));
    ]

let make_ai_response_metadata ~(message_id : string) ~(summary : string) () =
  ({ message_id; summary } : ai_response_metadata)

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
  | other -> Unknown other

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

type nonrec channel_type =
  | Public
  | Private
  | Direct_message
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

let channel_type_of_yojson : Yojson.Safe.t -> channel_type =
 fun json ->
  match Json.string json with
  | "public" -> Public
  | "private" -> Private
  | "directMessage" -> Direct_message
  | "team" -> Team
  | other -> Unknown other

and yojson_of_channel_type : channel_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Public -> `String "public"
  | Private -> `String "private"
  | Direct_message -> `String "directMessage"
  | Team -> `String "team"
  | Unknown other -> `String other

type nonrec channel_mention_metadata = {
  channel_name : string option;
  channel_type : channel_type;
  message_content : string;  (** The message content *)
  message_id : string;  (** The message you were mentioned in *)
  sender_display_name : string option;
      (** Display name for non-user senders such as bots *)
  sender_profile_picture_url : string option;
  thread_id : string option;  (** the id of the thread *)
}

let channel_mention_metadata_of_yojson :
    Yojson.Safe.t -> channel_mention_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channelName" Json.string;
    channel_type = Json.required fields "channelType" channel_type_of_yojson;
    message_content = Json.required fields "messageContent" Json.string;
    message_id = Json.required fields "messageId" Json.string;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    thread_id = Json.optional fields "threadId" Json.string;
  }

and yojson_of_channel_mention_metadata :
    channel_mention_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channelName", Option.map Json.of_string value.channel_name);
      ("channelType", Some (yojson_of_channel_type value.channel_type));
      ("messageContent", Some (Json.of_string value.message_content));
      ("messageId", Some (Json.of_string value.message_id));
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ("threadId", Option.map Json.of_string value.thread_id);
    ]

let make_channel_mention_metadata ?channel_name ~(channel_type : channel_type)
    ~(message_content : string) ~(message_id : string) ?sender_display_name
    ?sender_profile_picture_url ?thread_id () =
  ({
     channel_name;
     channel_type;
     message_content;
     message_id;
     sender_display_name;
     sender_profile_picture_url;
     thread_id;
   }
    : channel_mention_metadata)

(** The sub type of a document in a notification.
Serializes as [{ "type": "task" }] matching the storage service pattern. *)
type nonrec notification_document_sub_type =
  | Task
  | Snippet
  | Skill
  | Initiative_description
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let notification_document_sub_type_of_yojson :
    Yojson.Safe.t -> notification_document_sub_type =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "task" -> Task
  | "snippet" -> Snippet
  | "skill" -> Skill
  | "initiative_description" -> Initiative_description
  | _ -> Unknown json

and yojson_of_notification_document_sub_type :
    notification_document_sub_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Task -> Json.record [ ("type", Some (`String "task")) ]
  | Snippet -> Json.record [ ("type", Some (`String "snippet")) ]
  | Skill -> Json.record [ ("type", Some (`String "skill")) ]
  | Initiative_description ->
      Json.record [ ("type", Some (`String "initiative_description")) ]
  | Unknown json -> json

type nonrec document_mention_metadata = {
  channel_name : string option;
  channel_type : channel_type;
  message_content : string;  (** The message content *)
  message_id : string;  (** The message you were mentioned in *)
  sender_display_name : string option;
      (** Display name for non-user senders such as bots *)
  sender_profile_picture_url : string option;
  thread_id : string option;  (** the id of the thread *)
  document_name : string;  (** The name of the document *)
  file_type : string option;  (** The file type of the document *)
  owner : string;  (** The owner of the document *)
  sub_type : notification_document_sub_type option;
}
(** Someone mentioned a document in a channel *)

let document_mention_metadata_of_yojson :
    Yojson.Safe.t -> document_mention_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channelName" Json.string;
    channel_type = Json.required fields "channelType" channel_type_of_yojson;
    message_content = Json.required fields "messageContent" Json.string;
    message_id = Json.required fields "messageId" Json.string;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    thread_id = Json.optional fields "threadId" Json.string;
    document_name = Json.required fields "documentName" Json.string;
    file_type = Json.optional fields "fileType" Json.string;
    owner = Json.required fields "owner" Json.string;
    sub_type =
      Json.optional fields "subType" notification_document_sub_type_of_yojson;
  }

and yojson_of_document_mention_metadata :
    document_mention_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channelName", Option.map Json.of_string value.channel_name);
      ("channelType", Some (yojson_of_channel_type value.channel_type));
      ("messageContent", Some (Json.of_string value.message_content));
      ("messageId", Some (Json.of_string value.message_id));
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ("threadId", Option.map Json.of_string value.thread_id);
      ("documentName", Some (Json.of_string value.document_name));
      ("fileType", Option.map Json.of_string value.file_type);
      ("owner", Some (Json.of_string value.owner));
      ( "subType",
        Option.map yojson_of_notification_document_sub_type value.sub_type );
    ]

let make_document_mention_metadata ?channel_name ~(channel_type : channel_type)
    ~(message_content : string) ~(message_id : string) ?sender_display_name
    ?sender_profile_picture_url ?thread_id ~(document_name : string) ?file_type
    ~(owner : string) ?sub_type () =
  ({
     channel_name;
     channel_type;
     message_content;
     message_id;
     sender_display_name;
     sender_profile_picture_url;
     thread_id;
     document_name;
     file_type;
     owner;
     sub_type;
   }
    : document_mention_metadata)

(** Identity of a document comment or its thread. Comments written before the
shared message store carry the legacy numeric ids; comments in the shared
store carry the message and root UUIDs. *)
type nonrec comment_ref =
  | Int64 of int64  (** Legacy [Comment.id] or [Thread.id]. *)
  | String of string  (** Message or root id in the shared message store. *)

let comment_ref_of_yojson : Yojson.Safe.t -> comment_ref =
 fun json ->
  Json.first_ok
    [
      (fun json -> Int64 (Json.int64 json));
      (fun json -> String (Json.string json));
    ]
    json

and yojson_of_comment_ref : comment_ref -> Yojson.Safe.t =
 fun value ->
  match value with
  | Int64 inner -> Json.of_int64 inner
  | String inner -> Json.of_string inner

type nonrec mentioned_in_document_comment_metadata = {
  comment_id : comment_ref;  (** the comment id *)
  document_name : string;  (** The name of the document. *)
  file_type : string option;  (** The file type of the document. *)
  mention_id : string;  (** The mention ID. *)
  owner : string;  (** The owner of the document. *)
  sender_display_name : string option;
      (** Public bot name when the author is an agent rather than a Macro user. *)
  sender_profile_picture_url : string option;
  sub_type : notification_document_sub_type option;
  text : string;  (** the text of the comment *)
  thread_id : comment_ref;  (** the thread id *)
}
(** Notification sent when a user is mentioned in a document comment. *)

let mentioned_in_document_comment_metadata_of_yojson :
    Yojson.Safe.t -> mentioned_in_document_comment_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    comment_id = Json.required fields "commentId" comment_ref_of_yojson;
    document_name = Json.required fields "documentName" Json.string;
    file_type = Json.optional fields "fileType" Json.string;
    mention_id = Json.required fields "mentionId" Json.string;
    owner = Json.required fields "owner" Json.string;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    sub_type =
      Json.optional fields "subType" notification_document_sub_type_of_yojson;
    text = Json.required fields "text" Json.string;
    thread_id = Json.required fields "threadId" comment_ref_of_yojson;
  }

and yojson_of_mentioned_in_document_comment_metadata :
    mentioned_in_document_comment_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("commentId", Some (yojson_of_comment_ref value.comment_id));
      ("documentName", Some (Json.of_string value.document_name));
      ("fileType", Option.map Json.of_string value.file_type);
      ("mentionId", Some (Json.of_string value.mention_id));
      ("owner", Some (Json.of_string value.owner));
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ( "subType",
        Option.map yojson_of_notification_document_sub_type value.sub_type );
      ("text", Some (Json.of_string value.text));
      ("threadId", Some (yojson_of_comment_ref value.thread_id));
    ]

let make_mentioned_in_document_comment_metadata ~(comment_id : comment_ref)
    ~(document_name : string) ?file_type ~(mention_id : string)
    ~(owner : string) ?sender_display_name ?sender_profile_picture_url ?sub_type
    ~(text : string) ~(thread_id : comment_ref) () =
  ({
     comment_id;
     document_name;
     file_type;
     mention_id;
     owner;
     sender_display_name;
     sender_profile_picture_url;
     sub_type;
     text;
     thread_id;
   }
    : mentioned_in_document_comment_metadata)

type nonrec replied_to_document_comment_thread_metadata = {
  comment_id : comment_ref;  (** the comment id *)
  document_name : string;  (** The name of the document. *)
  file_type : string option;  (** The file type of the document. *)
  owner : string;  (** The owner of the document. *)
  sender_display_name : string option;
      (** Public bot name when the author is an agent rather than a Macro user. *)
  sender_profile_picture_url : string option;
  sub_type : notification_document_sub_type option;
  text : string;  (** the text of the comment *)
  thread_id : comment_ref;  (** the thread id *)
}
(** Notification sent when someone replies to a document comment thread. *)

let replied_to_document_comment_thread_metadata_of_yojson :
    Yojson.Safe.t -> replied_to_document_comment_thread_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    comment_id = Json.required fields "commentId" comment_ref_of_yojson;
    document_name = Json.required fields "documentName" Json.string;
    file_type = Json.optional fields "fileType" Json.string;
    owner = Json.required fields "owner" Json.string;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    sub_type =
      Json.optional fields "subType" notification_document_sub_type_of_yojson;
    text = Json.required fields "text" Json.string;
    thread_id = Json.required fields "threadId" comment_ref_of_yojson;
  }

and yojson_of_replied_to_document_comment_thread_metadata :
    replied_to_document_comment_thread_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("commentId", Some (yojson_of_comment_ref value.comment_id));
      ("documentName", Some (Json.of_string value.document_name));
      ("fileType", Option.map Json.of_string value.file_type);
      ("owner", Some (Json.of_string value.owner));
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ( "subType",
        Option.map yojson_of_notification_document_sub_type value.sub_type );
      ("text", Some (Json.of_string value.text));
      ("threadId", Some (yojson_of_comment_ref value.thread_id));
    ]

let make_replied_to_document_comment_thread_metadata ~(comment_id : comment_ref)
    ~(document_name : string) ?file_type ~(owner : string) ?sender_display_name
    ?sender_profile_picture_url ?sub_type ~(text : string)
    ~(thread_id : comment_ref) () =
  ({
     comment_id;
     document_name;
     file_type;
     owner;
     sender_display_name;
     sender_profile_picture_url;
     sub_type;
     text;
     thread_id;
   }
    : replied_to_document_comment_thread_metadata)

type nonrec commented_on_document_metadata = {
  comment_id : comment_ref;  (** the comment id *)
  document_name : string;  (** The name of the document. *)
  file_type : string option;  (** The file type of the document. *)
  owner : string;  (** The owner of the document. *)
  sender_display_name : string option;
      (** Public bot name when the author is an agent rather than a Macro user. *)
  sender_profile_picture_url : string option;
  sub_type : notification_document_sub_type option;
  text : string;  (** the text of the comment *)
  thread_id : comment_ref;  (** the thread id *)
}
(** Notification sent when someone comments on a document the user owns. *)

let commented_on_document_metadata_of_yojson :
    Yojson.Safe.t -> commented_on_document_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    comment_id = Json.required fields "commentId" comment_ref_of_yojson;
    document_name = Json.required fields "documentName" Json.string;
    file_type = Json.optional fields "fileType" Json.string;
    owner = Json.required fields "owner" Json.string;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    sub_type =
      Json.optional fields "subType" notification_document_sub_type_of_yojson;
    text = Json.required fields "text" Json.string;
    thread_id = Json.required fields "threadId" comment_ref_of_yojson;
  }

and yojson_of_commented_on_document_metadata :
    commented_on_document_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("commentId", Some (yojson_of_comment_ref value.comment_id));
      ("documentName", Some (Json.of_string value.document_name));
      ("fileType", Option.map Json.of_string value.file_type);
      ("owner", Some (Json.of_string value.owner));
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ( "subType",
        Option.map yojson_of_notification_document_sub_type value.sub_type );
      ("text", Some (Json.of_string value.text));
      ("threadId", Some (yojson_of_comment_ref value.thread_id));
    ]

let make_commented_on_document_metadata ~(comment_id : comment_ref)
    ~(document_name : string) ?file_type ~(owner : string) ?sender_display_name
    ?sender_profile_picture_url ?sub_type ~(text : string)
    ~(thread_id : comment_ref) () =
  ({
     comment_id;
     document_name;
     file_type;
     owner;
     sender_display_name;
     sender_profile_picture_url;
     sub_type;
     text;
     thread_id;
   }
    : commented_on_document_metadata)

(** Permission level used by an access request, excluding ownership. *)
type nonrec requested_access_level =
  | View
  | Comment
  | Edit
  | Unknown of string  (** A value this SDK version does not know. *)

let requested_access_level_of_yojson : Yojson.Safe.t -> requested_access_level =
 fun json ->
  match Json.string json with
  | "view" -> View
  | "comment" -> Comment
  | "edit" -> Edit
  | other -> Unknown other

and yojson_of_requested_access_level : requested_access_level -> Yojson.Safe.t =
 fun value ->
  match value with
  | View -> `String "view"
  | Comment -> `String "comment"
  | Edit -> `String "edit"
  | Unknown other -> `String other

type nonrec entity_access_requested_metadata = {
  access_level : requested_access_level;
      (** Requested or granted permission. *)
  entity_name : string;  (** Shared item's name. *)
  file_type : string option;  (** Document file type for routing. *)
  request_id : string;  (** Stable request identity. *)
  revision : int;  (** Revision that generated this notification. *)
}
(** A person requested access to a shared entity. *)

let entity_access_requested_metadata_of_yojson :
    Yojson.Safe.t -> entity_access_requested_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    access_level =
      Json.required fields "accessLevel" requested_access_level_of_yojson;
    entity_name = Json.required fields "entityName" Json.string;
    file_type = Json.optional fields "fileType" Json.string;
    request_id = Json.required fields "requestId" Json.string;
    revision = Json.required fields "revision" Json.int;
  }

and yojson_of_entity_access_requested_metadata :
    entity_access_requested_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("accessLevel", Some (yojson_of_requested_access_level value.access_level));
      ("entityName", Some (Json.of_string value.entity_name));
      ("fileType", Option.map Json.of_string value.file_type);
      ("requestId", Some (Json.of_string value.request_id));
      ("revision", Some (Json.of_int value.revision));
    ]

let make_entity_access_requested_metadata
    ~(access_level : requested_access_level) ~(entity_name : string) ?file_type
    ~(request_id : string) ~(revision : int) () =
  ({ access_level; entity_name; file_type; request_id; revision }
    : entity_access_requested_metadata)

type nonrec entity_access_granted_metadata = {
  access_level : requested_access_level;
      (** Requested or granted permission. *)
  entity_name : string;  (** Shared item's name. *)
  file_type : string option;  (** Document file type for routing. *)
  request_id : string;  (** Stable request identity. *)
  revision : int;  (** Revision that generated this notification. *)
}
(** A person granted you access to a shared entity. *)

let entity_access_granted_metadata_of_yojson :
    Yojson.Safe.t -> entity_access_granted_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    access_level =
      Json.required fields "accessLevel" requested_access_level_of_yojson;
    entity_name = Json.required fields "entityName" Json.string;
    file_type = Json.optional fields "fileType" Json.string;
    request_id = Json.required fields "requestId" Json.string;
    revision = Json.required fields "revision" Json.int;
  }

and yojson_of_entity_access_granted_metadata :
    entity_access_granted_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("accessLevel", Some (yojson_of_requested_access_level value.access_level));
      ("entityName", Some (Json.of_string value.entity_name));
      ("fileType", Option.map Json.of_string value.file_type);
      ("requestId", Some (Json.of_string value.request_id));
      ("revision", Some (Json.of_int value.revision));
    ]

let make_entity_access_granted_metadata ~(access_level : requested_access_level)
    ~(entity_name : string) ?file_type ~(request_id : string) ~(revision : int)
    () =
  ({ access_level; entity_name; file_type; request_id; revision }
    : entity_access_granted_metadata)

(** Why a project discussion notification was delivered. *)
type nonrec initiative_discussion_reason =
  | Mention
  | Reply
  | Assignee
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

let initiative_discussion_reason_of_yojson :
    Yojson.Safe.t -> initiative_discussion_reason =
 fun json ->
  match Json.string json with
  | "mention" -> Mention
  | "reply" -> Reply
  | "assignee" -> Assignee
  | "owner" -> Owner
  | other -> Unknown other

and yojson_of_initiative_discussion_reason :
    initiative_discussion_reason -> Yojson.Safe.t =
 fun value ->
  match value with
  | Mention -> `String "mention"
  | Reply -> `String "reply"
  | Assignee -> `String "assignee"
  | Owner -> `String "owner"
  | Unknown other -> `String other

type nonrec initiative_discussion_metadata = {
  message_id : string;  (** Canonical shared message UUID. *)
  owner : string;  (** Authenticated project owner. *)
  project_name : string;  (** Name displayed in the project header. *)
  reason : initiative_discussion_reason;
      (** Semantic reason selected by the message delivery domain. *)
  sender_display_name : string option;
      (** Public display name for a bot author. *)
  sender_profile_picture_url : string option;
      (** Optional avatar for push notification attachments. *)
  text : string;  (** Posted Markdown content. *)
  thread_id : string;  (** Canonical discussion root UUID. *)
}
(** Project discussion metadata. The notification entity identifies the initiative;
message and thread UUIDs select the discussion inside that project. *)

let initiative_discussion_metadata_of_yojson :
    Yojson.Safe.t -> initiative_discussion_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    message_id = Json.required fields "messageId" Json.string;
    owner = Json.required fields "owner" Json.string;
    project_name = Json.required fields "projectName" Json.string;
    reason =
      Json.required fields "reason" initiative_discussion_reason_of_yojson;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    text = Json.required fields "text" Json.string;
    thread_id = Json.required fields "threadId" Json.string;
  }

and yojson_of_initiative_discussion_metadata :
    initiative_discussion_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("messageId", Some (Json.of_string value.message_id));
      ("owner", Some (Json.of_string value.owner));
      ("projectName", Some (Json.of_string value.project_name));
      ("reason", Some (yojson_of_initiative_discussion_reason value.reason));
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ("text", Some (Json.of_string value.text));
      ("threadId", Some (Json.of_string value.thread_id));
    ]

let make_initiative_discussion_metadata ~(message_id : string) ~(owner : string)
    ~(project_name : string) ~(reason : initiative_discussion_reason)
    ?sender_display_name ?sender_profile_picture_url ~(text : string)
    ~(thread_id : string) () =
  ({
     message_id;
     owner;
     project_name;
     reason;
     sender_display_name;
     sender_profile_picture_url;
     text;
     thread_id;
   }
    : initiative_discussion_metadata)

(** Why a CRM discussion notification was delivered. *)
type nonrec crm_discussion_reason =
  | Mention
  | Reply
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

let crm_discussion_reason_of_yojson : Yojson.Safe.t -> crm_discussion_reason =
 fun json ->
  match Json.string json with
  | "mention" -> Mention
  | "reply" -> Reply
  | "owner" -> Owner
  | other -> Unknown other

and yojson_of_crm_discussion_reason : crm_discussion_reason -> Yojson.Safe.t =
 fun value ->
  match value with
  | Mention -> `String "mention"
  | Reply -> `String "reply"
  | Owner -> `String "owner"
  | Unknown other -> `String other

type nonrec crm_discussion_metadata = {
  message_id : string;  (** Canonical shared message UUID. *)
  reason : crm_discussion_reason;
      (** Semantic reason selected by the message delivery domain. *)
  record_name : string;  (** Company or contact display name. *)
  sender_display_name : string option;
      (** Public display name for a bot author. *)
  sender_profile_picture_url : string option;
      (** Optional avatar for push notification attachments. *)
  text : string;  (** Posted Markdown content. *)
  thread_id : string;  (** Canonical discussion root UUID. *)
}
(** CRM discussion metadata. The notification entity identifies the company or
contact; message and thread UUIDs select the discussion inside it. *)

let crm_discussion_metadata_of_yojson : Yojson.Safe.t -> crm_discussion_metadata
    =
 fun json ->
  let fields = Json.obj json in
  {
    message_id = Json.required fields "messageId" Json.string;
    reason = Json.required fields "reason" crm_discussion_reason_of_yojson;
    record_name = Json.required fields "recordName" Json.string;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    text = Json.required fields "text" Json.string;
    thread_id = Json.required fields "threadId" Json.string;
  }

and yojson_of_crm_discussion_metadata : crm_discussion_metadata -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("messageId", Some (Json.of_string value.message_id));
      ("reason", Some (yojson_of_crm_discussion_reason value.reason));
      ("recordName", Some (Json.of_string value.record_name));
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ("text", Some (Json.of_string value.text));
      ("threadId", Some (Json.of_string value.thread_id));
    ]

let make_crm_discussion_metadata ~(message_id : string)
    ~(reason : crm_discussion_reason) ~(record_name : string)
    ?sender_display_name ?sender_profile_picture_url ~(text : string)
    ~(thread_id : string) () =
  ({
     message_id;
     reason;
     record_name;
     sender_display_name;
     sender_profile_picture_url;
     text;
     thread_id;
   }
    : crm_discussion_metadata)

type nonrec channel_invite_metadata = {
  channel_name : string option;  (** The name of the channel *)
  invited_by : string;  (** The user who sent the invitation *)
  is_direct_message : bool option;
      (** Whether this is a direct message rather than a channel invitation.
Older notification payloads retain channel-invitation wording. *)
  message_content : string option;
      (** Message content to show in the invite email, when the invite was triggered by a message. *)
  sender_profile_picture_url : string option;
      (** The sender's profile picture URL, if available. *)
}
(** Metadata for when a user is invited to a channel. *)

let channel_invite_metadata_of_yojson : Yojson.Safe.t -> channel_invite_metadata
    =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channelName" Json.string;
    invited_by = Json.required fields "invitedBy" Json.string;
    is_direct_message = Json.optional fields "isDirectMessage" Json.bool;
    message_content = Json.optional fields "messageContent" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
  }

and yojson_of_channel_invite_metadata : channel_invite_metadata -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("channelName", Option.map Json.of_string value.channel_name);
      ("invitedBy", Some (Json.of_string value.invited_by));
      ("isDirectMessage", Option.map Json.of_bool value.is_direct_message);
      ("messageContent", Option.map Json.of_string value.message_content);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
    ]

let make_channel_invite_metadata ?channel_name ~(invited_by : string)
    ?is_direct_message ?message_content ?sender_profile_picture_url () =
  ({
     channel_name;
     invited_by;
     is_direct_message;
     message_content;
     sender_profile_picture_url;
   }
    : channel_invite_metadata)

type nonrec channel_message_send_metadata = {
  channel_name : string option;
  channel_type : channel_type;
  message_content : string option;  (** The content of the message *)
  message_id : string;  (** The message id *)
  sender : string option;
      (** The user who sent the message, when sent by a user *)
  sender_display_name : string option;
      (** Display name for non-user senders such as bots *)
  sender_profile_picture_url : string option;
}

let channel_message_send_metadata_of_yojson :
    Yojson.Safe.t -> channel_message_send_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channelName" Json.string;
    channel_type = Json.required fields "channelType" channel_type_of_yojson;
    message_content = Json.optional fields "messageContent" Json.string;
    message_id = Json.required fields "messageId" Json.string;
    sender = Json.optional fields "sender" Json.string;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
  }

and yojson_of_channel_message_send_metadata :
    channel_message_send_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channelName", Option.map Json.of_string value.channel_name);
      ("channelType", Some (yojson_of_channel_type value.channel_type));
      ("messageContent", Option.map Json.of_string value.message_content);
      ("messageId", Some (Json.of_string value.message_id));
      ("sender", Option.map Json.of_string value.sender);
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
    ]

let make_channel_message_send_metadata ?channel_name
    ~(channel_type : channel_type) ?message_content ~(message_id : string)
    ?sender ?sender_display_name ?sender_profile_picture_url () =
  ({
     channel_name;
     channel_type;
     message_content;
     message_id;
     sender;
     sender_display_name;
     sender_profile_picture_url;
   }
    : channel_message_send_metadata)

type nonrec channel_reply_metadata = {
  channel_name : string option;
  channel_type : channel_type;
  message_content : string;  (** The message content *)
  message_id : string;  (** The id of the new message *)
  sender_display_name : string option;
      (** Display name for non-user senders such as bots *)
  sender_profile_picture_url : string option;
  thread_id : string;  (** The id of the thread that has the reply *)
  thread_parent_sender_id : string option;
      (** The user who sent the root message of the thread *)
  user_id : string option;
      (** The sender id of the reply, when sent by a user *)
}

let channel_reply_metadata_of_yojson : Yojson.Safe.t -> channel_reply_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channelName" Json.string;
    channel_type = Json.required fields "channelType" channel_type_of_yojson;
    message_content = Json.required fields "messageContent" Json.string;
    message_id = Json.required fields "messageId" Json.string;
    sender_display_name = Json.optional fields "senderDisplayName" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    thread_id = Json.required fields "threadId" Json.string;
    thread_parent_sender_id =
      Json.optional fields "threadParentSenderId" Json.string;
    user_id = Json.optional fields "userId" Json.string;
  }

and yojson_of_channel_reply_metadata : channel_reply_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channelName", Option.map Json.of_string value.channel_name);
      ("channelType", Some (yojson_of_channel_type value.channel_type));
      ("messageContent", Some (Json.of_string value.message_content));
      ("messageId", Some (Json.of_string value.message_id));
      ("senderDisplayName", Option.map Json.of_string value.sender_display_name);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ("threadId", Some (Json.of_string value.thread_id));
      ( "threadParentSenderId",
        Option.map Json.of_string value.thread_parent_sender_id );
      ("userId", Option.map Json.of_string value.user_id);
    ]

let make_channel_reply_metadata ?channel_name ~(channel_type : channel_type)
    ~(message_content : string) ~(message_id : string) ?sender_display_name
    ?sender_profile_picture_url ~(thread_id : string) ?thread_parent_sender_id
    ?user_id () =
  ({
     channel_name;
     channel_type;
     message_content;
     message_id;
     sender_display_name;
     sender_profile_picture_url;
     thread_id;
     thread_parent_sender_id;
     user_id;
   }
    : channel_reply_metadata)

type nonrec call_started_metadata = {
  channel_name : string option;
      (** The name of the channel the call started in, when available. *)
  sender_profile_picture_url : string option;
      (** Profile picture URL of the user who started the call, when available. *)
}
(** Metadata for a notification that a call has started in a channel.

Mirrors the producer-side [CallStartedNotification] in the [call] crate:
both serialize the same wire shape (snake_case fields) under the same
[call_started] \[[Notification::TYPE_NAME]\]. This type is the read-side
model used by \[[crate::NotifEvent]\]; the producer keeps its own type
because it additionally builds the incoming-call APNS/VoIP push.

Rows persisted before the type name was normalized used the kebab-case
[call-started]; the \[[crate::NotifEvent::CallStarted]\] variant carries a
`#\[serde(alias = "call-started")\]` so those rows still deserialize. *)

let call_started_metadata_of_yojson : Yojson.Safe.t -> call_started_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channel_name" Json.string;
    sender_profile_picture_url =
      Json.optional fields "sender_profile_picture_url" Json.string;
  }

and yojson_of_call_started_metadata : call_started_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_name", Option.map Json.of_string value.channel_name);
      ( "sender_profile_picture_url",
        Option.map Json.of_string value.sender_profile_picture_url );
    ]

let make_call_started_metadata ?channel_name ?sender_profile_picture_url () =
  ({ channel_name; sender_profile_picture_url } : call_started_metadata)

type nonrec new_email_metadata = {
  sender : string option;
  snippet : string;
  subject : string;
  thread_id : string;
  to_email : string;
}

let new_email_metadata_of_yojson : Yojson.Safe.t -> new_email_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    sender = Json.optional fields "sender" Json.string;
    snippet = Json.required fields "snippet" Json.string;
    subject = Json.required fields "subject" Json.string;
    thread_id = Json.required fields "threadId" Json.string;
    to_email = Json.required fields "toEmail" Json.string;
  }

and yojson_of_new_email_metadata : new_email_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("sender", Option.map Json.of_string value.sender);
      ("snippet", Some (Json.of_string value.snippet));
      ("subject", Some (Json.of_string value.subject));
      ("threadId", Some (Json.of_string value.thread_id));
      ("toEmail", Some (Json.of_string value.to_email));
    ]

let make_new_email_metadata ?sender ~(snippet : string) ~(subject : string)
    ~(thread_id : string) ~(to_email : string) () =
  ({ sender; snippet; subject; thread_id; to_email } : new_email_metadata)

type nonrec inbox_reauth_required_metadata = {
  email_address : string;
      (** The address of the inbox that needs to be reconnected. *)
}
(** Metadata for a notification that a linked inbox's grant has died and the
inbox must be reconnected. Fanned out to the inbox owner and every delegate,
since any of them holding the Google grant can restore sync. *)

let inbox_reauth_required_metadata_of_yojson :
    Yojson.Safe.t -> inbox_reauth_required_metadata =
 fun json ->
  let fields = Json.obj json in
  { email_address = Json.required fields "emailAddress" Json.string }

and yojson_of_inbox_reauth_required_metadata :
    inbox_reauth_required_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("emailAddress", Some (Json.of_string value.email_address)) ]

let make_inbox_reauth_required_metadata ~(email_address : string) () =
  ({ email_address } : inbox_reauth_required_metadata)

(** What a team invitee gets by joining. *)
type nonrec invitee_plan =
  | Free
  | Premium
  | Unknown of string  (** A value this SDK version does not know. *)

let invitee_plan_of_yojson : Yojson.Safe.t -> invitee_plan =
 fun json ->
  match Json.string json with
  | "free" -> Free
  | "premium" -> Premium
  | other -> Unknown other

and yojson_of_invitee_plan : invitee_plan -> Yojson.Safe.t =
 fun value ->
  match value with
  | Free -> `String "free"
  | Premium -> `String "premium"
  | Unknown other -> `String other

type nonrec invite_to_team_metadata = {
  invited_by : string;  (** The user who sent the invitation *)
  invitee_plan : invitee_plan option;
      (** What the invitee gets by joining, as the team stood when the invite was sent. *)
  inviter_name : string option;
      (** The inviter's display name, when they have set one. It is user-provided, so it is shown
on one line, capped, and escaped; the email falls back to the inviter's address. *)
  is_agent : bool option;  (** Whether the invite creates an agent account. *)
  reminder : bool option;
      (** Whether this email reminds the invitee of an invite they have not answered. *)
  role : string option;  (** Role/permission level in the team *)
  sender_profile_picture_url : string option;
      (** The sender's profile picture URL, if available. *)
  team_id : string;  (** The unique identifier of the team *)
  team_invite_id : string;  (** The unique identifier of the team invite *)
  team_name : string;  (** The name of the team being invited to *)
}
(** Metadata for when a user is invited to a team. *)

let invite_to_team_metadata_of_yojson : Yojson.Safe.t -> invite_to_team_metadata
    =
 fun json ->
  let fields = Json.obj json in
  {
    invited_by = Json.required fields "invitedBy" Json.string;
    invitee_plan = Json.optional fields "inviteePlan" invitee_plan_of_yojson;
    inviter_name = Json.optional fields "inviterName" Json.string;
    is_agent = Json.optional fields "isAgent" Json.bool;
    reminder = Json.optional fields "reminder" Json.bool;
    role = Json.optional fields "role" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    team_id = Json.required fields "teamId" Json.string;
    team_invite_id = Json.required fields "teamInviteId" Json.string;
    team_name = Json.required fields "teamName" Json.string;
  }

and yojson_of_invite_to_team_metadata : invite_to_team_metadata -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("invitedBy", Some (Json.of_string value.invited_by));
      ("inviteePlan", Option.map yojson_of_invitee_plan value.invitee_plan);
      ("inviterName", Option.map Json.of_string value.inviter_name);
      ("isAgent", Option.map Json.of_bool value.is_agent);
      ("reminder", Option.map Json.of_bool value.reminder);
      ("role", Option.map Json.of_string value.role);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ("teamId", Some (Json.of_string value.team_id));
      ("teamInviteId", Some (Json.of_string value.team_invite_id));
      ("teamName", Some (Json.of_string value.team_name));
    ]

let make_invite_to_team_metadata ~(invited_by : string) ?invitee_plan
    ?inviter_name ?is_agent ?reminder ?role ?sender_profile_picture_url
    ~(team_id : string) ~(team_invite_id : string) ~(team_name : string) () =
  ({
     invited_by;
     invitee_plan;
     inviter_name;
     is_agent;
     reminder;
     role;
     sender_profile_picture_url;
     team_id;
     team_invite_id;
     team_name;
   }
    : invite_to_team_metadata)

type nonrec task_assigned_metadata = {
  assigned_by : string;  (** The user who assigned the task *)
  sender_profile_picture_url : string option;
  sub_type : notification_document_sub_type option;
  task_id : string;  (** The unique identifier of the task *)
  task_name : string option;  (** The name of the task (optional) *)
}
(** Metadata for when a user is assigned to a task *)

let task_assigned_metadata_of_yojson : Yojson.Safe.t -> task_assigned_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    assigned_by = Json.required fields "assignedBy" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    sub_type =
      Json.optional fields "subType" notification_document_sub_type_of_yojson;
    task_id = Json.required fields "taskId" Json.string;
    task_name = Json.optional fields "taskName" Json.string;
  }

and yojson_of_task_assigned_metadata : task_assigned_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("assignedBy", Some (Json.of_string value.assigned_by));
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ( "subType",
        Option.map yojson_of_notification_document_sub_type value.sub_type );
      ("taskId", Some (Json.of_string value.task_id));
      ("taskName", Option.map Json.of_string value.task_name);
    ]

let make_task_assigned_metadata ~(assigned_by : string)
    ?sender_profile_picture_url ?sub_type ~(task_id : string) ?task_name () =
  ({ assigned_by; sender_profile_picture_url; sub_type; task_id; task_name }
    : task_assigned_metadata)

type nonrec reminder_metadata = {
  description : string;  (** What the user asked to be reminded about. *)
  reminder_id : string;  (** The reminder that fired. *)
  scheduled_for : string option;
      (** Which firing this is — the occurrence the reminder came due for.

What distinguishes two firings of the same recurring reminder, which are
otherwise identical: same id, same description. The collapse key is
built from it, so without it Tuesday's alert would replace Monday's
unread one on the lock screen.

Optional because notifications written before recurring dispatch existed
have no such field, and they still have to read back. *)
}
(** Metadata for a reminder the user set for themselves coming due.

There is no sender: a reminder is self-set, so the dispatcher sends it with
[sender_id: None] (a recipient who is also the sender is filtered out of
their own notification). Every formatter here must therefore work without
one.

The associated entity, when there is one, lives on the notification row
rather than in here, and clients resolve its name from that — so the
dispatcher does not have to look up a name across five entity types. *)

let reminder_metadata_of_yojson : Yojson.Safe.t -> reminder_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    description = Json.required fields "description" Json.string;
    reminder_id = Json.required fields "reminderId" Json.string;
    scheduled_for = Json.optional fields "scheduledFor" Json.string;
  }

and yojson_of_reminder_metadata : reminder_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("description", Some (Json.of_string value.description));
      ("reminderId", Some (Json.of_string value.reminder_id));
      ("scheduledFor", Option.map Json.of_string value.scheduled_for);
    ]

let make_reminder_metadata ~(description : string) ~(reminder_id : string)
    ?scheduled_for () =
  ({ description; reminder_id; scheduled_for } : reminder_metadata)

(** The messaging service an external chat lives in. *)
type nonrec external_chat_provider =
  | Whatsapp
  | Unknown of string  (** A value this SDK version does not know. *)

let external_chat_provider_of_yojson : Yojson.Safe.t -> external_chat_provider =
 fun json ->
  match Json.string json with "whatsapp" -> Whatsapp | other -> Unknown other

and yojson_of_external_chat_provider : external_chat_provider -> Yojson.Safe.t =
 fun value ->
  match value with
  | Whatsapp -> `String "whatsapp"
  | Unknown other -> `String other

type nonrec external_chat_message_metadata = {
  chat_name : string;  (** The chat's name. *)
  message_id : string;
      (** Stable message id; retries use it as their notification id. *)
  provider : external_chat_provider;
      (** The messaging service the chat lives in. *)
}
(** A live message in an independently shared external chat. *)

let external_chat_message_metadata_of_yojson :
    Yojson.Safe.t -> external_chat_message_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    chat_name = Json.required fields "chatName" Json.string;
    message_id = Json.required fields "messageId" Json.string;
    provider = Json.required fields "provider" external_chat_provider_of_yojson;
  }

and yojson_of_external_chat_message_metadata :
    external_chat_message_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chatName", Some (Json.of_string value.chat_name));
      ("messageId", Some (Json.of_string value.message_id));
      ("provider", Some (yojson_of_external_chat_provider value.provider));
    ]

let make_external_chat_message_metadata ~(chat_name : string)
    ~(message_id : string) ~(provider : external_chat_provider) () =
  ({ chat_name; message_id; provider } : external_chat_message_metadata)

type nonrec calendar_event_reminder_metadata = {
  ends_at : string option;  (** Instance end, for timed events. *)
  event_id : string;  (** The calendar event entity the alarm belongs to. *)
  minutes_before : int;
      (** Minutes before the start the alarm was configured to fire. *)
  occurrence_key : string;
      (** Stable occurrence key of the instance that is starting. *)
  start_date : string option;  (** Instance start date, for all-day events. *)
  starts_at : string option;  (** Instance start, for timed events. *)
  time_zone : string option;
      (** IANA zone for rendering local clock times, when known. *)
  title : string;  (** Event display title at dispatch time. *)
}
(** A calendar event alarm came due. Like \[[ReminderMetadata]\], these are
self-notifications: [sender_id] must stay [None] or the only recipient is
filtered out. Everything the alert renders rides in here so the
dispatcher never has to resolve the event again at display time. *)

let calendar_event_reminder_metadata_of_yojson :
    Yojson.Safe.t -> calendar_event_reminder_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    ends_at = Json.optional fields "endsAt" Json.string;
    event_id = Json.required fields "eventId" Json.string;
    minutes_before = Json.required fields "minutesBefore" Json.int;
    occurrence_key = Json.required fields "occurrenceKey" Json.string;
    start_date = Json.optional fields "startDate" Json.string;
    starts_at = Json.optional fields "startsAt" Json.string;
    time_zone = Json.optional fields "timeZone" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_calendar_event_reminder_metadata :
    calendar_event_reminder_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("endsAt", Option.map Json.of_string value.ends_at);
      ("eventId", Some (Json.of_string value.event_id));
      ("minutesBefore", Some (Json.of_int value.minutes_before));
      ("occurrenceKey", Some (Json.of_string value.occurrence_key));
      ("startDate", Option.map Json.of_string value.start_date);
      ("startsAt", Option.map Json.of_string value.starts_at);
      ("timeZone", Option.map Json.of_string value.time_zone);
      ("title", Some (Json.of_string value.title));
    ]

let make_calendar_event_reminder_metadata ?ends_at ~(event_id : string)
    ~(minutes_before : int) ~(occurrence_key : string) ?start_date ?starts_at
    ?time_zone ~(title : string) () =
  ({
     ends_at;
     event_id;
     minutes_before;
     occurrence_key;
     start_date;
     starts_at;
     time_zone;
     title;
   }
    : calendar_event_reminder_metadata)

(** The GitHub pull request webhook action that triggered the notification. *)
type nonrec github_pr_event_action =
  | Opened
  | Reopened
  | Closed
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pr_event_action_of_yojson : Yojson.Safe.t -> github_pr_event_action =
 fun json ->
  match Json.string json with
  | "opened" -> Opened
  | "reopened" -> Reopened
  | "closed" -> Closed
  | other -> Unknown other

and yojson_of_github_pr_event_action : github_pr_event_action -> Yojson.Safe.t =
 fun value ->
  match value with
  | Opened -> `String "opened"
  | Reopened -> `String "reopened"
  | Closed -> `String "closed"
  | Unknown other -> `String other

(** The normalized lifecycle status for a GitHub pull request notification. *)
type nonrec github_pr_event_status =
  | Open
  | Closed
  | Merged
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pr_event_status_of_yojson : Yojson.Safe.t -> github_pr_event_status =
 fun json ->
  match Json.string json with
  | "open" -> Open
  | "closed" -> Closed
  | "merged" -> Merged
  | other -> Unknown other

and yojson_of_github_pr_event_status : github_pr_event_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Open -> `String "open"
  | Closed -> `String "closed"
  | Merged -> `String "merged"
  | Unknown other -> `String other

type nonrec github_pr_status_changed = {
  display_name : string;  (** A compact label suitable for display in the UI. *)
  foreign_entity_id : string;
      (** The source-specific internal foreign entity row id for this pull request. *)
  github_key : string;
      (** The external GitHub key, in [owner/repo/pull/number] format. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  sender_github_avatar_url : string option;
      (** The GitHub avatar URL for the sender, when available. *)
  sender_github_login : string option;
      (** The GitHub login for the sender, when available. *)
  sender_github_user_id : string option;
      (** The stable GitHub numeric user id for the sender, serialized as a string. *)
  title : string;
      (** The GitHub pull request title. Falls back to [display_name] when GitHub has no title. *)
  url : string;  (** The public GitHub URL for the pull request. *)
  action : github_pr_event_action;
      (** The webhook action that triggered this notification. *)
  base_branch : string option;
      (** The pull request base branch, when available. *)
  head_branch : string option;
      (** The pull request head branch, when available. *)
  merged_at : string option;
      (** When the pull request was merged, when available. *)
  previous_status : github_pr_event_status option;
  status : github_pr_event_status;
      (** The current normalized pull request status. *)
}
(** Metadata for a GitHub pull request lifecycle notification. *)

let github_pr_status_changed_of_yojson :
    Yojson.Safe.t -> github_pr_status_changed =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    foreign_entity_id = Json.required fields "foreignEntityId" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    sender_github_avatar_url =
      Json.optional fields "senderGithubAvatarUrl" Json.string;
    sender_github_login = Json.optional fields "senderGithubLogin" Json.string;
    sender_github_user_id =
      Json.optional fields "senderGithubUserId" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
    action = Json.required fields "action" github_pr_event_action_of_yojson;
    base_branch = Json.optional fields "baseBranch" Json.string;
    head_branch = Json.optional fields "headBranch" Json.string;
    merged_at = Json.optional fields "mergedAt" Json.string;
    previous_status =
      Json.optional fields "previousStatus" github_pr_event_status_of_yojson;
    status = Json.required fields "status" github_pr_event_status_of_yojson;
  }

and yojson_of_github_pr_status_changed :
    github_pr_status_changed -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("foreignEntityId", Some (Json.of_string value.foreign_entity_id));
      ("githubKey", Some (Json.of_string value.github_key));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ( "senderGithubAvatarUrl",
        Option.map Json.of_string value.sender_github_avatar_url );
      ("senderGithubLogin", Option.map Json.of_string value.sender_github_login);
      ( "senderGithubUserId",
        Option.map Json.of_string value.sender_github_user_id );
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
      ("action", Some (yojson_of_github_pr_event_action value.action));
      ("baseBranch", Option.map Json.of_string value.base_branch);
      ("headBranch", Option.map Json.of_string value.head_branch);
      ("mergedAt", Option.map Json.of_string value.merged_at);
      ( "previousStatus",
        Option.map yojson_of_github_pr_event_status value.previous_status );
      ("status", Some (yojson_of_github_pr_event_status value.status));
    ]

let make_github_pr_status_changed ~(display_name : string)
    ~(foreign_entity_id : string) ~(github_key : string) ~(number : int64)
    ~(owner : string) ~(repo : string) ?sender_github_avatar_url
    ?sender_github_login ?sender_github_user_id ~(title : string)
    ~(url : string) ~(action : github_pr_event_action) ?base_branch ?head_branch
    ?merged_at ?previous_status ~(status : github_pr_event_status) () =
  ({
     display_name;
     foreign_entity_id;
     github_key;
     number;
     owner;
     repo;
     sender_github_avatar_url;
     sender_github_login;
     sender_github_user_id;
     title;
     url;
     action;
     base_branch;
     head_branch;
     merged_at;
     previous_status;
     status;
   }
    : github_pr_status_changed)

(** The normalized result state for a GitHub pull request check-run notification. *)
type nonrec github_pr_check_run_state =
  | Completed
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pr_check_run_state_of_yojson :
    Yojson.Safe.t -> github_pr_check_run_state =
 fun json ->
  match Json.string json with
  | "completed" -> Completed
  | "failed" -> Failed
  | other -> Unknown other

and yojson_of_github_pr_check_run_state :
    github_pr_check_run_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Completed -> `String "completed"
  | Failed -> `String "failed"
  | Unknown other -> `String other

type nonrec github_pr_check_run = {
  display_name : string;  (** A compact label suitable for display in the UI. *)
  foreign_entity_id : string;
      (** The source-specific internal foreign entity row id for this pull request. *)
  github_key : string;
      (** The external GitHub key, in [owner/repo/pull/number] format. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  sender_github_avatar_url : string option;
      (** The GitHub avatar URL for the sender, when available. *)
  sender_github_login : string option;
      (** The GitHub login for the sender, when available. *)
  sender_github_user_id : string option;
      (** The stable GitHub numeric user id for the sender, serialized as a string. *)
  title : string;
      (** The GitHub pull request title. Falls back to [display_name] when GitHub has no title. *)
  url : string;  (** The public GitHub URL for the pull request. *)
  check_name : string;
      (** The display name GitHub reported for the check run. *)
  check_run_github_id : int64;  (** The GitHub numeric id of the check run. *)
  check_status : string;  (** The raw GitHub check run status. *)
  check_url : string;  (** The public GitHub URL for the check run. *)
  completed_at : string;  (** When GitHub marked the check run as complete. *)
  conclusion : string;  (** The raw GitHub check run conclusion. *)
  state : github_pr_check_run_state;
      (** The normalized notification state for this check run. *)
}
(** Metadata for a notification that a GitHub pull request check run completed. *)

let github_pr_check_run_of_yojson : Yojson.Safe.t -> github_pr_check_run =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    foreign_entity_id = Json.required fields "foreignEntityId" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    sender_github_avatar_url =
      Json.optional fields "senderGithubAvatarUrl" Json.string;
    sender_github_login = Json.optional fields "senderGithubLogin" Json.string;
    sender_github_user_id =
      Json.optional fields "senderGithubUserId" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
    check_name = Json.required fields "checkName" Json.string;
    check_run_github_id = Json.required fields "checkRunGithubId" Json.int64;
    check_status = Json.required fields "checkStatus" Json.string;
    check_url = Json.required fields "checkUrl" Json.string;
    completed_at = Json.required fields "completedAt" Json.string;
    conclusion = Json.required fields "conclusion" Json.string;
    state = Json.required fields "state" github_pr_check_run_state_of_yojson;
  }

and yojson_of_github_pr_check_run : github_pr_check_run -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("foreignEntityId", Some (Json.of_string value.foreign_entity_id));
      ("githubKey", Some (Json.of_string value.github_key));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ( "senderGithubAvatarUrl",
        Option.map Json.of_string value.sender_github_avatar_url );
      ("senderGithubLogin", Option.map Json.of_string value.sender_github_login);
      ( "senderGithubUserId",
        Option.map Json.of_string value.sender_github_user_id );
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
      ("checkName", Some (Json.of_string value.check_name));
      ("checkRunGithubId", Some (Json.of_int64 value.check_run_github_id));
      ("checkStatus", Some (Json.of_string value.check_status));
      ("checkUrl", Some (Json.of_string value.check_url));
      ("completedAt", Some (Json.of_string value.completed_at));
      ("conclusion", Some (Json.of_string value.conclusion));
      ("state", Some (yojson_of_github_pr_check_run_state value.state));
    ]

let make_github_pr_check_run ~(display_name : string)
    ~(foreign_entity_id : string) ~(github_key : string) ~(number : int64)
    ~(owner : string) ~(repo : string) ?sender_github_avatar_url
    ?sender_github_login ?sender_github_user_id ~(title : string)
    ~(url : string) ~(check_name : string) ~(check_run_github_id : int64)
    ~(check_status : string) ~(check_url : string) ~(completed_at : string)
    ~(conclusion : string) ~(state : github_pr_check_run_state) () =
  ({
     display_name;
     foreign_entity_id;
     github_key;
     number;
     owner;
     repo;
     sender_github_avatar_url;
     sender_github_login;
     sender_github_user_id;
     title;
     url;
     check_name;
     check_run_github_id;
     check_status;
     check_url;
     completed_at;
     conclusion;
     state;
   }
    : github_pr_check_run)

type nonrec github_review_requested = {
  display_name : string;  (** A compact label suitable for display in the UI. *)
  foreign_entity_id : string;
      (** The source-specific internal foreign entity row id for this pull request. *)
  github_key : string;
      (** The external GitHub key, in [owner/repo/pull/number] format. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  sender_github_avatar_url : string option;
      (** The GitHub avatar URL for the sender, when available. *)
  sender_github_login : string option;
      (** The GitHub login for the sender, when available. *)
  sender_github_user_id : string option;
      (** The stable GitHub numeric user id for the sender, serialized as a string. *)
  title : string;
      (** The GitHub pull request title. Falls back to [display_name] when GitHub has no title. *)
  url : string;  (** The public GitHub URL for the pull request. *)
  requested_reviewer_github_login : string option;
      (** The GitHub login of the requested reviewer, when available. *)
  requested_reviewer_github_user_id : string option;
      (** The stable GitHub numeric user id of the requested reviewer, serialized as a string. *)
}
(** Metadata for a notification that the user's review was requested on a GitHub pull request. *)

let github_review_requested_of_yojson : Yojson.Safe.t -> github_review_requested
    =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    foreign_entity_id = Json.required fields "foreignEntityId" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    sender_github_avatar_url =
      Json.optional fields "senderGithubAvatarUrl" Json.string;
    sender_github_login = Json.optional fields "senderGithubLogin" Json.string;
    sender_github_user_id =
      Json.optional fields "senderGithubUserId" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
    requested_reviewer_github_login =
      Json.optional fields "requestedReviewerGithubLogin" Json.string;
    requested_reviewer_github_user_id =
      Json.optional fields "requestedReviewerGithubUserId" Json.string;
  }

and yojson_of_github_review_requested : github_review_requested -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("foreignEntityId", Some (Json.of_string value.foreign_entity_id));
      ("githubKey", Some (Json.of_string value.github_key));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ( "senderGithubAvatarUrl",
        Option.map Json.of_string value.sender_github_avatar_url );
      ("senderGithubLogin", Option.map Json.of_string value.sender_github_login);
      ( "senderGithubUserId",
        Option.map Json.of_string value.sender_github_user_id );
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
      ( "requestedReviewerGithubLogin",
        Option.map Json.of_string value.requested_reviewer_github_login );
      ( "requestedReviewerGithubUserId",
        Option.map Json.of_string value.requested_reviewer_github_user_id );
    ]

let make_github_review_requested ~(display_name : string)
    ~(foreign_entity_id : string) ~(github_key : string) ~(number : int64)
    ~(owner : string) ~(repo : string) ?sender_github_avatar_url
    ?sender_github_login ?sender_github_user_id ~(title : string)
    ~(url : string) ?requested_reviewer_github_login
    ?requested_reviewer_github_user_id () =
  ({
     display_name;
     foreign_entity_id;
     github_key;
     number;
     owner;
     repo;
     sender_github_avatar_url;
     sender_github_login;
     sender_github_user_id;
     title;
     url;
     requested_reviewer_github_login;
     requested_reviewer_github_user_id;
   }
    : github_review_requested)

(** The kind of GitHub comment that triggered a \[[GithubPrComment]\] notification. *)
type nonrec github_pr_comment_kind =
  | Issue
  | Review_comment
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pr_comment_kind_of_yojson : Yojson.Safe.t -> github_pr_comment_kind =
 fun json ->
  match Json.string json with
  | "issue" -> Issue
  | "review_comment" -> Review_comment
  | other -> Unknown other

and yojson_of_github_pr_comment_kind : github_pr_comment_kind -> Yojson.Safe.t =
 fun value ->
  match value with
  | Issue -> `String "issue"
  | Review_comment -> `String "review_comment"
  | Unknown other -> `String other

type nonrec github_pr_comment = {
  display_name : string;  (** A compact label suitable for display in the UI. *)
  foreign_entity_id : string;
      (** The source-specific internal foreign entity row id for this pull request. *)
  github_key : string;
      (** The external GitHub key, in [owner/repo/pull/number] format. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  sender_github_avatar_url : string option;
      (** The GitHub avatar URL for the sender, when available. *)
  sender_github_login : string option;
      (** The GitHub login for the sender, when available. *)
  sender_github_user_id : string option;
      (** The stable GitHub numeric user id for the sender, serialized as a string. *)
  title : string;
      (** The GitHub pull request title. Falls back to [display_name] when GitHub has no title. *)
  url : string;  (** The public GitHub URL for the pull request. *)
  comment_github_id : int64 option;
      (** The GitHub numeric id of the comment, when available. *)
  comment_kind : github_pr_comment_kind;
      (** The kind of comment that was posted. *)
  comment_snippet : string;  (** A truncated excerpt of the comment body. *)
  comment_url : string option;
      (** The public GitHub URL for the comment, when available. *)
}
(** Metadata for a notification that a GitHub pull request was commented on. *)

let github_pr_comment_of_yojson : Yojson.Safe.t -> github_pr_comment =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    foreign_entity_id = Json.required fields "foreignEntityId" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    sender_github_avatar_url =
      Json.optional fields "senderGithubAvatarUrl" Json.string;
    sender_github_login = Json.optional fields "senderGithubLogin" Json.string;
    sender_github_user_id =
      Json.optional fields "senderGithubUserId" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
    comment_github_id = Json.optional fields "commentGithubId" Json.int64;
    comment_kind =
      Json.required fields "commentKind" github_pr_comment_kind_of_yojson;
    comment_snippet = Json.required fields "commentSnippet" Json.string;
    comment_url = Json.optional fields "commentUrl" Json.string;
  }

and yojson_of_github_pr_comment : github_pr_comment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("foreignEntityId", Some (Json.of_string value.foreign_entity_id));
      ("githubKey", Some (Json.of_string value.github_key));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ( "senderGithubAvatarUrl",
        Option.map Json.of_string value.sender_github_avatar_url );
      ("senderGithubLogin", Option.map Json.of_string value.sender_github_login);
      ( "senderGithubUserId",
        Option.map Json.of_string value.sender_github_user_id );
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
      ("commentGithubId", Option.map Json.of_int64 value.comment_github_id);
      ("commentKind", Some (yojson_of_github_pr_comment_kind value.comment_kind));
      ("commentSnippet", Some (Json.of_string value.comment_snippet));
      ("commentUrl", Option.map Json.of_string value.comment_url);
    ]

let make_github_pr_comment ~(display_name : string)
    ~(foreign_entity_id : string) ~(github_key : string) ~(number : int64)
    ~(owner : string) ~(repo : string) ?sender_github_avatar_url
    ?sender_github_login ?sender_github_user_id ~(title : string)
    ~(url : string) ?comment_github_id ~(comment_kind : github_pr_comment_kind)
    ~(comment_snippet : string) ?comment_url () =
  ({
     display_name;
     foreign_entity_id;
     github_key;
     number;
     owner;
     repo;
     sender_github_avatar_url;
     sender_github_login;
     sender_github_user_id;
     title;
     url;
     comment_github_id;
     comment_kind;
     comment_snippet;
     comment_url;
   }
    : github_pr_comment)

(** Where in a GitHub pull request the user was mentioned. *)
type nonrec github_pr_mention_location =
  | Pr_body
  | Comment
  | Review
  | Review_comment
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pr_mention_location_of_yojson :
    Yojson.Safe.t -> github_pr_mention_location =
 fun json ->
  match Json.string json with
  | "pr_body" -> Pr_body
  | "comment" -> Comment
  | "review" -> Review
  | "review_comment" -> Review_comment
  | other -> Unknown other

and yojson_of_github_pr_mention_location :
    github_pr_mention_location -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pr_body -> `String "pr_body"
  | Comment -> `String "comment"
  | Review -> `String "review"
  | Review_comment -> `String "review_comment"
  | Unknown other -> `String other

type nonrec github_pr_mention = {
  display_name : string;  (** A compact label suitable for display in the UI. *)
  foreign_entity_id : string;
      (** The source-specific internal foreign entity row id for this pull request. *)
  github_key : string;
      (** The external GitHub key, in [owner/repo/pull/number] format. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  sender_github_avatar_url : string option;
      (** The GitHub avatar URL for the sender, when available. *)
  sender_github_login : string option;
      (** The GitHub login for the sender, when available. *)
  sender_github_user_id : string option;
      (** The stable GitHub numeric user id for the sender, serialized as a string. *)
  title : string;
      (** The GitHub pull request title. Falls back to [display_name] when GitHub has no title. *)
  url : string;  (** The public GitHub URL for the pull request. *)
  comment_github_id : int64 option;
      (** The GitHub numeric id of the comment or review containing the mention, when available. *)
  comment_url : string option;
      (** The public GitHub URL for the text containing the mention, when available. *)
  location : github_pr_mention_location;  (** Where the mention appeared. *)
  text_snippet : string;
      (** A truncated excerpt of the text containing the mention. *)
}
(** Metadata for a notification that the user was mentioned on a GitHub pull request. *)

let github_pr_mention_of_yojson : Yojson.Safe.t -> github_pr_mention =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    foreign_entity_id = Json.required fields "foreignEntityId" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    sender_github_avatar_url =
      Json.optional fields "senderGithubAvatarUrl" Json.string;
    sender_github_login = Json.optional fields "senderGithubLogin" Json.string;
    sender_github_user_id =
      Json.optional fields "senderGithubUserId" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
    comment_github_id = Json.optional fields "commentGithubId" Json.int64;
    comment_url = Json.optional fields "commentUrl" Json.string;
    location =
      Json.required fields "location" github_pr_mention_location_of_yojson;
    text_snippet = Json.required fields "textSnippet" Json.string;
  }

and yojson_of_github_pr_mention : github_pr_mention -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("foreignEntityId", Some (Json.of_string value.foreign_entity_id));
      ("githubKey", Some (Json.of_string value.github_key));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ( "senderGithubAvatarUrl",
        Option.map Json.of_string value.sender_github_avatar_url );
      ("senderGithubLogin", Option.map Json.of_string value.sender_github_login);
      ( "senderGithubUserId",
        Option.map Json.of_string value.sender_github_user_id );
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
      ("commentGithubId", Option.map Json.of_int64 value.comment_github_id);
      ("commentUrl", Option.map Json.of_string value.comment_url);
      ("location", Some (yojson_of_github_pr_mention_location value.location));
      ("textSnippet", Some (Json.of_string value.text_snippet));
    ]

let make_github_pr_mention ~(display_name : string)
    ~(foreign_entity_id : string) ~(github_key : string) ~(number : int64)
    ~(owner : string) ~(repo : string) ?sender_github_avatar_url
    ?sender_github_login ?sender_github_user_id ~(title : string)
    ~(url : string) ?comment_github_id ?comment_url
    ~(location : github_pr_mention_location) ~(text_snippet : string) () =
  ({
     display_name;
     foreign_entity_id;
     github_key;
     number;
     owner;
     repo;
     sender_github_avatar_url;
     sender_github_login;
     sender_github_user_id;
     title;
     url;
     comment_github_id;
     comment_url;
     location;
     text_snippet;
   }
    : github_pr_mention)

(** The state of a submitted GitHub pull request review. *)
type nonrec github_pr_review_state =
  | Approved
  | Changes_requested
  | Commented
  | Unknown of string  (** A value this SDK version does not know. *)

let github_pr_review_state_of_yojson : Yojson.Safe.t -> github_pr_review_state =
 fun json ->
  match Json.string json with
  | "approved" -> Approved
  | "changes_requested" -> Changes_requested
  | "commented" -> Commented
  | other -> Unknown other

and yojson_of_github_pr_review_state : github_pr_review_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Approved -> `String "approved"
  | Changes_requested -> `String "changes_requested"
  | Commented -> `String "commented"
  | Unknown other -> `String other

type nonrec github_pr_review = {
  display_name : string;  (** A compact label suitable for display in the UI. *)
  foreign_entity_id : string;
      (** The source-specific internal foreign entity row id for this pull request. *)
  github_key : string;
      (** The external GitHub key, in [owner/repo/pull/number] format. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  sender_github_avatar_url : string option;
      (** The GitHub avatar URL for the sender, when available. *)
  sender_github_login : string option;
      (** The GitHub login for the sender, when available. *)
  sender_github_user_id : string option;
      (** The stable GitHub numeric user id for the sender, serialized as a string. *)
  title : string;
      (** The GitHub pull request title. Falls back to [display_name] when GitHub has no title. *)
  url : string;  (** The public GitHub URL for the pull request. *)
  review_github_id : int64 option;
      (** The GitHub numeric id of the review, when available. *)
  review_snippet : string option;
      (** A truncated excerpt of the review body, when any was written. *)
  review_url : string option;
      (** The public GitHub URL for the review, when available. *)
  state : github_pr_review_state;  (** The review decision state. *)
}
(** Metadata for a notification that a review was submitted on the user's GitHub pull request. *)

let github_pr_review_of_yojson : Yojson.Safe.t -> github_pr_review =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    foreign_entity_id = Json.required fields "foreignEntityId" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    sender_github_avatar_url =
      Json.optional fields "senderGithubAvatarUrl" Json.string;
    sender_github_login = Json.optional fields "senderGithubLogin" Json.string;
    sender_github_user_id =
      Json.optional fields "senderGithubUserId" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
    review_github_id = Json.optional fields "reviewGithubId" Json.int64;
    review_snippet = Json.optional fields "reviewSnippet" Json.string;
    review_url = Json.optional fields "reviewUrl" Json.string;
    state = Json.required fields "state" github_pr_review_state_of_yojson;
  }

and yojson_of_github_pr_review : github_pr_review -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("foreignEntityId", Some (Json.of_string value.foreign_entity_id));
      ("githubKey", Some (Json.of_string value.github_key));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ( "senderGithubAvatarUrl",
        Option.map Json.of_string value.sender_github_avatar_url );
      ("senderGithubLogin", Option.map Json.of_string value.sender_github_login);
      ( "senderGithubUserId",
        Option.map Json.of_string value.sender_github_user_id );
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
      ("reviewGithubId", Option.map Json.of_int64 value.review_github_id);
      ("reviewSnippet", Option.map Json.of_string value.review_snippet);
      ("reviewUrl", Option.map Json.of_string value.review_url);
      ("state", Some (yojson_of_github_pr_review_state value.state));
    ]

let make_github_pr_review ~(display_name : string) ~(foreign_entity_id : string)
    ~(github_key : string) ~(number : int64) ~(owner : string) ~(repo : string)
    ?sender_github_avatar_url ?sender_github_login ?sender_github_user_id
    ~(title : string) ~(url : string) ?review_github_id ?review_snippet
    ?review_url ~(state : github_pr_review_state) () =
  ({
     display_name;
     foreign_entity_id;
     github_key;
     number;
     owner;
     repo;
     sender_github_avatar_url;
     sender_github_login;
     sender_github_user_id;
     title;
     url;
     review_github_id;
     review_snippet;
     review_url;
     state;
   }
    : github_pr_review)

type nonrec channel_message_reaction_metadata = {
  channel_name : string option;
  channel_type : channel_type;
  emoji : string;  (** The emoji added by the reactor. *)
  message_content : string;  (** The reacted-to message content. *)
  message_id : string;  (** The reacted-to message id. *)
  sender_profile_picture_url : string option;
      (** Optional reactor profile picture URL. *)
  thread_id : string option;
      (** The thread root id when the reacted-to message is a reply. *)
}
(** Metadata for a reaction added to one of the recipient's channel messages. *)

let channel_message_reaction_metadata_of_yojson :
    Yojson.Safe.t -> channel_message_reaction_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channelName" Json.string;
    channel_type = Json.required fields "channelType" channel_type_of_yojson;
    emoji = Json.required fields "emoji" Json.string;
    message_content = Json.required fields "messageContent" Json.string;
    message_id = Json.required fields "messageId" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
    thread_id = Json.optional fields "threadId" Json.string;
  }

and yojson_of_channel_message_reaction_metadata :
    channel_message_reaction_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channelName", Option.map Json.of_string value.channel_name);
      ("channelType", Some (yojson_of_channel_type value.channel_type));
      ("emoji", Some (Json.of_string value.emoji));
      ("messageContent", Some (Json.of_string value.message_content));
      ("messageId", Some (Json.of_string value.message_id));
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
      ("threadId", Option.map Json.of_string value.thread_id);
    ]

let make_channel_message_reaction_metadata ?channel_name
    ~(channel_type : channel_type) ~(emoji : string) ~(message_content : string)
    ~(message_id : string) ?sender_profile_picture_url ?thread_id () =
  ({
     channel_name;
     channel_type;
     emoji;
     message_content;
     message_id;
     sender_profile_picture_url;
     thread_id;
   }
    : channel_message_reaction_metadata)

type nonrec calendar_event_join_request_metadata = {
  event_id : string;
      (** The shared calendar event entity the request is for. *)
  request_id : string;
      (** Stable request identity, answered from the event's details. *)
  title : string;  (** Event title when the request was made. *)
}
(** A channel member who sees a calendar event only through a channel share
asked the person who shared it to add them as a guest. Sent to the sharer,
with the requester as sender. *)

let calendar_event_join_request_metadata_of_yojson :
    Yojson.Safe.t -> calendar_event_join_request_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    event_id = Json.required fields "eventId" Json.string;
    request_id = Json.required fields "requestId" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_calendar_event_join_request_metadata :
    calendar_event_join_request_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("eventId", Some (Json.of_string value.event_id));
      ("requestId", Some (Json.of_string value.request_id));
      ("title", Some (Json.of_string value.title));
    ]

let make_calendar_event_join_request_metadata ~(event_id : string)
    ~(request_id : string) ~(title : string) () =
  ({ event_id; request_id; title } : calendar_event_join_request_metadata)

type nonrec channel_access_requested_metadata = {
  channel_name : string option;
  channel_type : channel_type;
  request_id : string;
      (** The attempt to join, which is also this notification's id. *)
  sender_profile_picture_url : string option;
      (** Optional requester profile picture URL. *)
}
(** A person asked to join a channel the recipient participates in. *)

let channel_access_requested_metadata_of_yojson :
    Yojson.Safe.t -> channel_access_requested_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channelName" Json.string;
    channel_type = Json.required fields "channelType" channel_type_of_yojson;
    request_id = Json.required fields "requestId" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
  }

and yojson_of_channel_access_requested_metadata :
    channel_access_requested_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channelName", Option.map Json.of_string value.channel_name);
      ("channelType", Some (yojson_of_channel_type value.channel_type));
      ("requestId", Some (Json.of_string value.request_id));
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
    ]

let make_channel_access_requested_metadata ?channel_name
    ~(channel_type : channel_type) ~(request_id : string)
    ?sender_profile_picture_url () =
  ({ channel_name; channel_type; request_id; sender_profile_picture_url }
    : channel_access_requested_metadata)

(** How a routine run ended, as its notification reports it. *)
type nonrec routine_run_outcome =
  | Succeeded
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let routine_run_outcome_of_yojson : Yojson.Safe.t -> routine_run_outcome =
 fun json ->
  match Json.string json with
  | "succeeded" -> Succeeded
  | "failed" -> Failed
  | other -> Unknown other

and yojson_of_routine_run_outcome : routine_run_outcome -> Yojson.Safe.t =
 fun value ->
  match value with
  | Succeeded -> `String "succeeded"
  | Failed -> `String "failed"
  | Unknown other -> `String other

type nonrec routine_run_finished_metadata = {
  outcome : routine_run_outcome;  (** How the run ended. *)
  routine_id : string;  (** The routine that ran. *)
  routine_name : string;  (** The routine's name when it ran. *)
}
(** One of the recipient's routines finished a run. Every run notifies,
whether it succeeded or failed. *)

let routine_run_finished_metadata_of_yojson :
    Yojson.Safe.t -> routine_run_finished_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    outcome = Json.required fields "outcome" routine_run_outcome_of_yojson;
    routine_id = Json.required fields "routineId" Json.string;
    routine_name = Json.required fields "routineName" Json.string;
  }

and yojson_of_routine_run_finished_metadata :
    routine_run_finished_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("outcome", Some (yojson_of_routine_run_outcome value.outcome));
      ("routineId", Some (Json.of_string value.routine_id));
      ("routineName", Some (Json.of_string value.routine_name));
    ]

let make_routine_run_finished_metadata ~(outcome : routine_run_outcome)
    ~(routine_id : string) ~(routine_name : string) () =
  ({ outcome; routine_id; routine_name } : routine_run_finished_metadata)

type nonrec computer_setup_agent = {
  name : string;  (** The agent's name. *)
  user_id : string;  (** The agent's Macro user id, to open a DM with it. *)
}
(** The agent teammate a computer was bought for, so its inviter hears about
the agent rather than the machine. *)

let computer_setup_agent_of_yojson : Yojson.Safe.t -> computer_setup_agent =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.required fields "name" Json.string;
    user_id = Json.required fields "userId" Json.string;
  }

and yojson_of_computer_setup_agent : computer_setup_agent -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Some (Json.of_string value.name));
      ("userId", Some (Json.of_string value.user_id));
    ]

let make_computer_setup_agent ~(name : string) ~(user_id : string) () =
  ({ name; user_id } : computer_setup_agent)

(** How a computer's first setup ended. *)
type nonrec computer_setup_outcome =
  | Ready  (** macrod connected for the first time: the computer is ready. *)
  | Failed of {
      failure_reason : string;
          (** Why, in the words the computer's status shows. *)
    }  (** Setup gave up before the computer was ready. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let computer_setup_outcome_of_yojson : Yojson.Safe.t -> computer_setup_outcome =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "ready" -> Ready
  | "failed" ->
      Failed
        { failure_reason = Json.required fields "failureReason" Json.string }
  | _ -> Unknown json

and yojson_of_computer_setup_outcome : computer_setup_outcome -> Yojson.Safe.t =
 fun value ->
  match value with
  | Ready -> Json.record [ ("kind", Some (`String "ready")) ]
  | Failed case ->
      Json.record
        [
          ("kind", Some (`String "failed"));
          ("failureReason", Some (Json.of_string case.failure_reason));
        ]
  | Unknown json -> json

let make_computer_setup_outcome_failed ~(failure_reason : string) () =
  (Failed { failure_reason } : computer_setup_outcome)

type nonrec computer_setup_metadata = {
  agent : computer_setup_agent option;
  computer_id : string;  (** The computer that was set up. *)
  computer_name : string;  (** The computer's name when the notice was sent. *)
  harness_id : string option;
      (** The computer's harness, once macrod has connected. *)
  outcome : computer_setup_outcome;  (** Ready, or why setup failed. *)
}
(** A team's Macro computer finished first-time setup, or could not be set
up. Sent to its buyer, who continues (or retries) from the setup flow. *)

let computer_setup_metadata_of_yojson : Yojson.Safe.t -> computer_setup_metadata
    =
 fun json ->
  let fields = Json.obj json in
  {
    agent = Json.optional fields "agent" computer_setup_agent_of_yojson;
    computer_id = Json.required fields "computerId" Json.string;
    computer_name = Json.required fields "computerName" Json.string;
    harness_id = Json.optional fields "harnessId" Json.string;
    outcome = Json.required fields "outcome" computer_setup_outcome_of_yojson;
  }

and yojson_of_computer_setup_metadata : computer_setup_metadata -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("agent", Option.map yojson_of_computer_setup_agent value.agent);
      ("computerId", Some (Json.of_string value.computer_id));
      ("computerName", Some (Json.of_string value.computer_name));
      ("harnessId", Option.map Json.of_string value.harness_id);
      ("outcome", Some (yojson_of_computer_setup_outcome value.outcome));
    ]

let make_computer_setup_metadata ?agent ~(computer_id : string)
    ~(computer_name : string) ?harness_id ~(outcome : computer_setup_outcome) ()
    =
  ({ agent; computer_id; computer_name; harness_id; outcome }
    : computer_setup_metadata)

type nonrec stopped_agent = {
  bot_id : string;  (** The agent's bot id. *)
  name : string;  (** The agent's display name. *)
}
(** One of the recipient's agents that stopped with their runtime access. *)

let stopped_agent_of_yojson : Yojson.Safe.t -> stopped_agent =
 fun json ->
  let fields = Json.obj json in
  {
    bot_id = Json.required fields "botId" Json.string;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_stopped_agent : stopped_agent -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("botId", Some (Json.of_string value.bot_id));
      ("name", Some (Json.of_string value.name));
    ]

let make_stopped_agent ~(bot_id : string) ~(name : string) () =
  ({ bot_id; name } : stopped_agent)

type nonrec runtime_access_removed_metadata = {
  agents : stopped_agent list;
      (** The recipient's agents living on the runtime, which stopped. Never
empty: without one there is nothing to tell them. *)
  runtime_name : string;  (** The runtime's name. *)
}
(** A runtime's owner removed the recipient's access to it, or lowered it to
Read, and agents the recipient keeps living there stopped. *)

let runtime_access_removed_metadata_of_yojson :
    Yojson.Safe.t -> runtime_access_removed_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    agents = Json.required fields "agents" (Json.list stopped_agent_of_yojson);
    runtime_name = Json.required fields "runtimeName" Json.string;
  }

and yojson_of_runtime_access_removed_metadata :
    runtime_access_removed_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("agents", Some ((Json.of_list yojson_of_stopped_agent) value.agents));
      ("runtimeName", Some (Json.of_string value.runtime_name));
    ]

let make_runtime_access_removed_metadata ~(agents : stopped_agent list)
    ~(runtime_name : string) () =
  ({ agents; runtime_name } : runtime_access_removed_metadata)

(** Mirrors \[[model_notifications::NotificationEvent]\] but uses [tag] / [content]
as the serde adjacently-tagged field names so it can be deserialized from the
shape produced by \[[UserNotificationRow::into_tagged]\] +
\[[UserNotificationRow::into_json]\].

Only includes variants whose metadata types implement the [Notification] trait. *)
type nonrec notif_event =
  | Channel_mention of {
      content : channel_mention_metadata;
          (** Someone mentioned you in a channel. *)
    }  (** Someone mentioned you in a channel. *)
  | Document_mention of {
      content : document_mention_metadata;
          (** Someone mentioned a document in a channel. *)
    }  (** Someone mentioned a document in a channel. *)
  | Mentioned_in_document_comment of {
      content : mentioned_in_document_comment_metadata;
          (** User was mentioned in a comment in a document *)
    }  (** User was mentioned in a comment in a document *)
  | Replied_to_document_comment_thread of {
      content : replied_to_document_comment_thread_metadata;
          (** Someone replied to a document comment thread the user participated in. *)
    }
      (** Someone replied to a document comment thread the user participated in. *)
  | Commented_on_document of {
      content : commented_on_document_metadata;
          (** Someone commented on a document the user owns. *)
    }  (** Someone commented on a document the user owns. *)
  | Entity_access_requested of {
      content : entity_access_requested_metadata;
          (** Someone requested more access to a shared entity. *)
    }  (** Someone requested more access to a shared entity. *)
  | Entity_access_granted of {
      content : entity_access_granted_metadata;
          (** An owner granted requested access. *)
    }  (** An owner granted requested access. *)
  | Initiative_discussion of {
      content : initiative_discussion_metadata;
          (** Someone commented, replied, or mentioned the recipient on a project. *)
    }
      (** Someone commented, replied, or mentioned the recipient on a project. *)
  | Crm_discussion of {
      content : crm_discussion_metadata;
          (** Someone commented, replied, or mentioned the recipient on a CRM company or contact. *)
    }
      (** Someone commented, replied, or mentioned the recipient on a CRM company or contact. *)
  | Channel_invite of {
      content : channel_invite_metadata;
          (** The user was invited to a channel. *)
    }  (** The user was invited to a channel. *)
  | Channel_message_send of {
      content : channel_message_send_metadata;
          (** A user sent a message in a channel. *)
    }  (** A user sent a message in a channel. *)
  | Channel_message_reply of {
      content : channel_reply_metadata;
          (** Someone replied to a thread in a channel that the user is part of. *)
    }  (** Someone replied to a thread in a channel that the user is part of. *)
  | Call_started of {
      content : call_started_metadata;
          (** A call has started in a channel the user is a member of.

The [call-started] alias keeps rows persisted before the type name
was normalized to snake_case ([call_started]) deserializable. *)
    }
      (** A call has started in a channel the user is a member of.

The [call-started] alias keeps rows persisted before the type name
was normalized to snake_case ([call_started]) deserializable. *)
  | New_email of {
      content : new_email_metadata;
          (** A new email has been sent to the user. *)
    }  (** A new email has been sent to the user. *)
  | Inbox_reauth_required of {
      content : inbox_reauth_required_metadata;
          (** A linked inbox's grant died and must be reconnected. *)
    }  (** A linked inbox's grant died and must be reconnected. *)
  | Invite_to_team of {
      content : invite_to_team_metadata;  (** A user was invited to a team. *)
    }  (** A user was invited to a team. *)
  | Task_assigned of {
      content : task_assigned_metadata;  (** A user was assigned to a task. *)
    }  (** A user was assigned to a task. *)
  | Reminder of {
      content : reminder_metadata;
          (** A reminder the user set for themselves came due. *)
    }  (** A reminder the user set for themselves came due. *)
  | External_chat_message of {
      content : external_chat_message_metadata;
          (** A live message in a shared external chat. *)
    }  (** A live message in a shared external chat. *)
  | Calendar_event_reminder of {
      content : calendar_event_reminder_metadata;
          (** A calendar event alarm came due. *)
    }  (** A calendar event alarm came due. *)
  | Ai_response of {
      content : ai_response_metadata;
          (** An AI assistant responded to a chat. *)
    }  (** An AI assistant responded to a chat. *)
  | Github_pr_status_changed of {
      content : github_pr_status_changed;
          (** A GitHub pull request changed lifecycle state.

The [github_pr_event] alias keeps rows and queue messages persisted
before the rename deserializable. *)
    }
      (** A GitHub pull request changed lifecycle state.

The [github_pr_event] alias keeps rows and queue messages persisted
before the rename deserializable. *)
  | Github_pr_check_run of {
      content : github_pr_check_run;
          (** A GitHub pull request check run completed. *)
    }  (** A GitHub pull request check run completed. *)
  | Github_review_requested of {
      content : github_review_requested;
          (** The user's review was requested on a GitHub pull request. *)
    }  (** The user's review was requested on a GitHub pull request. *)
  | Github_pr_comment of {
      content : github_pr_comment;
          (** A GitHub pull request was commented on. *)
    }  (** A GitHub pull request was commented on. *)
  | Github_pr_mention of {
      content : github_pr_mention;
          (** The user was mentioned on a GitHub pull request. *)
    }  (** The user was mentioned on a GitHub pull request. *)
  | Github_pr_review of {
      content : github_pr_review;
          (** A review was submitted on the user's GitHub pull request. *)
    }  (** A review was submitted on the user's GitHub pull request. *)
  | Agent_session_settled of {
      content : agent_session_settled_metadata;
          (** An agent finished a turn with nothing queued behind it. *)
    }  (** An agent finished a turn with nothing queued behind it. *)
  | Agent_session_waiting_for_input of {
      content : agent_session_waiting_for_input_metadata;
          (** An agent is blocked on a question for the session's owner. *)
    }  (** An agent is blocked on a question for the session's owner. *)
  | Agent_session_mentioned of {
      content : agent_session_mentioned_metadata;
          (** The user was named in a prompt to an agent session. *)
    }  (** The user was named in a prompt to an agent session. *)
  | Channel_message_reaction of {
      content : channel_message_reaction_metadata;
          (** Someone reacted to one of the user's channel messages. *)
    }  (** Someone reacted to one of the user's channel messages. *)
  | Calendar_event_join_request of {
      content : calendar_event_join_request_metadata;
          (** A channel member asked to be added as a guest of an event the
user shared with the channel. *)
    }
      (** A channel member asked to be added as a guest of an event the
user shared with the channel. *)
  | Channel_access_requested of {
      content : channel_access_requested_metadata;
          (** Someone asked to join a channel the user participates in. *)
    }  (** Someone asked to join a channel the user participates in. *)
  | Routine_run_finished of {
      content : routine_run_finished_metadata;
          (** One of the user's routines finished a run, successfully or not. *)
    }  (** One of the user's routines finished a run, successfully or not. *)
  | Agent_sign_in_expiry of {
      content : agent_sign_in_expiry_metadata;
          (** An agent's sign-in on one of the team's Macro computers is about
to expire, expired, or was rejected. *)
    }
      (** An agent's sign-in on one of the team's Macro computers is about
to expire, expired, or was rejected. *)
  | Computer_setup of {
      content : computer_setup_metadata;
          (** A Macro computer the user bought finished first-time setup, or
could not be set up. *)
    }
      (** A Macro computer the user bought finished first-time setup, or
could not be set up. *)
  | Runtime_access_removed of {
      content : runtime_access_removed_metadata;
          (** A runtime's owner removed the user's access to it, and agents of
theirs living there stopped. *)
    }
      (** A runtime's owner removed the user's access to it, and agents of
theirs living there stopped. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let notif_event_of_yojson : Yojson.Safe.t -> notif_event =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "tag" with
  | "channel_mention" ->
      Channel_mention
        {
          content =
            Json.required fields "content" channel_mention_metadata_of_yojson;
        }
  | "document_mention" ->
      Document_mention
        {
          content =
            Json.required fields "content" document_mention_metadata_of_yojson;
        }
  | "mentioned_in_document_comment" ->
      Mentioned_in_document_comment
        {
          content =
            Json.required fields "content"
              mentioned_in_document_comment_metadata_of_yojson;
        }
  | "replied_to_document_comment_thread" ->
      Replied_to_document_comment_thread
        {
          content =
            Json.required fields "content"
              replied_to_document_comment_thread_metadata_of_yojson;
        }
  | "commented_on_document" ->
      Commented_on_document
        {
          content =
            Json.required fields "content"
              commented_on_document_metadata_of_yojson;
        }
  | "entity_access_requested" ->
      Entity_access_requested
        {
          content =
            Json.required fields "content"
              entity_access_requested_metadata_of_yojson;
        }
  | "entity_access_granted" ->
      Entity_access_granted
        {
          content =
            Json.required fields "content"
              entity_access_granted_metadata_of_yojson;
        }
  | "initiative_discussion" ->
      Initiative_discussion
        {
          content =
            Json.required fields "content"
              initiative_discussion_metadata_of_yojson;
        }
  | "crm_discussion" ->
      Crm_discussion
        {
          content =
            Json.required fields "content" crm_discussion_metadata_of_yojson;
        }
  | "channel_invite" ->
      Channel_invite
        {
          content =
            Json.required fields "content" channel_invite_metadata_of_yojson;
        }
  | "channel_message_send" ->
      Channel_message_send
        {
          content =
            Json.required fields "content"
              channel_message_send_metadata_of_yojson;
        }
  | "channel_message_reply" ->
      Channel_message_reply
        {
          content =
            Json.required fields "content" channel_reply_metadata_of_yojson;
        }
  | "call_started" ->
      Call_started
        {
          content =
            Json.required fields "content" call_started_metadata_of_yojson;
        }
  | "new_email" ->
      New_email
        {
          content = Json.required fields "content" new_email_metadata_of_yojson;
        }
  | "inbox_reauth_required" ->
      Inbox_reauth_required
        {
          content =
            Json.required fields "content"
              inbox_reauth_required_metadata_of_yojson;
        }
  | "invite_to_team" ->
      Invite_to_team
        {
          content =
            Json.required fields "content" invite_to_team_metadata_of_yojson;
        }
  | "task_assigned" ->
      Task_assigned
        {
          content =
            Json.required fields "content" task_assigned_metadata_of_yojson;
        }
  | "reminder" ->
      Reminder
        { content = Json.required fields "content" reminder_metadata_of_yojson }
  | "external_chat_message" ->
      External_chat_message
        {
          content =
            Json.required fields "content"
              external_chat_message_metadata_of_yojson;
        }
  | "calendar_event_reminder" ->
      Calendar_event_reminder
        {
          content =
            Json.required fields "content"
              calendar_event_reminder_metadata_of_yojson;
        }
  | "ai_response" ->
      Ai_response
        {
          content =
            Json.required fields "content" ai_response_metadata_of_yojson;
        }
  | "github_pr_status_changed" ->
      Github_pr_status_changed
        {
          content =
            Json.required fields "content" github_pr_status_changed_of_yojson;
        }
  | "github_pr_check_run" ->
      Github_pr_check_run
        {
          content = Json.required fields "content" github_pr_check_run_of_yojson;
        }
  | "github_review_requested" ->
      Github_review_requested
        {
          content =
            Json.required fields "content" github_review_requested_of_yojson;
        }
  | "github_pr_comment" ->
      Github_pr_comment
        { content = Json.required fields "content" github_pr_comment_of_yojson }
  | "github_pr_mention" ->
      Github_pr_mention
        { content = Json.required fields "content" github_pr_mention_of_yojson }
  | "github_pr_review" ->
      Github_pr_review
        { content = Json.required fields "content" github_pr_review_of_yojson }
  | "agent_session_settled" ->
      Agent_session_settled
        {
          content =
            Json.required fields "content"
              agent_session_settled_metadata_of_yojson;
        }
  | "agent_session_waiting_for_input" ->
      Agent_session_waiting_for_input
        {
          content =
            Json.required fields "content"
              agent_session_waiting_for_input_metadata_of_yojson;
        }
  | "agent_session_mentioned" ->
      Agent_session_mentioned
        {
          content =
            Json.required fields "content"
              agent_session_mentioned_metadata_of_yojson;
        }
  | "channel_message_reaction" ->
      Channel_message_reaction
        {
          content =
            Json.required fields "content"
              channel_message_reaction_metadata_of_yojson;
        }
  | "calendar_event_join_request" ->
      Calendar_event_join_request
        {
          content =
            Json.required fields "content"
              calendar_event_join_request_metadata_of_yojson;
        }
  | "channel_access_requested" ->
      Channel_access_requested
        {
          content =
            Json.required fields "content"
              channel_access_requested_metadata_of_yojson;
        }
  | "routine_run_finished" ->
      Routine_run_finished
        {
          content =
            Json.required fields "content"
              routine_run_finished_metadata_of_yojson;
        }
  | "agent_sign_in_expiry" ->
      Agent_sign_in_expiry
        {
          content =
            Json.required fields "content"
              agent_sign_in_expiry_metadata_of_yojson;
        }
  | "computer_setup" ->
      Computer_setup
        {
          content =
            Json.required fields "content" computer_setup_metadata_of_yojson;
        }
  | "runtime_access_removed" ->
      Runtime_access_removed
        {
          content =
            Json.required fields "content"
              runtime_access_removed_metadata_of_yojson;
        }
  | _ -> Unknown json

and yojson_of_notif_event : notif_event -> Yojson.Safe.t =
 fun value ->
  match value with
  | Channel_mention case ->
      Json.record
        [
          ("tag", Some (`String "channel_mention"));
          ("content", Some (yojson_of_channel_mention_metadata case.content));
        ]
  | Document_mention case ->
      Json.record
        [
          ("tag", Some (`String "document_mention"));
          ("content", Some (yojson_of_document_mention_metadata case.content));
        ]
  | Mentioned_in_document_comment case ->
      Json.record
        [
          ("tag", Some (`String "mentioned_in_document_comment"));
          ( "content",
            Some (yojson_of_mentioned_in_document_comment_metadata case.content)
          );
        ]
  | Replied_to_document_comment_thread case ->
      Json.record
        [
          ("tag", Some (`String "replied_to_document_comment_thread"));
          ( "content",
            Some
              (yojson_of_replied_to_document_comment_thread_metadata
                 case.content) );
        ]
  | Commented_on_document case ->
      Json.record
        [
          ("tag", Some (`String "commented_on_document"));
          ( "content",
            Some (yojson_of_commented_on_document_metadata case.content) );
        ]
  | Entity_access_requested case ->
      Json.record
        [
          ("tag", Some (`String "entity_access_requested"));
          ( "content",
            Some (yojson_of_entity_access_requested_metadata case.content) );
        ]
  | Entity_access_granted case ->
      Json.record
        [
          ("tag", Some (`String "entity_access_granted"));
          ( "content",
            Some (yojson_of_entity_access_granted_metadata case.content) );
        ]
  | Initiative_discussion case ->
      Json.record
        [
          ("tag", Some (`String "initiative_discussion"));
          ( "content",
            Some (yojson_of_initiative_discussion_metadata case.content) );
        ]
  | Crm_discussion case ->
      Json.record
        [
          ("tag", Some (`String "crm_discussion"));
          ("content", Some (yojson_of_crm_discussion_metadata case.content));
        ]
  | Channel_invite case ->
      Json.record
        [
          ("tag", Some (`String "channel_invite"));
          ("content", Some (yojson_of_channel_invite_metadata case.content));
        ]
  | Channel_message_send case ->
      Json.record
        [
          ("tag", Some (`String "channel_message_send"));
          ( "content",
            Some (yojson_of_channel_message_send_metadata case.content) );
        ]
  | Channel_message_reply case ->
      Json.record
        [
          ("tag", Some (`String "channel_message_reply"));
          ("content", Some (yojson_of_channel_reply_metadata case.content));
        ]
  | Call_started case ->
      Json.record
        [
          ("tag", Some (`String "call_started"));
          ("content", Some (yojson_of_call_started_metadata case.content));
        ]
  | New_email case ->
      Json.record
        [
          ("tag", Some (`String "new_email"));
          ("content", Some (yojson_of_new_email_metadata case.content));
        ]
  | Inbox_reauth_required case ->
      Json.record
        [
          ("tag", Some (`String "inbox_reauth_required"));
          ( "content",
            Some (yojson_of_inbox_reauth_required_metadata case.content) );
        ]
  | Invite_to_team case ->
      Json.record
        [
          ("tag", Some (`String "invite_to_team"));
          ("content", Some (yojson_of_invite_to_team_metadata case.content));
        ]
  | Task_assigned case ->
      Json.record
        [
          ("tag", Some (`String "task_assigned"));
          ("content", Some (yojson_of_task_assigned_metadata case.content));
        ]
  | Reminder case ->
      Json.record
        [
          ("tag", Some (`String "reminder"));
          ("content", Some (yojson_of_reminder_metadata case.content));
        ]
  | External_chat_message case ->
      Json.record
        [
          ("tag", Some (`String "external_chat_message"));
          ( "content",
            Some (yojson_of_external_chat_message_metadata case.content) );
        ]
  | Calendar_event_reminder case ->
      Json.record
        [
          ("tag", Some (`String "calendar_event_reminder"));
          ( "content",
            Some (yojson_of_calendar_event_reminder_metadata case.content) );
        ]
  | Ai_response case ->
      Json.record
        [
          ("tag", Some (`String "ai_response"));
          ("content", Some (yojson_of_ai_response_metadata case.content));
        ]
  | Github_pr_status_changed case ->
      Json.record
        [
          ("tag", Some (`String "github_pr_status_changed"));
          ("content", Some (yojson_of_github_pr_status_changed case.content));
        ]
  | Github_pr_check_run case ->
      Json.record
        [
          ("tag", Some (`String "github_pr_check_run"));
          ("content", Some (yojson_of_github_pr_check_run case.content));
        ]
  | Github_review_requested case ->
      Json.record
        [
          ("tag", Some (`String "github_review_requested"));
          ("content", Some (yojson_of_github_review_requested case.content));
        ]
  | Github_pr_comment case ->
      Json.record
        [
          ("tag", Some (`String "github_pr_comment"));
          ("content", Some (yojson_of_github_pr_comment case.content));
        ]
  | Github_pr_mention case ->
      Json.record
        [
          ("tag", Some (`String "github_pr_mention"));
          ("content", Some (yojson_of_github_pr_mention case.content));
        ]
  | Github_pr_review case ->
      Json.record
        [
          ("tag", Some (`String "github_pr_review"));
          ("content", Some (yojson_of_github_pr_review case.content));
        ]
  | Agent_session_settled case ->
      Json.record
        [
          ("tag", Some (`String "agent_session_settled"));
          ( "content",
            Some (yojson_of_agent_session_settled_metadata case.content) );
        ]
  | Agent_session_waiting_for_input case ->
      Json.record
        [
          ("tag", Some (`String "agent_session_waiting_for_input"));
          ( "content",
            Some
              (yojson_of_agent_session_waiting_for_input_metadata case.content)
          );
        ]
  | Agent_session_mentioned case ->
      Json.record
        [
          ("tag", Some (`String "agent_session_mentioned"));
          ( "content",
            Some (yojson_of_agent_session_mentioned_metadata case.content) );
        ]
  | Channel_message_reaction case ->
      Json.record
        [
          ("tag", Some (`String "channel_message_reaction"));
          ( "content",
            Some (yojson_of_channel_message_reaction_metadata case.content) );
        ]
  | Calendar_event_join_request case ->
      Json.record
        [
          ("tag", Some (`String "calendar_event_join_request"));
          ( "content",
            Some (yojson_of_calendar_event_join_request_metadata case.content)
          );
        ]
  | Channel_access_requested case ->
      Json.record
        [
          ("tag", Some (`String "channel_access_requested"));
          ( "content",
            Some (yojson_of_channel_access_requested_metadata case.content) );
        ]
  | Routine_run_finished case ->
      Json.record
        [
          ("tag", Some (`String "routine_run_finished"));
          ( "content",
            Some (yojson_of_routine_run_finished_metadata case.content) );
        ]
  | Agent_sign_in_expiry case ->
      Json.record
        [
          ("tag", Some (`String "agent_sign_in_expiry"));
          ( "content",
            Some (yojson_of_agent_sign_in_expiry_metadata case.content) );
        ]
  | Computer_setup case ->
      Json.record
        [
          ("tag", Some (`String "computer_setup"));
          ("content", Some (yojson_of_computer_setup_metadata case.content));
        ]
  | Runtime_access_removed case ->
      Json.record
        [
          ("tag", Some (`String "runtime_access_removed"));
          ( "content",
            Some (yojson_of_runtime_access_removed_metadata case.content) );
        ]
  | Unknown json -> json

let make_notif_event_channel_mention ~(content : channel_mention_metadata) () =
  (Channel_mention { content } : notif_event)

let make_notif_event_document_mention ~(content : document_mention_metadata) ()
    =
  (Document_mention { content } : notif_event)

let make_notif_event_mentioned_in_document_comment
    ~(content : mentioned_in_document_comment_metadata) () =
  (Mentioned_in_document_comment { content } : notif_event)

let make_notif_event_replied_to_document_comment_thread
    ~(content : replied_to_document_comment_thread_metadata) () =
  (Replied_to_document_comment_thread { content } : notif_event)

let make_notif_event_commented_on_document
    ~(content : commented_on_document_metadata) () =
  (Commented_on_document { content } : notif_event)

let make_notif_event_entity_access_requested
    ~(content : entity_access_requested_metadata) () =
  (Entity_access_requested { content } : notif_event)

let make_notif_event_entity_access_granted
    ~(content : entity_access_granted_metadata) () =
  (Entity_access_granted { content } : notif_event)

let make_notif_event_initiative_discussion
    ~(content : initiative_discussion_metadata) () =
  (Initiative_discussion { content } : notif_event)

let make_notif_event_crm_discussion ~(content : crm_discussion_metadata) () =
  (Crm_discussion { content } : notif_event)

let make_notif_event_channel_invite ~(content : channel_invite_metadata) () =
  (Channel_invite { content } : notif_event)

let make_notif_event_channel_message_send
    ~(content : channel_message_send_metadata) () =
  (Channel_message_send { content } : notif_event)

let make_notif_event_channel_message_reply ~(content : channel_reply_metadata)
    () =
  (Channel_message_reply { content } : notif_event)

let make_notif_event_call_started ~(content : call_started_metadata) () =
  (Call_started { content } : notif_event)

let make_notif_event_new_email ~(content : new_email_metadata) () =
  (New_email { content } : notif_event)

let make_notif_event_inbox_reauth_required
    ~(content : inbox_reauth_required_metadata) () =
  (Inbox_reauth_required { content } : notif_event)

let make_notif_event_invite_to_team ~(content : invite_to_team_metadata) () =
  (Invite_to_team { content } : notif_event)

let make_notif_event_task_assigned ~(content : task_assigned_metadata) () =
  (Task_assigned { content } : notif_event)

let make_notif_event_reminder ~(content : reminder_metadata) () =
  (Reminder { content } : notif_event)

let make_notif_event_external_chat_message
    ~(content : external_chat_message_metadata) () =
  (External_chat_message { content } : notif_event)

let make_notif_event_calendar_event_reminder
    ~(content : calendar_event_reminder_metadata) () =
  (Calendar_event_reminder { content } : notif_event)

let make_notif_event_ai_response ~(content : ai_response_metadata) () =
  (Ai_response { content } : notif_event)

let make_notif_event_github_pr_status_changed
    ~(content : github_pr_status_changed) () =
  (Github_pr_status_changed { content } : notif_event)

let make_notif_event_github_pr_check_run ~(content : github_pr_check_run) () =
  (Github_pr_check_run { content } : notif_event)

let make_notif_event_github_review_requested
    ~(content : github_review_requested) () =
  (Github_review_requested { content } : notif_event)

let make_notif_event_github_pr_comment ~(content : github_pr_comment) () =
  (Github_pr_comment { content } : notif_event)

let make_notif_event_github_pr_mention ~(content : github_pr_mention) () =
  (Github_pr_mention { content } : notif_event)

let make_notif_event_github_pr_review ~(content : github_pr_review) () =
  (Github_pr_review { content } : notif_event)

let make_notif_event_agent_session_settled
    ~(content : agent_session_settled_metadata) () =
  (Agent_session_settled { content } : notif_event)

let make_notif_event_agent_session_waiting_for_input
    ~(content : agent_session_waiting_for_input_metadata) () =
  (Agent_session_waiting_for_input { content } : notif_event)

let make_notif_event_agent_session_mentioned
    ~(content : agent_session_mentioned_metadata) () =
  (Agent_session_mentioned { content } : notif_event)

let make_notif_event_channel_message_reaction
    ~(content : channel_message_reaction_metadata) () =
  (Channel_message_reaction { content } : notif_event)

let make_notif_event_calendar_event_join_request
    ~(content : calendar_event_join_request_metadata) () =
  (Calendar_event_join_request { content } : notif_event)

let make_notif_event_channel_access_requested
    ~(content : channel_access_requested_metadata) () =
  (Channel_access_requested { content } : notif_event)

let make_notif_event_routine_run_finished
    ~(content : routine_run_finished_metadata) () =
  (Routine_run_finished { content } : notif_event)

let make_notif_event_agent_sign_in_expiry
    ~(content : agent_sign_in_expiry_metadata) () =
  (Agent_sign_in_expiry { content } : notif_event)

let make_notif_event_computer_setup ~(content : computer_setup_metadata) () =
  (Computer_setup { content } : notif_event)

let make_notif_event_runtime_access_removed
    ~(content : runtime_access_removed_metadata) () =
  (Runtime_access_removed { content } : notif_event)

(** The mutually exclusive lifecycle states of a user's notification. *)
type nonrec notification_state =
  | Unseen
  | Seen
  | Done
  | Unknown of string  (** A value this SDK version does not know. *)

let notification_state_of_yojson : Yojson.Safe.t -> notification_state =
 fun json ->
  match Json.string json with
  | "unseen" -> Unseen
  | "seen" -> Seen
  | "done" -> Done
  | other -> Unknown other

and yojson_of_notification_state : notification_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Unseen -> `String "unseen"
  | Seen -> `String "seen"
  | Done -> `String "done"
  | Unknown other -> `String other

type nonrec api_user_notification = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
  created_at : string;  (** When the notification was created. *)
  deleted_at : string option;  (** When the notification was deleted. *)
  id : string;  (** The notification ID. *)
  notification_event_type : string;
      (** The notification event type string (e.g. "channel_mention").
TODO make this a new type *)
  notification_metadata : notif_event;
      (** Deserialized notification metadata. *)
  owner_id : string;  (** The user who owns this notification. *)
  sender_id : string option;  (** The user who triggered the notification. *)
  sent : bool;  (** Whether the notification has been sent. *)
  state : notification_state;
      (** The authoritative notification lifecycle state. *)
  updated_at : string;  (** When the notification was last updated. *)
  viewed_at : string option;  (** When the notification was viewed/seen. *)
}

let api_user_notification_of_yojson : Yojson.Safe.t -> api_user_notification =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    created_at = Json.required fields "created_at" Json.string;
    deleted_at = Json.optional fields "deleted_at" Json.string;
    id = Json.required fields "id" Json.string;
    notification_event_type =
      Json.required fields "notification_event_type" Json.string;
    notification_metadata =
      Json.required fields "notification_metadata" notif_event_of_yojson;
    owner_id = Json.required fields "owner_id" Json.string;
    sender_id = Json.optional fields "sender_id" Json.string;
    sent = Json.required fields "sent" Json.bool;
    state = Json.required fields "state" notification_state_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
    viewed_at = Json.optional fields "viewed_at" Json.string;
  }

and yojson_of_api_user_notification : api_user_notification -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ("created_at", Some (Json.of_string value.created_at));
      ("deleted_at", Option.map Json.of_string value.deleted_at);
      ("id", Some (Json.of_string value.id));
      ( "notification_event_type",
        Some (Json.of_string value.notification_event_type) );
      ( "notification_metadata",
        Some (yojson_of_notif_event value.notification_metadata) );
      ("owner_id", Some (Json.of_string value.owner_id));
      ("sender_id", Option.map Json.of_string value.sender_id);
      ("sent", Some (Json.of_bool value.sent));
      ("state", Some (yojson_of_notification_state value.state));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("viewed_at", Option.map Json.of_string value.viewed_at);
    ]

let make_api_user_notification ~(entity_id : string)
    ~(entity_type : entity_type) ~(created_at : string) ?deleted_at
    ~(id : string) ~(notification_event_type : string)
    ~(notification_metadata : notif_event) ~(owner_id : string) ?sender_id
    ~(sent : bool) ~(state : notification_state) ~(updated_at : string)
    ?viewed_at () =
  ({
     entity_id;
     entity_type;
     created_at;
     deleted_at;
     id;
     notification_event_type;
     notification_metadata;
     owner_id;
     sender_id;
     sent;
     state;
     updated_at;
     viewed_at;
   }
    : api_user_notification)

type nonrec bulk_get_by_event_item_ids_request = {
  event_item_ids : string list;
      (** The event item IDs to filter notifications by. *)
}
(** Request body for bulk-fetching notifications by event item IDs. *)

let bulk_get_by_event_item_ids_request_of_yojson :
    Yojson.Safe.t -> bulk_get_by_event_item_ids_request =
 fun json ->
  let fields = Json.obj json in
  {
    event_item_ids = Json.required fields "eventItemIds" (Json.list Json.string);
  }

and yojson_of_bulk_get_by_event_item_ids_request :
    bulk_get_by_event_item_ids_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("eventItemIds", Some ((Json.of_list Json.of_string) value.event_item_ids));
    ]

let make_bulk_get_by_event_item_ids_request ~(event_item_ids : string list) () =
  ({ event_item_ids } : bulk_get_by_event_item_ids_request)

type nonrec bulk_item = { item_id : string; item_type : entity_type }

let bulk_item_of_yojson : Yojson.Safe.t -> bulk_item =
 fun json ->
  let fields = Json.obj json in
  {
    item_id = Json.required fields "item_id" Json.string;
    item_type = Json.required fields "item_type" entity_type_of_yojson;
  }

and yojson_of_bulk_item : bulk_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("item_id", Some (Json.of_string value.item_id));
      ("item_type", Some (yojson_of_entity_type value.item_type));
    ]

let make_bulk_item ~(item_id : string) ~(item_type : entity_type) () =
  ({ item_id; item_type } : bulk_item)

type nonrec bulk_remove_items_request = { items : bulk_item list }

let bulk_remove_items_request_of_yojson :
    Yojson.Safe.t -> bulk_remove_items_request =
 fun json ->
  let fields = Json.obj json in
  { items = Json.required fields "items" (Json.list bulk_item_of_yojson) }

and yojson_of_bulk_remove_items_request :
    bulk_remove_items_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("items", Some ((Json.of_list yojson_of_bulk_item) value.items)) ]

let make_bulk_remove_items_request ~(items : bulk_item list) () =
  ({ items } : bulk_remove_items_request)

type nonrec bulk_set_items_request = {
  items : bulk_item list;
  snoozed_until : string option;
      (** A future resume time. Omit to mute indefinitely. *)
}

let bulk_set_items_request_of_yojson : Yojson.Safe.t -> bulk_set_items_request =
 fun json ->
  let fields = Json.obj json in
  {
    items = Json.required fields "items" (Json.list bulk_item_of_yojson);
    snoozed_until = Json.optional fields "snoozed_until" Json.string;
  }

and yojson_of_bulk_set_items_request : bulk_set_items_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("items", Some ((Json.of_list yojson_of_bulk_item) value.items));
      ("snoozed_until", Option.map Json.of_string value.snoozed_until);
    ]

let make_bulk_set_items_request ~(items : bulk_item list) ?snoozed_until () =
  ({ items; snoozed_until } : bulk_set_items_request)

type nonrec common_channel_metadata = {
  channel_name : string option;
  channel_type : channel_type;
}
(** Common metadata for notifications on channels *)

let common_channel_metadata_of_yojson : Yojson.Safe.t -> common_channel_metadata
    =
 fun json ->
  let fields = Json.obj json in
  {
    channel_name = Json.optional fields "channelName" Json.string;
    channel_type = Json.required fields "channelType" channel_type_of_yojson;
  }

and yojson_of_common_channel_metadata : common_channel_metadata -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("channelName", Option.map Json.of_string value.channel_name);
      ("channelType", Some (yojson_of_channel_type value.channel_type));
    ]

let make_common_channel_metadata ?channel_name ~(channel_type : channel_type) ()
    =
  ({ channel_name; channel_type } : common_channel_metadata)

type nonrec notification_type_name = string
(** newtype wrapper for the the typename of a Notification *)

let notification_type_name_of_yojson : Yojson.Safe.t -> notification_type_name =
 fun json -> Json.string json

and yojson_of_notification_type_name : notification_type_name -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec realtime_notif_tagged_content_value_notification_metadata = {
  content : Yojson.Safe.t;
  tag : notification_type_name;
}
(** A notification metadata value tagged with the notification event type. *)

let realtime_notif_tagged_content_value_notification_metadata_of_yojson :
    Yojson.Safe.t -> realtime_notif_tagged_content_value_notification_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.required fields "content" Json.json;
    tag = Json.required fields "tag" notification_type_name_of_yojson;
  }

and yojson_of_realtime_notif_tagged_content_value_notification_metadata :
    realtime_notif_tagged_content_value_notification_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Some (Json.of_json value.content));
      ("tag", Some (yojson_of_notification_type_name value.tag));
    ]

let make_realtime_notif_tagged_content_value_notification_metadata
    ~(content : Yojson.Safe.t) ~(tag : notification_type_name) () =
  ({ content; tag } : realtime_notif_tagged_content_value_notification_metadata)

type nonrec macro_user_id_str = string

let macro_user_id_str_of_yojson : Yojson.Safe.t -> macro_user_id_str =
 fun json -> Json.string json

and yojson_of_macro_user_id_str : macro_user_id_str -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec realtime_notif_tagged_content_value = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
  created_at : string;  (** When the notification was created. *)
  deleted_at : string option;  (** When the notification was deleted. *)
  notification_event_type : string;
      (** The notification event type string (e.g. "channel_mention").
TODO make this a new type *)
  notification_id : string;  (** The notification ID. *)
  notification_metadata :
    realtime_notif_tagged_content_value_notification_metadata;
      (** A notification metadata value tagged with the notification event type. *)
  sender_id : macro_user_id_str option;
  sent : bool;  (** Whether the notification has been sent. *)
  state : notification_state;
      (** The authoritative lifecycle state, independent of viewing timestamps. *)
  updated_at : string;  (** When the notification was last updated. *)
  viewed_at : string option;  (** When the notification was viewed/seen. *)
}
(** the value of the inner payload inside \[ConnGatewayNotification\] *)

let realtime_notif_tagged_content_value_of_yojson :
    Yojson.Safe.t -> realtime_notif_tagged_content_value =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    created_at = Json.required fields "created_at" Json.string;
    deleted_at = Json.optional fields "deleted_at" Json.string;
    notification_event_type =
      Json.required fields "notification_event_type" Json.string;
    notification_id = Json.required fields "notification_id" Json.string;
    notification_metadata =
      Json.required fields "notification_metadata"
        realtime_notif_tagged_content_value_notification_metadata_of_yojson;
    sender_id = Json.optional fields "sender_id" macro_user_id_str_of_yojson;
    sent = Json.required fields "sent" Json.bool;
    state = Json.required fields "state" notification_state_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
    viewed_at = Json.optional fields "viewed_at" Json.string;
  }

and yojson_of_realtime_notif_tagged_content_value :
    realtime_notif_tagged_content_value -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ("created_at", Some (Json.of_string value.created_at));
      ("deleted_at", Option.map Json.of_string value.deleted_at);
      ( "notification_event_type",
        Some (Json.of_string value.notification_event_type) );
      ("notification_id", Some (Json.of_string value.notification_id));
      ( "notification_metadata",
        Some
          (yojson_of_realtime_notif_tagged_content_value_notification_metadata
             value.notification_metadata) );
      ("sender_id", Option.map yojson_of_macro_user_id_str value.sender_id);
      ("sent", Some (Json.of_bool value.sent));
      ("state", Some (yojson_of_notification_state value.state));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("viewed_at", Option.map Json.of_string value.viewed_at);
    ]

let make_realtime_notif_tagged_content_value ~(entity_id : string)
    ~(entity_type : entity_type) ~(created_at : string) ?deleted_at
    ~(notification_event_type : string) ~(notification_id : string)
    ~(notification_metadata :
       realtime_notif_tagged_content_value_notification_metadata) ?sender_id
    ~(sent : bool) ~(state : notification_state) ~(updated_at : string)
    ?viewed_at () =
  ({
     entity_id;
     entity_type;
     created_at;
     deleted_at;
     notification_event_type;
     notification_id;
     notification_metadata;
     sender_id;
     sent;
     state;
     updated_at;
     viewed_at;
   }
    : realtime_notif_tagged_content_value)

type nonrec conn_gateway_notification_payload =
  realtime_notif_tagged_content_value
(** Concrete schema type for \[[RealtimeNotif]\] with [serde_json::Value] metadata.

Used for OpenAPI schema generation — serializes identically to
[RealtimeNotif<serde_json::Value>]. *)

let conn_gateway_notification_payload_of_yojson :
    Yojson.Safe.t -> conn_gateway_notification_payload =
 fun json -> realtime_notif_tagged_content_value_of_yojson json

and yojson_of_conn_gateway_notification_payload :
    conn_gateway_notification_payload -> Yojson.Safe.t =
 fun value -> yojson_of_realtime_notif_tagged_content_value value

type nonrec create_notification = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
  metadata : Yojson.Safe.t option;
      (** Custom metadata that may be needed for the notification *)
  notification_event_type : string;  (** The type of notification *)
  service_sender : string;  (** The service that created the notification *)
}

let create_notification_of_yojson : Yojson.Safe.t -> create_notification =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    metadata = Json.optional fields "metadata" Json.json;
    notification_event_type =
      Json.required fields "notification_event_type" Json.string;
    service_sender = Json.required fields "service_sender" Json.string;
  }

and yojson_of_create_notification : create_notification -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ("metadata", Option.map Json.of_json value.metadata);
      ( "notification_event_type",
        Some (Json.of_string value.notification_event_type) );
      ("service_sender", Some (Json.of_string value.service_sender));
    ]

let make_create_notification ~(entity_id : string) ~(entity_type : entity_type)
    ?metadata ~(notification_event_type : string) ~(service_sender : string) ()
    =
  ({ entity_id; entity_type; metadata; notification_event_type; service_sender }
    : create_notification)

type nonrec device_type =
  | Ios
  | Android
  | Iosvoip
  | Unknown of string  (** A value this SDK version does not know. *)

let device_type_of_yojson : Yojson.Safe.t -> device_type =
 fun json ->
  match Json.string json with
  | "ios" -> Ios
  | "android" -> Android
  | "iosvoip" -> Iosvoip
  | other -> Unknown other

and yojson_of_device_type : device_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Ios -> `String "ios"
  | Android -> `String "android"
  | Iosvoip -> `String "iosvoip"
  | Unknown other -> `String other

type nonrec device_request = {
  device_type : device_type;  (** The device platform type (iOS or Android). *)
  native_call_capable : bool option;
      (** Whether this Android binary supports native Telecom incoming calls. *)
  token : string;  (** The device push notification token. *)
}
(** Request to register or unregister a device for push notifications. *)

let device_request_of_yojson : Yojson.Safe.t -> device_request =
 fun json ->
  let fields = Json.obj json in
  {
    device_type = Json.required fields "deviceType" device_type_of_yojson;
    native_call_capable = Json.optional fields "nativeCallCapable" Json.bool;
    token = Json.required fields "token" Json.string;
  }

and yojson_of_device_request : device_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("deviceType", Some (yojson_of_device_type value.device_type));
      ("nativeCallCapable", Option.map Json.of_bool value.native_call_capable);
      ("token", Some (Json.of_string value.token));
    ]

let make_device_request ~(device_type : device_type) ?native_call_capable
    ~(token : string) () =
  ({ device_type; native_call_capable; token } : device_request)

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

let empty_response_of_yojson : Yojson.Safe.t -> empty_response =
 fun json -> Json.json json

and yojson_of_empty_response : empty_response -> Yojson.Safe.t =
 fun value -> Json.of_json value

type nonrec entity = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
}
(** The Entity describes the minimum amount of information required to describe a unique thing in Macro
This contains the type of the entity \[EntityType\] and the string id of that entity *)

let entity_of_yojson : Yojson.Safe.t -> entity =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
  }

and yojson_of_entity : entity -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
    ]

let make_entity ~(entity_id : string) ~(entity_type : entity_type) () =
  ({ entity_id; entity_type } : entity)

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

type nonrec get_all_user_notifications_response = {
  items : api_user_notification list;  (** The list of items returned. *)
  next_cursor : string option;  (** The next page cursor if it exists. *)
}
(** The strongly typed response for listing user notifications. *)

let get_all_user_notifications_response_of_yojson :
    Yojson.Safe.t -> get_all_user_notifications_response =
 fun json ->
  let fields = Json.obj json in
  {
    items =
      Json.required fields "items" (Json.list api_user_notification_of_yojson);
    next_cursor = Json.optional fields "next_cursor" Json.string;
  }

and yojson_of_get_all_user_notifications_response :
    get_all_user_notifications_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "items",
        Some ((Json.of_list yojson_of_api_user_notification) value.items) );
      ("next_cursor", Option.map Json.of_string value.next_cursor);
    ]

let make_get_all_user_notifications_response
    ~(items : api_user_notification list) ?next_cursor () =
  ({ items; next_cursor } : get_all_user_notifications_response)

type nonrec get_notification_type_preferences_response = {
  disabled_types : string list;
      (** The notification types that the user has disabled. *)
}
(** Response for listing disabled notification types. *)

let get_notification_type_preferences_response_of_yojson :
    Yojson.Safe.t -> get_notification_type_preferences_response =
 fun json ->
  let fields = Json.obj json in
  {
    disabled_types =
      Json.required fields "disabled_types" (Json.list Json.string);
  }

and yojson_of_get_notification_type_preferences_response :
    get_notification_type_preferences_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "disabled_types",
        Some ((Json.of_list Json.of_string) value.disabled_types) );
    ]

let make_get_notification_type_preferences_response
    ~(disabled_types : string list) () =
  ({ disabled_types } : get_notification_type_preferences_response)

type nonrec github_pr_notification_common = {
  display_name : string;  (** A compact label suitable for display in the UI. *)
  foreign_entity_id : string;
      (** The source-specific internal foreign entity row id for this pull request. *)
  github_key : string;
      (** The external GitHub key, in [owner/repo/pull/number] format. *)
  number : int64;  (** The GitHub pull request number. *)
  owner : string;  (** The GitHub repository owner or organization. *)
  repo : string;  (** The GitHub repository name. *)
  sender_github_avatar_url : string option;
      (** The GitHub avatar URL for the sender, when available. *)
  sender_github_login : string option;
      (** The GitHub login for the sender, when available. *)
  sender_github_user_id : string option;
      (** The stable GitHub numeric user id for the sender, serialized as a string. *)
  title : string;
      (** The GitHub pull request title. Falls back to [display_name] when GitHub has no title. *)
  url : string;  (** The public GitHub URL for the pull request. *)
}
(** Fields shared by every GitHub pull request notification type.

Embedded with `#\[serde(flatten)\]` so the wire shape keeps these keys at the
top level of the metadata object. *)

let github_pr_notification_common_of_yojson :
    Yojson.Safe.t -> github_pr_notification_common =
 fun json ->
  let fields = Json.obj json in
  {
    display_name = Json.required fields "displayName" Json.string;
    foreign_entity_id = Json.required fields "foreignEntityId" Json.string;
    github_key = Json.required fields "githubKey" Json.string;
    number = Json.required fields "number" Json.int64;
    owner = Json.required fields "owner" Json.string;
    repo = Json.required fields "repo" Json.string;
    sender_github_avatar_url =
      Json.optional fields "senderGithubAvatarUrl" Json.string;
    sender_github_login = Json.optional fields "senderGithubLogin" Json.string;
    sender_github_user_id =
      Json.optional fields "senderGithubUserId" Json.string;
    title = Json.required fields "title" Json.string;
    url = Json.required fields "url" Json.string;
  }

and yojson_of_github_pr_notification_common :
    github_pr_notification_common -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("displayName", Some (Json.of_string value.display_name));
      ("foreignEntityId", Some (Json.of_string value.foreign_entity_id));
      ("githubKey", Some (Json.of_string value.github_key));
      ("number", Some (Json.of_int64 value.number));
      ("owner", Some (Json.of_string value.owner));
      ("repo", Some (Json.of_string value.repo));
      ( "senderGithubAvatarUrl",
        Option.map Json.of_string value.sender_github_avatar_url );
      ("senderGithubLogin", Option.map Json.of_string value.sender_github_login);
      ( "senderGithubUserId",
        Option.map Json.of_string value.sender_github_user_id );
      ("title", Some (Json.of_string value.title));
      ("url", Some (Json.of_string value.url));
    ]

let make_github_pr_notification_common ~(display_name : string)
    ~(foreign_entity_id : string) ~(github_key : string) ~(number : int64)
    ~(owner : string) ~(repo : string) ?sender_github_avatar_url
    ?sender_github_login ?sender_github_user_id ~(title : string)
    ~(url : string) () =
  ({
     display_name;
     foreign_entity_id;
     github_key;
     number;
     owner;
     repo;
     sender_github_avatar_url;
     sender_github_login;
     sender_github_user_id;
     title;
     url;
   }
    : github_pr_notification_common)

type nonrec item_shared_metadata = {
  item_id : string;  (** The name/title of the shared item (optional) *)
  item_name : string option;  (** The name/title of the shared item *)
  item_type : entity_type;  (** The type of item being shared *)
  permission_level : string option;
      (** Permission level granted (read, write, admin, etc.) *)
  shared_by : string;
  user_ids : string list;  (** List of user IDs that the item is shared with *)
}
(** Metadata for when a item is shared with a user *)

let item_shared_metadata_of_yojson : Yojson.Safe.t -> item_shared_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    item_id = Json.required fields "itemId" Json.string;
    item_name = Json.optional fields "itemName" Json.string;
    item_type = Json.required fields "itemType" entity_type_of_yojson;
    permission_level = Json.optional fields "permissionLevel" Json.string;
    shared_by = Json.required fields "sharedBy" Json.string;
    user_ids = Json.required fields "userIds" (Json.list Json.string);
  }

and yojson_of_item_shared_metadata : item_shared_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("itemId", Some (Json.of_string value.item_id));
      ("itemName", Option.map Json.of_string value.item_name);
      ("itemType", Some (yojson_of_entity_type value.item_type));
      ("permissionLevel", Option.map Json.of_string value.permission_level);
      ("sharedBy", Some (Json.of_string value.shared_by));
      ("userIds", Some ((Json.of_list Json.of_string) value.user_ids));
    ]

let make_item_shared_metadata ~(item_id : string) ?item_name
    ~(item_type : entity_type) ?permission_level ~(shared_by : string)
    ~(user_ids : string list) () =
  ({ item_id; item_name; item_type; permission_level; shared_by; user_ids }
    : item_shared_metadata)

type nonrec notification_bulk_request = {
  notification_ids : string list;  (** The ids of the notifications to handle *)
}
(** the notification ids that we are bulk updating *)

let notification_bulk_request_of_yojson :
    Yojson.Safe.t -> notification_bulk_request =
 fun json ->
  let fields = Json.obj json in
  {
    notification_ids =
      Json.required fields "notificationIds" (Json.list Json.string);
  }

and yojson_of_notification_bulk_request :
    notification_bulk_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "notificationIds",
        Some ((Json.of_list Json.of_string) value.notification_ids) );
    ]

let make_notification_bulk_request ~(notification_ids : string list) () =
  ({ notification_ids } : notification_bulk_request)

type nonrec notification_service_api_version =
  | V1
  | Unknown of string  (** A value this SDK version does not know. *)

let notification_service_api_version_of_yojson :
    Yojson.Safe.t -> notification_service_api_version =
 fun json -> match Json.string json with "v1" -> V1 | other -> Unknown other

and yojson_of_notification_service_api_version :
    notification_service_api_version -> Yojson.Safe.t =
 fun value ->
  match value with V1 -> `String "v1" | Unknown other -> `String other

(** A destination carried by a push notification. Access is checked when opened. *)
type nonrec push_notification_navigation =
  | Channel of {
      channel_id : string;  (** Channel containing the message. *)
      message_id : string;  (** Message to highlight. *)
      thread_id : string option;
          (** Root of the message's thread; null identifies a top-level message. *)
    }  (** Open a channel at a specific message. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let push_notification_navigation_of_yojson :
    Yojson.Safe.t -> push_notification_navigation =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "channel" ->
      Channel
        {
          channel_id = Json.required fields "channelId" Json.string;
          message_id = Json.required fields "messageId" Json.string;
          thread_id = Json.optional fields "threadId" Json.string;
        }
  | _ -> Unknown json

and yojson_of_push_notification_navigation :
    push_notification_navigation -> Yojson.Safe.t =
 fun value ->
  match value with
  | Channel case ->
      Json.record
        [
          ("type", Some (`String "channel"));
          ("channelId", Some (Json.of_string case.channel_id));
          ("messageId", Some (Json.of_string case.message_id));
          ("threadId", Some ((Json.of_option Json.of_string) case.thread_id));
        ]
  | Unknown json -> json

let make_push_notification_navigation_channel ~(channel_id : string)
    ~(message_id : string) ?thread_id () =
  (Channel { channel_id; message_id; thread_id } : push_notification_navigation)

type nonrec push_notification_data = {
  navigation : push_notification_navigation option;
  notification_id : string;
      (** The id of the notification record (UserNotification.id) *)
  recipient_id : string option;
      (** Account that owns the receiving device, set during per-recipient delivery. *)
  sender_profile_picture_url : string option;
      (** The sender's profile picture URL, used by the Notification Service Extension
to download and attach as a rich notification image. *)
}
(** the value we send as the payload in the ios notification
This data is accessible to the client *)

let push_notification_data_of_yojson : Yojson.Safe.t -> push_notification_data =
 fun json ->
  let fields = Json.obj json in
  {
    navigation =
      Json.optional fields "navigation" push_notification_navigation_of_yojson;
    notification_id = Json.required fields "notificationId" Json.string;
    recipient_id = Json.optional fields "recipientId" Json.string;
    sender_profile_picture_url =
      Json.optional fields "senderProfilePictureUrl" Json.string;
  }

and yojson_of_push_notification_data : push_notification_data -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "navigation",
        Option.map yojson_of_push_notification_navigation value.navigation );
      ("notificationId", Some (Json.of_string value.notification_id));
      ("recipientId", Option.map Json.of_string value.recipient_id);
      ( "senderProfilePictureUrl",
        Option.map Json.of_string value.sender_profile_picture_url );
    ]

let make_push_notification_data ?navigation ~(notification_id : string)
    ?recipient_id ?sender_profile_picture_url () =
  ({ navigation; notification_id; recipient_id; sender_profile_picture_url }
    : push_notification_data)

type nonrec unsubscribe_item_path_params = {
  item_id : string;
  item_type : entity_type;
}

let unsubscribe_item_path_params_of_yojson :
    Yojson.Safe.t -> unsubscribe_item_path_params =
 fun json ->
  let fields = Json.obj json in
  {
    item_id = Json.required fields "item_id" Json.string;
    item_type = Json.required fields "item_type" entity_type_of_yojson;
  }

and yojson_of_unsubscribe_item_path_params :
    unsubscribe_item_path_params -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("item_id", Some (Json.of_string value.item_id));
      ("item_type", Some (yojson_of_entity_type value.item_type));
    ]

let make_unsubscribe_item_path_params ~(item_id : string)
    ~(item_type : entity_type) () =
  ({ item_id; item_type } : unsubscribe_item_path_params)

type nonrec user_unsubscribe = {
  item_id : string;  (** The item id *)
  item_type : string;  (** The item type *)
  snoozed_until : string option;
      (** None for permanent mutes; notifications resume automatically at this deadline. *)
}

let user_unsubscribe_of_yojson : Yojson.Safe.t -> user_unsubscribe =
 fun json ->
  let fields = Json.obj json in
  {
    item_id = Json.required fields "item_id" Json.string;
    item_type = Json.required fields "item_type" Json.string;
    snoozed_until = Json.optional fields "snoozed_until" Json.string;
  }

and yojson_of_user_unsubscribe : user_unsubscribe -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("item_id", Some (Json.of_string value.item_id));
      ("item_type", Some (Json.of_string value.item_type));
      ("snoozed_until", Option.map Json.of_string value.snoozed_until);
    ]

let make_user_unsubscribe ~(item_id : string) ~(item_type : string)
    ?snoozed_until () =
  ({ item_id; item_type; snoozed_until } : user_unsubscribe)

(** [GET /health]

Health check *)
let health_handler () =
  ({
     Request.service = "notification";
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

(** [GET /unsubscribe]

Gets the users unsubscribe items. *)
let get_unsubscribes () =
  ({
     Request.service = "notification";
     operation = "get_unsubscribes";
     meth = `GET;
     path = "/unsubscribe";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list user_unsubscribe_of_yojson);
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (user_unsubscribe list, error_response) Macro_sdk_runtime.Request.t)

(** [POST /unsubscribe/email]

Unsubscribes a user from receiving emails *)
let unsubscribe_email () =
  ({
     Request.service = "notification";
     operation = "unsubscribe_email";
     meth = `POST;
     path = "/unsubscribe/email";
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

(** [POST /unsubscribe/item/{item_type}/{item_id}]

Unsubscribes a user from a given item for notifications. *)
let unsubscribe_item ~(item_type : entity_type) ~(item_id : string)
    ?snoozed_until () =
  ({
     Request.service = "notification";
     operation = "unsubscribe_item";
     meth = `POST;
     path =
       String.concat ""
         [
           "/unsubscribe/item/";
           Request.segment
             ((fun value -> Json.string (yojson_of_entity_type value))
                item_type);
           "/";
           Request.segment ((fun value -> value) item_id);
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "snoozed_until",
             match snoozed_until with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /unsubscribe/item/{item_type}/{item_id}]

Removes a unsubscribe item for a user. *)
let remove_unsubscribe_item ~(item_type : entity_type) ~(item_id : string) () =
  ({
     Request.service = "notification";
     operation = "remove_unsubscribe_item";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/unsubscribe/item/";
           Request.segment
             ((fun value -> Json.string (yojson_of_entity_type value))
                item_type);
           "/";
           Request.segment ((fun value -> value) item_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /unsubscribe/items]

Atomically mute or snooze items for the authenticated user. *)
let unsubscribe_items ~(items : bulk_item list) ?snoozed_until () =
  ({
     Request.service = "notification";
     operation = "unsubscribe_items";
     meth = `POST;
     path = "/unsubscribe/items";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_bulk_set_items_request
               ({ items; snoozed_until } : bulk_set_items_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /unsubscribe/items]

Atomically resume delivery for the authenticated user's items. *)
let remove_unsubscribe_items ~(items : bulk_item list) () =
  ({
     Request.service = "notification";
     operation = "remove_unsubscribe_items";
     meth = `DELETE;
     path = "/unsubscribe/items";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_bulk_remove_items_request
               ({ items } : bulk_remove_items_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /unsubscribe/mute]

Unsubscribes user from all notifications. *)
let unsubscribe_all () =
  ({
     Request.service = "notification";
     operation = "unsubscribe_all";
     meth = `POST;
     path = "/unsubscribe/mute";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /unsubscribe/mute]

Unmutes all notifications.
Existing notifications that were muted manually will remain muted. *)
let remove_unsubscribe_all () =
  ({
     Request.service = "notification";
     operation = "remove_unsubscribe_all";
     meth = `DELETE;
     path = "/unsubscribe/mute";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /v1/user_notifications]

Wrapper handler that calls the inner generic list handler with [serde_json::Value],
then converts each row to \[[UserNotificationRow<NotifEvent>]\]. *)
let list_typed_notifications ?states ?limit ?cursor () =
  ({
     Request.service = "notification";
     operation = "list_typed_notifications";
     meth = `GET;
     path = "/v1/user_notifications";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "states",
             match states with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "limit",
             match limit with
             | None -> []
             | Some value -> [ string_of_int value ] );
           ( "cursor",
             match cursor with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_all_user_notifications_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : ( get_all_user_notifications_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [DELETE /v1/user_notifications/bulk]

Soft-delete multiple user notifications. *)
let bulk_delete_user_notifications_v2 ~(notification_ids : string list) () =
  ({
     Request.service = "notification";
     operation = "bulk_delete_user_notifications_v2";
     meth = `DELETE;
     path = "/v1/user_notifications/bulk";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_notification_bulk_request
               ({ notification_ids } : notification_bulk_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /v1/user_notifications/bulk/done]

Mark notifications as done. *)
let bulk_mark_notifications_done ~(notification_ids : string list) () =
  ({
     Request.service = "notification";
     operation = "bulk_mark_notifications_done";
     meth = `PATCH;
     path = "/v1/user_notifications/bulk/done";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_notification_bulk_request
               ({ notification_ids } : notification_bulk_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /v1/user_notifications/bulk/seen]

Mark notifications as seen. *)
let bulk_mark_notifications_seen ~(notification_ids : string list) () =
  ({
     Request.service = "notification";
     operation = "bulk_mark_notifications_seen";
     meth = `PATCH;
     path = "/v1/user_notifications/bulk/seen";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_notification_bulk_request
               ({ notification_ids } : notification_bulk_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /v1/user_notifications/bulk/undone]

Mark notifications as not done. *)
let bulk_mark_notifications_undone ~(notification_ids : string list) () =
  ({
     Request.service = "notification";
     operation = "bulk_mark_notifications_undone";
     meth = `PATCH;
     path = "/v1/user_notifications/bulk/undone";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_notification_bulk_request
               ({ notification_ids } : notification_bulk_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [POST /v1/user_notifications/item/bulk]

Wrapper handler that calls the inner generic bulk-get handler with [serde_json::Value],
then converts each row to \[[UserNotificationRow<NotifEvent>]\]. *)
let bulk_get_typed_notifications_by_event_item_ids
    ~(event_item_ids : string list) ?states ?limit ?cursor () =
  ({
     Request.service = "notification";
     operation = "bulk_get_typed_notifications_by_event_item_ids";
     meth = `POST;
     path = "/v1/user_notifications/item/bulk";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "states",
             match states with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "limit",
             match limit with
             | None -> []
             | Some value -> [ string_of_int value ] );
           ( "cursor",
             match cursor with
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
            (yojson_of_bulk_get_by_event_item_ids_request
               ({ event_item_ids } : bulk_get_by_event_item_ids_request)));
     decode_reply = Request.json get_all_user_notifications_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : ( get_all_user_notifications_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /v1/user_notifications/item/{event_item_id}]

Typed wrapper for getting notifications by a single event item ID. *)
let get_typed_notifications_by_event_item_id ~(event_item_id : string) ?states
    ?limit ?cursor () =
  ({
     Request.service = "notification";
     operation = "get_typed_notifications_by_event_item_id";
     meth = `GET;
     path =
       String.concat ""
         [
           "/v1/user_notifications/item/";
           Request.segment ((fun value -> value) event_item_id);
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "states",
             match states with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "limit",
             match limit with
             | None -> []
             | Some value -> [ string_of_int value ] );
           ( "cursor",
             match cursor with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_all_user_notifications_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : ( get_all_user_notifications_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /v1/user_notifications/preferences]

Get the notification types that the user has disabled. *)
let get_notification_type_preferences () =
  ({
     Request.service = "notification";
     operation = "get_notification_type_preferences";
     meth = `GET;
     path = "/v1/user_notifications/preferences";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.json get_notification_type_preferences_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : ( get_notification_type_preferences_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [PUT /v1/user_notifications/preferences/{notification_event_type}/disable]

Disable a notification type for the authenticated user. *)
let disable_notification_type ~(notification_event_type : string) () =
  ({
     Request.service = "notification";
     operation = "disable_notification_type";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/v1/user_notifications/preferences/";
           Request.segment ((fun value -> value) notification_event_type);
           "/disable";
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

(** [PUT /v1/user_notifications/preferences/{notification_event_type}/enable]

Re-enable a notification type for the authenticated user. *)
let enable_notification_type ~(notification_event_type : string) () =
  ({
     Request.service = "notification";
     operation = "enable_notification_type";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/v1/user_notifications/preferences/";
           Request.segment ((fun value -> value) notification_event_type);
           "/enable";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /v1/user_notifications/{notification_id}]

Typed wrapper for getting a single notification by ID. *)
let get_typed_notification_by_id ~(notification_id : string) () =
  ({
     Request.service = "notification";
     operation = "get_typed_notification_by_id";
     meth = `GET;
     path =
       String.concat ""
         [
           "/v1/user_notifications/";
           Request.segment ((fun value -> value) notification_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json api_user_notification_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (api_user_notification, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /v1/user_notifications/{notification_id}]

Soft-delete a single user notification. *)
let delete_user_notification_v2 ~(notification_id : string) () =
  ({
     Request.service = "notification";
     operation = "delete_user_notification_v2";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/v1/user_notifications/";
           Request.segment ((fun value -> value) notification_id);
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
