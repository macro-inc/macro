(* Generated from packages/sdk/specs/email.json by packages/sdk-ocaml/gen. Do not edit. *)

(** Ordered from least to most access top -> bottom *)
type nonrec access_level =
  | View
  | Comment
  | Edit
  | Owner
  | Unknown of string  (** A value this SDK version does not know. *)

val access_level_of_yojson : Yojson.Safe.t -> access_level
val yojson_of_access_level : access_level -> Yojson.Safe.t

type nonrec add_draft_attachment_request = {
  file_name : string;  (** The name of the file being uploaded. *)
  sha : string;  (** The SHA256 hash of the file being uploaded. *)
  size : int;  (** The size of the file in bytes. *)
  upload_id : string option;
      (** Stable client upload identifier. Retry the same file with the same ID. *)
}
(** The request passed to send a message *)

val add_draft_attachment_request_of_yojson :
  Yojson.Safe.t -> add_draft_attachment_request

val yojson_of_add_draft_attachment_request :
  add_draft_attachment_request -> Yojson.Safe.t

val make_add_draft_attachment_request :
  file_name:string ->
  sha:string ->
  size:int ->
  ?upload_id:string ->
  unit ->
  add_draft_attachment_request
(** The request passed to send a message *)

type nonrec add_draft_attachment_response = {
  attachment_id : string;  (** The ID of the attachment in the database. *)
  content_type : string;  (** The MIME type of the attachment. *)
  upload_url : string;  (** The URL to upload the attachment to. *)
}

val add_draft_attachment_response_of_yojson :
  Yojson.Safe.t -> add_draft_attachment_response

val yojson_of_add_draft_attachment_response :
  add_draft_attachment_response -> Yojson.Safe.t

val make_add_draft_attachment_response :
  attachment_id:string ->
  content_type:string ->
  upload_url:string ->
  unit ->
  add_draft_attachment_response

type nonrec add_forwarded_attachment_request = {
  attachment_id : string;  (** The ID of the original attachment to forward. *)
}

val add_forwarded_attachment_request_of_yojson :
  Yojson.Safe.t -> add_forwarded_attachment_request

val yojson_of_add_forwarded_attachment_request :
  add_forwarded_attachment_request -> Yojson.Safe.t

val make_add_forwarded_attachment_request :
  attachment_id:string -> unit -> add_forwarded_attachment_request

type nonrec add_forwarded_attachment_response = {
  attachment_id : string;  (** The ID of the original attachment. *)
  filename : string option;  (** Original file name of the attachment. *)
  mime_type : string option;  (** MIME type of the attachment. *)
  size_bytes : int64 option;  (** File size in bytes. *)
}

val add_forwarded_attachment_response_of_yojson :
  Yojson.Safe.t -> add_forwarded_attachment_response

val yojson_of_add_forwarded_attachment_response :
  add_forwarded_attachment_response -> Yojson.Safe.t

val make_add_forwarded_attachment_response :
  attachment_id:string ->
  ?filename:string ->
  ?mime_type:string ->
  ?size_bytes:int64 ->
  unit ->
  add_forwarded_attachment_response

type nonrec api_attachment = {
  content_id : string option;
  created_at : string;
  filename : string option;
  id : string;
  message_id : string;
  mime_type : string option;
  provider_attachment_id : string option;
  size_bytes : int64 option;
}

val api_attachment_of_yojson : Yojson.Safe.t -> api_attachment
val yojson_of_api_attachment : api_attachment -> Yojson.Safe.t

val make_api_attachment :
  ?content_id:string ->
  created_at:string ->
  ?filename:string ->
  id:string ->
  message_id:string ->
  ?mime_type:string ->
  ?provider_attachment_id:string ->
  ?size_bytes:int64 ->
  unit ->
  api_attachment

type nonrec api_attachment_draft = {
  content_id : string option;
  content_type : string;
  draft_id : string;
  file_name : string;
  id : string;
  is_inline : bool;
  s3_key : string;
  sha : string;
  size : int;
  upload_pending : bool;
}
(** API representation of a draft attachment on a message. *)

val api_attachment_draft_of_yojson : Yojson.Safe.t -> api_attachment_draft
val yojson_of_api_attachment_draft : api_attachment_draft -> Yojson.Safe.t

val make_api_attachment_draft :
  ?content_id:string ->
  content_type:string ->
  draft_id:string ->
  file_name:string ->
  id:string ->
  is_inline:bool ->
  s3_key:string ->
  sha:string ->
  size:int ->
  upload_pending:bool ->
  unit ->
  api_attachment_draft
(** API representation of a draft attachment on a message. *)

type nonrec api_attachment_forwarded = {
  attachment_id : string;
  draft_id : string;
  filename : string option;
  message_provider_id : string;
  mime_type : string option;
  provider_attachment_id : string option;
  size_bytes : int64 option;
}
(** API representation of a forwarded attachment on a message. *)

val api_attachment_forwarded_of_yojson :
  Yojson.Safe.t -> api_attachment_forwarded

val yojson_of_api_attachment_forwarded :
  api_attachment_forwarded -> Yojson.Safe.t

val make_api_attachment_forwarded :
  attachment_id:string ->
  draft_id:string ->
  ?filename:string ->
  message_provider_id:string ->
  ?mime_type:string ->
  ?provider_attachment_id:string ->
  ?size_bytes:int64 ->
  unit ->
  api_attachment_forwarded
(** API representation of a forwarded attachment on a message. *)

type nonrec api_contact = {
  email_address : string option;
  id : string;
  link_id : string;
  name : string option;
  sfs_photo_url : string option;
}

val api_contact_of_yojson : Yojson.Safe.t -> api_contact
val yojson_of_api_contact : api_contact -> Yojson.Safe.t

val make_api_contact :
  ?email_address:string ->
  id:string ->
  link_id:string ->
  ?name:string ->
  ?sfs_photo_url:string ->
  unit ->
  api_contact

type nonrec api_contact_info = {
  email : string;
  name : string option;
  photo_url : string option;
}
(** API representation of a contact (sender or recipient). *)

val api_contact_info_of_yojson : Yojson.Safe.t -> api_contact_info
val yojson_of_api_contact_info : api_contact_info -> Yojson.Safe.t

val make_api_contact_info :
  email:string -> ?name:string -> ?photo_url:string -> unit -> api_contact_info
(** API representation of a contact (sender or recipient). *)

type nonrec api_draft_contact_info = {
  email : string;  (** Email address. *)
  name : string option;  (** Display name. *)
  photo_url : string option;  (** Profile photo URL. *)
}
(** Contact info for draft request/response (backward-compatible with MessageToSend shape). *)

val api_draft_contact_info_of_yojson : Yojson.Safe.t -> api_draft_contact_info
val yojson_of_api_draft_contact_info : api_draft_contact_info -> Yojson.Safe.t

val make_api_draft_contact_info :
  email:string ->
  ?name:string ->
  ?photo_url:string ->
  unit ->
  api_draft_contact_info
(** Contact info for draft request/response (backward-compatible with MessageToSend shape). *)

type nonrec value = Yojson.Safe.t

val value_of_yojson : Yojson.Safe.t -> value
val yojson_of_value : value -> Yojson.Safe.t

