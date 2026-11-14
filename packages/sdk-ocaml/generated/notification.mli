(* Generated from packages/sdk/specs/notification.json by packages/sdk-ocaml/gen. Do not edit. *)

(** Whose account an agent signs in to: the Postgres [agent_provider] enum of
[provider_accounts.provider] and [harness_account_logins.provider]. New
providers add a value there. *)
type nonrec agent_provider =
  | Claude
  | Unknown of string  (** A value this SDK version does not know. *)

val agent_provider_of_yojson : Yojson.Safe.t -> agent_provider
val yojson_of_agent_provider : agent_provider -> Yojson.Safe.t

type nonrec agent_session_origin_parent = {
  id : string;  (** The parent entity id. *)
  type_ : string;  (** [channel], [document], or [initiative]. *)
}
(** The session an agent-session notification is about, and where its magic
chip lives when it was opened from a thread.

The conversation an agent session was opened from: a channel, document,
or initiative. Spelled like the message API's parent for client routing. *)

val agent_session_origin_parent_of_yojson :
  Yojson.Safe.t -> agent_session_origin_parent

val yojson_of_agent_session_origin_parent :
  agent_session_origin_parent -> Yojson.Safe.t

val make_agent_session_origin_parent :
  id:string -> type_:string -> unit -> agent_session_origin_parent
(** The session an agent-session notification is about, and where its magic
chip lives when it was opened from a thread.

The conversation an agent session was opened from: a channel, document,
or initiative. Spelled like the message API's parent for client routing. *)

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

val agent_session_mentioned_metadata_of_yojson :
  Yojson.Safe.t -> agent_session_mentioned_metadata

val yojson_of_agent_session_mentioned_metadata :
  agent_session_mentioned_metadata -> Yojson.Safe.t

val make_agent_session_mentioned_metadata :
  ?announcement_message_id:string ->
  bot_id:string ->
  bot_name:string ->
  ?channel_id:string ->
  ?parent:agent_session_origin_parent ->
  session_id:string ->
  session_name:string ->
  ?thread_id:string ->
  action_id:string ->
  ?mentioned_by:string ->
  unit ->
  agent_session_mentioned_metadata
(** Someone named the recipient in a prompt to an agent session. *)

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

val agent_session_notification_ref_of_yojson :
  Yojson.Safe.t -> agent_session_notification_ref

val yojson_of_agent_session_notification_ref :
  agent_session_notification_ref -> Yojson.Safe.t

val make_agent_session_notification_ref :
  ?announcement_message_id:string ->
  bot_id:string ->
  bot_name:string ->
  ?channel_id:string ->
  ?parent:agent_session_origin_parent ->
  session_id:string ->
  session_name:string ->
  ?thread_id:string ->
  unit ->
  agent_session_notification_ref
(** Flattened into each agent-session kind so the wire keeps these keys at the
top level of the metadata, the way \[[CommonChannelMetadata]\] does. *)

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

val agent_session_settled_metadata_of_yojson :
  Yojson.Safe.t -> agent_session_settled_metadata

val yojson_of_agent_session_settled_metadata :
  agent_session_settled_metadata -> Yojson.Safe.t

val make_agent_session_settled_metadata :
  ?announcement_message_id:string ->
  bot_id:string ->
  bot_name:string ->
  ?channel_id:string ->
  ?parent:agent_session_origin_parent ->
  session_id:string ->
  session_name:string ->
  ?thread_id:string ->
  ?actor:string ->
  ?excerpt:string ->
  stop_reason:string ->
  turn:int ->
  unit ->
  agent_session_settled_metadata
(** An agent finished a turn with nothing queued behind it. *)

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

val agent_session_waiting_for_input_metadata_of_yojson :
  Yojson.Safe.t -> agent_session_waiting_for_input_metadata

val yojson_of_agent_session_waiting_for_input_metadata :
  agent_session_waiting_for_input_metadata -> Yojson.Safe.t

val make_agent_session_waiting_for_input_metadata :
  ?announcement_message_id:string ->
  bot_id:string ->
  bot_name:string ->
  ?channel_id:string ->
  ?parent:agent_session_origin_parent ->
  session_id:string ->
  session_name:string ->
  ?thread_id:string ->
  question:string ->
  turn:int ->
  unit ->
  agent_session_waiting_for_input_metadata
(** An agent is blocked on a question only the session's owner can answer. *)

(** How close a computer's agent sign-in is to no longer working. *)
type nonrec agent_sign_in_expiry_stage =
  | Expires_soon
  | Expires_today
  | Expired
  | Unknown of string  (** A value this SDK version does not know. *)

val agent_sign_in_expiry_stage_of_yojson :
  Yojson.Safe.t -> agent_sign_in_expiry_stage

val yojson_of_agent_sign_in_expiry_stage :
  agent_sign_in_expiry_stage -> Yojson.Safe.t

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

val agent_sign_in_expiry_metadata_of_yojson :
  Yojson.Safe.t -> agent_sign_in_expiry_metadata

val yojson_of_agent_sign_in_expiry_metadata :
  agent_sign_in_expiry_metadata -> Yojson.Safe.t

val make_agent_sign_in_expiry_metadata :
  agent:agent_provider ->
  computer_name:string ->
  ?expires_at:string ->
  harness_id:string ->
  stage:agent_sign_in_expiry_stage ->
  unit ->
  agent_sign_in_expiry_metadata
(** The account a team's Macro computer signed an agent in to is about to
stop working, or has. Sent to whoever signed it in and to the team's
admins and owner, who can sign it in again from Settings → Machines. *)

type nonrec ai_response_metadata = { message_id : string; summary : string }

val ai_response_metadata_of_yojson : Yojson.Safe.t -> ai_response_metadata
val yojson_of_ai_response_metadata : ai_response_metadata -> Yojson.Safe.t

val make_ai_response_metadata :
  message_id:string -> summary:string -> unit -> ai_response_metadata

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

type nonrec channel_type =
  | Public
  | Private
  | Direct_message
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

val channel_type_of_yojson : Yojson.Safe.t -> channel_type
val yojson_of_channel_type : channel_type -> Yojson.Safe.t

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

val channel_mention_metadata_of_yojson :
  Yojson.Safe.t -> channel_mention_metadata

val yojson_of_channel_mention_metadata :
  channel_mention_metadata -> Yojson.Safe.t

val make_channel_mention_metadata :
  ?channel_name:string ->
  channel_type:channel_type ->
  message_content:string ->
  message_id:string ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  ?thread_id:string ->
  unit ->
  channel_mention_metadata

(** The sub type of a document in a notification.
Serializes as [{ "type": "task" }] matching the storage service pattern. *)
type nonrec notification_document_sub_type =
  | Task
  | Snippet
  | Skill
  | Initiative_description
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val notification_document_sub_type_of_yojson :
  Yojson.Safe.t -> notification_document_sub_type

val yojson_of_notification_document_sub_type :
  notification_document_sub_type -> Yojson.Safe.t

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

val document_mention_metadata_of_yojson :
  Yojson.Safe.t -> document_mention_metadata

val yojson_of_document_mention_metadata :
  document_mention_metadata -> Yojson.Safe.t

val make_document_mention_metadata :
  ?channel_name:string ->
  channel_type:channel_type ->
  message_content:string ->
  message_id:string ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  ?thread_id:string ->
  document_name:string ->
  ?file_type:string ->
  owner:string ->
  ?sub_type:notification_document_sub_type ->
  unit ->
  document_mention_metadata
(** Someone mentioned a document in a channel *)

(** Identity of a document comment or its thread. Comments written before the
shared message store carry the legacy numeric ids; comments in the shared
store carry the message and root UUIDs. *)
type nonrec comment_ref =
  | Int64 of int64  (** Legacy [Comment.id] or [Thread.id]. *)
  | String of string  (** Message or root id in the shared message store. *)

val comment_ref_of_yojson : Yojson.Safe.t -> comment_ref
val yojson_of_comment_ref : comment_ref -> Yojson.Safe.t

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

val mentioned_in_document_comment_metadata_of_yojson :
  Yojson.Safe.t -> mentioned_in_document_comment_metadata

val yojson_of_mentioned_in_document_comment_metadata :
  mentioned_in_document_comment_metadata -> Yojson.Safe.t

val make_mentioned_in_document_comment_metadata :
  comment_id:comment_ref ->
  document_name:string ->
  ?file_type:string ->
  mention_id:string ->
  owner:string ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  ?sub_type:notification_document_sub_type ->
  text:string ->
  thread_id:comment_ref ->
  unit ->
  mentioned_in_document_comment_metadata
(** Notification sent when a user is mentioned in a document comment. *)

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

val replied_to_document_comment_thread_metadata_of_yojson :
  Yojson.Safe.t -> replied_to_document_comment_thread_metadata

val yojson_of_replied_to_document_comment_thread_metadata :
  replied_to_document_comment_thread_metadata -> Yojson.Safe.t

val make_replied_to_document_comment_thread_metadata :
  comment_id:comment_ref ->
  document_name:string ->
  ?file_type:string ->
  owner:string ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  ?sub_type:notification_document_sub_type ->
  text:string ->
  thread_id:comment_ref ->
  unit ->
  replied_to_document_comment_thread_metadata
(** Notification sent when someone replies to a document comment thread. *)

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

val commented_on_document_metadata_of_yojson :
  Yojson.Safe.t -> commented_on_document_metadata

val yojson_of_commented_on_document_metadata :
  commented_on_document_metadata -> Yojson.Safe.t

val make_commented_on_document_metadata :
  comment_id:comment_ref ->
  document_name:string ->
  ?file_type:string ->
  owner:string ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  ?sub_type:notification_document_sub_type ->
  text:string ->
  thread_id:comment_ref ->
  unit ->
  commented_on_document_metadata
(** Notification sent when someone comments on a document the user owns. *)

(** Permission level used by an access request, excluding ownership. *)
type nonrec requested_access_level =
  | View
  | Comment
  | Edit
  | Unknown of string  (** A value this SDK version does not know. *)

val requested_access_level_of_yojson : Yojson.Safe.t -> requested_access_level
val yojson_of_requested_access_level : requested_access_level -> Yojson.Safe.t

type nonrec entity_access_requested_metadata = {
  access_level : requested_access_level;
      (** Requested or granted permission. *)
  entity_name : string;  (** Shared item's name. *)
  file_type : string option;  (** Document file type for routing. *)
  request_id : string;  (** Stable request identity. *)
  revision : int;  (** Revision that generated this notification. *)
}
(** A person requested access to a shared entity. *)

val entity_access_requested_metadata_of_yojson :
  Yojson.Safe.t -> entity_access_requested_metadata

val yojson_of_entity_access_requested_metadata :
  entity_access_requested_metadata -> Yojson.Safe.t

val make_entity_access_requested_metadata :
  access_level:requested_access_level ->
  entity_name:string ->
  ?file_type:string ->
  request_id:string ->
  revision:int ->
  unit ->
  entity_access_requested_metadata
(** A person requested access to a shared entity. *)

type nonrec entity_access_granted_metadata = {
  access_level : requested_access_level;
      (** Requested or granted permission. *)
  entity_name : string;  (** Shared item's name. *)
  file_type : string option;  (** Document file type for routing. *)
  request_id : string;  (** Stable request identity. *)
  revision : int;  (** Revision that generated this notification. *)
}
(** A person granted you access to a shared entity. *)

val entity_access_granted_metadata_of_yojson :
  Yojson.Safe.t -> entity_access_granted_metadata

val yojson_of_entity_access_granted_metadata :
  entity_access_granted_metadata -> Yojson.Safe.t

val make_entity_access_granted_metadata :
  access_level:requested_access_level ->
  entity_name:string ->
  ?file_type:string ->
  request_id:string ->
  revision:int ->
  unit ->
  entity_access_granted_metadata
(** A person granted you access to a shared entity. *)

(** Why a project discussion notification was delivered. *)
type nonrec initiative_discussion_reason =
  | Mention
  | Reply
  | Assignee
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

val initiative_discussion_reason_of_yojson :
  Yojson.Safe.t -> initiative_discussion_reason

val yojson_of_initiative_discussion_reason :
  initiative_discussion_reason -> Yojson.Safe.t

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

val initiative_discussion_metadata_of_yojson :
  Yojson.Safe.t -> initiative_discussion_metadata

val yojson_of_initiative_discussion_metadata :
  initiative_discussion_metadata -> Yojson.Safe.t

val make_initiative_discussion_metadata :
  message_id:string ->
  owner:string ->
  project_name:string ->
  reason:initiative_discussion_reason ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  text:string ->
  thread_id:string ->
  unit ->
  initiative_discussion_metadata
(** Project discussion metadata. The notification entity identifies the initiative;
message and thread UUIDs select the discussion inside that project. *)

(** Why a CRM discussion notification was delivered. *)
type nonrec crm_discussion_reason =
  | Mention
  | Reply
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

val crm_discussion_reason_of_yojson : Yojson.Safe.t -> crm_discussion_reason
val yojson_of_crm_discussion_reason : crm_discussion_reason -> Yojson.Safe.t

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

val crm_discussion_metadata_of_yojson : Yojson.Safe.t -> crm_discussion_metadata
val yojson_of_crm_discussion_metadata : crm_discussion_metadata -> Yojson.Safe.t

val make_crm_discussion_metadata :
  message_id:string ->
  reason:crm_discussion_reason ->
  record_name:string ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  text:string ->
  thread_id:string ->
  unit ->
  crm_discussion_metadata
(** CRM discussion metadata. The notification entity identifies the company or
contact; message and thread UUIDs select the discussion inside it. *)

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

val channel_invite_metadata_of_yojson : Yojson.Safe.t -> channel_invite_metadata
val yojson_of_channel_invite_metadata : channel_invite_metadata -> Yojson.Safe.t

val make_channel_invite_metadata :
  ?channel_name:string ->
  invited_by:string ->
  ?is_direct_message:bool ->
  ?message_content:string ->
  ?sender_profile_picture_url:string ->
  unit ->
  channel_invite_metadata
(** Metadata for when a user is invited to a channel. *)

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

val channel_message_send_metadata_of_yojson :
  Yojson.Safe.t -> channel_message_send_metadata

val yojson_of_channel_message_send_metadata :
  channel_message_send_metadata -> Yojson.Safe.t

val make_channel_message_send_metadata :
  ?channel_name:string ->
  channel_type:channel_type ->
  ?message_content:string ->
  message_id:string ->
  ?sender:string ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  unit ->
  channel_message_send_metadata

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

val channel_reply_metadata_of_yojson : Yojson.Safe.t -> channel_reply_metadata
val yojson_of_channel_reply_metadata : channel_reply_metadata -> Yojson.Safe.t

val make_channel_reply_metadata :
  ?channel_name:string ->
  channel_type:channel_type ->
  message_content:string ->
  message_id:string ->
  ?sender_display_name:string ->
  ?sender_profile_picture_url:string ->
  thread_id:string ->
  ?thread_parent_sender_id:string ->
  ?user_id:string ->
  unit ->
  channel_reply_metadata

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

val call_started_metadata_of_yojson : Yojson.Safe.t -> call_started_metadata
val yojson_of_call_started_metadata : call_started_metadata -> Yojson.Safe.t

val make_call_started_metadata :
  ?channel_name:string ->
  ?sender_profile_picture_url:string ->
  unit ->
  call_started_metadata
(** Metadata for a notification that a call has started in a channel.

Mirrors the producer-side [CallStartedNotification] in the [call] crate:
both serialize the same wire shape (snake_case fields) under the same
[call_started] \[[Notification::TYPE_NAME]\]. This type is the read-side
model used by \[[crate::NotifEvent]\]; the producer keeps its own type
because it additionally builds the incoming-call APNS/VoIP push.

Rows persisted before the type name was normalized used the kebab-case
[call-started]; the \[[crate::NotifEvent::CallStarted]\] variant carries a
`#\[serde(alias = "call-started")\]` so those rows still deserialize. *)

type nonrec new_email_metadata = {
  sender : string option;
  snippet : string;
  subject : string;
  thread_id : string;
  to_email : string;
}

val new_email_metadata_of_yojson : Yojson.Safe.t -> new_email_metadata
val yojson_of_new_email_metadata : new_email_metadata -> Yojson.Safe.t

val make_new_email_metadata :
  ?sender:string ->
  snippet:string ->
  subject:string ->
  thread_id:string ->
  to_email:string ->
  unit ->
  new_email_metadata

type nonrec inbox_reauth_required_metadata = {
  email_address : string;
      (** The address of the inbox that needs to be reconnected. *)
}
(** Metadata for a notification that a linked inbox's grant has died and the
inbox must be reconnected. Fanned out to the inbox owner and every delegate,
since any of them holding the Google grant can restore sync. *)

val inbox_reauth_required_metadata_of_yojson :
  Yojson.Safe.t -> inbox_reauth_required_metadata

val yojson_of_inbox_reauth_required_metadata :
  inbox_reauth_required_metadata -> Yojson.Safe.t

val make_inbox_reauth_required_metadata :
  email_address:string -> unit -> inbox_reauth_required_metadata
(** Metadata for a notification that a linked inbox's grant has died and the
inbox must be reconnected. Fanned out to the inbox owner and every delegate,
since any of them holding the Google grant can restore sync. *)

(** What a team invitee gets by joining. *)
type nonrec invitee_plan =
  | Free
  | Premium
  | Unknown of string  (** A value this SDK version does not know. *)

val invitee_plan_of_yojson : Yojson.Safe.t -> invitee_plan
val yojson_of_invitee_plan : invitee_plan -> Yojson.Safe.t

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

val invite_to_team_metadata_of_yojson : Yojson.Safe.t -> invite_to_team_metadata
val yojson_of_invite_to_team_metadata : invite_to_team_metadata -> Yojson.Safe.t

val make_invite_to_team_metadata :
  invited_by:string ->
  ?invitee_plan:invitee_plan ->
  ?inviter_name:string ->
  ?is_agent:bool ->
  ?reminder:bool ->
  ?role:string ->
  ?sender_profile_picture_url:string ->
  team_id:string ->
  team_invite_id:string ->
  team_name:string ->
  unit ->
  invite_to_team_metadata
(** Metadata for when a user is invited to a team. *)

type nonrec task_assigned_metadata = {
  assigned_by : string;  (** The user who assigned the task *)
  sender_profile_picture_url : string option;
  sub_type : notification_document_sub_type option;
  task_id : string;  (** The unique identifier of the task *)
  task_name : string option;  (** The name of the task (optional) *)
}
(** Metadata for when a user is assigned to a task *)

val task_assigned_metadata_of_yojson : Yojson.Safe.t -> task_assigned_metadata
val yojson_of_task_assigned_metadata : task_assigned_metadata -> Yojson.Safe.t

val make_task_assigned_metadata :
  assigned_by:string ->
  ?sender_profile_picture_url:string ->
  ?sub_type:notification_document_sub_type ->
  task_id:string ->
  ?task_name:string ->
  unit ->
  task_assigned_metadata
(** Metadata for when a user is assigned to a task *)

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

val reminder_metadata_of_yojson : Yojson.Safe.t -> reminder_metadata
val yojson_of_reminder_metadata : reminder_metadata -> Yojson.Safe.t

val make_reminder_metadata :
  description:string ->
  reminder_id:string ->
  ?scheduled_for:string ->
  unit ->
  reminder_metadata
(** Metadata for a reminder the user set for themselves coming due.

There is no sender: a reminder is self-set, so the dispatcher sends it with
[sender_id: None] (a recipient who is also the sender is filtered out of
their own notification). Every formatter here must therefore work without
one.

The associated entity, when there is one, lives on the notification row
rather than in here, and clients resolve its name from that — so the
dispatcher does not have to look up a name across five entity types. *)

(** The messaging service an external chat lives in. *)
type nonrec external_chat_provider =
  | Whatsapp
  | Unknown of string  (** A value this SDK version does not know. *)

val external_chat_provider_of_yojson : Yojson.Safe.t -> external_chat_provider
val yojson_of_external_chat_provider : external_chat_provider -> Yojson.Safe.t

type nonrec external_chat_message_metadata = {
  chat_name : string;  (** The chat's name. *)
  message_id : string;
      (** Stable message id; retries use it as their notification id. *)
  provider : external_chat_provider;
      (** The messaging service the chat lives in. *)
}
(** A live message in an independently shared external chat. *)

val external_chat_message_metadata_of_yojson :
  Yojson.Safe.t -> external_chat_message_metadata

val yojson_of_external_chat_message_metadata :
  external_chat_message_metadata -> Yojson.Safe.t

val make_external_chat_message_metadata :
  chat_name:string ->
  message_id:string ->
  provider:external_chat_provider ->
  unit ->
  external_chat_message_metadata
(** A live message in an independently shared external chat. *)

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

val calendar_event_reminder_metadata_of_yojson :
  Yojson.Safe.t -> calendar_event_reminder_metadata

val yojson_of_calendar_event_reminder_metadata :
  calendar_event_reminder_metadata -> Yojson.Safe.t

val make_calendar_event_reminder_metadata :
  ?ends_at:string ->
  event_id:string ->
  minutes_before:int ->
  occurrence_key:string ->
  ?start_date:string ->
  ?starts_at:string ->
  ?time_zone:string ->
  title:string ->
  unit ->
  calendar_event_reminder_metadata
(** A calendar event alarm came due. Like \[[ReminderMetadata]\], these are
self-notifications: [sender_id] must stay [None] or the only recipient is
filtered out. Everything the alert renders rides in here so the
dispatcher never has to resolve the event again at display time. *)

(** The GitHub pull request webhook action that triggered the notification. *)
type nonrec github_pr_event_action =
  | Opened
  | Reopened
  | Closed
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pr_event_action_of_yojson : Yojson.Safe.t -> github_pr_event_action
val yojson_of_github_pr_event_action : github_pr_event_action -> Yojson.Safe.t

(** The normalized lifecycle status for a GitHub pull request notification. *)
type nonrec github_pr_event_status =
  | Open
  | Closed
  | Merged
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pr_event_status_of_yojson : Yojson.Safe.t -> github_pr_event_status
val yojson_of_github_pr_event_status : github_pr_event_status -> Yojson.Safe.t

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

val github_pr_status_changed_of_yojson :
  Yojson.Safe.t -> github_pr_status_changed

val yojson_of_github_pr_status_changed :
  github_pr_status_changed -> Yojson.Safe.t

val make_github_pr_status_changed :
  display_name:string ->
  foreign_entity_id:string ->
  github_key:string ->
  number:int64 ->
  owner:string ->
  repo:string ->
  ?sender_github_avatar_url:string ->
  ?sender_github_login:string ->
  ?sender_github_user_id:string ->
  title:string ->
  url:string ->
  action:github_pr_event_action ->
  ?base_branch:string ->
  ?head_branch:string ->
  ?merged_at:string ->
  ?previous_status:github_pr_event_status ->
  status:github_pr_event_status ->
  unit ->
  github_pr_status_changed
(** Metadata for a GitHub pull request lifecycle notification. *)

(** The normalized result state for a GitHub pull request check-run notification. *)
type nonrec github_pr_check_run_state =
  | Completed
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pr_check_run_state_of_yojson :
  Yojson.Safe.t -> github_pr_check_run_state

val yojson_of_github_pr_check_run_state :
  github_pr_check_run_state -> Yojson.Safe.t

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

val github_pr_check_run_of_yojson : Yojson.Safe.t -> github_pr_check_run
val yojson_of_github_pr_check_run : github_pr_check_run -> Yojson.Safe.t

val make_github_pr_check_run :
  display_name:string ->
  foreign_entity_id:string ->
  github_key:string ->
  number:int64 ->
  owner:string ->
  repo:string ->
  ?sender_github_avatar_url:string ->
  ?sender_github_login:string ->
  ?sender_github_user_id:string ->
  title:string ->
  url:string ->
  check_name:string ->
  check_run_github_id:int64 ->
  check_status:string ->
  check_url:string ->
  completed_at:string ->
  conclusion:string ->
  state:github_pr_check_run_state ->
  unit ->
  github_pr_check_run
(** Metadata for a notification that a GitHub pull request check run completed. *)

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

val github_review_requested_of_yojson : Yojson.Safe.t -> github_review_requested
val yojson_of_github_review_requested : github_review_requested -> Yojson.Safe.t

val make_github_review_requested :
  display_name:string ->
  foreign_entity_id:string ->
  github_key:string ->
  number:int64 ->
  owner:string ->
  repo:string ->
  ?sender_github_avatar_url:string ->
  ?sender_github_login:string ->
  ?sender_github_user_id:string ->
  title:string ->
  url:string ->
  ?requested_reviewer_github_login:string ->
  ?requested_reviewer_github_user_id:string ->
  unit ->
  github_review_requested
(** Metadata for a notification that the user's review was requested on a GitHub pull request. *)

(** The kind of GitHub comment that triggered a \[[GithubPrComment]\] notification. *)
type nonrec github_pr_comment_kind =
  | Issue
  | Review_comment
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pr_comment_kind_of_yojson : Yojson.Safe.t -> github_pr_comment_kind
val yojson_of_github_pr_comment_kind : github_pr_comment_kind -> Yojson.Safe.t

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

val github_pr_comment_of_yojson : Yojson.Safe.t -> github_pr_comment
val yojson_of_github_pr_comment : github_pr_comment -> Yojson.Safe.t

val make_github_pr_comment :
  display_name:string ->
  foreign_entity_id:string ->
  github_key:string ->
  number:int64 ->
  owner:string ->
  repo:string ->
  ?sender_github_avatar_url:string ->
  ?sender_github_login:string ->
  ?sender_github_user_id:string ->
  title:string ->
  url:string ->
  ?comment_github_id:int64 ->
  comment_kind:github_pr_comment_kind ->
  comment_snippet:string ->
  ?comment_url:string ->
  unit ->
  github_pr_comment
(** Metadata for a notification that a GitHub pull request was commented on. *)

(** Where in a GitHub pull request the user was mentioned. *)
type nonrec github_pr_mention_location =
  | Pr_body
  | Comment
  | Review
  | Review_comment
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pr_mention_location_of_yojson :
  Yojson.Safe.t -> github_pr_mention_location

val yojson_of_github_pr_mention_location :
  github_pr_mention_location -> Yojson.Safe.t

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

val github_pr_mention_of_yojson : Yojson.Safe.t -> github_pr_mention
val yojson_of_github_pr_mention : github_pr_mention -> Yojson.Safe.t

val make_github_pr_mention :
  display_name:string ->
  foreign_entity_id:string ->
  github_key:string ->
  number:int64 ->
  owner:string ->
  repo:string ->
  ?sender_github_avatar_url:string ->
  ?sender_github_login:string ->
  ?sender_github_user_id:string ->
  title:string ->
  url:string ->
  ?comment_github_id:int64 ->
  ?comment_url:string ->
  location:github_pr_mention_location ->
  text_snippet:string ->
  unit ->
  github_pr_mention
(** Metadata for a notification that the user was mentioned on a GitHub pull request. *)

(** The state of a submitted GitHub pull request review. *)
type nonrec github_pr_review_state =
  | Approved
  | Changes_requested
  | Commented
  | Unknown of string  (** A value this SDK version does not know. *)

val github_pr_review_state_of_yojson : Yojson.Safe.t -> github_pr_review_state
val yojson_of_github_pr_review_state : github_pr_review_state -> Yojson.Safe.t

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

val github_pr_review_of_yojson : Yojson.Safe.t -> github_pr_review
val yojson_of_github_pr_review : github_pr_review -> Yojson.Safe.t

val make_github_pr_review :
  display_name:string ->
  foreign_entity_id:string ->
  github_key:string ->
  number:int64 ->
  owner:string ->
  repo:string ->
  ?sender_github_avatar_url:string ->
  ?sender_github_login:string ->
  ?sender_github_user_id:string ->
  title:string ->
  url:string ->
  ?review_github_id:int64 ->
  ?review_snippet:string ->
  ?review_url:string ->
  state:github_pr_review_state ->
  unit ->
  github_pr_review
(** Metadata for a notification that a review was submitted on the user's GitHub pull request. *)

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

val channel_message_reaction_metadata_of_yojson :
  Yojson.Safe.t -> channel_message_reaction_metadata

val yojson_of_channel_message_reaction_metadata :
  channel_message_reaction_metadata -> Yojson.Safe.t

val make_channel_message_reaction_metadata :
  ?channel_name:string ->
  channel_type:channel_type ->
  emoji:string ->
  message_content:string ->
  message_id:string ->
  ?sender_profile_picture_url:string ->
  ?thread_id:string ->
  unit ->
  channel_message_reaction_metadata
(** Metadata for a reaction added to one of the recipient's channel messages. *)

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

val calendar_event_join_request_metadata_of_yojson :
  Yojson.Safe.t -> calendar_event_join_request_metadata

val yojson_of_calendar_event_join_request_metadata :
  calendar_event_join_request_metadata -> Yojson.Safe.t

val make_calendar_event_join_request_metadata :
  event_id:string ->
  request_id:string ->
  title:string ->
  unit ->
  calendar_event_join_request_metadata
(** A channel member who sees a calendar event only through a channel share
asked the person who shared it to add them as a guest. Sent to the sharer,
with the requester as sender. *)

type nonrec channel_access_requested_metadata = {
  channel_name : string option;
  channel_type : channel_type;
  request_id : string;
      (** The attempt to join, which is also this notification's id. *)
  sender_profile_picture_url : string option;
      (** Optional requester profile picture URL. *)
}
(** A person asked to join a channel the recipient participates in. *)

val channel_access_requested_metadata_of_yojson :
  Yojson.Safe.t -> channel_access_requested_metadata

val yojson_of_channel_access_requested_metadata :
  channel_access_requested_metadata -> Yojson.Safe.t

val make_channel_access_requested_metadata :
  ?channel_name:string ->
  channel_type:channel_type ->
  request_id:string ->
  ?sender_profile_picture_url:string ->
  unit ->
  channel_access_requested_metadata
(** A person asked to join a channel the recipient participates in. *)

(** How a routine run ended, as its notification reports it. *)
type nonrec routine_run_outcome =
  | Succeeded
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val routine_run_outcome_of_yojson : Yojson.Safe.t -> routine_run_outcome
val yojson_of_routine_run_outcome : routine_run_outcome -> Yojson.Safe.t

type nonrec routine_run_finished_metadata = {
  outcome : routine_run_outcome;  (** How the run ended. *)
  routine_id : string;  (** The routine that ran. *)
  routine_name : string;  (** The routine's name when it ran. *)
}
(** One of the recipient's routines finished a run. Every run notifies,
whether it succeeded or failed. *)

val routine_run_finished_metadata_of_yojson :
  Yojson.Safe.t -> routine_run_finished_metadata

val yojson_of_routine_run_finished_metadata :
  routine_run_finished_metadata -> Yojson.Safe.t

val make_routine_run_finished_metadata :
  outcome:routine_run_outcome ->
  routine_id:string ->
  routine_name:string ->
  unit ->
  routine_run_finished_metadata
(** One of the recipient's routines finished a run. Every run notifies,
whether it succeeded or failed. *)

type nonrec computer_setup_agent = {
  name : string;  (** The agent's name. *)
  user_id : string;  (** The agent's Macro user id, to open a DM with it. *)
}
(** The agent teammate a computer was bought for, so its inviter hears about
the agent rather than the machine. *)

val computer_setup_agent_of_yojson : Yojson.Safe.t -> computer_setup_agent
val yojson_of_computer_setup_agent : computer_setup_agent -> Yojson.Safe.t

val make_computer_setup_agent :
  name:string -> user_id:string -> unit -> computer_setup_agent
(** The agent teammate a computer was bought for, so its inviter hears about
the agent rather than the machine. *)

(** How a computer's first setup ended. *)
type nonrec computer_setup_outcome =
  | Ready  (** macrod connected for the first time: the computer is ready. *)
  | Failed of {
      failure_reason : string;
          (** Why, in the words the computer's status shows. *)
    }  (** Setup gave up before the computer was ready. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val computer_setup_outcome_of_yojson : Yojson.Safe.t -> computer_setup_outcome
val yojson_of_computer_setup_outcome : computer_setup_outcome -> Yojson.Safe.t

val make_computer_setup_outcome_failed :
  failure_reason:string -> unit -> computer_setup_outcome
(** Setup gave up before the computer was ready. *)

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

val computer_setup_metadata_of_yojson : Yojson.Safe.t -> computer_setup_metadata
val yojson_of_computer_setup_metadata : computer_setup_metadata -> Yojson.Safe.t

val make_computer_setup_metadata :
  ?agent:computer_setup_agent ->
  computer_id:string ->
  computer_name:string ->
  ?harness_id:string ->
  outcome:computer_setup_outcome ->
  unit ->
  computer_setup_metadata
(** A team's Macro computer finished first-time setup, or could not be set
up. Sent to its buyer, who continues (or retries) from the setup flow. *)

type nonrec stopped_agent = {
  bot_id : string;  (** The agent's bot id. *)
  name : string;  (** The agent's display name. *)
}
(** One of the recipient's agents that stopped with their runtime access. *)

val stopped_agent_of_yojson : Yojson.Safe.t -> stopped_agent
val yojson_of_stopped_agent : stopped_agent -> Yojson.Safe.t

val make_stopped_agent : bot_id:string -> name:string -> unit -> stopped_agent
(** One of the recipient's agents that stopped with their runtime access. *)

type nonrec runtime_access_removed_metadata = {
  agents : stopped_agent list;
      (** The recipient's agents living on the runtime, which stopped. Never
empty: without one there is nothing to tell them. *)
  runtime_name : string;  (** The runtime's name. *)
}
(** A runtime's owner removed the recipient's access to it, or lowered it to
Read, and agents the recipient keeps living there stopped. *)

val runtime_access_removed_metadata_of_yojson :
  Yojson.Safe.t -> runtime_access_removed_metadata

val yojson_of_runtime_access_removed_metadata :
  runtime_access_removed_metadata -> Yojson.Safe.t

val make_runtime_access_removed_metadata :
  agents:stopped_agent list ->
  runtime_name:string ->
  unit ->
  runtime_access_removed_metadata
(** A runtime's owner removed the recipient's access to it, or lowered it to
Read, and agents the recipient keeps living there stopped. *)

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

val notif_event_of_yojson : Yojson.Safe.t -> notif_event
val yojson_of_notif_event : notif_event -> Yojson.Safe.t

val make_notif_event_channel_mention :
  content:channel_mention_metadata -> unit -> notif_event
(** Someone mentioned you in a channel. *)

val make_notif_event_document_mention :
  content:document_mention_metadata -> unit -> notif_event
(** Someone mentioned a document in a channel. *)

val make_notif_event_mentioned_in_document_comment :
  content:mentioned_in_document_comment_metadata -> unit -> notif_event
(** User was mentioned in a comment in a document *)

val make_notif_event_replied_to_document_comment_thread :
  content:replied_to_document_comment_thread_metadata -> unit -> notif_event
(** Someone replied to a document comment thread the user participated in. *)

val make_notif_event_commented_on_document :
  content:commented_on_document_metadata -> unit -> notif_event
(** Someone commented on a document the user owns. *)

val make_notif_event_entity_access_requested :
  content:entity_access_requested_metadata -> unit -> notif_event
(** Someone requested more access to a shared entity. *)

val make_notif_event_entity_access_granted :
  content:entity_access_granted_metadata -> unit -> notif_event
(** An owner granted requested access. *)

val make_notif_event_initiative_discussion :
  content:initiative_discussion_metadata -> unit -> notif_event
(** Someone commented, replied, or mentioned the recipient on a project. *)

val make_notif_event_crm_discussion :
  content:crm_discussion_metadata -> unit -> notif_event
(** Someone commented, replied, or mentioned the recipient on a CRM company or contact. *)

val make_notif_event_channel_invite :
  content:channel_invite_metadata -> unit -> notif_event
(** The user was invited to a channel. *)

val make_notif_event_channel_message_send :
  content:channel_message_send_metadata -> unit -> notif_event
(** A user sent a message in a channel. *)

val make_notif_event_channel_message_reply :
  content:channel_reply_metadata -> unit -> notif_event
(** Someone replied to a thread in a channel that the user is part of. *)

val make_notif_event_call_started :
  content:call_started_metadata -> unit -> notif_event
(** A call has started in a channel the user is a member of.

The [call-started] alias keeps rows persisted before the type name
was normalized to snake_case ([call_started]) deserializable. *)

val make_notif_event_new_email :
  content:new_email_metadata -> unit -> notif_event
(** A new email has been sent to the user. *)

val make_notif_event_inbox_reauth_required :
  content:inbox_reauth_required_metadata -> unit -> notif_event
(** A linked inbox's grant died and must be reconnected. *)

val make_notif_event_invite_to_team :
  content:invite_to_team_metadata -> unit -> notif_event
(** A user was invited to a team. *)

val make_notif_event_task_assigned :
  content:task_assigned_metadata -> unit -> notif_event
(** A user was assigned to a task. *)

val make_notif_event_reminder : content:reminder_metadata -> unit -> notif_event
(** A reminder the user set for themselves came due. *)

val make_notif_event_external_chat_message :
  content:external_chat_message_metadata -> unit -> notif_event
(** A live message in a shared external chat. *)

val make_notif_event_calendar_event_reminder :
  content:calendar_event_reminder_metadata -> unit -> notif_event
(** A calendar event alarm came due. *)

val make_notif_event_ai_response :
  content:ai_response_metadata -> unit -> notif_event
(** An AI assistant responded to a chat. *)

val make_notif_event_github_pr_status_changed :
  content:github_pr_status_changed -> unit -> notif_event
(** A GitHub pull request changed lifecycle state.

The [github_pr_event] alias keeps rows and queue messages persisted
before the rename deserializable. *)

val make_notif_event_github_pr_check_run :
  content:github_pr_check_run -> unit -> notif_event
(** A GitHub pull request check run completed. *)

val make_notif_event_github_review_requested :
  content:github_review_requested -> unit -> notif_event
(** The user's review was requested on a GitHub pull request. *)

val make_notif_event_github_pr_comment :
  content:github_pr_comment -> unit -> notif_event
(** A GitHub pull request was commented on. *)

val make_notif_event_github_pr_mention :
  content:github_pr_mention -> unit -> notif_event
(** The user was mentioned on a GitHub pull request. *)

val make_notif_event_github_pr_review :
  content:github_pr_review -> unit -> notif_event
(** A review was submitted on the user's GitHub pull request. *)

val make_notif_event_agent_session_settled :
  content:agent_session_settled_metadata -> unit -> notif_event
(** An agent finished a turn with nothing queued behind it. *)

val make_notif_event_agent_session_waiting_for_input :
  content:agent_session_waiting_for_input_metadata -> unit -> notif_event
(** An agent is blocked on a question for the session's owner. *)

val make_notif_event_agent_session_mentioned :
  content:agent_session_mentioned_metadata -> unit -> notif_event
(** The user was named in a prompt to an agent session. *)

val make_notif_event_channel_message_reaction :
  content:channel_message_reaction_metadata -> unit -> notif_event
(** Someone reacted to one of the user's channel messages. *)

val make_notif_event_calendar_event_join_request :
  content:calendar_event_join_request_metadata -> unit -> notif_event
(** A channel member asked to be added as a guest of an event the
user shared with the channel. *)

val make_notif_event_channel_access_requested :
  content:channel_access_requested_metadata -> unit -> notif_event
(** Someone asked to join a channel the user participates in. *)

val make_notif_event_routine_run_finished :
  content:routine_run_finished_metadata -> unit -> notif_event
(** One of the user's routines finished a run, successfully or not. *)

val make_notif_event_agent_sign_in_expiry :
  content:agent_sign_in_expiry_metadata -> unit -> notif_event
(** An agent's sign-in on one of the team's Macro computers is about
to expire, expired, or was rejected. *)

val make_notif_event_computer_setup :
  content:computer_setup_metadata -> unit -> notif_event
(** A Macro computer the user bought finished first-time setup, or
could not be set up. *)

val make_notif_event_runtime_access_removed :
  content:runtime_access_removed_metadata -> unit -> notif_event
(** A runtime's owner removed the user's access to it, and agents of
theirs living there stopped. *)

(** The mutually exclusive lifecycle states of a user's notification. *)
type nonrec notification_state =
  | Unseen
  | Seen
  | Done
  | Unknown of string  (** A value this SDK version does not know. *)

val notification_state_of_yojson : Yojson.Safe.t -> notification_state
val yojson_of_notification_state : notification_state -> Yojson.Safe.t

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

val api_user_notification_of_yojson : Yojson.Safe.t -> api_user_notification
val yojson_of_api_user_notification : api_user_notification -> Yojson.Safe.t

val make_api_user_notification :
  entity_id:string ->
  entity_type:entity_type ->
  created_at:string ->
  ?deleted_at:string ->
  id:string ->
  notification_event_type:string ->
  notification_metadata:notif_event ->
  owner_id:string ->
  ?sender_id:string ->
  sent:bool ->
  state:notification_state ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  api_user_notification

type nonrec bulk_get_by_event_item_ids_request = {
  event_item_ids : string list;
      (** The event item IDs to filter notifications by. *)
}
(** Request body for bulk-fetching notifications by event item IDs. *)

val bulk_get_by_event_item_ids_request_of_yojson :
  Yojson.Safe.t -> bulk_get_by_event_item_ids_request

val yojson_of_bulk_get_by_event_item_ids_request :
  bulk_get_by_event_item_ids_request -> Yojson.Safe.t

val make_bulk_get_by_event_item_ids_request :
  event_item_ids:string list -> unit -> bulk_get_by_event_item_ids_request
(** Request body for bulk-fetching notifications by event item IDs. *)

type nonrec bulk_item = { item_id : string; item_type : entity_type }

val bulk_item_of_yojson : Yojson.Safe.t -> bulk_item
val yojson_of_bulk_item : bulk_item -> Yojson.Safe.t

val make_bulk_item :
  item_id:string -> item_type:entity_type -> unit -> bulk_item

type nonrec bulk_remove_items_request = { items : bulk_item list }

val bulk_remove_items_request_of_yojson :
  Yojson.Safe.t -> bulk_remove_items_request

val yojson_of_bulk_remove_items_request :
  bulk_remove_items_request -> Yojson.Safe.t

val make_bulk_remove_items_request :
  items:bulk_item list -> unit -> bulk_remove_items_request

type nonrec bulk_set_items_request = {
  items : bulk_item list;
  snoozed_until : string option;
      (** A future resume time. Omit to mute indefinitely. *)
}

val bulk_set_items_request_of_yojson : Yojson.Safe.t -> bulk_set_items_request
val yojson_of_bulk_set_items_request : bulk_set_items_request -> Yojson.Safe.t

val make_bulk_set_items_request :
  items:bulk_item list ->
  ?snoozed_until:string ->
  unit ->
  bulk_set_items_request

type nonrec common_channel_metadata = {
  channel_name : string option;
  channel_type : channel_type;
}
(** Common metadata for notifications on channels *)

val common_channel_metadata_of_yojson : Yojson.Safe.t -> common_channel_metadata
val yojson_of_common_channel_metadata : common_channel_metadata -> Yojson.Safe.t

val make_common_channel_metadata :
  ?channel_name:string ->
  channel_type:channel_type ->
  unit ->
  common_channel_metadata
(** Common metadata for notifications on channels *)

type nonrec notification_type_name = string
(** newtype wrapper for the the typename of a Notification *)

val notification_type_name_of_yojson : Yojson.Safe.t -> notification_type_name
val yojson_of_notification_type_name : notification_type_name -> Yojson.Safe.t

type nonrec realtime_notif_tagged_content_value_notification_metadata = {
  content : Yojson.Safe.t;
  tag : notification_type_name;
}
(** A notification metadata value tagged with the notification event type. *)

val realtime_notif_tagged_content_value_notification_metadata_of_yojson :
  Yojson.Safe.t -> realtime_notif_tagged_content_value_notification_metadata

val yojson_of_realtime_notif_tagged_content_value_notification_metadata :
  realtime_notif_tagged_content_value_notification_metadata -> Yojson.Safe.t

val make_realtime_notif_tagged_content_value_notification_metadata :
  content:Yojson.Safe.t ->
  tag:notification_type_name ->
  unit ->
  realtime_notif_tagged_content_value_notification_metadata
(** A notification metadata value tagged with the notification event type. *)

type nonrec macro_user_id_str = string

val macro_user_id_str_of_yojson : Yojson.Safe.t -> macro_user_id_str
val yojson_of_macro_user_id_str : macro_user_id_str -> Yojson.Safe.t

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

val realtime_notif_tagged_content_value_of_yojson :
  Yojson.Safe.t -> realtime_notif_tagged_content_value

val yojson_of_realtime_notif_tagged_content_value :
  realtime_notif_tagged_content_value -> Yojson.Safe.t

val make_realtime_notif_tagged_content_value :
  entity_id:string ->
  entity_type:entity_type ->
  created_at:string ->
  ?deleted_at:string ->
  notification_event_type:string ->
  notification_id:string ->
  notification_metadata:
    realtime_notif_tagged_content_value_notification_metadata ->
  ?sender_id:macro_user_id_str ->
  sent:bool ->
  state:notification_state ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  realtime_notif_tagged_content_value
(** the value of the inner payload inside \[ConnGatewayNotification\] *)

type nonrec conn_gateway_notification_payload =
  realtime_notif_tagged_content_value
(** Concrete schema type for \[[RealtimeNotif]\] with [serde_json::Value] metadata.

Used for OpenAPI schema generation — serializes identically to
[RealtimeNotif<serde_json::Value>]. *)

val conn_gateway_notification_payload_of_yojson :
  Yojson.Safe.t -> conn_gateway_notification_payload

val yojson_of_conn_gateway_notification_payload :
  conn_gateway_notification_payload -> Yojson.Safe.t

type nonrec create_notification = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
  metadata : Yojson.Safe.t option;
      (** Custom metadata that may be needed for the notification *)
  notification_event_type : string;  (** The type of notification *)
  service_sender : string;  (** The service that created the notification *)
}

val create_notification_of_yojson : Yojson.Safe.t -> create_notification
val yojson_of_create_notification : create_notification -> Yojson.Safe.t

val make_create_notification :
  entity_id:string ->
  entity_type:entity_type ->
  ?metadata:Yojson.Safe.t ->
  notification_event_type:string ->
  service_sender:string ->
  unit ->
  create_notification

type nonrec device_type =
  | Ios
  | Android
  | Iosvoip
  | Unknown of string  (** A value this SDK version does not know. *)

val device_type_of_yojson : Yojson.Safe.t -> device_type
val yojson_of_device_type : device_type -> Yojson.Safe.t

type nonrec device_request = {
  device_type : device_type;  (** The device platform type (iOS or Android). *)
  native_call_capable : bool option;
      (** Whether this Android binary supports native Telecom incoming calls. *)
  token : string;  (** The device push notification token. *)
}
(** Request to register or unregister a device for push notifications. *)

val device_request_of_yojson : Yojson.Safe.t -> device_request
val yojson_of_device_request : device_request -> Yojson.Safe.t

val make_device_request :
  device_type:device_type ->
  ?native_call_capable:bool ->
  token:string ->
  unit ->
  device_request
(** Request to register or unregister a device for push notifications. *)

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

val empty_response_of_yojson : Yojson.Safe.t -> empty_response
val yojson_of_empty_response : empty_response -> Yojson.Safe.t

type nonrec entity = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
}
(** The Entity describes the minimum amount of information required to describe a unique thing in Macro
This contains the type of the entity \[EntityType\] and the string id of that entity *)

val entity_of_yojson : Yojson.Safe.t -> entity
val yojson_of_entity : entity -> Yojson.Safe.t

val make_entity : entity_id:string -> entity_type:entity_type -> unit -> entity
(** The Entity describes the minimum amount of information required to describe a unique thing in Macro
This contains the type of the entity \[EntityType\] and the string id of that entity *)

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

type nonrec get_all_user_notifications_response = {
  items : api_user_notification list;  (** The list of items returned. *)
  next_cursor : string option;  (** The next page cursor if it exists. *)
}
(** The strongly typed response for listing user notifications. *)

val get_all_user_notifications_response_of_yojson :
  Yojson.Safe.t -> get_all_user_notifications_response

val yojson_of_get_all_user_notifications_response :
  get_all_user_notifications_response -> Yojson.Safe.t

val make_get_all_user_notifications_response :
  items:api_user_notification list ->
  ?next_cursor:string ->
  unit ->
  get_all_user_notifications_response
(** The strongly typed response for listing user notifications. *)

type nonrec get_notification_type_preferences_response = {
  disabled_types : string list;
      (** The notification types that the user has disabled. *)
}
(** Response for listing disabled notification types. *)

val get_notification_type_preferences_response_of_yojson :
  Yojson.Safe.t -> get_notification_type_preferences_response

val yojson_of_get_notification_type_preferences_response :
  get_notification_type_preferences_response -> Yojson.Safe.t

val make_get_notification_type_preferences_response :
  disabled_types:string list ->
  unit ->
  get_notification_type_preferences_response
(** Response for listing disabled notification types. *)

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

val github_pr_notification_common_of_yojson :
  Yojson.Safe.t -> github_pr_notification_common

val yojson_of_github_pr_notification_common :
  github_pr_notification_common -> Yojson.Safe.t

val make_github_pr_notification_common :
  display_name:string ->
  foreign_entity_id:string ->
  github_key:string ->
  number:int64 ->
  owner:string ->
  repo:string ->
  ?sender_github_avatar_url:string ->
  ?sender_github_login:string ->
  ?sender_github_user_id:string ->
  title:string ->
  url:string ->
  unit ->
  github_pr_notification_common
(** Fields shared by every GitHub pull request notification type.

Embedded with `#\[serde(flatten)\]` so the wire shape keeps these keys at the
top level of the metadata object. *)

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

val item_shared_metadata_of_yojson : Yojson.Safe.t -> item_shared_metadata
val yojson_of_item_shared_metadata : item_shared_metadata -> Yojson.Safe.t

val make_item_shared_metadata :
  item_id:string ->
  ?item_name:string ->
  item_type:entity_type ->
  ?permission_level:string ->
  shared_by:string ->
  user_ids:string list ->
  unit ->
  item_shared_metadata
(** Metadata for when a item is shared with a user *)

type nonrec notification_bulk_request = {
  notification_ids : string list;  (** The ids of the notifications to handle *)
}
(** the notification ids that we are bulk updating *)

val notification_bulk_request_of_yojson :
  Yojson.Safe.t -> notification_bulk_request

val yojson_of_notification_bulk_request :
  notification_bulk_request -> Yojson.Safe.t

val make_notification_bulk_request :
  notification_ids:string list -> unit -> notification_bulk_request
(** the notification ids that we are bulk updating *)

type nonrec notification_service_api_version =
  | V1
  | Unknown of string  (** A value this SDK version does not know. *)

val notification_service_api_version_of_yojson :
  Yojson.Safe.t -> notification_service_api_version

val yojson_of_notification_service_api_version :
  notification_service_api_version -> Yojson.Safe.t

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

val push_notification_navigation_of_yojson :
  Yojson.Safe.t -> push_notification_navigation

val yojson_of_push_notification_navigation :
  push_notification_navigation -> Yojson.Safe.t

val make_push_notification_navigation_channel :
  channel_id:string ->
  message_id:string ->
  ?thread_id:string ->
  unit ->
  push_notification_navigation
(** Open a channel at a specific message. *)

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

val push_notification_data_of_yojson : Yojson.Safe.t -> push_notification_data
val yojson_of_push_notification_data : push_notification_data -> Yojson.Safe.t

val make_push_notification_data :
  ?navigation:push_notification_navigation ->
  notification_id:string ->
  ?recipient_id:string ->
  ?sender_profile_picture_url:string ->
  unit ->
  push_notification_data
(** the value we send as the payload in the ios notification
This data is accessible to the client *)

type nonrec unsubscribe_item_path_params = {
  item_id : string;
  item_type : entity_type;
}

val unsubscribe_item_path_params_of_yojson :
  Yojson.Safe.t -> unsubscribe_item_path_params

val yojson_of_unsubscribe_item_path_params :
  unsubscribe_item_path_params -> Yojson.Safe.t

val make_unsubscribe_item_path_params :
  item_id:string ->
  item_type:entity_type ->
  unit ->
  unsubscribe_item_path_params

type nonrec user_unsubscribe = {
  item_id : string;  (** The item id *)
  item_type : string;  (** The item type *)
  snoozed_until : string option;
      (** None for permanent mutes; notifications resume automatically at this deadline. *)
}

val user_unsubscribe_of_yojson : Yojson.Safe.t -> user_unsubscribe
val yojson_of_user_unsubscribe : user_unsubscribe -> Yojson.Safe.t

val make_user_unsubscribe :
  item_id:string ->
  item_type:string ->
  ?snoozed_until:string ->
  unit ->
  user_unsubscribe

val health_handler :
  unit ->
  ( empty_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /health]

Health check *)

val get_unsubscribes :
  unit -> (user_unsubscribe list, error_response) Macro_sdk_runtime.Request.t
(** [GET /unsubscribe]

Gets the users unsubscribe items. *)

val unsubscribe_email :
  unit -> (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /unsubscribe/email]

Unsubscribes a user from receiving emails *)

val unsubscribe_item :
  item_type:entity_type ->
  item_id:string ->
  ?snoozed_until:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /unsubscribe/item/{item_type}/{item_id}]

Unsubscribes a user from a given item for notifications. *)

val remove_unsubscribe_item :
  item_type:entity_type ->
  item_id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /unsubscribe/item/{item_type}/{item_id}]

Removes a unsubscribe item for a user. *)

val unsubscribe_items :
  items:bulk_item list ->
  ?snoozed_until:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /unsubscribe/items]

Atomically mute or snooze items for the authenticated user. *)

val remove_unsubscribe_items :
  items:bulk_item list ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /unsubscribe/items]

Atomically resume delivery for the authenticated user's items. *)

val unsubscribe_all :
  unit -> (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /unsubscribe/mute]

Unsubscribes user from all notifications. *)

val remove_unsubscribe_all :
  unit -> (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /unsubscribe/mute]

Unmutes all notifications.
Existing notifications that were muted manually will remain muted. *)

val list_typed_notifications :
  ?states:string ->
  ?limit:int ->
  ?cursor:string ->
  unit ->
  ( get_all_user_notifications_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [GET /v1/user_notifications]

Wrapper handler that calls the inner generic list handler with [serde_json::Value],
then converts each row to \[[UserNotificationRow<NotifEvent>]\]. *)

val bulk_delete_user_notifications_v2 :
  notification_ids:string list ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /v1/user_notifications/bulk]

Soft-delete multiple user notifications. *)

val bulk_mark_notifications_done :
  notification_ids:string list ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /v1/user_notifications/bulk/done]

Mark notifications as done. *)

val bulk_mark_notifications_seen :
  notification_ids:string list ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /v1/user_notifications/bulk/seen]

Mark notifications as seen. *)

val bulk_mark_notifications_undone :
  notification_ids:string list ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /v1/user_notifications/bulk/undone]

Mark notifications as not done. *)

val bulk_get_typed_notifications_by_event_item_ids :
  event_item_ids:string list ->
  ?states:string ->
  ?limit:int ->
  ?cursor:string ->
  unit ->
  ( get_all_user_notifications_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [POST /v1/user_notifications/item/bulk]

Wrapper handler that calls the inner generic bulk-get handler with [serde_json::Value],
then converts each row to \[[UserNotificationRow<NotifEvent>]\]. *)

val get_typed_notifications_by_event_item_id :
  event_item_id:string ->
  ?states:string ->
  ?limit:int ->
  ?cursor:string ->
  unit ->
  ( get_all_user_notifications_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [GET /v1/user_notifications/item/{event_item_id}]

Typed wrapper for getting notifications by a single event item ID. *)

val get_notification_type_preferences :
  unit ->
  ( get_notification_type_preferences_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [GET /v1/user_notifications/preferences]

Get the notification types that the user has disabled. *)

val disable_notification_type :
  notification_event_type:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [PUT /v1/user_notifications/preferences/{notification_event_type}/disable]

Disable a notification type for the authenticated user. *)

val enable_notification_type :
  notification_event_type:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [PUT /v1/user_notifications/preferences/{notification_event_type}/enable]

Re-enable a notification type for the authenticated user. *)

val get_typed_notification_by_id :
  notification_id:string ->
  unit ->
  (api_user_notification, error_response) Macro_sdk_runtime.Request.t
(** [GET /v1/user_notifications/{notification_id}]

Typed wrapper for getting a single notification by ID. *)

val delete_user_notification_v2 :
  notification_id:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /v1/user_notifications/{notification_id}]

Soft-delete a single user notification. *)