type nonrec api_draft_input = {
  bcc : api_draft_contact_info list option;  (** Bcc recipients. *)
  body_html : string option;
      (** HTML body (base64 URL_SAFE_NO_PAD encoded). Sanitized before storage. *)
  body_macro : string option;  (** Macro body format. *)
  body_text : string option;  (** Plain text body. *)
  cc : api_draft_contact_info list option;  (** Cc recipients. *)
  db_id : string option;
      (** Existing message DB ID (for updating an existing draft). *)
  draft_generation : int option;
      (** Generation from the last loaded draft; legacy clients begin at zero. *)
  from : string option;
      (** The address to send from: the selected inbox's own address or one of
its verified Gmail send-as aliases, which sends under the alias's
display name. Omit it to send from the inbox's own address. *)
  headers_json : value option;
  include_signature : bool option;
      (** Per-message override for whether to include the signature on send:
[Some(false)] to exclude (user dismissed it). Omit to use the inbox's
default policy. Ignored for drafts. *)
  provider_id : string option;  (** Provider message ID. *)
  provider_thread_id : string option;  (** Provider thread ID. *)
  replying_to_id : string option;
      (** ID of the message this draft is replying to. *)
  subject : string;  (** Subject line. *)
  thread_db_id : string option;  (** Thread DB ID. *)
  to_ : api_draft_contact_info list option;  (** To recipients. *)
}
(** The draft input matching the current [MessageToSend] JSON shape for backward compat. *)

val api_draft_input_of_yojson : Yojson.Safe.t -> api_draft_input
val yojson_of_api_draft_input : api_draft_input -> Yojson.Safe.t

val make_api_draft_input :
  ?bcc:api_draft_contact_info list ->
  ?body_html:string ->
  ?body_macro:string ->
  ?body_text:string ->
  ?cc:api_draft_contact_info list ->
  ?db_id:string ->
  ?draft_generation:int ->
  ?from:string ->
  ?headers_json:value ->
  ?include_signature:bool ->
  ?provider_id:string ->
  ?provider_thread_id:string ->
  ?replying_to_id:string ->
  subject:string ->
  ?thread_db_id:string ->
  ?to_:api_draft_contact_info list ->
  unit ->
  api_draft_input
(** The draft input matching the current [MessageToSend] JSON shape for backward compat. *)

type nonrec api_draft_output = {
  bcc : api_draft_contact_info list option;  (** Bcc recipients. *)
  body_html : string option;  (** HTML body (decoded). *)
  body_macro : string option;  (** Macro body. *)
  body_text : string option;  (** Plain text body. *)
  cc : api_draft_contact_info list option;  (** Cc recipients. *)
  db_id : string option;  (** Message DB ID. *)
  draft_generation : int;  (** Generation required for subsequent edits. *)
  headers_json : value option;
  link_id : string;  (** Link ID. *)
  provider_id : string option;  (** Provider message ID. *)
  provider_thread_id : string option;  (** Provider thread ID. *)
  replying_to_id : string option;
      (** ID of the message this draft is replying to. *)
  send_time : string option;  (** Send time. *)
  subject : string;  (** Subject line. *)
  thread_db_id : string option;  (** Thread DB ID. *)
  to_ : api_draft_contact_info list option;  (** To recipients. *)
}
(** The draft output matching the current [MessageToSend] JSON shape for backward compat. *)

val api_draft_output_of_yojson : Yojson.Safe.t -> api_draft_output
val yojson_of_api_draft_output : api_draft_output -> Yojson.Safe.t

val make_api_draft_output :
  ?bcc:api_draft_contact_info list ->
  ?body_html:string ->
  ?body_macro:string ->
  ?body_text:string ->
  ?cc:api_draft_contact_info list ->
  ?db_id:string ->
  draft_generation:int ->
  ?headers_json:value ->
  link_id:string ->
  ?provider_id:string ->
  ?provider_thread_id:string ->
  ?replying_to_id:string ->
  ?send_time:string ->
  subject:string ->
  ?thread_db_id:string ->
  ?to_:api_draft_contact_info list ->
  unit ->
  api_draft_output
(** The draft output matching the current [MessageToSend] JSON shape for backward compat. *)

type nonrec api_email_filter = {
  created_at : string;
  email_address : string option;
  email_domain : string option;
  id : string;
  is_important : bool;
}
(** A single email filter in API responses. *)

val api_email_filter_of_yojson : Yojson.Safe.t -> api_email_filter
val yojson_of_api_email_filter : api_email_filter -> Yojson.Safe.t

val make_api_email_filter :
  created_at:string ->
  ?email_address:string ->
  ?email_domain:string ->
  id:string ->
  is_important:bool ->
  unit ->
  api_email_filter
(** A single email filter in API responses. *)

type nonrec api_label_list_visibility =
  | Label_show
  | Label_show_if_unread
  | Label_hide
  | Unknown of string  (** A value this SDK version does not know. *)

val api_label_list_visibility_of_yojson :
  Yojson.Safe.t -> api_label_list_visibility

val yojson_of_api_label_list_visibility :
  api_label_list_visibility -> Yojson.Safe.t

type nonrec api_message_list_visibility =
  | Show
  | Hide
  | Unknown of string  (** A value this SDK version does not know. *)

val api_message_list_visibility_of_yojson :
  Yojson.Safe.t -> api_message_list_visibility

val yojson_of_api_message_list_visibility :
  api_message_list_visibility -> Yojson.Safe.t

type nonrec api_label_type =
  | System
  | User
  | Unknown of string  (** A value this SDK version does not know. *)

val api_label_type_of_yojson : Yojson.Safe.t -> api_label_type
val yojson_of_api_label_type : api_label_type -> Yojson.Safe.t

type nonrec api_label = {
  created_at : string;
  id : string;
  label_list_visibility : api_label_list_visibility;
  link_id : string;
  message_list_visibility : api_message_list_visibility;
  name : string;
  provider_label_id : string;
  type_ : api_label_type;
}

val api_label_of_yojson : Yojson.Safe.t -> api_label
val yojson_of_api_label : api_label -> Yojson.Safe.t

val make_api_label :
  created_at:string ->
  id:string ->
  label_list_visibility:api_label_list_visibility ->
  link_id:string ->
  message_list_visibility:api_message_list_visibility ->
  name:string ->
  provider_label_id:string ->
  type_:api_label_type ->
  unit ->
  api_label

type nonrec api_message_attachment = {
  content_id : string option;
  data_url : string option;
  db_id : string;
  filename : string option;
  mime_type : string option;
  provider_id : string option;
  reference_url : string option;
  sfs_id : string option;
  size_bytes : int64 option;
}
(** API representation of a provider attachment on a message. *)

val api_message_attachment_of_yojson : Yojson.Safe.t -> api_message_attachment
val yojson_of_api_message_attachment : api_message_attachment -> Yojson.Safe.t

val make_api_message_attachment :
  ?content_id:string ->
  ?data_url:string ->
  db_id:string ->
  ?filename:string ->
  ?mime_type:string ->
  ?provider_id:string ->
  ?reference_url:string ->
  ?sfs_id:string ->
  ?size_bytes:int64 ->
  unit ->
  api_message_attachment
(** API representation of a provider attachment on a message. *)

type nonrec invitation_participant = {
  email : string;  (** Participant calendar address. *)
  name : string option;  (** Sender-supplied display name. *)
  participation_status : string option;
      (** Original PARTSTAT, retaining extensions. *)
}
(** Scheduling participant; saved responses are historical, not current RSVP. *)

val invitation_participant_of_yojson : Yojson.Safe.t -> invitation_participant
val yojson_of_invitation_participant : invitation_participant -> Yojson.Safe.t

val make_invitation_participant :
  email:string ->
  ?name:string ->
  ?participation_status:string ->
  unit ->
  invitation_participant
(** Scheduling participant; saved responses are historical, not current RSVP. *)

(** Preserve date-only and unresolved times without manufacturing UTC instants. *)
type nonrec invitation_date_time =
  | Date of { value : string  (** ISO calendar date. *) }
      (** Calendar date. DTEND remains exclusive. *)
  | Zoned of {
      time_zone : string;  (** IANA zone of the original TZID, or UTC. *)
      value : string;  (** RFC3339 instant. *)
    }  (** Unambiguous instant with the original timezone retained. *)
  | Unresolved of {
      time_zone : string option;  (** Original TZID if present. *)
      value : string;  (** ISO local wall time, without an offset. *)
    }  (** Floating, ambiguous, nonexistent, or unknown-zone wall time. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val invitation_date_time_of_yojson : Yojson.Safe.t -> invitation_date_time
val yojson_of_invitation_date_time : invitation_date_time -> Yojson.Safe.t

val make_invitation_date_time_date :
  value:string -> unit -> invitation_date_time
(** Calendar date. DTEND remains exclusive. *)

val make_invitation_date_time_zoned :
  time_zone:string -> value:string -> unit -> invitation_date_time
(** Unambiguous instant with the original timezone retained. *)

val make_invitation_date_time_unresolved :
  ?time_zone:string -> value:string -> unit -> invitation_date_time
(** Floating, ambiguous, nonexistent, or unknown-zone wall time. *)

(** Original scheduling method, including methods unsupported for actions. *)
type nonrec invitation_method =
  | Request
  | Reply
  | Cancel
  | Counter
  | Publish
  | Unknown_
  | Unknown of string  (** A value this SDK version does not know. *)

val invitation_method_of_yojson : Yojson.Safe.t -> invitation_method
val yojson_of_invitation_method : invitation_method -> Yojson.Safe.t

type nonrec calendar_invitation = {
  attendees : invitation_participant list;
      (** Historical attendee identities and participation metadata. *)
  comment : string option;  (** Reply or counter-proposal comment. *)
  conference_url : string option;
      (** Validated HTTP(S) conferencing URL; never fetched during rendering. *)
  description : string option;
      (** Plaintext description, retaining passwords and dial-in instructions. *)
  dtstamp : string option;
      (** Scheduling timestamp in its original spelling. *)
  end_ : invitation_date_time option;
  id : string;
      (** Content-derived component identity, stable across repeated extraction. *)
  last_modified : string option;
      (** Last modification timestamp in its original spelling. *)
  location : string option;  (** Plaintext event location. *)
  method_ : invitation_method;  (** Original scheduling method. *)
  organizer : invitation_participant option;
  recurrence : string list option;
      (** Raw [RRULE], [RDATE] and [EXDATE] lines, empty for a single event.
[None] on snapshots saved before recurrence was recorded, where a
series cannot be told apart from a single event. *)
  recurrence_id : invitation_date_time option;
  recurrence_id_raw : string option;
      (** Original recurrence identifier spelling and parameters. *)
  sequence : int;  (** Scheduling revision, distinct from delivery order. *)
  start : invitation_date_time option;
  status : string option;  (** Original event status. *)
  title : string option;  (** Event summary. *)
  uid : string;  (** iCalendar UID; never a Google provider event ID. *)
}
(** Display snapshot of one meaningful VEVENT, owned by the email domain. *)

val calendar_invitation_of_yojson : Yojson.Safe.t -> calendar_invitation
val yojson_of_calendar_invitation : calendar_invitation -> Yojson.Safe.t

val make_calendar_invitation :
  attendees:invitation_participant list ->
  ?comment:string ->
  ?conference_url:string ->
  ?description:string ->
  ?dtstamp:string ->
  ?end_:invitation_date_time ->
  id:string ->
  ?last_modified:string ->
  ?location:string ->
  method_:invitation_method ->
  ?organizer:invitation_participant ->
  ?recurrence:string list ->
  ?recurrence_id:invitation_date_time ->
  ?recurrence_id_raw:string ->
  sequence:int ->
  ?start:invitation_date_time ->
  ?status:string ->
  ?title:string ->
  uid:string ->
  unit ->
  calendar_invitation
(** Display snapshot of one meaningful VEVENT, owned by the email domain. *)

type nonrec api_message_label = {
  created_at : string;
  id : string option;
  label_list_visibility : api_label_list_visibility option;
  link_id : string;
  message_list_visibility : api_message_list_visibility option;
  name : string option;
  provider_label_id : string;
  type_ : api_label_type option;
}
(** API representation of a label on a message. *)

val api_message_label_of_yojson : Yojson.Safe.t -> api_message_label
val yojson_of_api_message_label : api_message_label -> Yojson.Safe.t

val make_api_message_label :
  created_at:string ->
  ?id:string ->
  ?label_list_visibility:api_label_list_visibility ->
  link_id:string ->
  ?message_list_visibility:api_message_list_visibility ->
  ?name:string ->
  provider_label_id:string ->
  ?type_:api_label_type ->
  unit ->
  api_message_label
(** API representation of a label on a message. *)

(** Provider-neutral state exposed to clients. *)
type nonrec api_message_operation_issue =
  | Accepting_remote
  | Draft_conflict
  | Creation_unknown
  | Attachment_unknown
  | Send_unknown
  | Send_rejected
  | Access_revoked
  | Invalid_content
  | Move_pending
  | Move_conflict
  | Move_source_sent
  | Move_reauthorization
  | Move_original_remains
  | Unknown of string  (** A value this SDK version does not know. *)

val api_message_operation_issue_of_yojson :
  Yojson.Safe.t -> api_message_operation_issue

val yojson_of_api_message_operation_issue :
  api_message_operation_issue -> Yojson.Safe.t

(** Provider-neutral state exposed to clients. *)
type nonrec api_message_operation_state =
  | Pending
  | Synchronized
  | Conflict
  | Uncertain
  | Submitting
  | Confirming
  | Sent
  | Deleted
  | Cancelled
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val api_message_operation_state_of_yojson :
  Yojson.Safe.t -> api_message_operation_state

val yojson_of_api_message_operation_state :
  api_message_operation_state -> Yojson.Safe.t

type nonrec api_message_operation = {
  issue : api_message_operation_issue option;
  remote_version : string option;
  revision : string;
  state : api_message_operation_state;
}
(** Versions are opaque decimal strings so clients never truncate an i64. *)

val api_message_operation_of_yojson : Yojson.Safe.t -> api_message_operation
val yojson_of_api_message_operation : api_message_operation -> Yojson.Safe.t

val make_api_message_operation :
  ?issue:api_message_operation_issue ->
  ?remote_version:string ->
  revision:string ->
  state:api_message_operation_state ->
  unit ->
  api_message_operation
(** Versions are opaque decimal strings so clients never truncate an i64. *)

(** The user-visible delivery state of an unsent scheduled message. *)
type nonrec scheduled_send_status =
  | Pending
  | Sending
  | Failed
  | Unconfirmed
  | Unknown of string  (** A value this SDK version does not know. *)

val scheduled_send_status_of_yojson : Yojson.Safe.t -> scheduled_send_status
val yojson_of_scheduled_send_status : scheduled_send_status -> Yojson.Safe.t

type nonrec api_message = {
  attachments : api_message_attachment list;
  attachments_draft : api_attachment_draft list;
  attachments_forwarded : api_attachment_forwarded list;
  bcc : api_contact_info list;
  body_html_sanitized : string option;
  body_macro : string option;
  body_replyless : string option;
  body_text : string option;
  calendar_invitations : calendar_invitation list option;
  cc : api_contact_info list;
  created_at : string;
  db_id : string;
  draft_generation : int;
      (** Draft edit generation; changes at send and cancellation boundaries. *)
  from : api_contact_info option;
  global_id : string option;
  has_attachments : bool;
  headers_json : Yojson.Safe.t option;
  internal_date_ts : string option;
  is_draft : bool;
  is_read : bool;
  is_sent : bool;
  is_starred : bool;
  labels : api_message_label list;
  link_id : string;
  operation_status : api_message_operation option;
  provider_history_id : string option;
  provider_id : string option;
  provider_thread_id : string option;
  replying_to_id : string option;
  scheduled_send_status : scheduled_send_status option;
  scheduled_send_time : string option;
  sent_at : string option;
  size_estimate : int64 option;
  snippet : string option;
  subject : string option;
  thread_db_id : string;
  to_ : api_contact_info list;
  updated_at : string;
}
(** API representation of a fully assembled email message. *)

val api_message_of_yojson : Yojson.Safe.t -> api_message
val yojson_of_api_message : api_message -> Yojson.Safe.t

val make_api_message :
  attachments:api_message_attachment list ->
  attachments_draft:api_attachment_draft list ->
  attachments_forwarded:api_attachment_forwarded list ->
  bcc:api_contact_info list ->
  ?body_html_sanitized:string ->
  ?body_macro:string ->
  ?body_replyless:string ->
  ?body_text:string ->
  ?calendar_invitations:calendar_invitation list ->
  cc:api_contact_info list ->
  created_at:string ->
  db_id:string ->
  draft_generation:int ->
  ?from:api_contact_info ->
  ?global_id:string ->
  has_attachments:bool ->
  ?headers_json:Yojson.Safe.t ->
  ?internal_date_ts:string ->
  is_draft:bool ->
  is_read:bool ->
  is_sent:bool ->
  is_starred:bool ->
  labels:api_message_label list ->
  link_id:string ->
  ?operation_status:api_message_operation ->
  ?provider_history_id:string ->
  ?provider_id:string ->
  ?provider_thread_id:string ->
  ?replying_to_id:string ->
  ?scheduled_send_status:scheduled_send_status ->
  ?scheduled_send_time:string ->
  ?sent_at:string ->
  ?size_estimate:int64 ->
  ?snippet:string ->
  ?subject:string ->
  thread_db_id:string ->
  to_:api_contact_info list ->
  updated_at:string ->
  unit ->
  api_message
(** API representation of a fully assembled email message. *)

(** A deliberate resolution of a particular observed operation version. *)
type nonrec api_message_resolution_action =
  | Keep_local
  | Use_provider
  | Recheck
  | Retry_send
  | Keep_original
  | Unknown of string  (** A value this SDK version does not know. *)

val api_message_resolution_action_of_yojson :
  Yojson.Safe.t -> api_message_resolution_action

val yojson_of_api_message_resolution_action :
  api_message_resolution_action -> Yojson.Safe.t

type nonrec api_thread_preview_cursor = {
  created_at : string;
  id : string;
  inbox_visible : bool;
  is_draft : bool;
  is_important : bool;
  is_read : bool;
  link_id : string;
  name : string option;
  owner_id : string;
  provider_id : string option;
  sender_email : string option;
  sender_name : string option;
  sender_photo_url : string option;
  snippet : string option;
  sort_ts : string;
  updated_at : string;
  viewed_at : string option;
  attachments : api_attachment list;
  contacts : api_contact list;
  frecency_score : float option;
  labels : api_label list;
}

val api_thread_preview_cursor_of_yojson :
  Yojson.Safe.t -> api_thread_preview_cursor

val yojson_of_api_thread_preview_cursor :
  api_thread_preview_cursor -> Yojson.Safe.t

val make_api_thread_preview_cursor :
  created_at:string ->
  id:string ->
  inbox_visible:bool ->
  is_draft:bool ->
  is_important:bool ->
  is_read:bool ->
  link_id:string ->
  ?name:string ->
  owner_id:string ->
  ?provider_id:string ->
  ?sender_email:string ->
  ?sender_name:string ->
  ?sender_photo_url:string ->
  ?snippet:string ->
  sort_ts:string ->
  updated_at:string ->
  ?viewed_at:string ->
  attachments:api_attachment list ->
  contacts:api_contact list ->
  ?frecency_score:float ->
  labels:api_label list ->
  unit ->
  api_thread_preview_cursor

type nonrec api_paginated_thread_cursor = {
  items : api_thread_preview_cursor list;
  next_cursor : string option;
}

val api_paginated_thread_cursor_of_yojson :
  Yojson.Safe.t -> api_paginated_thread_cursor

val yojson_of_api_paginated_thread_cursor :
  api_paginated_thread_cursor -> Yojson.Safe.t

val make_api_paginated_thread_cursor :
  items:api_thread_preview_cursor list ->
  ?next_cursor:string ->
  unit ->
  api_paginated_thread_cursor

(** common types of sorts based on timestamps *)
type nonrec api_sort_method =
  | Viewed_at
  | Updated_at
  | Created_at
  | Viewed_updated
  | Unknown of string  (** A value this SDK version does not know. *)

val api_sort_method_of_yojson : Yojson.Safe.t -> api_sort_method
val yojson_of_api_sort_method : api_sort_method -> Yojson.Safe.t

type nonrec api_thread = {
  access_level : access_level;
  created_at : string;
  db_id : string;
  has_received_mail : bool;
      (** Whether any message was received rather than drafted or sent. Only
threads with received mail can return to the inbox. *)
  inbox_visible : bool;
  is_read : bool;
  latest_inbound_message_ts : string option;
  latest_non_spam_message_ts : string option;
  latest_outbound_message_ts : string option;
  link_id : string;
  messages : api_message list;
  project_id : string option;
  provider_id : string option;
  updated_at : string;
}
(** API representation of a fully assembled email thread. *)

val api_thread_of_yojson : Yojson.Safe.t -> api_thread
val yojson_of_api_thread : api_thread -> Yojson.Safe.t

val make_api_thread :
  access_level:access_level ->
  created_at:string ->
  db_id:string ->
  has_received_mail:bool ->
  inbox_visible:bool ->
  is_read:bool ->
  ?latest_inbound_message_ts:string ->
  ?latest_non_spam_message_ts:string ->
  ?latest_outbound_message_ts:string ->
  link_id:string ->
  messages:api_message list ->
  ?project_id:string ->
  ?provider_id:string ->
  updated_at:string ->
  unit ->
  api_thread
(** API representation of a fully assembled email thread. *)

type nonrec api_thread_preview_cursor_inner = {
  created_at : string;
  id : string;
  inbox_visible : bool;
  is_draft : bool;
  is_important : bool;
  is_read : bool;
  link_id : string;
  name : string option;
  owner_id : string;
  provider_id : string option;
  sender_email : string option;
  sender_name : string option;
  sender_photo_url : string option;
  snippet : string option;
  sort_ts : string;
  updated_at : string;
  viewed_at : string option;
}

val api_thread_preview_cursor_inner_of_yojson :
  Yojson.Safe.t -> api_thread_preview_cursor_inner

val yojson_of_api_thread_preview_cursor_inner :
  api_thread_preview_cursor_inner -> Yojson.Safe.t

val make_api_thread_preview_cursor_inner :
  created_at:string ->
  id:string ->
  inbox_visible:bool ->
  is_draft:bool ->
  is_important:bool ->
  is_read:bool ->
  link_id:string ->
  ?name:string ->
  owner_id:string ->
  ?provider_id:string ->
  ?sender_email:string ->
  ?sender_name:string ->
  ?sender_photo_url:string ->
  ?snippet:string ->
  sort_ts:string ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  api_thread_preview_cursor_inner

type nonrec archive_thread_request = { value : bool }

val archive_thread_request_of_yojson : Yojson.Safe.t -> archive_thread_request
val yojson_of_archive_thread_request : archive_thread_request -> Yojson.Safe.t
val make_archive_thread_request : value:bool -> unit -> archive_thread_request

type nonrec archive_threads_request = { thread_ids : string list; value : bool }

val archive_threads_request_of_yojson : Yojson.Safe.t -> archive_threads_request
val yojson_of_archive_threads_request : archive_threads_request -> Yojson.Safe.t

val make_archive_threads_request :
  thread_ids:string list -> value:bool -> unit -> archive_threads_request

type nonrec archive_threads_response = {
  failed_thread_ids : string list;
      (** Threads left unchanged because they could not be updated. *)
  updated_thread_ids : string list;
      (** Threads whose archived status now matches the request. *)
}

val archive_threads_response_of_yojson :
  Yojson.Safe.t -> archive_threads_response

val yojson_of_archive_threads_response :
  archive_threads_response -> Yojson.Safe.t

val make_archive_threads_response :
  failed_thread_ids:string list ->
  updated_thread_ids:string list ->
  unit ->
  archive_threads_response

type nonrec attachment = {
  content_id : string option;
  data_url : string option;
  db_id : string;
  filename : string option;
  mime_type : string option;
  provider_id : string option;
  reference_url : string option;
      (** Cloud reference: open this provider page instead of downloading bytes. *)
  sfs_id : string option;
  size_bytes : int64 option;
}
(** Attachments of a message, as sent to us by the provider. *)

val attachment_of_yojson : Yojson.Safe.t -> attachment
val yojson_of_attachment : attachment -> Yojson.Safe.t

val make_attachment :
  ?content_id:string ->
  ?data_url:string ->
  db_id:string ->
  ?filename:string ->
  ?mime_type:string ->
  ?provider_id:string ->
  ?reference_url:string ->
  ?sfs_id:string ->
  ?size_bytes:int64 ->
  unit ->
  attachment
(** Attachments of a message, as sent to us by the provider. *)

type nonrec attachment_draft = {
  content_id : string option;
      (** Original Content-ID retained when transferring a provider attachment. *)
  content_type : string;
      (** MIME type of the attachment (e.g., "application/pdf", "image/png"). *)
  draft_id : string;
      (** The ID of the draft message this attachment belongs to. *)
  file_name : string;  (** Original file name of the attachment. *)
  id : string;  (** Unique identifier for the attachment. *)
  is_inline : bool option;
      (** Whether the attachment is referenced inline by the message body. *)
  s3_key : string;  (** S3 object key where the attachment content is stored. *)
  sha : string;
      (** SHA-256 hash of the file content for integrity verification. *)
  size : int;  (** File size in bytes. *)
  upload_pending : bool option;
      (** Bytes have not yet been verified; sending must wait for completion. *)
}

val attachment_draft_of_yojson : Yojson.Safe.t -> attachment_draft
val yojson_of_attachment_draft : attachment_draft -> Yojson.Safe.t

val make_attachment_draft :
  ?content_id:string ->
  content_type:string ->
  draft_id:string ->
  file_name:string ->
  id:string ->
  ?is_inline:bool ->
  s3_key:string ->
  sha:string ->
  size:int ->
  ?upload_pending:bool ->
  unit ->
  attachment_draft

type nonrec attachment_forwarded = {
  attachment_id : string;
      (** The UUID of the original attachment in email_attachments. *)
  draft_id : string;
      (** The ID of the draft message this forwarded attachment belongs to. *)
  filename : string option;  (** Original file name of the attachment. *)
  message_provider_id : string;
      (** The Gmail message ID of the original message containing the attachment. *)
  mime_type : string option;  (** MIME type of the attachment. *)
  provider_attachment_id : string option;
      (** The Gmail attachment ID for fetching data from Gmail API. *)
  size_bytes : int64 option;  (** File size in bytes. *)
}
(** A forwarded attachment linking a draft to an original message's attachment.
Data is fetched from Gmail at send time rather than stored in S3. *)

val attachment_forwarded_of_yojson : Yojson.Safe.t -> attachment_forwarded
val yojson_of_attachment_forwarded : attachment_forwarded -> Yojson.Safe.t

val make_attachment_forwarded :
  attachment_id:string ->
  draft_id:string ->
  ?filename:string ->
  message_provider_id:string ->
  ?mime_type:string ->
  ?provider_attachment_id:string ->
  ?size_bytes:int64 ->
  unit ->
  attachment_forwarded
(** A forwarded attachment linking a draft to an original message's attachment.
Data is fetched from Gmail at send time rather than stored in S3. *)

(** RSVP state for an attendee. *)
type nonrec attendee_response_status =
  | Needs_action
  | Accepted
  | Declined
  | Tentative
  | Unknown of string  (** A value this SDK version does not know. *)

val attendee_response_status_of_yojson :
  Yojson.Safe.t -> attendee_response_status

val yojson_of_attendee_response_status :
  attendee_response_status -> Yojson.Safe.t

type nonrec backfill_job_status =
  | Init
  | In_progress
  | Complete
  | Cancelled
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val backfill_job_status_of_yojson : Yojson.Safe.t -> backfill_job_status
val yojson_of_backfill_job_status : backfill_job_status -> Yojson.Safe.t

type nonrec backfill_job = {
  created_at : string;
  fusionauth_user_id : string;
  id : string;
  link_id : string option;
  status : backfill_job_status;
  threads_requested_limit : int option;
  threads_retrieved_count : int;
  total_threads : int;
  updated_at : string;
}

val backfill_job_of_yojson : Yojson.Safe.t -> backfill_job
val yojson_of_backfill_job : backfill_job -> Yojson.Safe.t

val make_backfill_job :
  created_at:string ->
  fusionauth_user_id:string ->
  id:string ->
  ?link_id:string ->
  status:backfill_job_status ->
  ?threads_requested_limit:int ->
  threads_retrieved_count:int ->
  total_threads:int ->
  updated_at:string ->
  unit ->
  backfill_job

(** Progress/terminal state of a backfill job for \[[RefreshEmailEvent::Backfill]\]. *)
type nonrec backfill_status =
  | Progress
  | Complete
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val backfill_status_of_yojson : Yojson.Safe.t -> backfill_status
val yojson_of_backfill_status : backfill_status -> Yojson.Safe.t

type nonrec block_sender_request = {
  email_address : string;  (** The email address of the sender to block. *)
}
(** Request to block a sender. *)

val block_sender_request_of_yojson : Yojson.Safe.t -> block_sender_request
val yojson_of_block_sender_request : block_sender_request -> Yojson.Safe.t

val make_block_sender_request :
  email_address:string -> unit -> block_sender_request
(** Request to block a sender. *)

type nonrec calendar_attendee = {
  comment : string option;  (** Optional attendee comment. *)
  display_name : string option;  (** Provider display name. *)
  email : string;  (** Normalized email address. *)
  is_optional : bool;  (** Whether attendance is optional. *)
  is_organizer : bool;  (** Whether this attendee is the organizer. *)
  is_self : bool;
      (** Whether this attendee is one of the viewing requester's inboxes. *)
  response_status : attendee_response_status;  (** RSVP state. *)
}
(** An attendee on a calendar event. *)

val calendar_attendee_of_yojson : Yojson.Safe.t -> calendar_attendee
val yojson_of_calendar_attendee : calendar_attendee -> Yojson.Safe.t

val make_calendar_attendee :
  ?comment:string ->
  ?display_name:string ->
  email:string ->
  is_optional:bool ->
  is_organizer:bool ->
  is_self:bool ->
  response_status:attendee_response_status ->
  unit ->
  calendar_attendee
(** An attendee on a calendar event. *)

(** The conferencing system backing an event's join URL.

Calendars can create Google Meet or Microsoft Teams according to their
capabilities. Imported third-party conferences are labeled separately.
Omitting a conference change preserves the current conference; explicit
changes still require provider and calendar capability validation. *)
type nonrec conference_provider =
  | Microsoft_teams
  | Google_meet
  | Other
  | Unknown of string  (** A value this SDK version does not know. *)

val conference_provider_of_yojson : Yojson.Safe.t -> conference_provider
val yojson_of_conference_provider : conference_provider -> Yojson.Safe.t

(** Google's event type: ordinary meetings versus the status-style entries
(working location, out of office, focus time, birthdays) Google renders
and notifies differently. Immutable at the provider after creation. *)
type nonrec event_type =
  | Default
  | Out_of_office
  | Focus_time
  | Working_location
  | Birthday
  | From_gmail
  | Unknown of string  (** A value this SDK version does not know. *)

val event_type_of_yojson : Yojson.Safe.t -> event_type
val yojson_of_event_type : event_type -> Yojson.Safe.t

type nonrec guest_policy = {
  can_invite_others : bool;  (** Whether guests may invite others. *)
  can_modify : bool;
      (** Whether guests may change the event, including its guest list. *)
  can_see_other_guests : bool;  (** Whether guests may see the guest list. *)
}
(** The switches an organizer sets on an event to bound what its guests may
do. Google omits a switch from the payload while it holds its default. *)

val guest_policy_of_yojson : Yojson.Safe.t -> guest_policy
val yojson_of_guest_policy : guest_policy -> Yojson.Safe.t

val make_guest_policy :
  can_invite_others:bool ->
  can_modify:bool ->
  can_see_other_guests:bool ->
  unit ->
  guest_policy
(** The switches an organizer sets on an event to bound what its guests may
do. Google omits a switch from the payload while it holds its default. *)

type nonrec event_reminder_override = {
  method_ : string;
      (** Provider method, stored verbatim; only [popup] fires Macro
notifications. *)
  minutes : int;  (** Minutes before the event start. *)
}
(** One reminder: how it alerts and how many minutes before the event start
(before midnight in the calendar's zone for all-day events) it fires. *)

val event_reminder_override_of_yojson : Yojson.Safe.t -> event_reminder_override
val yojson_of_event_reminder_override : event_reminder_override -> Yojson.Safe.t

val make_event_reminder_override :
  method_:string -> minutes:int -> unit -> event_reminder_override
(** One reminder: how it alerts and how many minutes before the event start
(before midnight in the calendar's zone for all-day events) it fires. *)

type nonrec event_reminders = {
  overrides : event_reminder_override list option;
      (** Explicit reminders replacing the defaults when [use_default] is off. *)
  use_default : bool;  (** Whether the calendar's default reminders apply. *)
}
(** Per-user reminder configuration for an event, mirroring Google's model:
either the calendar's default reminders apply, or the explicit overrides
replace them entirely. *)

val event_reminders_of_yojson : Yojson.Safe.t -> event_reminders
val yojson_of_event_reminders : event_reminders -> Yojson.Safe.t

val make_event_reminders :
  ?overrides:event_reminder_override list ->
  use_default:bool ->
  unit ->
  event_reminders
(** Per-user reminder configuration for an event, mirroring Google's model:
either the calendar's default reminders apply, or the explicit overrides
replace them entirely. *)

(** Whether an event blocks availability. *)
type nonrec event_transparency =
  | Opaque
  | Transparent
  | Unknown of string  (** A value this SDK version does not know. *)

val event_transparency_of_yojson : Yojson.Safe.t -> event_transparency
val yojson_of_event_transparency : event_transparency -> Yojson.Safe.t

(** Visibility of event details. *)
type nonrec event_visibility =
  | Default
  | Public
  | Private
  | Confidential
  | Unknown of string  (** A value this SDK version does not know. *)

val event_visibility_of_yojson : Yojson.Safe.t -> event_visibility
val yojson_of_event_visibility : event_visibility -> Yojson.Safe.t

type nonrec calendar_event_source_content = {
  calendar_id : string;  (** Calendar this copy lives on. *)
  creator_email : string option;  (** Provider-reported creator email. *)
  creator_name : string option;  (** Provider-reported creator display name. *)
  description : string option;  (** Optional event body. *)
  event_type : event_type;  (** Provider event type. *)
  is_read_only : bool;
      (** Whether the calendar's access role prohibits editing this copy. *)
  location : string option;  (** Optional physical or virtual location label. *)
  reminders : event_reminders;  (** Reminder configuration of this copy. *)
  title : string;  (** Display title. *)
  transparency : event_transparency;  (** Availability behavior. *)
  visibility : event_visibility;  (** Event visibility. *)
}
(** The content one provider copy of an event carries.

Google keeps these fields per calendar copy: a shared calendar's copy of a
member's event can have its own title, type, reminders, and access role.
The entity holds its canonical source's values. Every other copy's values
are read from here so a client can show the copy that belongs to the
calendar being viewed. *)

val calendar_event_source_content_of_yojson :
  Yojson.Safe.t -> calendar_event_source_content

val yojson_of_calendar_event_source_content :
  calendar_event_source_content -> Yojson.Safe.t

val make_calendar_event_source_content :
  calendar_id:string ->
  ?creator_email:string ->
  ?creator_name:string ->
  ?description:string ->
  event_type:event_type ->
  is_read_only:bool ->
  ?location:string ->
  reminders:event_reminders ->
  title:string ->
  transparency:event_transparency ->
  visibility:event_visibility ->
  unit ->
  calendar_event_source_content
(** The content one provider copy of an event carries.

Google keeps these fields per calendar copy: a shared calendar's copy of a
member's event can have its own title, type, reminders, and access role.
The entity holds its canonical source's values. Every other copy's values
are read from here so a client can show the copy that belongs to the
calendar being viewed. *)

(** Canonical event status. *)
type nonrec event_status =
  | Confirmed
  | Tentative
  | Cancelled
  | Unknown of string  (** A value this SDK version does not know. *)

val event_status_of_yojson : Yojson.Safe.t -> event_status
val yojson_of_event_status : event_status -> Yojson.Safe.t

(** The mutually exclusive time shape of a calendar event.

Fields are renamed per variant rather than with [rename_all_fields]
because utoipa only honors variant-level serde renames when it
derives the OpenAPI schema. *)
type nonrec event_time =
  | Timed of {
      ends_at : string;
          (** Exclusive end instant; equal to the start for an imported point event. *)
      starts_at : string;  (** Inclusive start instant. *)
      time_zone : string option;
          (** Original IANA time-zone identifier, when supplied. *)
    }  (** An event with absolute instants. *)
  | All_day of {
      end_date : string;  (** Exclusive local end date. *)
      start_date : string;  (** Inclusive local start date. *)
    }  (** An all-day event using RFC 5545's exclusive end date. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val event_time_of_yojson : Yojson.Safe.t -> event_time
val yojson_of_event_time : event_time -> Yojson.Safe.t

val make_event_time_timed :
  ends_at:string -> starts_at:string -> ?time_zone:string -> unit -> event_time
(** An event with absolute instants. *)

val make_event_time_all_day :
  end_date:string -> start_date:string -> unit -> event_time
(** An all-day event using RFC 5545's exclusive end date. *)

type nonrec viewer_capabilities = {
  edit_details : bool;
      (** Change the event's details (title, time, description, conference). *)
  invite_guests : bool;  (** Add guests. *)
  organize : bool;
      (** Act as the event's organizer: replace its whole guest list and manage
its conferencing. *)
  remove_guests : bool;  (** Remove guests. *)
  rsvp : bool;  (** Answer the invitation. *)
  set_guest_policy : bool;
      (** Change the event's guest policy, which only Google calendars have. *)
}
(** What the viewing requester may do with an event. *)

val viewer_capabilities_of_yojson : Yojson.Safe.t -> viewer_capabilities
val yojson_of_viewer_capabilities : viewer_capabilities -> Yojson.Safe.t

val make_viewer_capabilities :
  edit_details:bool ->
  invite_guests:bool ->
  organize:bool ->
  remove_guests:bool ->
  rsvp:bool ->
  set_guest_policy:bool ->
  unit ->
  viewer_capabilities
(** What the viewing requester may do with an event. *)

type nonrec calendar_event = {
  attendees : calendar_attendee list;
      (** Attendees, keyed by email during persistence. *)
  calendar_id : string option;
      (** Calendar the canonical source belongs to, when known. Absent only in
projections stored before calendars were attributed. *)
  conference_provider : conference_provider option;
  conference_url : string option;  (** Direct join URL when known. *)
  created_at : string;  (** Entity creation time. *)
  creator_email : string option;
      (** Provider-reported creator email. Distinct from the organizer when
someone writes onto a calendar they do not own. Omitted from stored
projections when unknown so events ingested before this field still
compare equal. *)
  creator_name : string option;  (** Provider-reported creator display name. *)
  description : string option;  (** Optional event body. *)
  event_type : event_type option;
      (** Provider event type. Skipped when it is the regular type so
projections stored before event types were modeled still compare
equal. *)
  guest_policy : guest_policy;
      (** What the organizer lets guests do: the canonical copy's values, or
Google's defaults for an event synced before the policy was modeled. *)
  ical_uid : string;
      (** RFC 5545 UID used to reconcile provider and email sources. *)
  id : string;  (** Macro entity identifier. *)
  is_read_only : bool;
      (** Whether the canonical source's calendar prohibits editing it. *)
  is_snapshot : bool;
      (** Whether this is a snapshot of a meeting shared with the owner, which
Macro added to their calendar as a private copy: the meeting's changes
never reach it, and nothing done to it reaches the meeting. *)
  location : string option;  (** Optional physical or virtual location label. *)
  organizer_email : string option;  (** Organizer email. *)
  organizer_name : string option;  (** Organizer display name. *)
  owner_id : string;  (** Macro user who owns this event entity. *)
  recurrence_lines : string list;
      (** Raw RFC 5545 recurrence properties ([RRULE], [RDATE], [EXDATE]). *)
  reminders : event_reminders option;
      (** Per-user reminder configuration. Skipped when it is the provider
default so projections stored before reminders were modeled still
compare equal. *)
  sequence : int;  (** Provider/iCalendar sequence number. *)
  sources : calendar_event_source_content list option;
      (** Content of every active copy of this event, canonical first: the
primary calendar's copy, then the freshest. A client picks the copy
whose calendar it is showing and falls back to the first. Populated
only on the read path, so stored projections omit it. *)
  status : event_status;  (** Event status. *)
  time : event_time;  (** Timed or all-day shape. *)
  title : string;  (** Display title. *)
  transparency : event_transparency;  (** Availability behavior. *)
  updated_at : string;  (** Entity update time. *)
  viewer_can : viewer_capabilities;
      (** What the viewing requester may do with the event. Resolved only on
the read path, alongside each attendee's [is_self]; nothing when no
viewer is known. Source projections never store it. *)
  visibility : event_visibility;  (** Event visibility. *)
}
(** A stable, first-class Macro calendar event entity.

Content fields hold the canonical source's values: the account's primary
calendar copy when one is synced, else the freshest remaining copy. *)

val calendar_event_of_yojson : Yojson.Safe.t -> calendar_event
val yojson_of_calendar_event : calendar_event -> Yojson.Safe.t

val make_calendar_event :
  attendees:calendar_attendee list ->
  ?calendar_id:string ->
  ?conference_provider:conference_provider ->
  ?conference_url:string ->
  created_at:string ->
  ?creator_email:string ->
  ?creator_name:string ->
  ?description:string ->
  ?event_type:event_type ->
  guest_policy:guest_policy ->
  ical_uid:string ->
  id:string ->
  is_read_only:bool ->
  is_snapshot:bool ->
  ?location:string ->
  ?organizer_email:string ->
  ?organizer_name:string ->
  owner_id:string ->
  recurrence_lines:string list ->
  ?reminders:event_reminders ->
  sequence:int ->
  ?sources:calendar_event_source_content list ->
  status:event_status ->
  time:event_time ->
  title:string ->
  transparency:event_transparency ->
  updated_at:string ->
  viewer_can:viewer_capabilities ->
  visibility:event_visibility ->
  unit ->
  calendar_event
(** A stable, first-class Macro calendar event entity.

Content fields hold the canonical source's values: the account's primary
calendar copy when one is synced, else the freshest remaining copy. *)

(** Machine-readable failure category for calendar mutations. *)
type nonrec calendar_mutation_error_code =
  | Not_found
  | Occurrence_not_found
  | Read_only
  | No_writable_calendar
  | Not_attendee
  | Not_organizer
  | Guests_cannot_invite
  | Guest_list_hidden
  | Guests_cannot_modify
  | Already_on_calendar
  | Join_request_open
  | Copy_refused
  | Snapshot
  | Invalid_input
  | Reauth_required
  | Provider_rejected
  | Retryable
  | Persist_failed
  | Macro_call_failed
  | Copy_choice_required
  | Confirmation_required
  | Unknown of string  (** A value this SDK version does not know. *)

val calendar_mutation_error_code_of_yojson :
  Yojson.Safe.t -> calendar_mutation_error_code

val yojson_of_calendar_mutation_error_code :
  calendar_mutation_error_code -> Yojson.Safe.t

type nonrec calendar_mutation_api_error = {
  code : calendar_mutation_error_code;
      (** Machine-readable failure category. *)
  message : string;  (** Human-readable failure description. *)
}
(** HTTP error body returned by calendar mutation endpoints. *)

val calendar_mutation_api_error_of_yojson :
  Yojson.Safe.t -> calendar_mutation_api_error

val yojson_of_calendar_mutation_api_error :
  calendar_mutation_api_error -> Yojson.Safe.t

val make_calendar_mutation_api_error :
  code:calendar_mutation_error_code ->
  message:string ->
  unit ->
  calendar_mutation_api_error
(** HTTP error body returned by calendar mutation endpoints. *)

type nonrec calendar_occurrence = {
  event_id : string;  (** Owning event entity. *)
  is_cancelled : bool;  (** Whether the instance was cancelled. *)
  occurrence_key : string;  (** Stable key within the event. *)
  recurrence_id : string option;
      (** Provider recurrence identifier, when applicable. *)
  time : event_time;  (** Instance time. *)
}
(** A materialized recurrence instance optimized for range queries. *)

val calendar_occurrence_of_yojson : Yojson.Safe.t -> calendar_occurrence
val yojson_of_calendar_occurrence : calendar_occurrence -> Yojson.Safe.t

val make_calendar_occurrence :
  event_id:string ->
  is_cancelled:bool ->
  occurrence_key:string ->
  ?recurrence_id:string ->
  time:event_time ->
  unit ->
  calendar_occurrence
(** A materialized recurrence instance optimized for range queries. *)

type nonrec cancel_backfill_params = { job_id : string }

val cancel_backfill_params_of_yojson : Yojson.Safe.t -> cancel_backfill_params
val yojson_of_cancel_backfill_params : cancel_backfill_params -> Yojson.Safe.t

val make_cancel_backfill_params :
  job_id:string -> unit -> cancel_backfill_params

type nonrec contact = {
  email_address : string option;
  id : string;
  link_id : string;
  name : string option;
  original_photo_url : string option;
  sfs_photo_url : string option;
}

val contact_of_yojson : Yojson.Safe.t -> contact
val yojson_of_contact : contact -> Yojson.Safe.t

val make_contact :
  ?email_address:string ->
  id:string ->
  link_id:string ->
  ?name:string ->
  ?original_photo_url:string ->
  ?sfs_photo_url:string ->
  unit ->
  contact

type nonrec contact_info = {
  email : string;
  name : string option;
  photo_url : string option;
}

val contact_info_of_yojson : Yojson.Safe.t -> contact_info
val yojson_of_contact_info : contact_info -> Yojson.Safe.t

val make_contact_info :
  email:string -> ?name:string -> ?photo_url:string -> unit -> contact_info

type nonrec contact_info_legacy = {
  email : string;
  email_address : string;
  name : string option;
  photo_url : string option;
}

val contact_info_legacy_of_yojson : Yojson.Safe.t -> contact_info_legacy
val yojson_of_contact_info_legacy : contact_info_legacy -> Yojson.Safe.t

val make_contact_info_legacy :
  email:string ->
  email_address:string ->
  ?name:string ->
  ?photo_url:string ->
  unit ->
  contact_info_legacy

type nonrec contact_info_with_interaction = {
  email : string;
  email_address : string;
  name : string option;
  photo_url : string option;
  last_interaction : string;
}

val contact_info_with_interaction_of_yojson :
  Yojson.Safe.t -> contact_info_with_interaction

val yojson_of_contact_info_with_interaction :
  contact_info_with_interaction -> Yojson.Safe.t

val make_contact_info_with_interaction :
  email:string ->
  email_address:string ->
  ?name:string ->
  ?photo_url:string ->
  last_interaction:string ->
  unit ->
  contact_info_with_interaction

type nonrec copy_calendar_event_request = {
  calendar_id : string option;
      (** Google calendar to add the copy to; defaults to the requester's
primary inbox's primary calendar. *)
}
(** Request body adding a shared event to the requester's calendar. *)

val copy_calendar_event_request_of_yojson :
  Yojson.Safe.t -> copy_calendar_event_request

val yojson_of_copy_calendar_event_request :
  copy_calendar_event_request -> Yojson.Safe.t

val make_copy_calendar_event_request :
  ?calendar_id:string -> unit -> copy_calendar_event_request
(** Request body adding a shared event to the requester's calendar. *)

type nonrec create_draft_request = {
  draft : api_draft_input;  (** The draft content. *)
  send_time : string option;  (** Scheduled send time. *)
}
(** Request body for creating a draft. *)

val create_draft_request_of_yojson : Yojson.Safe.t -> create_draft_request
val yojson_of_create_draft_request : create_draft_request -> Yojson.Safe.t

val make_create_draft_request :
  draft:api_draft_input -> ?send_time:string -> unit -> create_draft_request
(** Request body for creating a draft. *)

type nonrec create_draft_response = {
  draft : api_draft_output;  (** The created draft. *)
}
(** Response body for creating a draft. *)

val create_draft_response_of_yojson : Yojson.Safe.t -> create_draft_response
val yojson_of_create_draft_response : create_draft_response -> Yojson.Safe.t

val make_create_draft_response :
  draft:api_draft_output -> unit -> create_draft_response
(** Response body for creating a draft. *)

type nonrec create_label_request = { label_name : string }

val create_label_request_of_yojson : Yojson.Safe.t -> create_label_request
val yojson_of_create_label_request : create_label_request -> Yojson.Safe.t

val make_create_label_request :
  label_name:string -> unit -> create_label_request

type nonrec label_list_visibility =
  | Label_show
  | Label_show_if_unread
  | Label_hide
  | Unknown of string  (** A value this SDK version does not know. *)

val label_list_visibility_of_yojson : Yojson.Safe.t -> label_list_visibility
val yojson_of_label_list_visibility : label_list_visibility -> Yojson.Safe.t

type nonrec message_list_visibility =
  | Show
  | Hide
  | Unknown of string  (** A value this SDK version does not know. *)

val message_list_visibility_of_yojson : Yojson.Safe.t -> message_list_visibility
val yojson_of_message_list_visibility : message_list_visibility -> Yojson.Safe.t

type nonrec label_type =
  | System
  | User
  | Unknown of string  (** A value this SDK version does not know. *)

val label_type_of_yojson : Yojson.Safe.t -> label_type
val yojson_of_label_type : label_type -> Yojson.Safe.t

type nonrec label = {
  created_at : string;
  id : string option;
  label_list_visibility : label_list_visibility option;
  link_id : string;
  message_list_visibility : message_list_visibility option;
  name : string option;
  provider_label_id : string;
  type_ : label_type option;
}

val label_of_yojson : Yojson.Safe.t -> label
val yojson_of_label : label -> Yojson.Safe.t

val make_label :
  created_at:string ->
  ?id:string ->
  ?label_list_visibility:label_list_visibility ->
  link_id:string ->
  ?message_list_visibility:message_list_visibility ->
  ?name:string ->
  provider_label_id:string ->
  ?type_:label_type ->
  unit ->
  label

type nonrec create_label_response = {
  label : label;
      (** Local label. Pending provider creation is reported by settings operations. *)
}
(** The response returned from the create label endpoint *)

val create_label_response_of_yojson : Yojson.Safe.t -> create_label_response
val yojson_of_create_label_response : create_label_response -> Yojson.Safe.t

val make_create_label_response : label:label -> unit -> create_label_response
(** The response returned from the create label endpoint *)

type nonrec eml_file = string

val eml_file_of_yojson : Yojson.Safe.t -> eml_file
val yojson_of_eml_file : eml_file -> Yojson.Safe.t

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

val empty_response_of_yojson : Yojson.Safe.t -> empty_response
val yojson_of_empty_response : empty_response -> Yojson.Safe.t

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

(** Why a forward was not sent. *)
type nonrec forward_calendar_event_error_code =
  | Not_found
  | Invalid_recipients
  | Inbox_unavailable
  | Send_failed
  | Unknown of string  (** A value this SDK version does not know. *)

val forward_calendar_event_error_code_of_yojson :
  Yojson.Safe.t -> forward_calendar_event_error_code

val yojson_of_forward_calendar_event_error_code :
  forward_calendar_event_error_code -> Yojson.Safe.t

type nonrec forward_calendar_event_error = {
  code : forward_calendar_event_error_code;  (** What went wrong. *)
  message : string;  (** A message fit to show the user. *)
}
(** A refused or failed forward. *)

val forward_calendar_event_error_of_yojson :
  Yojson.Safe.t -> forward_calendar_event_error

val yojson_of_forward_calendar_event_error :
  forward_calendar_event_error -> Yojson.Safe.t

val make_forward_calendar_event_error :
  code:forward_calendar_event_error_code ->
  message:string ->
  unit ->
  forward_calendar_event_error
(** A refused or failed forward. *)

type nonrec forward_calendar_event_recipient = {
  email : string;  (** Their email address. *)
  name : string option;  (** Their display name. *)
}
(** One person a forwarded invitation goes to. *)

val forward_calendar_event_recipient_of_yojson :
  Yojson.Safe.t -> forward_calendar_event_recipient

val yojson_of_forward_calendar_event_recipient :
  forward_calendar_event_recipient -> Yojson.Safe.t

val make_forward_calendar_event_recipient :
  email:string -> ?name:string -> unit -> forward_calendar_event_recipient
(** One person a forwarded invitation goes to. *)

type nonrec forward_calendar_event_request = {
  body_text : string option;
      (** A plain-text summary of the event the email opens with; the title
when absent. The email ends with a note saying what the recipient
can do with the forward. *)
  to_ : forward_calendar_event_recipient list;
      (** The people it goes to, at most 50. *)
}
(** Who a forwarded invitation goes to, and what its email says. *)

val forward_calendar_event_request_of_yojson :
  Yojson.Safe.t -> forward_calendar_event_request

val yojson_of_forward_calendar_event_request :
  forward_calendar_event_request -> Yojson.Safe.t

val make_forward_calendar_event_request :
  ?body_text:string ->
  to_:forward_calendar_event_recipient list ->
  unit ->
  forward_calendar_event_request
(** Who a forwarded invitation goes to, and what its email says. *)

type nonrec forward_calendar_event_response = {
  message_id : string;  (** The sent message. *)
  thread_id : string;  (** Its thread. *)
}
(** The email the forward queued. *)

val forward_calendar_event_response_of_yojson :
  Yojson.Safe.t -> forward_calendar_event_response

val yojson_of_forward_calendar_event_response :
  forward_calendar_event_response -> Yojson.Safe.t

val make_forward_calendar_event_response :
  message_id:string ->
  thread_id:string ->
  unit ->
  forward_calendar_event_response
(** The email the forward queued. *)

type nonrec get_active_backfill_job_response = { job : backfill_job }
(** The response returned from the get backfill job endpoint *)

val get_active_backfill_job_response_of_yojson :
  Yojson.Safe.t -> get_active_backfill_job_response

val yojson_of_get_active_backfill_job_response :
  get_active_backfill_job_response -> Yojson.Safe.t

val make_get_active_backfill_job_response :
  job:backfill_job -> unit -> get_active_backfill_job_response
(** The response returned from the get backfill job endpoint *)

type nonrec get_attachment_document_id_response = {
  attachment_id : string;
  document_id : string;
}
(** The response returned from the get attachment endpoint *)

val get_attachment_document_id_response_of_yojson :
  Yojson.Safe.t -> get_attachment_document_id_response

val yojson_of_get_attachment_document_id_response :
  get_attachment_document_id_response -> Yojson.Safe.t

val make_get_attachment_document_id_response :
  attachment_id:string ->
  document_id:string ->
  unit ->
  get_attachment_document_id_response
(** The response returned from the get attachment endpoint *)

type nonrec get_attachment_response = { attachment : attachment }
(** The response returned from the get attachment endpoint *)

val get_attachment_response_of_yojson : Yojson.Safe.t -> get_attachment_response
val yojson_of_get_attachment_response : get_attachment_response -> Yojson.Safe.t

val make_get_attachment_response :
  attachment:attachment -> unit -> get_attachment_response
(** The response returned from the get attachment endpoint *)

type nonrec get_backfill_job_response = { job : backfill_job }
(** The response returned from the get backfill job endpoint *)

val get_backfill_job_response_of_yojson :
  Yojson.Safe.t -> get_backfill_job_response

val yojson_of_get_backfill_job_response :
  get_backfill_job_response -> Yojson.Safe.t

val make_get_backfill_job_response :
  job:backfill_job -> unit -> get_backfill_job_response
(** The response returned from the get backfill job endpoint *)

type nonrec get_previews_cursor_params = {
  limit : int option;  (** Limit for pagination. Default is 20. Max is 500. *)
  sort_method : api_sort_method option;
}
(** Parameters for getting thread previews with cursor-based pagination. *)

val get_previews_cursor_params_of_yojson :
  Yojson.Safe.t -> get_previews_cursor_params

val yojson_of_get_previews_cursor_params :
  get_previews_cursor_params -> Yojson.Safe.t

val make_get_previews_cursor_params :
  ?limit:int ->
  ?sort_method:api_sort_method ->
  unit ->
  get_previews_cursor_params
(** Parameters for getting thread previews with cursor-based pagination. *)

type nonrec message = {
  attachments : attachment list;
  attachments_draft : attachment_draft list;
      (** Uploaded file attachments for the message, if it is a draft *)
  attachments_forwarded : attachment_forwarded list;
      (** Forwarded attachments from original messages, if it is a draft *)
  bcc : contact_info list;
  body_html_sanitized : string option;
  body_macro : string option;
  body_text : string option;
  cc : contact_info list;
  created_at : string;
  db_id : string;
  from : contact_info option;
  global_id : string option;
      (** The globally unique Message-ID header value created by the sender to uniquely identify this email
Used for threading across all providers (In-Reply-To header, References header) *)
  has_attachments : bool;
  headers_json : value option;
  internal_date_ts : string option;
  is_draft : bool;
  is_read : bool;
  is_sent : bool;
  is_starred : bool;
  labels : label list;
  link_id : string;
  provider_history_id : string option;
  provider_id : string option;
  provider_thread_id : string option;
  replying_to_id : string option;
  scheduled_send_time : string option;
  sent_at : string option;
  size_estimate : int64 option;
  snippet : string option;
  subject : string option;
  thread_db_id : string;
  to_ : contact_info list;
  updated_at : string;
}

val message_of_yojson : Yojson.Safe.t -> message
val yojson_of_message : message -> Yojson.Safe.t

val make_message :
  attachments:attachment list ->
  attachments_draft:attachment_draft list ->
  attachments_forwarded:attachment_forwarded list ->
  bcc:contact_info list ->
  ?body_html_sanitized:string ->
  ?body_macro:string ->
  ?body_text:string ->
  cc:contact_info list ->
  created_at:string ->
  db_id:string ->
  ?from:contact_info ->
  ?global_id:string ->
  has_attachments:bool ->
  ?headers_json:value ->
  ?internal_date_ts:string ->
  is_draft:bool ->
  is_read:bool ->
  is_sent:bool ->
  is_starred:bool ->
  labels:label list ->
  link_id:string ->
  ?provider_history_id:string ->
  ?provider_id:string ->
  ?provider_thread_id:string ->
  ?replying_to_id:string ->
  ?scheduled_send_time:string ->
  ?sent_at:string ->
  ?size_estimate:int64 ->
  ?snippet:string ->
  ?subject:string ->
  thread_db_id:string ->
  to_:contact_info list ->
  updated_at:string ->
  unit ->
  message

type nonrec get_scheduled_response = { messages : message list }

val get_scheduled_response_of_yojson : Yojson.Safe.t -> get_scheduled_response
val yojson_of_get_scheduled_response : get_scheduled_response -> Yojson.Safe.t

val make_get_scheduled_response :
  messages:message list -> unit -> get_scheduled_response

type nonrec get_thread_response = { thread : api_thread }
(** Response body for the get-thread endpoint. *)

val get_thread_response_of_yojson : Yojson.Safe.t -> get_thread_response
val yojson_of_get_thread_response : get_thread_response -> Yojson.Safe.t

val make_get_thread_response : thread:api_thread -> unit -> get_thread_response
(** Response body for the get-thread endpoint. *)

type nonrec init_error_code_response = {
  code : string;  (** Stable machine-readable error code. *)
  message : string;  (** Human-readable explanation. *)
}
(** Structured 400 body carrying a machine-readable code. Clients branch on
[code] instead of parsing the human message. *)

val init_error_code_response_of_yojson :
  Yojson.Safe.t -> init_error_code_response

val yojson_of_init_error_code_response :
  init_error_code_response -> Yojson.Safe.t

val make_init_error_code_response :
  code:string -> message:string -> unit -> init_error_code_response
(** Structured 400 body carrying a machine-readable code. Clients branch on
[code] instead of parsing the human message. *)

type nonrec init_response = {
  backfill_job_id : string option;
      (** Present when init enqueued a backfill job. Absent for cross-user delegation,
where the child link's backfill already ran under its own macro_id; present for
the self-link bootstrap, where a fresh link is provisioned and backfilled. *)
  link_id : string;
      (** The email_links row id for the now-accessible inbox. For cross-user delegation
this is the *existing* child link the caller now delegates over; for the
self-link bootstrap and the data-source path it's a freshly upserted row. *)
}

val init_response_of_yojson : Yojson.Safe.t -> init_response
val yojson_of_init_response : init_response -> Yojson.Safe.t

val make_init_response :
  ?backfill_job_id:string -> link_id:string -> unit -> init_response

(** Refreshable result, distinct from the immutable email contents. *)
type nonrec invitation_resolution =
  | Disconnected
      (** Viewer has no active owned or delegated Google-backed calendar. *)
  | Still_syncing  (** An active calendar is still ingesting this event. *)
  | Cancelled
      (** A saved scheduling cancellation precedes removal from the synced projection. *)
  | Unavailable
      (** Original occurrence identity cannot safely be interpreted. *)
  | No_match  (** No independently authorized matching copy has synced. *)
  | Ambiguous
      (** More than one authorized account could respond; never guess. *)
  | Resolved of {
      can_join : bool;
          (** Whether the conference link belongs to the reconciled scheduling target. *)
      can_respond : bool;  (** Whether a response is currently allowed. *)
      event : calendar_event;  (** Current occurrence-specific content. *)
      is_stale : bool;
          (** Whether the provider projection trails the email revision. *)
      occurrence : calendar_occurrence;
          (** Original occurrence identity and current time. *)
      responding_email : string;  (** Connected address that would respond. *)
    }  (** Current authorized event and explicit capabilities. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val invitation_resolution_of_yojson : Yojson.Safe.t -> invitation_resolution
val yojson_of_invitation_resolution : invitation_resolution -> Yojson.Safe.t

val make_invitation_resolution_resolved :
  can_join:bool ->
  can_respond:bool ->
  event:calendar_event ->
  is_stale:bool ->
  occurrence:calendar_occurrence ->
  responding_email:string ->
  unit ->
  invitation_resolution
(** Current authorized event and explicit capabilities. *)

type nonrec label_info = { name : string; provider_id : string }

val label_info_of_yojson : Yojson.Safe.t -> label_info
val yojson_of_label_info : label_info -> Yojson.Safe.t
val make_label_info : name:string -> provider_id:string -> unit -> label_info

type nonrec user_provider =
  | Gmail
  | Outlook
  | Unknown of string  (** A value this SDK version does not know. *)

val user_provider_of_yojson : Yojson.Safe.t -> user_provider
val yojson_of_user_provider : user_provider -> Yojson.Safe.t

type nonrec settings = {
  read_receipts_enabled : bool option;
      (** Whether messages sent from this inbox carry an open-tracking pixel. *)
  signature : string option;
      (** The user's email signature content (HTML). On a patch, omit or send
[null] to leave unchanged (both deserialize to [None]); pass an empty
string to clear it. The column cannot be set to SQL NULL via patch. *)
  signature_on_replies_forwards : bool option;
}

val settings_of_yojson : Yojson.Safe.t -> settings
val yojson_of_settings : settings -> Yojson.Safe.t

val make_settings :
  ?read_receipts_enabled:bool ->
  ?signature:string ->
  ?signature_on_replies_forwards:bool ->
  unit ->
  settings

(** Coarse sync state for an inbox, used to render a one-line hint in the
multi-inbox settings list. Derived from the link's [is_sync_active] flag, its
reauth health, and its most recent backfill job. *)
type nonrec sync_status =
  | Syncing
  | Up_to_date
  | Error_
  | Needs_reauth
  | Inactive
  | Unknown of string  (** A value this SDK version does not know. *)

val sync_status_of_yojson : Yojson.Safe.t -> sync_status
val yojson_of_sync_status : sync_status -> Yojson.Safe.t

type nonrec link = {
  calendar_disabled : bool;
      (** Whether the user turned calendar off for this inbox, which also removed
its calendar data. [needs_calendar_permission] is true either way, so
this is what separates "never granted" from "deliberately off" —
unprompted calendar nags must stay quiet for the latter. *)
  created_at : string;
  email_address : string;
  fusionauth_user_id : string;
  has_calendar_data : bool;
      (** Whether Macro holds calendar data for this inbox. Drives the turn-off
control on its own, so removing that data never depends on the recorded
scopes still matching the set Macro requests today — a set that changes
as the integration narrows, stranding data behind a capability check
that no longer recognizes an older grant. *)
  id : string;
  is_primary : bool;
  is_sync_active : bool;
  macro_id : string;
  needs_calendar_permission : bool;
      (** Whether the link's Google grant is missing the calendar scope. True for
inboxes connected before the calendar capability existed (and for
grants where the user declined it); drives the per-inbox calendar
upgrade prompt. Re-running the connect flow records the new grant. *)
  needs_reauth : bool;
      (** Whether the link's Google grant needs to be reconnected. Drives the
per-inbox reconnect prompt independently of the sync-status badge. *)
  photo_url : string option;
      (** The inbox's own profile photo (its self-contact's SFS photo), if synced. *)
  provider : user_provider;
  settings : settings;
  sync_status : sync_status;
  updated_at : string;
}

val link_of_yojson : Yojson.Safe.t -> link
val yojson_of_link : link -> Yojson.Safe.t

val make_link :
  calendar_disabled:bool ->
  created_at:string ->
  email_address:string ->
  fusionauth_user_id:string ->
  has_calendar_data:bool ->
  id:string ->
  is_primary:bool ->
  is_sync_active:bool ->
  macro_id:string ->
  needs_calendar_permission:bool ->
  needs_reauth:bool ->
  ?photo_url:string ->
  provider:user_provider ->
  settings:settings ->
  sync_status:sync_status ->
  updated_at:string ->
  unit ->
  link

type nonrec list_backfill_jobs_response = { jobs : backfill_job list }
(** The response returned from the list backfill jobs endpoint *)

val list_backfill_jobs_response_of_yojson :
  Yojson.Safe.t -> list_backfill_jobs_response

val yojson_of_list_backfill_jobs_response :
  list_backfill_jobs_response -> Yojson.Safe.t

val make_list_backfill_jobs_response :
  jobs:backfill_job list -> unit -> list_backfill_jobs_response
(** The response returned from the list backfill jobs endpoint *)

type nonrec list_blocked_response = {
  blocked_emails : string list;
      (** List of email addresses that are currently blocked. *)
}
(** Response containing list of blocked email addresses. *)

val list_blocked_response_of_yojson : Yojson.Safe.t -> list_blocked_response
val yojson_of_list_blocked_response : list_blocked_response -> Yojson.Safe.t

val make_list_blocked_response :
  blocked_emails:string list -> unit -> list_blocked_response
(** Response containing list of blocked email addresses. *)

type nonrec list_contacts_response = {
  contacts : (string * contact_info_with_interaction list) list;
      (** the thread, with messages inside *)
}

val list_contacts_response_of_yojson : Yojson.Safe.t -> list_contacts_response
val yojson_of_list_contacts_response : list_contacts_response -> Yojson.Safe.t

val make_list_contacts_response :
  contacts:(string * contact_info_with_interaction list) list ->
  unit ->
  list_contacts_response

type nonrec list_email_filters_response = { filters : api_email_filter list }
(** Response body for listing email filters. *)

val list_email_filters_response_of_yojson :
  Yojson.Safe.t -> list_email_filters_response

val yojson_of_list_email_filters_response :
  list_email_filters_response -> Yojson.Safe.t

val make_list_email_filters_response :
  filters:api_email_filter list -> unit -> list_email_filters_response
(** Response body for listing email filters. *)

type nonrec list_labels_response = { labels : api_label list }
(** Response body for listing labels. *)

val list_labels_response_of_yojson : Yojson.Safe.t -> list_labels_response
val yojson_of_list_labels_response : list_labels_response -> Yojson.Safe.t

val make_list_labels_response :
  labels:api_label list -> unit -> list_labels_response
(** Response body for listing labels. *)

type nonrec list_links_response = {
  links : link list;  (** the thread, with messages inside *)
}
(** The response returned from the list links endpoint *)

val list_links_response_of_yojson : Yojson.Safe.t -> list_links_response
val yojson_of_list_links_response : list_links_response -> Yojson.Safe.t

val make_list_links_response : links:link list -> unit -> list_links_response
(** The response returned from the list links endpoint *)

type nonrec mailbox_action_category_value = { name : string; present : bool }
(** Add/remove a category while preserving other provider assignments. *)

val mailbox_action_category_value_of_yojson :
  Yojson.Safe.t -> mailbox_action_category_value

val yojson_of_mailbox_action_category_value :
  mailbox_action_category_value -> Yojson.Safe.t

val make_mailbox_action_category_value :
  name:string -> present:bool -> unit -> mailbox_action_category_value
(** Add/remove a category while preserving other provider assignments. *)

(** Desired organization state. Categories never stand in for folders or flags. *)
type nonrec mailbox_action =
  | Read of { value : bool  (** Mark correspondence read or unread. *) }
      (** Mark correspondence read or unread. *)
  | Flagged of { value : bool  (** Set the follow-up star. *) }
      (** Set the follow-up star. *)
  | Archived of {
      value : bool;
          (** Archive inbox messages, or restore received correspondence to the inbox. *)
    }
      (** Archive inbox messages, or restore received correspondence to the inbox. *)
  | Trashed of {
      value : bool;
          (** Move to recoverable trash, or restore correspondence to Inbox (drafts to Drafts). *)
    }
      (** Move to recoverable trash, or restore correspondence to Inbox (drafts to Drafts). *)
  | Junk of { value : bool  (** Move to junk, or restore to the inbox. *) }
      (** Move to junk, or restore to the inbox. *)
  | Category of {
      value : mailbox_action_category_value;
          (** Add/remove a category while preserving other provider assignments. *)
    }  (** Add/remove a category while preserving other provider assignments. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val mailbox_action_of_yojson : Yojson.Safe.t -> mailbox_action
val yojson_of_mailbox_action : mailbox_action -> Yojson.Safe.t

val make_mailbox_action_read : value:bool -> unit -> mailbox_action
(** Mark correspondence read or unread. *)

val make_mailbox_action_flagged : value:bool -> unit -> mailbox_action
(** Set the follow-up star. *)

val make_mailbox_action_archived : value:bool -> unit -> mailbox_action
(** Archive inbox messages, or restore received correspondence to the inbox. *)

val make_mailbox_action_trashed : value:bool -> unit -> mailbox_action
(** Move to recoverable trash, or restore correspondence to Inbox (drafts to Drafts). *)

val make_mailbox_action_junk : value:bool -> unit -> mailbox_action
(** Move to junk, or restore to the inbox. *)

val make_mailbox_action_category :
  value:mailbox_action_category_value -> unit -> mailbox_action
(** Add/remove a category while preserving other provider assignments. *)

type nonrec mailbox_operation_state =
  | Pending
  | Applied
  | Failed
  | Cancelled
  | Unknown of string  (** A value this SDK version does not know. *)

val mailbox_operation_state_of_yojson : Yojson.Safe.t -> mailbox_operation_state
val yojson_of_mailbox_operation_state : mailbox_operation_state -> Yojson.Safe.t

type nonrec mailbox_operation = {
  action : mailbox_action;
  id : string;
  state : mailbox_operation_state;
  updated_at : string;
}
(** Durable outcome of an accepted organization action. *)

val mailbox_operation_of_yojson : Yojson.Safe.t -> mailbox_operation
val yojson_of_mailbox_operation : mailbox_operation -> Yojson.Safe.t

val make_mailbox_operation :
  action:mailbox_action ->
  id:string ->
  state:mailbox_operation_state ->
  updated_at:string ->
  unit ->
  mailbox_operation
(** Durable outcome of an accepted organization action. *)

type nonrec mailbox_settings_change =
  | Create_label
  | Delete_label
  | Sender_block
  | Unknown of string  (** A value this SDK version does not know. *)

val mailbox_settings_change_of_yojson : Yojson.Safe.t -> mailbox_settings_change
val yojson_of_mailbox_settings_change : mailbox_settings_change -> Yojson.Safe.t

type nonrec mailbox_settings_operation = {
  enabled : bool;
  id : string;
  kind : mailbox_settings_change;
  needs_attention : bool;
  resource : string;
}
(** An accepted inbox configuration change awaiting provider confirmation. *)

val mailbox_settings_operation_of_yojson :
  Yojson.Safe.t -> mailbox_settings_operation

val yojson_of_mailbox_settings_operation :
  mailbox_settings_operation -> Yojson.Safe.t

val make_mailbox_settings_operation :
  enabled:bool ->
  id:string ->
  kind:mailbox_settings_change ->
  needs_attention:bool ->
  resource:string ->
  unit ->
  mailbox_settings_operation
(** An accepted inbox configuration change awaiting provider confirmation. *)

type nonrec message_operation_response = {
  operation : api_message_operation option;
}
(** Authorized polling response. Gmail has no asynchronous draft operation. *)

val message_operation_response_of_yojson :
  Yojson.Safe.t -> message_operation_response

val yojson_of_message_operation_response :
  message_operation_response -> Yojson.Safe.t

val make_message_operation_response :
  ?operation:api_message_operation -> unit -> message_operation_response
(** Authorized polling response. Gmail has no asynchronous draft operation. *)

type nonrec message_read_receipt = {
  first_opened_at : string option;  (** First counted fetch. *)
  last_opened_at : string option;  (** Latest counted fetch. *)
  message_id : string;  (** The tracked message. *)
  open_count : int;  (** Counted pixel fetches. *)
}
(** Open state of one tracked, sent message. *)

val message_read_receipt_of_yojson : Yojson.Safe.t -> message_read_receipt
val yojson_of_message_read_receipt : message_read_receipt -> Yojson.Safe.t

val make_message_read_receipt :
  ?first_opened_at:string ->
  ?last_opened_at:string ->
  message_id:string ->
  open_count:int ->
  unit ->
  message_read_receipt
(** Open state of one tracked, sent message. *)

type nonrec parsed_message = {
  bcc : contact_info list;
  body_parsed : string option;
  cc : contact_info list;
  db_id : string;
  draft_generation : int option;
      (** Draft edit generation captured with this message snapshot. *)
  from : contact_info option;
  internal_date_ts : string option;
  labels : label_info list;
  link_id : string;
  subject : string option;
  thread_db_id : string;
  to_ : contact_info list;
}

val parsed_message_of_yojson : Yojson.Safe.t -> parsed_message
val yojson_of_parsed_message : parsed_message -> Yojson.Safe.t

val make_parsed_message :
  bcc:contact_info list ->
  ?body_parsed:string ->
  cc:contact_info list ->
  db_id:string ->
  ?draft_generation:int ->
  ?from:contact_info ->
  ?internal_date_ts:string ->
  labels:label_info list ->
  link_id:string ->
  ?subject:string ->
  thread_db_id:string ->
  to_:contact_info list ->
  unit ->
  parsed_message

type nonrec patch_settings_request = { settings : settings }

val patch_settings_request_of_yojson : Yojson.Safe.t -> patch_settings_request
val yojson_of_patch_settings_request : patch_settings_request -> Yojson.Safe.t

val make_patch_settings_request :
  settings:settings -> unit -> patch_settings_request

type nonrec patch_settings_response = { settings : settings }

val patch_settings_response_of_yojson : Yojson.Safe.t -> patch_settings_response
val yojson_of_patch_settings_response : patch_settings_response -> Yojson.Safe.t

val make_patch_settings_response :
  settings:settings -> unit -> patch_settings_response

type nonrec preview_view_1 =
  | Inbox
  | Sent
  | Drafts
  | Starred
  | All
  | Spam
  | Trash
  | Important
  | Other
  | Unknown of string  (** A value this SDK version does not know. *)

val preview_view_1_of_yojson : Yojson.Safe.t -> preview_view_1
val yojson_of_preview_view_1 : preview_view_1 -> Yojson.Safe.t

(** View type. Supported values include standard labels and a custom user label user:<label> *)
type nonrec preview_view =
  | Preview_view_1 of preview_view_1
  | String of string
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val preview_view_of_yojson : Yojson.Safe.t -> preview_view
val yojson_of_preview_view : preview_view -> Yojson.Safe.t

type nonrec preview_view_standard_label =
  | Inbox
  | Sent
  | Drafts
  | Starred
  | All
  | Spam
  | Trash
  | Important
  | Other
  | Unknown of string  (** A value this SDK version does not know. *)

val preview_view_standard_label_of_yojson :
  Yojson.Safe.t -> preview_view_standard_label

val yojson_of_preview_view_standard_label :
  preview_view_standard_label -> Yojson.Safe.t

(** Payload for the [refresh_email] connection gateway event: identifies the
inbox that changed and the kind of change. *)
type nonrec refresh_email_event =
  | Backfill of { link_id : string; status : backfill_status }
      (** Backfill progress for [link_id]; see \[[BackfillStatus]\]. *)
  | Upsert_message of { link_id : string }
      (** A message was inserted or updated for [link_id]. *)
  | Update_labels of { link_id : string }  (** Labels changed for [link_id]. *)
  | Delete_message of { link_id : string }
      (** A message was deleted for [link_id]. *)
  | Link_removed of { link_id : string }
      (** The inbox [link_id] was removed and its data torn down. *)
  | Photo_synced of { link_id : string }
      (** The self-contact photo for [link_id] finished uploading to static
file storage, so the inbox's derived [photo_url] is now available. *)
  | Backfill_progress of {
      completed_threads : int;
      link_id : string;
      status : backfill_status;
      total_threads : int;
    }
      (** Live backfill progress for [link_id], for driving a progress indicator on
the frontend: [completed_threads] out of [total_threads], plus [status].
Counts reflect the Redis progress counters; the priority pass may bump
both above the raw mailbox size, but in lockstep, so the ratio holds.
Appended last so existing variants keep their generated TS names. *)
  | Focus_updated of { link_id : string; traceparent : string option }
      (** A Focus classification was stored for a thread in [link_id], so its
readers read their Focus list again. [traceparent] is the W3C trace
context of the classification, for that read to join. Coalesced by the
sender; carries nothing about the mail. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val refresh_email_event_of_yojson : Yojson.Safe.t -> refresh_email_event
val yojson_of_refresh_email_event : refresh_email_event -> Yojson.Safe.t

val make_refresh_email_event_backfill :
  link_id:string -> status:backfill_status -> unit -> refresh_email_event
(** Backfill progress for [link_id]; see \[[BackfillStatus]\]. *)

val make_refresh_email_event_upsert_message :
  link_id:string -> unit -> refresh_email_event
(** A message was inserted or updated for [link_id]. *)

val make_refresh_email_event_update_labels :
  link_id:string -> unit -> refresh_email_event
(** Labels changed for [link_id]. *)

val make_refresh_email_event_delete_message :
  link_id:string -> unit -> refresh_email_event
(** A message was deleted for [link_id]. *)

val make_refresh_email_event_link_removed :
  link_id:string -> unit -> refresh_email_event
(** The inbox [link_id] was removed and its data torn down. *)

val make_refresh_email_event_photo_synced :
  link_id:string -> unit -> refresh_email_event
(** The self-contact photo for [link_id] finished uploading to static
file storage, so the inbox's derived [photo_url] is now available. *)

val make_refresh_email_event_backfill_progress :
  completed_threads:int ->
  link_id:string ->
  status:backfill_status ->
  total_threads:int ->
  unit ->
  refresh_email_event
(** Live backfill progress for [link_id], for driving a progress indicator on
the frontend: [completed_threads] out of [total_threads], plus [status].
Counts reflect the Redis progress counters; the priority pass may bump
both above the raw mailbox size, but in lockstep, so the ratio holds.
Appended last so existing variants keep their generated TS names. *)

val make_refresh_email_event_focus_updated :
  link_id:string -> ?traceparent:string -> unit -> refresh_email_event
(** A Focus classification was stored for a thread in [link_id], so its
readers read their Focus list again. [traceparent] is the W3C trace
context of the classification, for that read to join. Coalesced by the
sender; carries nothing about the mail. *)

type nonrec resolve_message_operation_request = {
  accept_duplicate_risk : bool option;
  action : api_message_resolution_action;
  remote_version : string option;
  revision : string;
}
(** Stale versions fail without altering the current operation. *)

val resolve_message_operation_request_of_yojson :
  Yojson.Safe.t -> resolve_message_operation_request

val yojson_of_resolve_message_operation_request :
  resolve_message_operation_request -> Yojson.Safe.t

val make_resolve_message_operation_request :
  ?accept_duplicate_risk:bool ->
  action:api_message_resolution_action ->
  ?remote_version:string ->
  revision:string ->
  unit ->
  resolve_message_operation_request
(** Stale versions fail without altering the current operation. *)

type nonrec resync_response = {
  already_in_progress : bool;
      (** True when a backfill was already running and this call was a no-op. *)
  backfill_job_id : string;
      (** Opaque ID of the backfill job or provider sync stream driving the resync.
the one already in progress. *)
}
(** The response returned from the resync endpoint. *)

val resync_response_of_yojson : Yojson.Safe.t -> resync_response
val yojson_of_resync_response : resync_response -> Yojson.Safe.t

val make_resync_response :
  already_in_progress:bool -> backfill_job_id:string -> unit -> resync_response
(** The response returned from the resync endpoint. *)

type nonrec send_message_request = {
  message : api_draft_input;  (** The message content. *)
}
(** Request body for sending a message (backward-compatible with [{ message: MessageToSend }]). *)

val send_message_request_of_yojson : Yojson.Safe.t -> send_message_request
val yojson_of_send_message_request : send_message_request -> Yojson.Safe.t

val make_send_message_request :
  message:api_draft_input -> unit -> send_message_request
(** Request body for sending a message (backward-compatible with [{ message: MessageToSend }]). *)

type nonrec send_message_response = {
  message : api_draft_output;  (** The created message. *)
}
(** Response body for sending a message. *)

val send_message_response_of_yojson : Yojson.Safe.t -> send_message_response
val yojson_of_send_message_response : send_message_response -> Yojson.Safe.t

val make_send_message_response :
  message:api_draft_output -> unit -> send_message_response
(** Response body for sending a message. *)

type nonrec shared_inbox_conflict_response = {
  email_address : string;  (** The mailbox address that is already connected. *)
  existing_link_id : string;
      (** The existing link that would be shared if the caller confirms. *)
  existing_owner_email : string;
      (** The email of the macro user who first connected the mailbox. *)
}
(** Returned with a [409 Conflict] when a connect targets an external mailbox another
macro user has already connected. The client surfaces a confirmation; on confirm it
retries [/email/init] with [force_share=true] to promote the mailbox to a shared inbox. *)

val shared_inbox_conflict_response_of_yojson :
  Yojson.Safe.t -> shared_inbox_conflict_response

val yojson_of_shared_inbox_conflict_response :
  shared_inbox_conflict_response -> Yojson.Safe.t

val make_shared_inbox_conflict_response :
  email_address:string ->
  existing_link_id:string ->
  existing_owner_email:string ->
  unit ->
  shared_inbox_conflict_response
(** Returned with a [409 Conflict] when a connect targets an external mailbox another
macro user has already connected. The client surfaces a confirmation; on confirm it
retries [/email/init] with [force_share=true] to promote the mailbox to a shared inbox. *)

type nonrec thread = {
  created_at : string;
  db_id : string;
  inbox_visible : bool;
  is_read : bool;
  latest_inbound_message_ts : string option;
  latest_non_spam_message_ts : string option;
  latest_outbound_message_ts : string option;
  link_id : string;
  messages : message list;
  provider_id : string option;
  updated_at : string;
}

val thread_of_yojson : Yojson.Safe.t -> thread
val yojson_of_thread : thread -> Yojson.Safe.t

val make_thread :
  created_at:string ->
  db_id:string ->
  inbox_visible:bool ->
  is_read:bool ->
  ?latest_inbound_message_ts:string ->
  ?latest_non_spam_message_ts:string ->
  ?latest_outbound_message_ts:string ->
  link_id:string ->
  messages:message list ->
  ?provider_id:string ->
  updated_at:string ->
  unit ->
  thread

type nonrec thread_summary = { provider_id : string }

val thread_summary_of_yojson : Yojson.Safe.t -> thread_summary
val yojson_of_thread_summary : thread_summary -> Yojson.Safe.t
val make_thread_summary : provider_id:string -> unit -> thread_summary

type nonrec thread_list = {
  next_page_token : string option;
  threads : thread_summary list;
}

val thread_list_of_yojson : Yojson.Safe.t -> thread_list
val yojson_of_thread_list : thread_list -> Yojson.Safe.t

val make_thread_list :
  ?next_page_token:string -> threads:thread_summary list -> unit -> thread_list

type nonrec thread_preview_cursor = {
  attachments : attachment list;
  created_at : string;
  id : string;
  inbox_visible : bool;
  is_draft : bool;
  is_important : bool;
  is_read : bool;
  name : string option;
  owner_id : string;
  participants : contact list;
  provider_id : string option;
  sender_email : string option;
  sender_name : string option;
  sender_photo_url : string option;
  snippet : string option;
  sort_ts : string;
  updated_at : string;
  viewed_at : string option;
}
(** thread summary returned in preview cursor endpoint *)

val thread_preview_cursor_of_yojson : Yojson.Safe.t -> thread_preview_cursor
val yojson_of_thread_preview_cursor : thread_preview_cursor -> Yojson.Safe.t

val make_thread_preview_cursor :
  attachments:attachment list ->
  created_at:string ->
  id:string ->
  inbox_visible:bool ->
  is_draft:bool ->
  is_important:bool ->
  is_read:bool ->
  ?name:string ->
  owner_id:string ->
  participants:contact list ->
  ?provider_id:string ->
  ?sender_email:string ->
  ?sender_name:string ->
  ?sender_photo_url:string ->
  ?snippet:string ->
  sort_ts:string ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  thread_preview_cursor
(** thread summary returned in preview cursor endpoint *)

type nonrec thread_read_receipts = { receipts : message_read_receipt list }
(** Open state of the caller's tracked, sent messages in one thread. *)

val thread_read_receipts_of_yojson : Yojson.Safe.t -> thread_read_receipts
val yojson_of_thread_read_receipts : thread_read_receipts -> Yojson.Safe.t

val make_thread_read_receipts :
  receipts:message_read_receipt list -> unit -> thread_read_receipts
(** Open state of the caller's tracked, sent messages in one thread. *)

(** Semantic mailbox facts, independent of folder/category names. *)
type nonrec thread_state_field =
  | Read
  | Starred
  | Trashed
  | Junk
  | Unknown of string  (** A value this SDK version does not know. *)

val thread_state_field_of_yojson : Yojson.Safe.t -> thread_state_field
val yojson_of_thread_state_field : thread_state_field -> Yojson.Safe.t

type nonrec transfer_draft_request = {
  destination_link_id : string;
  draft_generation : int option;
      (** Generation captured with the source draft. *)
  operation_id : string;
}
(** Reuse the same operation ID when retrying after a lost response. *)

val transfer_draft_request_of_yojson : Yojson.Safe.t -> transfer_draft_request
val yojson_of_transfer_draft_request : transfer_draft_request -> Yojson.Safe.t

val make_transfer_draft_request :
  destination_link_id:string ->
  ?draft_generation:int ->
  operation_id:string ->
  unit ->
  transfer_draft_request
(** Reuse the same operation ID when retrying after a lost response. *)

type nonrec transfer_draft_response = {
  attachments : api_attachment_draft list;
  message_id : string;
  source_id : string;
  source_thread_id : string;
  thread_id : string;
}
(** A new identity prevents delayed writes from mutating the moved copy. *)

val transfer_draft_response_of_yojson : Yojson.Safe.t -> transfer_draft_response
val yojson_of_transfer_draft_response : transfer_draft_response -> Yojson.Safe.t

val make_transfer_draft_response :
  attachments:api_attachment_draft list ->
  message_id:string ->
  source_id:string ->
  source_thread_id:string ->
  thread_id:string ->
  unit ->
  transfer_draft_response
(** A new identity prevents delayed writes from mutating the moved copy. *)

type nonrec transfer_recovery_response = {
  committed : transfer_draft_response option;
}
(** A null result confirms that the move cannot commit, even if its request was delayed. *)

val transfer_recovery_response_of_yojson :
  Yojson.Safe.t -> transfer_recovery_response

val yojson_of_transfer_recovery_response :
  transfer_recovery_response -> Yojson.Safe.t

val make_transfer_recovery_response :
  ?committed:transfer_draft_response -> unit -> transfer_recovery_response
(** A null result confirms that the move cannot commit, even if its request was delayed. *)

type nonrec unblock_sender_request = {
  email_address : string;  (** The email address of the sender to unblock. *)
}
(** Request to unblock a sender. *)

val unblock_sender_request_of_yojson : Yojson.Safe.t -> unblock_sender_request
val yojson_of_unblock_sender_request : unblock_sender_request -> Yojson.Safe.t

val make_unblock_sender_request :
  email_address:string -> unit -> unblock_sender_request
(** Request to unblock a sender. *)

type nonrec unresolved_signature_images_error = { unresolved_image_count : int }
(** Body returned with a 422 when signature images can't be loaded. *)

val unresolved_signature_images_error_of_yojson :
  Yojson.Safe.t -> unresolved_signature_images_error

val yojson_of_unresolved_signature_images_error :
  unresolved_signature_images_error -> Yojson.Safe.t

val make_unresolved_signature_images_error :
  unresolved_image_count:int -> unit -> unresolved_signature_images_error
(** Body returned with a 422 when signature images can't be loaded. *)

type nonrec update_label_batch_request = {
  label_id : string;
  message_ids : string list;
  value : bool;
}

val update_label_batch_request_of_yojson :
  Yojson.Safe.t -> update_label_batch_request

val yojson_of_update_label_batch_request :
  update_label_batch_request -> Yojson.Safe.t

val make_update_label_batch_request :
  label_id:string ->
  message_ids:string list ->
  value:bool ->
  unit ->
  update_label_batch_request

type nonrec update_label_batch_response = {
  failed_ids : string list;
  missing_ids : string list;
  successful_ids : string list;
}

val update_label_batch_response_of_yojson :
  Yojson.Safe.t -> update_label_batch_response

val yojson_of_update_label_batch_response :
  update_label_batch_response -> Yojson.Safe.t

val make_update_label_batch_response :
  failed_ids:string list ->
  missing_ids:string list ->
  successful_ids:string list ->
  unit ->
  update_label_batch_response

type nonrec update_thread_label_request = { label_id : string; value : bool }
(** Request body for updating a thread's labels. *)

val update_thread_label_request_of_yojson :
  Yojson.Safe.t -> update_thread_label_request

val yojson_of_update_thread_label_request :
  update_thread_label_request -> Yojson.Safe.t

val make_update_thread_label_request :
  label_id:string -> value:bool -> unit -> update_thread_label_request
(** Request body for updating a thread's labels. *)

type nonrec update_thread_labels_response = {
  failed_ids : string list;
  successful_ids : string list;
}
(** Response body for updating a thread's labels. *)

val update_thread_labels_response_of_yojson :
  Yojson.Safe.t -> update_thread_labels_response

val yojson_of_update_thread_labels_response :
  update_thread_labels_response -> Yojson.Safe.t

val make_update_thread_labels_response :
  failed_ids:string list ->
  successful_ids:string list ->
  unit ->
  update_thread_labels_response
(** Response body for updating a thread's labels. *)

type nonrec update_thread_project_request = {
  project_id : string option;
      (** The project ID to assign to the thread, or null to remove from project. *)
}
(** Request body for updating a thread's project. *)

val update_thread_project_request_of_yojson :
  Yojson.Safe.t -> update_thread_project_request

val yojson_of_update_thread_project_request :
  update_thread_project_request -> Yojson.Safe.t

val make_update_thread_project_request :
  ?project_id:string -> unit -> update_thread_project_request
(** Request body for updating a thread's project. *)

type nonrec update_thread_project_response = {
  old_project_id : string option;  (** The previous project ID of the thread. *)
}
(** Response body for updating a thread's project. *)

val update_thread_project_response_of_yojson :
  Yojson.Safe.t -> update_thread_project_response

val yojson_of_update_thread_project_response :
  update_thread_project_response -> Yojson.Safe.t

val make_update_thread_project_response :
  ?old_project_id:string -> unit -> update_thread_project_response
(** Response body for updating a thread's project. *)

type nonrec update_thread_state_request = {
  field : thread_state_field;
  value : bool;
}
(** Desired state for every applicable message in an authorized thread. *)

val update_thread_state_request_of_yojson :
  Yojson.Safe.t -> update_thread_state_request

val yojson_of_update_thread_state_request :
  update_thread_state_request -> Yojson.Safe.t

val make_update_thread_state_request :
  field:thread_state_field -> value:bool -> unit -> update_thread_state_request
(** Desired state for every applicable message in an authorized thread. *)

type nonrec upsert_email_filter_request = {
  email_address : string option;
      (** Exact email address to match. Mutually exclusive with [email_domain]. *)
  email_domain : string option;
      (** Email domain to match. Mutually exclusive with [email_address]. *)
  is_important : bool;
      (** Whether matching senders should be considered important. *)
}
(** Request body for creating or updating an email filter. *)

val upsert_email_filter_request_of_yojson :
  Yojson.Safe.t -> upsert_email_filter_request

val yojson_of_upsert_email_filter_request :
  upsert_email_filter_request -> Yojson.Safe.t

val make_upsert_email_filter_request :
  ?email_address:string ->
  ?email_domain:string ->
  is_important:bool ->
  unit ->
  upsert_email_filter_request
(** Request body for creating or updating an email filter. *)

type nonrec upsert_email_filter_response = { filter : api_email_filter }
(** Response body for upsert email filter. *)

val upsert_email_filter_response_of_yojson :
  Yojson.Safe.t -> upsert_email_filter_response

val yojson_of_upsert_email_filter_response :
  upsert_email_filter_response -> Yojson.Safe.t

val make_upsert_email_filter_response :
  filter:api_email_filter -> unit -> upsert_email_filter_response
(** Response body for upsert email filter. *)

type nonrec upsert_scheduled_request = {
  include_signature : bool option;
      (** Per-message signature override; absent uses the inbox's send defaults. *)
  send_time : string;  (** The time to send the message (ISO 8601 format). *)
  user_confirmation : string option;
      (** The user's own reply approving this send, quoted verbatim. Required
from an agent's program, which is refused without it; ignored for a
person in the app, whose Send Later is their confirmation. *)
}

val upsert_scheduled_request_of_yojson :
  Yojson.Safe.t -> upsert_scheduled_request

val yojson_of_upsert_scheduled_request :
  upsert_scheduled_request -> Yojson.Safe.t

val make_upsert_scheduled_request :
  ?include_signature:bool ->
  send_time:string ->
  ?user_confirmation:string ->
  unit ->
  upsert_scheduled_request

type nonrec upsert_scheduled_response = {
  message_id : string;
  send_time : string;
}

val upsert_scheduled_response_of_yojson :
  Yojson.Safe.t -> upsert_scheduled_response

val yojson_of_upsert_scheduled_response :
  upsert_scheduled_response -> Yojson.Safe.t

val make_upsert_scheduled_response :
  message_id:string -> send_time:string -> unit -> upsert_scheduled_response

type nonrec get_backfill_gmail_active_reply =
  | Ok_ of get_active_backfill_job_response  (** HTTP 200. *)
  | No_content of empty_response  (** HTTP 204. *)

and init_user_error =
  | Bad_request of init_error_code_response  (** HTTP 400. *)
  | Unauthorized of error_response  (** HTTP 401. *)
  | Payment_required of error_response  (** HTTP 402. *)
  | Conflict of shared_inbox_conflict_response  (** HTTP 409. *)
  | Too_many_requests of error_response  (** HTTP 429. *)
  | Internal_server_error of error_response  (** HTTP 500. *)

and patch_settings_error =
  | Bad_request of error_response  (** HTTP 400. *)
  | Unauthorized of error_response  (** HTTP 401. *)
  | Unprocessable_entity of unresolved_signature_images_error  (** HTTP 422. *)
  | Internal_server_error of error_response  (** HTTP 500. *)

val get_attachment :
  id:string ->
  unit ->
  (get_attachment_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/attachments/{id}]

Get an attachment by ID. *)

val get_attachment_document_id :
  id:string ->
  unit ->
  ( get_attachment_document_id_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [GET /email/attachments/{id}/document_id]

Get the Macro document id for an email attachment, uploading it if it doesn't already exist. *)

val list_backfill_gmail :
  unit ->
  (list_backfill_jobs_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/backfill/gmail]

List all backfill jobs for the authenticated user, across every link they
own. Scoped by the user's fusionauth id from the request context rather than
a single resolved link. *)

val cancel_backfill_gmail :
  job_id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/backfill/gmail]

Cancel a backfill job. *)

val get_backfill_gmail_active :
  unit ->
  (get_backfill_gmail_active_reply, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/backfill/gmail/active]

Get any active backfill job for the user. *)

val get_backfill_gmail :
  id:string ->
  unit ->
  (get_backfill_job_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/backfill/gmail/{id}]

Get a backfill job. *)

val forward_calendar_event :
  event_id:string ->
  to_:forward_calendar_event_recipient list ->
  ?body_text:string ->
  unit ->
  ( forward_calendar_event_response,
    forward_calendar_event_error )
  Macro_sdk_runtime.Request.t
(** [POST /email/calendar-events/{event_id}/forward]

Email one of the viewer's events to people the organizer's guest list
does not name, from the inbox that holds the viewer's copy, with the
usual undo delay, carrying the copy's join link. When the copy is Google's
private copy of an invitation from an organizer outside Google, it is a
real invitation ([METHOD:REQUEST]) naming the recipients, who answer it to
the organizer, who gets the email too. Otherwise it is the event's file
([METHOD:PUBLISH], no attendees): recipients can add the event to their
own calendar, are not added to the guest list, and the organizer is not
told. *)

val list_contacts :
  unit -> (list_contacts_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/contacts]

List all contacts belonging to the user, grouped by link. *)

val block_sender :
  email_address:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/contacts/block]

Durably block a sender in the selected inbox. *)

val list_blocked_senders :
  unit -> (list_blocked_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/contacts/blocked]

List all blocked senders for the authenticated user. *)

val unblock_sender :
  email_address:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/contacts/unblock]

Durably remove Macro-managed sender blocking in the selected inbox. *)

val recover_draft_transfer :
  id:string ->
  unit ->
  ( transfer_recovery_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /email/draft-transfers/{id}/recover] *)

val create_draft :
  draft:api_draft_input ->
  ?send_time:string ->
  unit ->
  (create_draft_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/drafts]

Create a draft. *)

val get_scheduled_messages :
  ?offset:int ->
  ?limit:int ->
  unit ->
  (get_scheduled_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/drafts/scheduled]

List scheduled drafts. *)

val upsert_scheduled_message :
  id:string ->
  send_time:string ->
  ?draft_generation:int ->
  ?include_signature:bool ->
  ?user_confirmation:string ->
  unit ->
  (upsert_scheduled_response, error_response) Macro_sdk_runtime.Request.t
(** [PUT /email/drafts/scheduled/{id}]

Schedule or update a scheduled draft. *)

val delete_scheduled_draft :
  message_id:string ->
  ?draft_generation:int ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/drafts/scheduled/{message_id}]

Remove the scheduled send from a draft, including immediate-send undo. *)

val delete_draft :
  id:string ->
  ?draft_generation:int ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/drafts/{id}]

Delete a draft. *)

val add_draft_attachment :
  id:string ->
  file_name:string ->
  sha:string ->
  size:int ->
  ?draft_generation:int ->
  ?upload_id:string ->
  unit ->
  (add_draft_attachment_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/drafts/{id}/attachments]

Add an attachment to a draft. *)

val remove_draft_attachment :
  id:string ->
  attachment_id:string ->
  ?draft_generation:int ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/drafts/{id}/attachments/{attachment_id}]

Remove an attachment from a draft. *)

val complete_draft_attachment :
  id:string ->
  attachment_id:string ->
  ?draft_generation:int ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /email/drafts/{id}/attachments/{attachment_id}/complete]

Confirm an uploaded attachment before it becomes part of a sendable draft. *)

val add_forwarded_attachment :
  id:string ->
  attachment_id:string ->
  ?draft_generation:int ->
  unit ->
  ( add_forwarded_attachment_response,
    error_response )
  Macro_sdk_runtime.Request.t
(** [POST /email/drafts/{id}/forwarded-attachments]

Add a forwarded attachment to a draft. *)

val remove_forwarded_attachment :
  id:string ->
  attachment_id:string ->
  ?draft_generation:int ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/drafts/{id}/forwarded-attachments/{attachment_id}]

Remove a forwarded attachment from a draft. *)

val message_operation_status :
  id:string ->
  unit ->
  (message_operation_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/drafts/{id}/operation]

The same provider-neutral state returned on fully hydrated email messages. *)

val resolve_message_operation :
  id:string ->
  action:api_message_resolution_action ->
  revision:string ->
  ?accept_duplicate_risk:bool ->
  ?remote_version:string ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/drafts/{id}/resolve]

Resolve an observed draft conflict or uncertain provider operation. *)

val transfer_draft :
  id:string ->
  destination_link_id:string ->
  operation_id:string ->
  ?draft_generation:int ->
  unit ->
  ( transfer_draft_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /email/drafts/{id}/transfer] *)

val list_email_filters :
  unit ->
  (list_email_filters_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/filters]

List all email filters for the current user. *)

val upsert_email_filter :
  is_important:bool ->
  ?email_address:string ->
  ?email_domain:string ->
  unit ->
  (upsert_email_filter_response, error_response) Macro_sdk_runtime.Request.t
(** [PUT /email/filters]

Create or update an email filter. *)

val delete_email_filter :
  id:string -> unit -> (unit, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/filters/{id}]

Delete an email filter by ID. *)

val init_user :
  ?link_id:string ->
  ?force_share:bool ->
  unit ->
  (init_response, init_user_error) Macro_sdk_runtime.Request.t
(** [POST /email/init]

Initialize email functionality for the user. Populates initial threads and enables inbox syncing. *)

val list_labels :
  unit -> (list_labels_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/labels]

List all labels for the user's email link. *)

val create_label :
  label_name:string ->
  unit ->
  (create_label_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/labels]

Create a label. *)

val delete_label :
  id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/labels/{id}]

Delete a label. *)

val list_links :
  unit -> (list_links_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/links]

List all links belonging to the user. *)

val health_check_links :
  unit -> (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/links/health-check]

Probes the live auth state of each of the caller's inboxes (owned and delegated)
against the auth service and records the result on each link. A grant that died
while the caller was inactive is detected here within minutes instead of waiting on
the daily refresh sweep; the side effects (clearing or setting the reauth flag, and
the one-time reauth fan-out) are handled by the email service token source. *)

val delete_link :
  link_id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/links/{link_id}]

Removes a linked inbox. *)

val disable_link_calendar :
  link_id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/links/{link_id}/calendar]

Turns calendar off for a connected inbox. *)

val resync_link :
  link_id:string ->
  unit ->
  (resync_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/links/{link_id}/resync]

Re-syncs a linked inbox by enqueuing a fresh backfill. *)

val send_message :
  message:api_draft_input ->
  unit ->
  (send_message_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/messages]

Send a message. *)

val get_messages_batch :
  body:string list ->
  unit ->
  (parsed_message list, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/messages/batch] *)

val add_remove_label :
  label_id:string ->
  message_ids:string list ->
  value:bool ->
  unit ->
  (update_label_batch_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /email/messages/labels]

Add or remove a label from a batch of messages *)

val get_message :
  id:string ->
  unit ->
  (parsed_message, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/messages/{id}] *)

val get_message_eml :
  id:string -> unit -> (string, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/messages/{id}/eml]

Download a message's original source as an [.eml] file. *)

val patch_settings :
  settings:settings ->
  unit ->
  (patch_settings_response, patch_settings_error) Macro_sdk_runtime.Request.t
(** [PATCH /email/settings]

Patch user settings. *)

val mailbox_settings_operations :
  unit ->
  ( mailbox_settings_operation list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /email/settings/operations]

Accepted label and sender-policy changes awaiting provider confirmation. *)

val disable_sync :
  ?x_email_link_id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [DELETE /email/sync]

Disables inbox syncing for the selected inbox. *)

val archive_threads :
  thread_ids:string list ->
  value:bool ->
  unit ->
  (archive_threads_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /email/threads/archived]

Change the archived status of up to 100 threads, sending one provider
write per inbox. A thread that can't change is reported, not fatal. *)

val previews_inbox_cursor :
  view:string ->
  ?limit:int ->
  ?sort_method:api_sort_method ->
  ?cursor:string ->
  unit ->
  (api_paginated_thread_cursor, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/threads/previews/cursor/{view}]

Get paginated thread previews with cursor-based pagination. *)

val archive_thread :
  id:string ->
  value:bool ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /email/threads/{id}/archived]

Change the archived status of a thread. *)

val add_remove_thread_label :
  id:string ->
  label_id:string ->
  value:bool ->
  unit ->
  (update_thread_labels_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /email/threads/{id}/labels]

Add or remove a label from all messages in a thread. *)

val get_thread_messages_handler :
  id:string ->
  ?since:string ->
  ?limit:int64 ->
  unit ->
  (parsed_message list, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/threads/{id}/messages] *)

val thread_operations :
  id:string ->
  unit ->
  (mailbox_operation list, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/threads/{id}/operations]

Fetch the latest organization action outcomes without provider-specific status strings. *)

val thread_seen :
  id:string ->
  unit ->
  (empty_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /email/threads/{id}/seen]

Called by FE when the user has seen a thread. *)

val update_thread_state :
  id:string ->
  field:thread_state_field ->
  value:bool ->
  unit ->
  (unit, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /email/threads/{id}/state]

Set mailbox state without client-side provider label lookup. *)

val get_thread :
  thread_id:string ->
  ?offset:int64 ->
  ?limit:int64 ->
  unit ->
  (get_thread_response, error_response) Macro_sdk_runtime.Request.t
(** [GET /email/threads/{thread_id}]

Get a thread with paginated messages. *)

val get_thread_calendar_invitations :
  thread_id:string ->
  unit ->
  ( (string * invitation_resolution) list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /email/threads/{thread_id}/calendar-invitations] *)

val copy_thread_calendar_invitation :
  thread_id:string ->
  message_id:string ->
  invitation_id:string ->
  ?calendar_id:string ->
  unit ->
  (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t
(** [POST /email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy]

Add a shared event saved from one of the thread's messages to one of the
viewer's Google calendars, the way Add to calendar adds a channel-shared
event: a snapshot under the meeting's iCalendar UID and organizer, with the
viewer as its only guest and no join link. Nobody is notified. Only a
published event file ([METHOD:PUBLISH]) can be added; an invitation is
answered from the calendar it reached. *)

val update_thread_project :
  thread_id:string ->
  ?project_id:string ->
  unit ->
  (update_thread_project_response, error_response) Macro_sdk_runtime.Request.t
(** [PATCH /email/threads/{thread_id}/project]

Update the project assignment for a thread. *)

val get_thread_read_receipts :
  thread_id:string ->
  unit ->
  ( thread_read_receipts,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /email/threads/{thread_id}/read-receipts] *)

val health_handler :
  unit ->
  ( empty_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /health]

Health check *)

val get_read_receipt_pixel :
  token:string ->
  unit ->
  (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /opens/{token}]

Every request gets the same uncacheable pixel so the response reveals nothing
about the token, and each open reaches the server. *)
