(* Generated from packages/sdk/specs/email.json by packages/sdk-ocaml/gen. Do not edit. *)

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

type nonrec add_draft_attachment_request = {
  file_name : string;  (** The name of the file being uploaded. *)
  sha : string;  (** The SHA256 hash of the file being uploaded. *)
  size : int;  (** The size of the file in bytes. *)
  upload_id : string option;
      (** Stable client upload identifier. Retry the same file with the same ID. *)
}
(** The request passed to send a message *)

let add_draft_attachment_request_of_yojson :
    Yojson.Safe.t -> add_draft_attachment_request =
 fun json ->
  let fields = Json.obj json in
  {
    file_name = Json.required fields "file_name" Json.string;
    sha = Json.required fields "sha" Json.string;
    size = Json.required fields "size" Json.int;
    upload_id = Json.optional fields "upload_id" Json.string;
  }

and yojson_of_add_draft_attachment_request :
    add_draft_attachment_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("file_name", Some (Json.of_string value.file_name));
      ("sha", Some (Json.of_string value.sha));
      ("size", Some (Json.of_int value.size));
      ("upload_id", Option.map Json.of_string value.upload_id);
    ]

let make_add_draft_attachment_request ~(file_name : string) ~(sha : string)
    ~(size : int) ?upload_id () =
  ({ file_name; sha; size; upload_id } : add_draft_attachment_request)

type nonrec add_draft_attachment_response = {
  attachment_id : string;  (** The ID of the attachment in the database. *)
  content_type : string;  (** The MIME type of the attachment. *)
  upload_url : string;  (** The URL to upload the attachment to. *)
}

let add_draft_attachment_response_of_yojson :
    Yojson.Safe.t -> add_draft_attachment_response =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_id = Json.required fields "attachment_id" Json.string;
    content_type = Json.required fields "content_type" Json.string;
    upload_url = Json.required fields "upload_url" Json.string;
  }

and yojson_of_add_draft_attachment_response :
    add_draft_attachment_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachment_id", Some (Json.of_string value.attachment_id));
      ("content_type", Some (Json.of_string value.content_type));
      ("upload_url", Some (Json.of_string value.upload_url));
    ]

let make_add_draft_attachment_response ~(attachment_id : string)
    ~(content_type : string) ~(upload_url : string) () =
  ({ attachment_id; content_type; upload_url } : add_draft_attachment_response)

type nonrec add_forwarded_attachment_request = {
  attachment_id : string;  (** The ID of the original attachment to forward. *)
}

let add_forwarded_attachment_request_of_yojson :
    Yojson.Safe.t -> add_forwarded_attachment_request =
 fun json ->
  let fields = Json.obj json in
  { attachment_id = Json.required fields "attachment_id" Json.string }

and yojson_of_add_forwarded_attachment_request :
    add_forwarded_attachment_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("attachment_id", Some (Json.of_string value.attachment_id)) ]

let make_add_forwarded_attachment_request ~(attachment_id : string) () =
  ({ attachment_id } : add_forwarded_attachment_request)

type nonrec add_forwarded_attachment_response = {
  attachment_id : string;  (** The ID of the original attachment. *)
  filename : string option;  (** Original file name of the attachment. *)
  mime_type : string option;  (** MIME type of the attachment. *)
  size_bytes : int64 option;  (** File size in bytes. *)
}

let add_forwarded_attachment_response_of_yojson :
    Yojson.Safe.t -> add_forwarded_attachment_response =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_id = Json.required fields "attachment_id" Json.string;
    filename = Json.optional fields "filename" Json.string;
    mime_type = Json.optional fields "mime_type" Json.string;
    size_bytes = Json.optional fields "size_bytes" Json.int64;
  }

and yojson_of_add_forwarded_attachment_response :
    add_forwarded_attachment_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachment_id", Some (Json.of_string value.attachment_id));
      ("filename", Option.map Json.of_string value.filename);
      ("mime_type", Option.map Json.of_string value.mime_type);
      ("size_bytes", Option.map Json.of_int64 value.size_bytes);
    ]

let make_add_forwarded_attachment_response ~(attachment_id : string) ?filename
    ?mime_type ?size_bytes () =
  ({ attachment_id; filename; mime_type; size_bytes }
    : add_forwarded_attachment_response)

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

let api_attachment_of_yojson : Yojson.Safe.t -> api_attachment =
 fun json ->
  let fields = Json.obj json in
  {
    content_id = Json.optional fields "contentId" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    filename = Json.optional fields "filename" Json.string;
    id = Json.required fields "id" Json.string;
    message_id = Json.required fields "messageId" Json.string;
    mime_type = Json.optional fields "mimeType" Json.string;
    provider_attachment_id =
      Json.optional fields "providerAttachmentId" Json.string;
    size_bytes = Json.optional fields "sizeBytes" Json.int64;
  }

and yojson_of_api_attachment : api_attachment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("contentId", Option.map Json.of_string value.content_id);
      ("createdAt", Some (Json.of_string value.created_at));
      ("filename", Option.map Json.of_string value.filename);
      ("id", Some (Json.of_string value.id));
      ("messageId", Some (Json.of_string value.message_id));
      ("mimeType", Option.map Json.of_string value.mime_type);
      ( "providerAttachmentId",
        Option.map Json.of_string value.provider_attachment_id );
      ("sizeBytes", Option.map Json.of_int64 value.size_bytes);
    ]

let make_api_attachment ?content_id ~(created_at : string) ?filename
    ~(id : string) ~(message_id : string) ?mime_type ?provider_attachment_id
    ?size_bytes () =
  ({
     content_id;
     created_at;
     filename;
     id;
     message_id;
     mime_type;
     provider_attachment_id;
     size_bytes;
   }
    : api_attachment)

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

let api_attachment_draft_of_yojson : Yojson.Safe.t -> api_attachment_draft =
 fun json ->
  let fields = Json.obj json in
  {
    content_id = Json.optional fields "content_id" Json.string;
    content_type = Json.required fields "content_type" Json.string;
    draft_id = Json.required fields "draft_id" Json.string;
    file_name = Json.required fields "file_name" Json.string;
    id = Json.required fields "id" Json.string;
    is_inline = Json.required fields "is_inline" Json.bool;
    s3_key = Json.required fields "s3_key" Json.string;
    sha = Json.required fields "sha" Json.string;
    size = Json.required fields "size" Json.int;
    upload_pending = Json.required fields "upload_pending" Json.bool;
  }

and yojson_of_api_attachment_draft : api_attachment_draft -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content_id", Option.map Json.of_string value.content_id);
      ("content_type", Some (Json.of_string value.content_type));
      ("draft_id", Some (Json.of_string value.draft_id));
      ("file_name", Some (Json.of_string value.file_name));
      ("id", Some (Json.of_string value.id));
      ("is_inline", Some (Json.of_bool value.is_inline));
      ("s3_key", Some (Json.of_string value.s3_key));
      ("sha", Some (Json.of_string value.sha));
      ("size", Some (Json.of_int value.size));
      ("upload_pending", Some (Json.of_bool value.upload_pending));
    ]

let make_api_attachment_draft ?content_id ~(content_type : string)
    ~(draft_id : string) ~(file_name : string) ~(id : string)
    ~(is_inline : bool) ~(s3_key : string) ~(sha : string) ~(size : int)
    ~(upload_pending : bool) () =
  ({
     content_id;
     content_type;
     draft_id;
     file_name;
     id;
     is_inline;
     s3_key;
     sha;
     size;
     upload_pending;
   }
    : api_attachment_draft)

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

let api_attachment_forwarded_of_yojson :
    Yojson.Safe.t -> api_attachment_forwarded =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_id = Json.required fields "attachment_id" Json.string;
    draft_id = Json.required fields "draft_id" Json.string;
    filename = Json.optional fields "filename" Json.string;
    message_provider_id = Json.required fields "message_provider_id" Json.string;
    mime_type = Json.optional fields "mime_type" Json.string;
    provider_attachment_id =
      Json.optional fields "provider_attachment_id" Json.string;
    size_bytes = Json.optional fields "size_bytes" Json.int64;
  }

and yojson_of_api_attachment_forwarded :
    api_attachment_forwarded -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachment_id", Some (Json.of_string value.attachment_id));
      ("draft_id", Some (Json.of_string value.draft_id));
      ("filename", Option.map Json.of_string value.filename);
      ("message_provider_id", Some (Json.of_string value.message_provider_id));
      ("mime_type", Option.map Json.of_string value.mime_type);
      ( "provider_attachment_id",
        Option.map Json.of_string value.provider_attachment_id );
      ("size_bytes", Option.map Json.of_int64 value.size_bytes);
    ]

let make_api_attachment_forwarded ~(attachment_id : string) ~(draft_id : string)
    ?filename ~(message_provider_id : string) ?mime_type ?provider_attachment_id
    ?size_bytes () =
  ({
     attachment_id;
     draft_id;
     filename;
     message_provider_id;
     mime_type;
     provider_attachment_id;
     size_bytes;
   }
    : api_attachment_forwarded)

type nonrec api_contact = {
  email_address : string option;
  id : string;
  link_id : string;
  name : string option;
  sfs_photo_url : string option;
}

let api_contact_of_yojson : Yojson.Safe.t -> api_contact =
 fun json ->
  let fields = Json.obj json in
  {
    email_address = Json.optional fields "emailAddress" Json.string;
    id = Json.required fields "id" Json.string;
    link_id = Json.required fields "linkId" Json.string;
    name = Json.optional fields "name" Json.string;
    sfs_photo_url = Json.optional fields "sfsPhotoUrl" Json.string;
  }

and yojson_of_api_contact : api_contact -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("emailAddress", Option.map Json.of_string value.email_address);
      ("id", Some (Json.of_string value.id));
      ("linkId", Some (Json.of_string value.link_id));
      ("name", Option.map Json.of_string value.name);
      ("sfsPhotoUrl", Option.map Json.of_string value.sfs_photo_url);
    ]

let make_api_contact ?email_address ~(id : string) ~(link_id : string) ?name
    ?sfs_photo_url () =
  ({ email_address; id; link_id; name; sfs_photo_url } : api_contact)

type nonrec api_contact_info = {
  email : string;
  name : string option;
  photo_url : string option;
}
(** API representation of a contact (sender or recipient). *)

let api_contact_info_of_yojson : Yojson.Safe.t -> api_contact_info =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    name = Json.optional fields "name" Json.string;
    photo_url = Json.optional fields "photo_url" Json.string;
  }

and yojson_of_api_contact_info : api_contact_info -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("name", Option.map Json.of_string value.name);
      ("photo_url", Option.map Json.of_string value.photo_url);
    ]

let make_api_contact_info ~(email : string) ?name ?photo_url () =
  ({ email; name; photo_url } : api_contact_info)

type nonrec api_draft_contact_info = {
  email : string;  (** Email address. *)
  name : string option;  (** Display name. *)
  photo_url : string option;  (** Profile photo URL. *)
}
(** Contact info for draft request/response (backward-compatible with MessageToSend shape). *)

let api_draft_contact_info_of_yojson : Yojson.Safe.t -> api_draft_contact_info =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    name = Json.optional fields "name" Json.string;
    photo_url = Json.optional fields "photo_url" Json.string;
  }

and yojson_of_api_draft_contact_info : api_draft_contact_info -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("name", Option.map Json.of_string value.name);
      ("photo_url", Option.map Json.of_string value.photo_url);
    ]

let make_api_draft_contact_info ~(email : string) ?name ?photo_url () =
  ({ email; name; photo_url } : api_draft_contact_info)

type nonrec value = Yojson.Safe.t

let value_of_yojson : Yojson.Safe.t -> value = fun json -> Json.json json
and yojson_of_value : value -> Yojson.Safe.t = fun value -> Json.of_json value

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

let api_draft_input_of_yojson : Yojson.Safe.t -> api_draft_input =
 fun json ->
  let fields = Json.obj json in
  {
    bcc =
      Json.optional fields "bcc" (Json.list api_draft_contact_info_of_yojson);
    body_html = Json.optional fields "body_html" Json.string;
    body_macro = Json.optional fields "body_macro" Json.string;
    body_text = Json.optional fields "body_text" Json.string;
    cc = Json.optional fields "cc" (Json.list api_draft_contact_info_of_yojson);
    db_id = Json.optional fields "db_id" Json.string;
    draft_generation = Json.optional fields "draft_generation" Json.int;
    from = Json.optional fields "from" Json.string;
    headers_json = Json.optional fields "headers_json" value_of_yojson;
    include_signature = Json.optional fields "include_signature" Json.bool;
    provider_id = Json.optional fields "provider_id" Json.string;
    provider_thread_id = Json.optional fields "provider_thread_id" Json.string;
    replying_to_id = Json.optional fields "replying_to_id" Json.string;
    subject = Json.required fields "subject" Json.string;
    thread_db_id = Json.optional fields "thread_db_id" Json.string;
    to_ = Json.optional fields "to" (Json.list api_draft_contact_info_of_yojson);
  }

and yojson_of_api_draft_input : api_draft_input -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "bcc",
        Option.map (Json.of_list yojson_of_api_draft_contact_info) value.bcc );
      ("body_html", Option.map Json.of_string value.body_html);
      ("body_macro", Option.map Json.of_string value.body_macro);
      ("body_text", Option.map Json.of_string value.body_text);
      ("cc", Option.map (Json.of_list yojson_of_api_draft_contact_info) value.cc);
      ("db_id", Option.map Json.of_string value.db_id);
      ("draft_generation", Option.map Json.of_int value.draft_generation);
      ("from", Option.map Json.of_string value.from);
      ("headers_json", Option.map yojson_of_value value.headers_json);
      ("include_signature", Option.map Json.of_bool value.include_signature);
      ("provider_id", Option.map Json.of_string value.provider_id);
      ("provider_thread_id", Option.map Json.of_string value.provider_thread_id);
      ("replying_to_id", Option.map Json.of_string value.replying_to_id);
      ("subject", Some (Json.of_string value.subject));
      ("thread_db_id", Option.map Json.of_string value.thread_db_id);
      ( "to",
        Option.map (Json.of_list yojson_of_api_draft_contact_info) value.to_ );
    ]

let make_api_draft_input ?bcc ?body_html ?body_macro ?body_text ?cc ?db_id
    ?draft_generation ?from ?headers_json ?include_signature ?provider_id
    ?provider_thread_id ?replying_to_id ~(subject : string) ?thread_db_id ?to_
    () =
  ({
     bcc;
     body_html;
     body_macro;
     body_text;
     cc;
     db_id;
     draft_generation;
     from;
     headers_json;
     include_signature;
     provider_id;
     provider_thread_id;
     replying_to_id;
     subject;
     thread_db_id;
     to_;
   }
    : api_draft_input)

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

let api_draft_output_of_yojson : Yojson.Safe.t -> api_draft_output =
 fun json ->
  let fields = Json.obj json in
  {
    bcc =
      Json.optional fields "bcc" (Json.list api_draft_contact_info_of_yojson);
    body_html = Json.optional fields "body_html" Json.string;
    body_macro = Json.optional fields "body_macro" Json.string;
    body_text = Json.optional fields "body_text" Json.string;
    cc = Json.optional fields "cc" (Json.list api_draft_contact_info_of_yojson);
    db_id = Json.optional fields "db_id" Json.string;
    draft_generation = Json.required fields "draft_generation" Json.int;
    headers_json = Json.optional fields "headers_json" value_of_yojson;
    link_id = Json.required fields "link_id" Json.string;
    provider_id = Json.optional fields "provider_id" Json.string;
    provider_thread_id = Json.optional fields "provider_thread_id" Json.string;
    replying_to_id = Json.optional fields "replying_to_id" Json.string;
    send_time = Json.optional fields "send_time" Json.string;
    subject = Json.required fields "subject" Json.string;
    thread_db_id = Json.optional fields "thread_db_id" Json.string;
    to_ = Json.optional fields "to" (Json.list api_draft_contact_info_of_yojson);
  }

and yojson_of_api_draft_output : api_draft_output -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "bcc",
        Option.map (Json.of_list yojson_of_api_draft_contact_info) value.bcc );
      ("body_html", Option.map Json.of_string value.body_html);
      ("body_macro", Option.map Json.of_string value.body_macro);
      ("body_text", Option.map Json.of_string value.body_text);
      ("cc", Option.map (Json.of_list yojson_of_api_draft_contact_info) value.cc);
      ("db_id", Option.map Json.of_string value.db_id);
      ("draft_generation", Some (Json.of_int value.draft_generation));
      ("headers_json", Option.map yojson_of_value value.headers_json);
      ("link_id", Some (Json.of_string value.link_id));
      ("provider_id", Option.map Json.of_string value.provider_id);
      ("provider_thread_id", Option.map Json.of_string value.provider_thread_id);
      ("replying_to_id", Option.map Json.of_string value.replying_to_id);
      ("send_time", Option.map Json.of_string value.send_time);
      ("subject", Some (Json.of_string value.subject));
      ("thread_db_id", Option.map Json.of_string value.thread_db_id);
      ( "to",
        Option.map (Json.of_list yojson_of_api_draft_contact_info) value.to_ );
    ]

let make_api_draft_output ?bcc ?body_html ?body_macro ?body_text ?cc ?db_id
    ~(draft_generation : int) ?headers_json ~(link_id : string) ?provider_id
    ?provider_thread_id ?replying_to_id ?send_time ~(subject : string)
    ?thread_db_id ?to_ () =
  ({
     bcc;
     body_html;
     body_macro;
     body_text;
     cc;
     db_id;
     draft_generation;
     headers_json;
     link_id;
     provider_id;
     provider_thread_id;
     replying_to_id;
     send_time;
     subject;
     thread_db_id;
     to_;
   }
    : api_draft_output)

type nonrec api_email_filter = {
  created_at : string;
  email_address : string option;
  email_domain : string option;
  id : string;
  is_important : bool;
}
(** A single email filter in API responses. *)

let api_email_filter_of_yojson : Yojson.Safe.t -> api_email_filter =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    email_address = Json.optional fields "email_address" Json.string;
    email_domain = Json.optional fields "email_domain" Json.string;
    id = Json.required fields "id" Json.string;
    is_important = Json.required fields "is_important" Json.bool;
  }

and yojson_of_api_email_filter : api_email_filter -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("email_address", Option.map Json.of_string value.email_address);
      ("email_domain", Option.map Json.of_string value.email_domain);
      ("id", Some (Json.of_string value.id));
      ("is_important", Some (Json.of_bool value.is_important));
    ]

let make_api_email_filter ~(created_at : string) ?email_address ?email_domain
    ~(id : string) ~(is_important : bool) () =
  ({ created_at; email_address; email_domain; id; is_important }
    : api_email_filter)

type nonrec api_label_list_visibility =
  | Label_show
  | Label_show_if_unread
  | Label_hide
  | Unknown of string  (** A value this SDK version does not know. *)

let api_label_list_visibility_of_yojson :
    Yojson.Safe.t -> api_label_list_visibility =
 fun json ->
  match Json.string json with
  | "LabelShow" -> Label_show
  | "LabelShowIfUnread" -> Label_show_if_unread
  | "LabelHide" -> Label_hide
  | other -> Json.unknown "api_label_list_visibility" json (Unknown other)

and yojson_of_api_label_list_visibility :
    api_label_list_visibility -> Yojson.Safe.t =
 fun value ->
  match value with
  | Label_show -> `String "LabelShow"
  | Label_show_if_unread -> `String "LabelShowIfUnread"
  | Label_hide -> `String "LabelHide"
  | Unknown other -> `String other

type nonrec api_message_list_visibility =
  | Show
  | Hide
  | Unknown of string  (** A value this SDK version does not know. *)

let api_message_list_visibility_of_yojson :
    Yojson.Safe.t -> api_message_list_visibility =
 fun json ->
  match Json.string json with
  | "Show" -> Show
  | "Hide" -> Hide
  | other -> Json.unknown "api_message_list_visibility" json (Unknown other)

and yojson_of_api_message_list_visibility :
    api_message_list_visibility -> Yojson.Safe.t =
 fun value ->
  match value with
  | Show -> `String "Show"
  | Hide -> `String "Hide"
  | Unknown other -> `String other

type nonrec api_label_type =
  | System
  | User
  | Unknown of string  (** A value this SDK version does not know. *)

let api_label_type_of_yojson : Yojson.Safe.t -> api_label_type =
 fun json ->
  match Json.string json with
  | "System" -> System
  | "User" -> User
  | other -> Json.unknown "api_label_type" json (Unknown other)

and yojson_of_api_label_type : api_label_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | System -> `String "System"
  | User -> `String "User"
  | Unknown other -> `String other

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

let api_label_of_yojson : Yojson.Safe.t -> api_label =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    label_list_visibility =
      Json.required fields "labelListVisibility"
        api_label_list_visibility_of_yojson;
    link_id = Json.required fields "linkId" Json.string;
    message_list_visibility =
      Json.required fields "messageListVisibility"
        api_message_list_visibility_of_yojson;
    name = Json.required fields "name" Json.string;
    provider_label_id = Json.required fields "providerLabelId" Json.string;
    type_ = Json.required fields "type" api_label_type_of_yojson;
  }

and yojson_of_api_label : api_label -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ( "labelListVisibility",
        Some (yojson_of_api_label_list_visibility value.label_list_visibility)
      );
      ("linkId", Some (Json.of_string value.link_id));
      ( "messageListVisibility",
        Some
          (yojson_of_api_message_list_visibility value.message_list_visibility)
      );
      ("name", Some (Json.of_string value.name));
      ("providerLabelId", Some (Json.of_string value.provider_label_id));
      ("type", Some (yojson_of_api_label_type value.type_));
    ]

let make_api_label ~(created_at : string) ~(id : string)
    ~(label_list_visibility : api_label_list_visibility) ~(link_id : string)
    ~(message_list_visibility : api_message_list_visibility) ~(name : string)
    ~(provider_label_id : string) ~(type_ : api_label_type) () =
  ({
     created_at;
     id;
     label_list_visibility;
     link_id;
     message_list_visibility;
     name;
     provider_label_id;
     type_;
   }
    : api_label)

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

let api_message_attachment_of_yojson : Yojson.Safe.t -> api_message_attachment =
 fun json ->
  let fields = Json.obj json in
  {
    content_id = Json.optional fields "content_id" Json.string;
    data_url = Json.optional fields "data_url" Json.string;
    db_id = Json.required fields "db_id" Json.string;
    filename = Json.optional fields "filename" Json.string;
    mime_type = Json.optional fields "mime_type" Json.string;
    provider_id = Json.optional fields "provider_id" Json.string;
    reference_url = Json.optional fields "reference_url" Json.string;
    sfs_id = Json.optional fields "sfs_id" Json.string;
    size_bytes = Json.optional fields "size_bytes" Json.int64;
  }

and yojson_of_api_message_attachment : api_message_attachment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content_id", Option.map Json.of_string value.content_id);
      ("data_url", Option.map Json.of_string value.data_url);
      ("db_id", Some (Json.of_string value.db_id));
      ("filename", Option.map Json.of_string value.filename);
      ("mime_type", Option.map Json.of_string value.mime_type);
      ("provider_id", Option.map Json.of_string value.provider_id);
      ("reference_url", Option.map Json.of_string value.reference_url);
      ("sfs_id", Option.map Json.of_string value.sfs_id);
      ("size_bytes", Option.map Json.of_int64 value.size_bytes);
    ]

let make_api_message_attachment ?content_id ?data_url ~(db_id : string)
    ?filename ?mime_type ?provider_id ?reference_url ?sfs_id ?size_bytes () =
  ({
     content_id;
     data_url;
     db_id;
     filename;
     mime_type;
     provider_id;
     reference_url;
     sfs_id;
     size_bytes;
   }
    : api_message_attachment)

type nonrec invitation_participant = {
  email : string;  (** Participant calendar address. *)
  name : string option;  (** Sender-supplied display name. *)
  participation_status : string option;
      (** Original PARTSTAT, retaining extensions. *)
}
(** Scheduling participant; saved responses are historical, not current RSVP. *)

let invitation_participant_of_yojson : Yojson.Safe.t -> invitation_participant =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    name = Json.optional fields "name" Json.string;
    participation_status =
      Json.optional fields "participation_status" Json.string;
  }

and yojson_of_invitation_participant : invitation_participant -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("name", Option.map Json.of_string value.name);
      ( "participation_status",
        Option.map Json.of_string value.participation_status );
    ]

let make_invitation_participant ~(email : string) ?name ?participation_status ()
    =
  ({ email; name; participation_status } : invitation_participant)

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

let invitation_date_time_of_yojson : Yojson.Safe.t -> invitation_date_time =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "date" -> Date { value = Json.required fields "value" Json.string }
  | "zoned" ->
      Zoned
        {
          time_zone = Json.required fields "time_zone" Json.string;
          value = Json.required fields "value" Json.string;
        }
  | "unresolved" ->
      Unresolved
        {
          time_zone = Json.optional fields "time_zone" Json.string;
          value = Json.required fields "value" Json.string;
        }
  | _ -> Json.unknown "invitation_date_time" json (Unknown json)

and yojson_of_invitation_date_time : invitation_date_time -> Yojson.Safe.t =
 fun value ->
  match value with
  | Date case ->
      Json.record
        [
          ("kind", Some (`String "date"));
          ("value", Some (Json.of_string case.value));
        ]
  | Zoned case ->
      Json.record
        [
          ("kind", Some (`String "zoned"));
          ("time_zone", Some (Json.of_string case.time_zone));
          ("value", Some (Json.of_string case.value));
        ]
  | Unresolved case ->
      Json.record
        [
          ("kind", Some (`String "unresolved"));
          ("time_zone", Option.map Json.of_string case.time_zone);
          ("value", Some (Json.of_string case.value));
        ]
  | Unknown json -> json

let make_invitation_date_time_date ~(value : string) () =
  (Date { value } : invitation_date_time)

let make_invitation_date_time_zoned ~(time_zone : string) ~(value : string) () =
  (Zoned { time_zone; value } : invitation_date_time)

let make_invitation_date_time_unresolved ?time_zone ~(value : string) () =
  (Unresolved { time_zone; value } : invitation_date_time)

(** Original scheduling method, including methods unsupported for actions. *)
type nonrec invitation_method =
  | Request
  | Reply
  | Cancel
  | Counter
  | Publish
  | Unknown_
  | Unknown of string  (** A value this SDK version does not know. *)

let invitation_method_of_yojson : Yojson.Safe.t -> invitation_method =
 fun json ->
  match Json.string json with
  | "request" -> Request
  | "reply" -> Reply
  | "cancel" -> Cancel
  | "counter" -> Counter
  | "publish" -> Publish
  | "unknown" -> Unknown_
  | other -> Json.unknown "invitation_method" json (Unknown other)

and yojson_of_invitation_method : invitation_method -> Yojson.Safe.t =
 fun value ->
  match value with
  | Request -> `String "request"
  | Reply -> `String "reply"
  | Cancel -> `String "cancel"
  | Counter -> `String "counter"
  | Publish -> `String "publish"
  | Unknown_ -> `String "unknown"
  | Unknown other -> `String other

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

let calendar_invitation_of_yojson : Yojson.Safe.t -> calendar_invitation =
 fun json ->
  let fields = Json.obj json in
  {
    attendees =
      Json.required fields "attendees"
        (Json.list invitation_participant_of_yojson);
    comment = Json.optional fields "comment" Json.string;
    conference_url = Json.optional fields "conference_url" Json.string;
    description = Json.optional fields "description" Json.string;
    dtstamp = Json.optional fields "dtstamp" Json.string;
    end_ = Json.optional fields "end" invitation_date_time_of_yojson;
    id = Json.required fields "id" Json.string;
    last_modified = Json.optional fields "last_modified" Json.string;
    location = Json.optional fields "location" Json.string;
    method_ = Json.required fields "method" invitation_method_of_yojson;
    organizer =
      Json.optional fields "organizer" invitation_participant_of_yojson;
    recurrence = Json.optional fields "recurrence" (Json.list Json.string);
    recurrence_id =
      Json.optional fields "recurrence_id" invitation_date_time_of_yojson;
    recurrence_id_raw = Json.optional fields "recurrence_id_raw" Json.string;
    sequence = Json.required fields "sequence" Json.int;
    start = Json.optional fields "start" invitation_date_time_of_yojson;
    status = Json.optional fields "status" Json.string;
    title = Json.optional fields "title" Json.string;
    uid = Json.required fields "uid" Json.string;
  }

and yojson_of_calendar_invitation : calendar_invitation -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attendees",
        Some ((Json.of_list yojson_of_invitation_participant) value.attendees)
      );
      ("comment", Option.map Json.of_string value.comment);
      ("conference_url", Option.map Json.of_string value.conference_url);
      ("description", Option.map Json.of_string value.description);
      ("dtstamp", Option.map Json.of_string value.dtstamp);
      ("end", Option.map yojson_of_invitation_date_time value.end_);
      ("id", Some (Json.of_string value.id));
      ("last_modified", Option.map Json.of_string value.last_modified);
      ("location", Option.map Json.of_string value.location);
      ("method", Some (yojson_of_invitation_method value.method_));
      ("organizer", Option.map yojson_of_invitation_participant value.organizer);
      ("recurrence", Option.map (Json.of_list Json.of_string) value.recurrence);
      ( "recurrence_id",
        Option.map yojson_of_invitation_date_time value.recurrence_id );
      ("recurrence_id_raw", Option.map Json.of_string value.recurrence_id_raw);
      ("sequence", Some (Json.of_int value.sequence));
      ("start", Option.map yojson_of_invitation_date_time value.start);
      ("status", Option.map Json.of_string value.status);
      ("title", Option.map Json.of_string value.title);
      ("uid", Some (Json.of_string value.uid));
    ]

let make_calendar_invitation ~(attendees : invitation_participant list) ?comment
    ?conference_url ?description ?dtstamp ?end_ ~(id : string) ?last_modified
    ?location ~(method_ : invitation_method) ?organizer ?recurrence
    ?recurrence_id ?recurrence_id_raw ~(sequence : int) ?start ?status ?title
    ~(uid : string) () =
  ({
     attendees;
     comment;
     conference_url;
     description;
     dtstamp;
     end_;
     id;
     last_modified;
     location;
     method_;
     organizer;
     recurrence;
     recurrence_id;
     recurrence_id_raw;
     sequence;
     start;
     status;
     title;
     uid;
   }
    : calendar_invitation)

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

let api_message_label_of_yojson : Yojson.Safe.t -> api_message_label =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    id = Json.optional fields "id" Json.string;
    label_list_visibility =
      Json.optional fields "label_list_visibility"
        api_label_list_visibility_of_yojson;
    link_id = Json.required fields "link_id" Json.string;
    message_list_visibility =
      Json.optional fields "message_list_visibility"
        api_message_list_visibility_of_yojson;
    name = Json.optional fields "name" Json.string;
    provider_label_id = Json.required fields "provider_label_id" Json.string;
    type_ = Json.optional fields "type_" api_label_type_of_yojson;
  }

and yojson_of_api_message_label : api_message_label -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("id", Option.map Json.of_string value.id);
      ( "label_list_visibility",
        Option.map yojson_of_api_label_list_visibility
          value.label_list_visibility );
      ("link_id", Some (Json.of_string value.link_id));
      ( "message_list_visibility",
        Option.map yojson_of_api_message_list_visibility
          value.message_list_visibility );
      ("name", Option.map Json.of_string value.name);
      ("provider_label_id", Some (Json.of_string value.provider_label_id));
      ("type_", Option.map yojson_of_api_label_type value.type_);
    ]

let make_api_message_label ~(created_at : string) ?id ?label_list_visibility
    ~(link_id : string) ?message_list_visibility ?name
    ~(provider_label_id : string) ?type_ () =
  ({
     created_at;
     id;
     label_list_visibility;
     link_id;
     message_list_visibility;
     name;
     provider_label_id;
     type_;
   }
    : api_message_label)

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

let api_message_operation_issue_of_yojson :
    Yojson.Safe.t -> api_message_operation_issue =
 fun json ->
  match Json.string json with
  | "ACCEPTING_REMOTE" -> Accepting_remote
  | "DRAFT_CONFLICT" -> Draft_conflict
  | "CREATION_UNKNOWN" -> Creation_unknown
  | "ATTACHMENT_UNKNOWN" -> Attachment_unknown
  | "SEND_UNKNOWN" -> Send_unknown
  | "SEND_REJECTED" -> Send_rejected
  | "ACCESS_REVOKED" -> Access_revoked
  | "INVALID_CONTENT" -> Invalid_content
  | "MOVE_PENDING" -> Move_pending
  | "MOVE_CONFLICT" -> Move_conflict
  | "MOVE_SOURCE_SENT" -> Move_source_sent
  | "MOVE_REAUTHORIZATION" -> Move_reauthorization
  | "MOVE_ORIGINAL_REMAINS" -> Move_original_remains
  | other -> Json.unknown "api_message_operation_issue" json (Unknown other)

and yojson_of_api_message_operation_issue :
    api_message_operation_issue -> Yojson.Safe.t =
 fun value ->
  match value with
  | Accepting_remote -> `String "ACCEPTING_REMOTE"
  | Draft_conflict -> `String "DRAFT_CONFLICT"
  | Creation_unknown -> `String "CREATION_UNKNOWN"
  | Attachment_unknown -> `String "ATTACHMENT_UNKNOWN"
  | Send_unknown -> `String "SEND_UNKNOWN"
  | Send_rejected -> `String "SEND_REJECTED"
  | Access_revoked -> `String "ACCESS_REVOKED"
  | Invalid_content -> `String "INVALID_CONTENT"
  | Move_pending -> `String "MOVE_PENDING"
  | Move_conflict -> `String "MOVE_CONFLICT"
  | Move_source_sent -> `String "MOVE_SOURCE_SENT"
  | Move_reauthorization -> `String "MOVE_REAUTHORIZATION"
  | Move_original_remains -> `String "MOVE_ORIGINAL_REMAINS"
  | Unknown other -> `String other

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

let api_message_operation_state_of_yojson :
    Yojson.Safe.t -> api_message_operation_state =
 fun json ->
  match Json.string json with
  | "PENDING" -> Pending
  | "SYNCHRONIZED" -> Synchronized
  | "CONFLICT" -> Conflict
  | "UNCERTAIN" -> Uncertain
  | "SUBMITTING" -> Submitting
  | "CONFIRMING" -> Confirming
  | "SENT" -> Sent
  | "DELETED" -> Deleted
  | "CANCELLED" -> Cancelled
  | "FAILED" -> Failed
  | other -> Json.unknown "api_message_operation_state" json (Unknown other)

and yojson_of_api_message_operation_state :
    api_message_operation_state -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pending -> `String "PENDING"
  | Synchronized -> `String "SYNCHRONIZED"
  | Conflict -> `String "CONFLICT"
  | Uncertain -> `String "UNCERTAIN"
  | Submitting -> `String "SUBMITTING"
  | Confirming -> `String "CONFIRMING"
  | Sent -> `String "SENT"
  | Deleted -> `String "DELETED"
  | Cancelled -> `String "CANCELLED"
  | Failed -> `String "FAILED"
  | Unknown other -> `String other

type nonrec api_message_operation = {
  issue : api_message_operation_issue option;
  remote_version : string option;
  revision : string;
  state : api_message_operation_state;
}
(** Versions are opaque decimal strings so clients never truncate an i64. *)

let api_message_operation_of_yojson : Yojson.Safe.t -> api_message_operation =
 fun json ->
  let fields = Json.obj json in
  {
    issue = Json.optional fields "issue" api_message_operation_issue_of_yojson;
    remote_version = Json.optional fields "remote_version" Json.string;
    revision = Json.required fields "revision" Json.string;
    state = Json.required fields "state" api_message_operation_state_of_yojson;
  }

and yojson_of_api_message_operation : api_message_operation -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("issue", Option.map yojson_of_api_message_operation_issue value.issue);
      ("remote_version", Option.map Json.of_string value.remote_version);
      ("revision", Some (Json.of_string value.revision));
      ("state", Some (yojson_of_api_message_operation_state value.state));
    ]

let make_api_message_operation ?issue ?remote_version ~(revision : string)
    ~(state : api_message_operation_state) () =
  ({ issue; remote_version; revision; state } : api_message_operation)

(** The user-visible delivery state of an unsent scheduled message. *)
type nonrec scheduled_send_status =
  | Pending
  | Sending
  | Failed
  | Unconfirmed
  | Unknown of string  (** A value this SDK version does not know. *)

let scheduled_send_status_of_yojson : Yojson.Safe.t -> scheduled_send_status =
 fun json ->
  match Json.string json with
  | "pending" -> Pending
  | "sending" -> Sending
  | "failed" -> Failed
  | "unconfirmed" -> Unconfirmed
  | other -> Json.unknown "scheduled_send_status" json (Unknown other)

and yojson_of_scheduled_send_status : scheduled_send_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pending -> `String "pending"
  | Sending -> `String "sending"
  | Failed -> `String "failed"
  | Unconfirmed -> `String "unconfirmed"
  | Unknown other -> `String other

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

let api_message_of_yojson : Yojson.Safe.t -> api_message =
 fun json ->
  let fields = Json.obj json in
  {
    attachments =
      Json.required fields "attachments"
        (Json.list api_message_attachment_of_yojson);
    attachments_draft =
      Json.required fields "attachments_draft"
        (Json.list api_attachment_draft_of_yojson);
    attachments_forwarded =
      Json.required fields "attachments_forwarded"
        (Json.list api_attachment_forwarded_of_yojson);
    bcc = Json.required fields "bcc" (Json.list api_contact_info_of_yojson);
    body_html_sanitized = Json.optional fields "body_html_sanitized" Json.string;
    body_macro = Json.optional fields "body_macro" Json.string;
    body_replyless = Json.optional fields "body_replyless" Json.string;
    body_text = Json.optional fields "body_text" Json.string;
    calendar_invitations =
      Json.optional fields "calendar_invitations"
        (Json.list calendar_invitation_of_yojson);
    cc = Json.required fields "cc" (Json.list api_contact_info_of_yojson);
    created_at = Json.required fields "created_at" Json.string;
    db_id = Json.required fields "db_id" Json.string;
    draft_generation = Json.required fields "draft_generation" Json.int;
    from = Json.optional fields "from" api_contact_info_of_yojson;
    global_id = Json.optional fields "global_id" Json.string;
    has_attachments = Json.required fields "has_attachments" Json.bool;
    headers_json = Json.optional fields "headers_json" Json.json;
    internal_date_ts = Json.optional fields "internal_date_ts" Json.string;
    is_draft = Json.required fields "is_draft" Json.bool;
    is_read = Json.required fields "is_read" Json.bool;
    is_sent = Json.required fields "is_sent" Json.bool;
    is_starred = Json.required fields "is_starred" Json.bool;
    labels =
      Json.required fields "labels" (Json.list api_message_label_of_yojson);
    link_id = Json.required fields "link_id" Json.string;
    operation_status =
      Json.optional fields "operation_status" api_message_operation_of_yojson;
    provider_history_id = Json.optional fields "provider_history_id" Json.string;
    provider_id = Json.optional fields "provider_id" Json.string;
    provider_thread_id = Json.optional fields "provider_thread_id" Json.string;
    replying_to_id = Json.optional fields "replying_to_id" Json.string;
    scheduled_send_status =
      Json.optional fields "scheduled_send_status"
        scheduled_send_status_of_yojson;
    scheduled_send_time = Json.optional fields "scheduled_send_time" Json.string;
    sent_at = Json.optional fields "sent_at" Json.string;
    size_estimate = Json.optional fields "size_estimate" Json.int64;
    snippet = Json.optional fields "snippet" Json.string;
    subject = Json.optional fields "subject" Json.string;
    thread_db_id = Json.required fields "thread_db_id" Json.string;
    to_ = Json.required fields "to" (Json.list api_contact_info_of_yojson);
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_api_message : api_message -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attachments",
        Some ((Json.of_list yojson_of_api_message_attachment) value.attachments)
      );
      ( "attachments_draft",
        Some
          ((Json.of_list yojson_of_api_attachment_draft)
             value.attachments_draft) );
      ( "attachments_forwarded",
        Some
          ((Json.of_list yojson_of_api_attachment_forwarded)
             value.attachments_forwarded) );
      ("bcc", Some ((Json.of_list yojson_of_api_contact_info) value.bcc));
      ( "body_html_sanitized",
        Option.map Json.of_string value.body_html_sanitized );
      ("body_macro", Option.map Json.of_string value.body_macro);
      ("body_replyless", Option.map Json.of_string value.body_replyless);
      ("body_text", Option.map Json.of_string value.body_text);
      ( "calendar_invitations",
        Option.map
          (Json.of_list yojson_of_calendar_invitation)
          value.calendar_invitations );
      ("cc", Some ((Json.of_list yojson_of_api_contact_info) value.cc));
      ("created_at", Some (Json.of_string value.created_at));
      ("db_id", Some (Json.of_string value.db_id));
      ("draft_generation", Some (Json.of_int value.draft_generation));
      ("from", Option.map yojson_of_api_contact_info value.from);
      ("global_id", Option.map Json.of_string value.global_id);
      ("has_attachments", Some (Json.of_bool value.has_attachments));
      ("headers_json", Option.map Json.of_json value.headers_json);
      ("internal_date_ts", Option.map Json.of_string value.internal_date_ts);
      ("is_draft", Some (Json.of_bool value.is_draft));
      ("is_read", Some (Json.of_bool value.is_read));
      ("is_sent", Some (Json.of_bool value.is_sent));
      ("is_starred", Some (Json.of_bool value.is_starred));
      ("labels", Some ((Json.of_list yojson_of_api_message_label) value.labels));
      ("link_id", Some (Json.of_string value.link_id));
      ( "operation_status",
        Option.map yojson_of_api_message_operation value.operation_status );
      ( "provider_history_id",
        Option.map Json.of_string value.provider_history_id );
      ("provider_id", Option.map Json.of_string value.provider_id);
      ("provider_thread_id", Option.map Json.of_string value.provider_thread_id);
      ("replying_to_id", Option.map Json.of_string value.replying_to_id);
      ( "scheduled_send_status",
        Option.map yojson_of_scheduled_send_status value.scheduled_send_status
      );
      ( "scheduled_send_time",
        Option.map Json.of_string value.scheduled_send_time );
      ("sent_at", Option.map Json.of_string value.sent_at);
      ("size_estimate", Option.map Json.of_int64 value.size_estimate);
      ("snippet", Option.map Json.of_string value.snippet);
      ("subject", Option.map Json.of_string value.subject);
      ("thread_db_id", Some (Json.of_string value.thread_db_id));
      ("to", Some ((Json.of_list yojson_of_api_contact_info) value.to_));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_api_message ~(attachments : api_message_attachment list)
    ~(attachments_draft : api_attachment_draft list)
    ~(attachments_forwarded : api_attachment_forwarded list)
    ~(bcc : api_contact_info list) ?body_html_sanitized ?body_macro
    ?body_replyless ?body_text ?calendar_invitations
    ~(cc : api_contact_info list) ~(created_at : string) ~(db_id : string)
    ~(draft_generation : int) ?from ?global_id ~(has_attachments : bool)
    ?headers_json ?internal_date_ts ~(is_draft : bool) ~(is_read : bool)
    ~(is_sent : bool) ~(is_starred : bool) ~(labels : api_message_label list)
    ~(link_id : string) ?operation_status ?provider_history_id ?provider_id
    ?provider_thread_id ?replying_to_id ?scheduled_send_status
    ?scheduled_send_time ?sent_at ?size_estimate ?snippet ?subject
    ~(thread_db_id : string) ~(to_ : api_contact_info list)
    ~(updated_at : string) () =
  ({
     attachments;
     attachments_draft;
     attachments_forwarded;
     bcc;
     body_html_sanitized;
     body_macro;
     body_replyless;
     body_text;
     calendar_invitations;
     cc;
     created_at;
     db_id;
     draft_generation;
     from;
     global_id;
     has_attachments;
     headers_json;
     internal_date_ts;
     is_draft;
     is_read;
     is_sent;
     is_starred;
     labels;
     link_id;
     operation_status;
     provider_history_id;
     provider_id;
     provider_thread_id;
     replying_to_id;
     scheduled_send_status;
     scheduled_send_time;
     sent_at;
     size_estimate;
     snippet;
     subject;
     thread_db_id;
     to_;
     updated_at;
   }
    : api_message)

(** A deliberate resolution of a particular observed operation version. *)
type nonrec api_message_resolution_action =
  | Keep_local
  | Use_provider
  | Recheck
  | Retry_send
  | Keep_original
  | Unknown of string  (** A value this SDK version does not know. *)

let api_message_resolution_action_of_yojson :
    Yojson.Safe.t -> api_message_resolution_action =
 fun json ->
  match Json.string json with
  | "keep_local" -> Keep_local
  | "use_provider" -> Use_provider
  | "recheck" -> Recheck
  | "retry_send" -> Retry_send
  | "keep_original" -> Keep_original
  | other -> Json.unknown "api_message_resolution_action" json (Unknown other)

and yojson_of_api_message_resolution_action :
    api_message_resolution_action -> Yojson.Safe.t =
 fun value ->
  match value with
  | Keep_local -> `String "keep_local"
  | Use_provider -> `String "use_provider"
  | Recheck -> `String "recheck"
  | Retry_send -> `String "retry_send"
  | Keep_original -> `String "keep_original"
  | Unknown other -> `String other

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

let api_thread_preview_cursor_of_yojson :
    Yojson.Safe.t -> api_thread_preview_cursor =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    inbox_visible = Json.required fields "inboxVisible" Json.bool;
    is_draft = Json.required fields "isDraft" Json.bool;
    is_important = Json.required fields "isImportant" Json.bool;
    is_read = Json.required fields "isRead" Json.bool;
    link_id = Json.required fields "linkId" Json.string;
    name = Json.optional fields "name" Json.string;
    owner_id = Json.required fields "ownerId" Json.string;
    provider_id = Json.optional fields "providerId" Json.string;
    sender_email = Json.optional fields "senderEmail" Json.string;
    sender_name = Json.optional fields "senderName" Json.string;
    sender_photo_url = Json.optional fields "senderPhotoUrl" Json.string;
    snippet = Json.optional fields "snippet" Json.string;
    sort_ts = Json.required fields "sortTs" Json.string;
    updated_at = Json.required fields "updatedAt" Json.string;
    viewed_at = Json.optional fields "viewedAt" Json.string;
    attachments =
      Json.required fields "attachments" (Json.list api_attachment_of_yojson);
    contacts = Json.required fields "contacts" (Json.list api_contact_of_yojson);
    frecency_score = Json.optional fields "frecencyScore" Json.float;
    labels = Json.required fields "labels" (Json.list api_label_of_yojson);
  }

and yojson_of_api_thread_preview_cursor :
    api_thread_preview_cursor -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("inboxVisible", Some (Json.of_bool value.inbox_visible));
      ("isDraft", Some (Json.of_bool value.is_draft));
      ("isImportant", Some (Json.of_bool value.is_important));
      ("isRead", Some (Json.of_bool value.is_read));
      ("linkId", Some (Json.of_string value.link_id));
      ("name", Option.map Json.of_string value.name);
      ("ownerId", Some (Json.of_string value.owner_id));
      ("providerId", Option.map Json.of_string value.provider_id);
      ("senderEmail", Option.map Json.of_string value.sender_email);
      ("senderName", Option.map Json.of_string value.sender_name);
      ("senderPhotoUrl", Option.map Json.of_string value.sender_photo_url);
      ("snippet", Option.map Json.of_string value.snippet);
      ("sortTs", Some (Json.of_string value.sort_ts));
      ("updatedAt", Some (Json.of_string value.updated_at));
      ("viewedAt", Option.map Json.of_string value.viewed_at);
      ( "attachments",
        Some ((Json.of_list yojson_of_api_attachment) value.attachments) );
      ("contacts", Some ((Json.of_list yojson_of_api_contact) value.contacts));
      ("frecencyScore", Option.map Json.of_float value.frecency_score);
      ("labels", Some ((Json.of_list yojson_of_api_label) value.labels));
    ]

let make_api_thread_preview_cursor ~(created_at : string) ~(id : string)
    ~(inbox_visible : bool) ~(is_draft : bool) ~(is_important : bool)
    ~(is_read : bool) ~(link_id : string) ?name ~(owner_id : string)
    ?provider_id ?sender_email ?sender_name ?sender_photo_url ?snippet
    ~(sort_ts : string) ~(updated_at : string) ?viewed_at
    ~(attachments : api_attachment list) ~(contacts : api_contact list)
    ?frecency_score ~(labels : api_label list) () =
  ({
     created_at;
     id;
     inbox_visible;
     is_draft;
     is_important;
     is_read;
     link_id;
     name;
     owner_id;
     provider_id;
     sender_email;
     sender_name;
     sender_photo_url;
     snippet;
     sort_ts;
     updated_at;
     viewed_at;
     attachments;
     contacts;
     frecency_score;
     labels;
   }
    : api_thread_preview_cursor)

type nonrec api_paginated_thread_cursor = {
  items : api_thread_preview_cursor list;
  next_cursor : string option;
}

let api_paginated_thread_cursor_of_yojson :
    Yojson.Safe.t -> api_paginated_thread_cursor =
 fun json ->
  let fields = Json.obj json in
  {
    items =
      Json.required fields "items"
        (Json.list api_thread_preview_cursor_of_yojson);
    next_cursor = Json.optional fields "next_cursor" Json.string;
  }

and yojson_of_api_paginated_thread_cursor :
    api_paginated_thread_cursor -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "items",
        Some ((Json.of_list yojson_of_api_thread_preview_cursor) value.items) );
      ("next_cursor", Option.map Json.of_string value.next_cursor);
    ]

let make_api_paginated_thread_cursor ~(items : api_thread_preview_cursor list)
    ?next_cursor () =
  ({ items; next_cursor } : api_paginated_thread_cursor)

(** common types of sorts based on timestamps *)
type nonrec api_sort_method =
  | Viewed_at
  | Updated_at
  | Created_at
  | Viewed_updated
  | Unknown of string  (** A value this SDK version does not know. *)

let api_sort_method_of_yojson : Yojson.Safe.t -> api_sort_method =
 fun json ->
  match Json.string json with
  | "viewed_at" -> Viewed_at
  | "updated_at" -> Updated_at
  | "created_at" -> Created_at
  | "viewed_updated" -> Viewed_updated
  | other -> Json.unknown "api_sort_method" json (Unknown other)

and yojson_of_api_sort_method : api_sort_method -> Yojson.Safe.t =
 fun value ->
  match value with
  | Viewed_at -> `String "viewed_at"
  | Updated_at -> `String "updated_at"
  | Created_at -> `String "created_at"
  | Viewed_updated -> `String "viewed_updated"
  | Unknown other -> `String other

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

let api_thread_of_yojson : Yojson.Safe.t -> api_thread =
 fun json ->
  let fields = Json.obj json in
  {
    access_level = Json.required fields "access_level" access_level_of_yojson;
    created_at = Json.required fields "created_at" Json.string;
    db_id = Json.required fields "db_id" Json.string;
    has_received_mail = Json.required fields "has_received_mail" Json.bool;
    inbox_visible = Json.required fields "inbox_visible" Json.bool;
    is_read = Json.required fields "is_read" Json.bool;
    latest_inbound_message_ts =
      Json.optional fields "latest_inbound_message_ts" Json.string;
    latest_non_spam_message_ts =
      Json.optional fields "latest_non_spam_message_ts" Json.string;
    latest_outbound_message_ts =
      Json.optional fields "latest_outbound_message_ts" Json.string;
    link_id = Json.required fields "link_id" Json.string;
    messages = Json.required fields "messages" (Json.list api_message_of_yojson);
    project_id = Json.optional fields "project_id" Json.string;
    provider_id = Json.optional fields "provider_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_api_thread : api_thread -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("access_level", Some (yojson_of_access_level value.access_level));
      ("created_at", Some (Json.of_string value.created_at));
      ("db_id", Some (Json.of_string value.db_id));
      ("has_received_mail", Some (Json.of_bool value.has_received_mail));
      ("inbox_visible", Some (Json.of_bool value.inbox_visible));
      ("is_read", Some (Json.of_bool value.is_read));
      ( "latest_inbound_message_ts",
        Option.map Json.of_string value.latest_inbound_message_ts );
      ( "latest_non_spam_message_ts",
        Option.map Json.of_string value.latest_non_spam_message_ts );
      ( "latest_outbound_message_ts",
        Option.map Json.of_string value.latest_outbound_message_ts );
      ("link_id", Some (Json.of_string value.link_id));
      ("messages", Some ((Json.of_list yojson_of_api_message) value.messages));
      ("project_id", Option.map Json.of_string value.project_id);
      ("provider_id", Option.map Json.of_string value.provider_id);
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_api_thread ~(access_level : access_level) ~(created_at : string)
    ~(db_id : string) ~(has_received_mail : bool) ~(inbox_visible : bool)
    ~(is_read : bool) ?latest_inbound_message_ts ?latest_non_spam_message_ts
    ?latest_outbound_message_ts ~(link_id : string)
    ~(messages : api_message list) ?project_id ?provider_id
    ~(updated_at : string) () =
  ({
     access_level;
     created_at;
     db_id;
     has_received_mail;
     inbox_visible;
     is_read;
     latest_inbound_message_ts;
     latest_non_spam_message_ts;
     latest_outbound_message_ts;
     link_id;
     messages;
     project_id;
     provider_id;
     updated_at;
   }
    : api_thread)

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

let api_thread_preview_cursor_inner_of_yojson :
    Yojson.Safe.t -> api_thread_preview_cursor_inner =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    inbox_visible = Json.required fields "inboxVisible" Json.bool;
    is_draft = Json.required fields "isDraft" Json.bool;
    is_important = Json.required fields "isImportant" Json.bool;
    is_read = Json.required fields "isRead" Json.bool;
    link_id = Json.required fields "linkId" Json.string;
    name = Json.optional fields "name" Json.string;
    owner_id = Json.required fields "ownerId" Json.string;
    provider_id = Json.optional fields "providerId" Json.string;
    sender_email = Json.optional fields "senderEmail" Json.string;
    sender_name = Json.optional fields "senderName" Json.string;
    sender_photo_url = Json.optional fields "senderPhotoUrl" Json.string;
    snippet = Json.optional fields "snippet" Json.string;
    sort_ts = Json.required fields "sortTs" Json.string;
    updated_at = Json.required fields "updatedAt" Json.string;
    viewed_at = Json.optional fields "viewedAt" Json.string;
  }

and yojson_of_api_thread_preview_cursor_inner :
    api_thread_preview_cursor_inner -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("inboxVisible", Some (Json.of_bool value.inbox_visible));
      ("isDraft", Some (Json.of_bool value.is_draft));
      ("isImportant", Some (Json.of_bool value.is_important));
      ("isRead", Some (Json.of_bool value.is_read));
      ("linkId", Some (Json.of_string value.link_id));
      ("name", Option.map Json.of_string value.name);
      ("ownerId", Some (Json.of_string value.owner_id));
      ("providerId", Option.map Json.of_string value.provider_id);
      ("senderEmail", Option.map Json.of_string value.sender_email);
      ("senderName", Option.map Json.of_string value.sender_name);
      ("senderPhotoUrl", Option.map Json.of_string value.sender_photo_url);
      ("snippet", Option.map Json.of_string value.snippet);
      ("sortTs", Some (Json.of_string value.sort_ts));
      ("updatedAt", Some (Json.of_string value.updated_at));
      ("viewedAt", Option.map Json.of_string value.viewed_at);
    ]

let make_api_thread_preview_cursor_inner ~(created_at : string) ~(id : string)
    ~(inbox_visible : bool) ~(is_draft : bool) ~(is_important : bool)
    ~(is_read : bool) ~(link_id : string) ?name ~(owner_id : string)
    ?provider_id ?sender_email ?sender_name ?sender_photo_url ?snippet
    ~(sort_ts : string) ~(updated_at : string) ?viewed_at () =
  ({
     created_at;
     id;
     inbox_visible;
     is_draft;
     is_important;
     is_read;
     link_id;
     name;
     owner_id;
     provider_id;
     sender_email;
     sender_name;
     sender_photo_url;
     snippet;
     sort_ts;
     updated_at;
     viewed_at;
   }
    : api_thread_preview_cursor_inner)

type nonrec archive_thread_request = { value : bool }

let archive_thread_request_of_yojson : Yojson.Safe.t -> archive_thread_request =
 fun json ->
  let fields = Json.obj json in
  { value = Json.required fields "value" Json.bool }

and yojson_of_archive_thread_request : archive_thread_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("value", Some (Json.of_bool value.value)) ]

let make_archive_thread_request ~(value : bool) () =
  ({ value } : archive_thread_request)

type nonrec archive_threads_request = { thread_ids : string list; value : bool }

let archive_threads_request_of_yojson : Yojson.Safe.t -> archive_threads_request
    =
 fun json ->
  let fields = Json.obj json in
  {
    thread_ids = Json.required fields "thread_ids" (Json.list Json.string);
    value = Json.required fields "value" Json.bool;
  }

and yojson_of_archive_threads_request : archive_threads_request -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("thread_ids", Some ((Json.of_list Json.of_string) value.thread_ids));
      ("value", Some (Json.of_bool value.value));
    ]

let make_archive_threads_request ~(thread_ids : string list) ~(value : bool) ()
    =
  ({ thread_ids; value } : archive_threads_request)

type nonrec archive_threads_response = {
  failed_thread_ids : string list;
      (** Threads left unchanged because they could not be updated. *)
  updated_thread_ids : string list;
      (** Threads whose archived status now matches the request. *)
}

let archive_threads_response_of_yojson :
    Yojson.Safe.t -> archive_threads_response =
 fun json ->
  let fields = Json.obj json in
  {
    failed_thread_ids =
      Json.required fields "failed_thread_ids" (Json.list Json.string);
    updated_thread_ids =
      Json.required fields "updated_thread_ids" (Json.list Json.string);
  }

and yojson_of_archive_threads_response :
    archive_threads_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "failed_thread_ids",
        Some ((Json.of_list Json.of_string) value.failed_thread_ids) );
      ( "updated_thread_ids",
        Some ((Json.of_list Json.of_string) value.updated_thread_ids) );
    ]

let make_archive_threads_response ~(failed_thread_ids : string list)
    ~(updated_thread_ids : string list) () =
  ({ failed_thread_ids; updated_thread_ids } : archive_threads_response)

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

let attachment_of_yojson : Yojson.Safe.t -> attachment =
 fun json ->
  let fields = Json.obj json in
  {
    content_id = Json.optional fields "content_id" Json.string;
    data_url = Json.optional fields "data_url" Json.string;
    db_id = Json.required fields "db_id" Json.string;
    filename = Json.optional fields "filename" Json.string;
    mime_type = Json.optional fields "mime_type" Json.string;
    provider_id = Json.optional fields "provider_id" Json.string;
    reference_url = Json.optional fields "reference_url" Json.string;
    sfs_id = Json.optional fields "sfs_id" Json.string;
    size_bytes = Json.optional fields "size_bytes" Json.int64;
  }

and yojson_of_attachment : attachment -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content_id", Option.map Json.of_string value.content_id);
      ("data_url", Option.map Json.of_string value.data_url);
      ("db_id", Some (Json.of_string value.db_id));
      ("filename", Option.map Json.of_string value.filename);
      ("mime_type", Option.map Json.of_string value.mime_type);
      ("provider_id", Option.map Json.of_string value.provider_id);
      ("reference_url", Option.map Json.of_string value.reference_url);
      ("sfs_id", Option.map Json.of_string value.sfs_id);
      ("size_bytes", Option.map Json.of_int64 value.size_bytes);
    ]

let make_attachment ?content_id ?data_url ~(db_id : string) ?filename ?mime_type
    ?provider_id ?reference_url ?sfs_id ?size_bytes () =
  ({
     content_id;
     data_url;
     db_id;
     filename;
     mime_type;
     provider_id;
     reference_url;
     sfs_id;
     size_bytes;
   }
    : attachment)

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

let attachment_draft_of_yojson : Yojson.Safe.t -> attachment_draft =
 fun json ->
  let fields = Json.obj json in
  {
    content_id = Json.optional fields "content_id" Json.string;
    content_type = Json.required fields "content_type" Json.string;
    draft_id = Json.required fields "draft_id" Json.string;
    file_name = Json.required fields "file_name" Json.string;
    id = Json.required fields "id" Json.string;
    is_inline = Json.optional fields "is_inline" Json.bool;
    s3_key = Json.required fields "s3_key" Json.string;
    sha = Json.required fields "sha" Json.string;
    size = Json.required fields "size" Json.int;
    upload_pending = Json.optional fields "upload_pending" Json.bool;
  }

and yojson_of_attachment_draft : attachment_draft -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content_id", Option.map Json.of_string value.content_id);
      ("content_type", Some (Json.of_string value.content_type));
      ("draft_id", Some (Json.of_string value.draft_id));
      ("file_name", Some (Json.of_string value.file_name));
      ("id", Some (Json.of_string value.id));
      ("is_inline", Option.map Json.of_bool value.is_inline);
      ("s3_key", Some (Json.of_string value.s3_key));
      ("sha", Some (Json.of_string value.sha));
      ("size", Some (Json.of_int value.size));
      ("upload_pending", Option.map Json.of_bool value.upload_pending);
    ]

let make_attachment_draft ?content_id ~(content_type : string)
    ~(draft_id : string) ~(file_name : string) ~(id : string) ?is_inline
    ~(s3_key : string) ~(sha : string) ~(size : int) ?upload_pending () =
  ({
     content_id;
     content_type;
     draft_id;
     file_name;
     id;
     is_inline;
     s3_key;
     sha;
     size;
     upload_pending;
   }
    : attachment_draft)

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

let attachment_forwarded_of_yojson : Yojson.Safe.t -> attachment_forwarded =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_id = Json.required fields "attachment_id" Json.string;
    draft_id = Json.required fields "draft_id" Json.string;
    filename = Json.optional fields "filename" Json.string;
    message_provider_id = Json.required fields "message_provider_id" Json.string;
    mime_type = Json.optional fields "mime_type" Json.string;
    provider_attachment_id =
      Json.optional fields "provider_attachment_id" Json.string;
    size_bytes = Json.optional fields "size_bytes" Json.int64;
  }

and yojson_of_attachment_forwarded : attachment_forwarded -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachment_id", Some (Json.of_string value.attachment_id));
      ("draft_id", Some (Json.of_string value.draft_id));
      ("filename", Option.map Json.of_string value.filename);
      ("message_provider_id", Some (Json.of_string value.message_provider_id));
      ("mime_type", Option.map Json.of_string value.mime_type);
      ( "provider_attachment_id",
        Option.map Json.of_string value.provider_attachment_id );
      ("size_bytes", Option.map Json.of_int64 value.size_bytes);
    ]

let make_attachment_forwarded ~(attachment_id : string) ~(draft_id : string)
    ?filename ~(message_provider_id : string) ?mime_type ?provider_attachment_id
    ?size_bytes () =
  ({
     attachment_id;
     draft_id;
     filename;
     message_provider_id;
     mime_type;
     provider_attachment_id;
     size_bytes;
   }
    : attachment_forwarded)

(** RSVP state for an attendee. *)
type nonrec attendee_response_status =
  | Needs_action
  | Accepted
  | Declined
  | Tentative
  | Unknown of string  (** A value this SDK version does not know. *)

let attendee_response_status_of_yojson :
    Yojson.Safe.t -> attendee_response_status =
 fun json ->
  match Json.string json with
  | "needs_action" -> Needs_action
  | "accepted" -> Accepted
  | "declined" -> Declined
  | "tentative" -> Tentative
  | other -> Json.unknown "attendee_response_status" json (Unknown other)

and yojson_of_attendee_response_status :
    attendee_response_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Needs_action -> `String "needs_action"
  | Accepted -> `String "accepted"
  | Declined -> `String "declined"
  | Tentative -> `String "tentative"
  | Unknown other -> `String other

type nonrec backfill_job_status =
  | Init
  | In_progress
  | Complete
  | Cancelled
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let backfill_job_status_of_yojson : Yojson.Safe.t -> backfill_job_status =
 fun json ->
  match Json.string json with
  | "Init" -> Init
  | "InProgress" -> In_progress
  | "Complete" -> Complete
  | "Cancelled" -> Cancelled
  | "Failed" -> Failed
  | other -> Json.unknown "backfill_job_status" json (Unknown other)

and yojson_of_backfill_job_status : backfill_job_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Init -> `String "Init"
  | In_progress -> `String "InProgress"
  | Complete -> `String "Complete"
  | Cancelled -> `String "Cancelled"
  | Failed -> `String "Failed"
  | Unknown other -> `String other

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

let backfill_job_of_yojson : Yojson.Safe.t -> backfill_job =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    fusionauth_user_id = Json.required fields "fusionauth_user_id" Json.string;
    id = Json.required fields "id" Json.string;
    link_id = Json.optional fields "link_id" Json.string;
    status = Json.required fields "status" backfill_job_status_of_yojson;
    threads_requested_limit =
      Json.optional fields "threads_requested_limit" Json.int;
    threads_retrieved_count =
      Json.required fields "threads_retrieved_count" Json.int;
    total_threads = Json.required fields "total_threads" Json.int;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_backfill_job : backfill_job -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("fusionauth_user_id", Some (Json.of_string value.fusionauth_user_id));
      ("id", Some (Json.of_string value.id));
      ("link_id", Option.map Json.of_string value.link_id);
      ("status", Some (yojson_of_backfill_job_status value.status));
      ( "threads_requested_limit",
        Option.map Json.of_int value.threads_requested_limit );
      ( "threads_retrieved_count",
        Some (Json.of_int value.threads_retrieved_count) );
      ("total_threads", Some (Json.of_int value.total_threads));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_backfill_job ~(created_at : string) ~(fusionauth_user_id : string)
    ~(id : string) ?link_id ~(status : backfill_job_status)
    ?threads_requested_limit ~(threads_retrieved_count : int)
    ~(total_threads : int) ~(updated_at : string) () =
  ({
     created_at;
     fusionauth_user_id;
     id;
     link_id;
     status;
     threads_requested_limit;
     threads_retrieved_count;
     total_threads;
     updated_at;
   }
    : backfill_job)

(** Progress/terminal state of a backfill job for \[[RefreshEmailEvent::Backfill]\]. *)
type nonrec backfill_status =
  | Progress
  | Complete
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let backfill_status_of_yojson : Yojson.Safe.t -> backfill_status =
 fun json ->
  match Json.string json with
  | "progress" -> Progress
  | "complete" -> Complete
  | "failed" -> Failed
  | other -> Json.unknown "backfill_status" json (Unknown other)

and yojson_of_backfill_status : backfill_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Progress -> `String "progress"
  | Complete -> `String "complete"
  | Failed -> `String "failed"
  | Unknown other -> `String other

type nonrec block_sender_request = {
  email_address : string;  (** The email address of the sender to block. *)
}
(** Request to block a sender. *)

let block_sender_request_of_yojson : Yojson.Safe.t -> block_sender_request =
 fun json ->
  let fields = Json.obj json in
  { email_address = Json.required fields "email_address" Json.string }

and yojson_of_block_sender_request : block_sender_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("email_address", Some (Json.of_string value.email_address)) ]

let make_block_sender_request ~(email_address : string) () =
  ({ email_address } : block_sender_request)

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

let calendar_attendee_of_yojson : Yojson.Safe.t -> calendar_attendee =
 fun json ->
  let fields = Json.obj json in
  {
    comment = Json.optional fields "comment" Json.string;
    display_name = Json.optional fields "displayName" Json.string;
    email = Json.required fields "email" Json.string;
    is_optional = Json.required fields "isOptional" Json.bool;
    is_organizer = Json.required fields "isOrganizer" Json.bool;
    is_self = Json.required fields "isSelf" Json.bool;
    response_status =
      Json.required fields "responseStatus" attendee_response_status_of_yojson;
  }

and yojson_of_calendar_attendee : calendar_attendee -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("comment", Option.map Json.of_string value.comment);
      ("displayName", Option.map Json.of_string value.display_name);
      ("email", Some (Json.of_string value.email));
      ("isOptional", Some (Json.of_bool value.is_optional));
      ("isOrganizer", Some (Json.of_bool value.is_organizer));
      ("isSelf", Some (Json.of_bool value.is_self));
      ( "responseStatus",
        Some (yojson_of_attendee_response_status value.response_status) );
    ]

let make_calendar_attendee ?comment ?display_name ~(email : string)
    ~(is_optional : bool) ~(is_organizer : bool) ~(is_self : bool)
    ~(response_status : attendee_response_status) () =
  ({
     comment;
     display_name;
     email;
     is_optional;
     is_organizer;
     is_self;
     response_status;
   }
    : calendar_attendee)

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

let conference_provider_of_yojson : Yojson.Safe.t -> conference_provider =
 fun json ->
  match Json.string json with
  | "microsoft_teams" -> Microsoft_teams
  | "google_meet" -> Google_meet
  | "other" -> Other
  | other -> Json.unknown "conference_provider" json (Unknown other)

and yojson_of_conference_provider : conference_provider -> Yojson.Safe.t =
 fun value ->
  match value with
  | Microsoft_teams -> `String "microsoft_teams"
  | Google_meet -> `String "google_meet"
  | Other -> `String "other"
  | Unknown other -> `String other

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

let event_type_of_yojson : Yojson.Safe.t -> event_type =
 fun json ->
  match Json.string json with
  | "default" -> Default
  | "out_of_office" -> Out_of_office
  | "focus_time" -> Focus_time
  | "working_location" -> Working_location
  | "birthday" -> Birthday
  | "from_gmail" -> From_gmail
  | other -> Json.unknown "event_type" json (Unknown other)

and yojson_of_event_type : event_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Default -> `String "default"
  | Out_of_office -> `String "out_of_office"
  | Focus_time -> `String "focus_time"
  | Working_location -> `String "working_location"
  | Birthday -> `String "birthday"
  | From_gmail -> `String "from_gmail"
  | Unknown other -> `String other

type nonrec guest_policy = {
  can_invite_others : bool;  (** Whether guests may invite others. *)
  can_modify : bool;
      (** Whether guests may change the event, including its guest list. *)
  can_see_other_guests : bool;  (** Whether guests may see the guest list. *)
}
(** The switches an organizer sets on an event to bound what its guests may
do. Google omits a switch from the payload while it holds its default. *)

let guest_policy_of_yojson : Yojson.Safe.t -> guest_policy =
 fun json ->
  let fields = Json.obj json in
  {
    can_invite_others = Json.required fields "canInviteOthers" Json.bool;
    can_modify = Json.required fields "canModify" Json.bool;
    can_see_other_guests = Json.required fields "canSeeOtherGuests" Json.bool;
  }

and yojson_of_guest_policy : guest_policy -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("canInviteOthers", Some (Json.of_bool value.can_invite_others));
      ("canModify", Some (Json.of_bool value.can_modify));
      ("canSeeOtherGuests", Some (Json.of_bool value.can_see_other_guests));
    ]

let make_guest_policy ~(can_invite_others : bool) ~(can_modify : bool)
    ~(can_see_other_guests : bool) () =
  ({ can_invite_others; can_modify; can_see_other_guests } : guest_policy)

type nonrec event_reminder_override = {
  method_ : string;
      (** Provider method, stored verbatim; only [popup] fires Macro
notifications. *)
  minutes : int;  (** Minutes before the event start. *)
}
(** One reminder: how it alerts and how many minutes before the event start
(before midnight in the calendar's zone for all-day events) it fires. *)

let event_reminder_override_of_yojson : Yojson.Safe.t -> event_reminder_override
    =
 fun json ->
  let fields = Json.obj json in
  {
    method_ = Json.required fields "method" Json.string;
    minutes = Json.required fields "minutes" Json.int;
  }

and yojson_of_event_reminder_override : event_reminder_override -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("method", Some (Json.of_string value.method_));
      ("minutes", Some (Json.of_int value.minutes));
    ]

let make_event_reminder_override ~(method_ : string) ~(minutes : int) () =
  ({ method_; minutes } : event_reminder_override)

type nonrec event_reminders = {
  overrides : event_reminder_override list option;
      (** Explicit reminders replacing the defaults when [use_default] is off. *)
  use_default : bool;  (** Whether the calendar's default reminders apply. *)
}
(** Per-user reminder configuration for an event, mirroring Google's model:
either the calendar's default reminders apply, or the explicit overrides
replace them entirely. *)

let event_reminders_of_yojson : Yojson.Safe.t -> event_reminders =
 fun json ->
  let fields = Json.obj json in
  {
    overrides =
      Json.optional fields "overrides"
        (Json.list event_reminder_override_of_yojson);
    use_default = Json.required fields "useDefault" Json.bool;
  }

and yojson_of_event_reminders : event_reminders -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "overrides",
        Option.map
          (Json.of_list yojson_of_event_reminder_override)
          value.overrides );
      ("useDefault", Some (Json.of_bool value.use_default));
    ]

let make_event_reminders ?overrides ~(use_default : bool) () =
  ({ overrides; use_default } : event_reminders)

(** Whether an event blocks availability. *)
type nonrec event_transparency =
  | Opaque
  | Transparent
  | Unknown of string  (** A value this SDK version does not know. *)

let event_transparency_of_yojson : Yojson.Safe.t -> event_transparency =
 fun json ->
  match Json.string json with
  | "opaque" -> Opaque
  | "transparent" -> Transparent
  | other -> Json.unknown "event_transparency" json (Unknown other)

and yojson_of_event_transparency : event_transparency -> Yojson.Safe.t =
 fun value ->
  match value with
  | Opaque -> `String "opaque"
  | Transparent -> `String "transparent"
  | Unknown other -> `String other

(** Visibility of event details. *)
type nonrec event_visibility =
  | Default
  | Public
  | Private
  | Confidential
  | Unknown of string  (** A value this SDK version does not know. *)

let event_visibility_of_yojson : Yojson.Safe.t -> event_visibility =
 fun json ->
  match Json.string json with
  | "default" -> Default
  | "public" -> Public
  | "private" -> Private
  | "confidential" -> Confidential
  | other -> Json.unknown "event_visibility" json (Unknown other)

and yojson_of_event_visibility : event_visibility -> Yojson.Safe.t =
 fun value ->
  match value with
  | Default -> `String "default"
  | Public -> `String "public"
  | Private -> `String "private"
  | Confidential -> `String "confidential"
  | Unknown other -> `String other

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

let calendar_event_source_content_of_yojson :
    Yojson.Safe.t -> calendar_event_source_content =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_id = Json.required fields "calendarId" Json.string;
    creator_email = Json.optional fields "creatorEmail" Json.string;
    creator_name = Json.optional fields "creatorName" Json.string;
    description = Json.optional fields "description" Json.string;
    event_type = Json.required fields "eventType" event_type_of_yojson;
    is_read_only = Json.required fields "isReadOnly" Json.bool;
    location = Json.optional fields "location" Json.string;
    reminders = Json.required fields "reminders" event_reminders_of_yojson;
    title = Json.required fields "title" Json.string;
    transparency =
      Json.required fields "transparency" event_transparency_of_yojson;
    visibility = Json.required fields "visibility" event_visibility_of_yojson;
  }

and yojson_of_calendar_event_source_content :
    calendar_event_source_content -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("calendarId", Some (Json.of_string value.calendar_id));
      ("creatorEmail", Option.map Json.of_string value.creator_email);
      ("creatorName", Option.map Json.of_string value.creator_name);
      ("description", Option.map Json.of_string value.description);
      ("eventType", Some (yojson_of_event_type value.event_type));
      ("isReadOnly", Some (Json.of_bool value.is_read_only));
      ("location", Option.map Json.of_string value.location);
      ("reminders", Some (yojson_of_event_reminders value.reminders));
      ("title", Some (Json.of_string value.title));
      ("transparency", Some (yojson_of_event_transparency value.transparency));
      ("visibility", Some (yojson_of_event_visibility value.visibility));
    ]

let make_calendar_event_source_content ~(calendar_id : string) ?creator_email
    ?creator_name ?description ~(event_type : event_type) ~(is_read_only : bool)
    ?location ~(reminders : event_reminders) ~(title : string)
    ~(transparency : event_transparency) ~(visibility : event_visibility) () =
  ({
     calendar_id;
     creator_email;
     creator_name;
     description;
     event_type;
     is_read_only;
     location;
     reminders;
     title;
     transparency;
     visibility;
   }
    : calendar_event_source_content)

(** Canonical event status. *)
type nonrec event_status =
  | Confirmed
  | Tentative
  | Cancelled
  | Unknown of string  (** A value this SDK version does not know. *)

let event_status_of_yojson : Yojson.Safe.t -> event_status =
 fun json ->
  match Json.string json with
  | "confirmed" -> Confirmed
  | "tentative" -> Tentative
  | "cancelled" -> Cancelled
  | other -> Json.unknown "event_status" json (Unknown other)

and yojson_of_event_status : event_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Confirmed -> `String "confirmed"
  | Tentative -> `String "tentative"
  | Cancelled -> `String "cancelled"
  | Unknown other -> `String other

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

let event_time_of_yojson : Yojson.Safe.t -> event_time =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "timed" ->
      Timed
        {
          ends_at = Json.required fields "endsAt" Json.string;
          starts_at = Json.required fields "startsAt" Json.string;
          time_zone = Json.optional fields "timeZone" Json.string;
        }
  | "allDay" ->
      All_day
        {
          end_date = Json.required fields "endDate" Json.string;
          start_date = Json.required fields "startDate" Json.string;
        }
  | _ -> Json.unknown "event_time" json (Unknown json)

and yojson_of_event_time : event_time -> Yojson.Safe.t =
 fun value ->
  match value with
  | Timed case ->
      Json.record
        [
          ("kind", Some (`String "timed"));
          ("endsAt", Some (Json.of_string case.ends_at));
          ("startsAt", Some (Json.of_string case.starts_at));
          ("timeZone", Option.map Json.of_string case.time_zone);
        ]
  | All_day case ->
      Json.record
        [
          ("kind", Some (`String "allDay"));
          ("endDate", Some (Json.of_string case.end_date));
          ("startDate", Some (Json.of_string case.start_date));
        ]
  | Unknown json -> json

let make_event_time_timed ~(ends_at : string) ~(starts_at : string) ?time_zone
    () =
  (Timed { ends_at; starts_at; time_zone } : event_time)

let make_event_time_all_day ~(end_date : string) ~(start_date : string) () =
  (All_day { end_date; start_date } : event_time)

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

let viewer_capabilities_of_yojson : Yojson.Safe.t -> viewer_capabilities =
 fun json ->
  let fields = Json.obj json in
  {
    edit_details = Json.required fields "editDetails" Json.bool;
    invite_guests = Json.required fields "inviteGuests" Json.bool;
    organize = Json.required fields "organize" Json.bool;
    remove_guests = Json.required fields "removeGuests" Json.bool;
    rsvp = Json.required fields "rsvp" Json.bool;
    set_guest_policy = Json.required fields "setGuestPolicy" Json.bool;
  }

and yojson_of_viewer_capabilities : viewer_capabilities -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("editDetails", Some (Json.of_bool value.edit_details));
      ("inviteGuests", Some (Json.of_bool value.invite_guests));
      ("organize", Some (Json.of_bool value.organize));
      ("removeGuests", Some (Json.of_bool value.remove_guests));
      ("rsvp", Some (Json.of_bool value.rsvp));
      ("setGuestPolicy", Some (Json.of_bool value.set_guest_policy));
    ]

let make_viewer_capabilities ~(edit_details : bool) ~(invite_guests : bool)
    ~(organize : bool) ~(remove_guests : bool) ~(rsvp : bool)
    ~(set_guest_policy : bool) () =
  ({
     edit_details;
     invite_guests;
     organize;
     remove_guests;
     rsvp;
     set_guest_policy;
   }
    : viewer_capabilities)

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

let calendar_event_of_yojson : Yojson.Safe.t -> calendar_event =
 fun json ->
  let fields = Json.obj json in
  {
    attendees =
      Json.required fields "attendees" (Json.list calendar_attendee_of_yojson);
    calendar_id = Json.optional fields "calendarId" Json.string;
    conference_provider =
      Json.optional fields "conferenceProvider" conference_provider_of_yojson;
    conference_url = Json.optional fields "conferenceUrl" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    creator_email = Json.optional fields "creatorEmail" Json.string;
    creator_name = Json.optional fields "creatorName" Json.string;
    description = Json.optional fields "description" Json.string;
    event_type = Json.optional fields "eventType" event_type_of_yojson;
    guest_policy = Json.required fields "guestPolicy" guest_policy_of_yojson;
    ical_uid = Json.required fields "icalUid" Json.string;
    id = Json.required fields "id" Json.string;
    is_read_only = Json.required fields "isReadOnly" Json.bool;
    is_snapshot = Json.required fields "isSnapshot" Json.bool;
    location = Json.optional fields "location" Json.string;
    organizer_email = Json.optional fields "organizerEmail" Json.string;
    organizer_name = Json.optional fields "organizerName" Json.string;
    owner_id = Json.required fields "ownerId" Json.string;
    recurrence_lines =
      Json.required fields "recurrenceLines" (Json.list Json.string);
    reminders = Json.optional fields "reminders" event_reminders_of_yojson;
    sequence = Json.required fields "sequence" Json.int;
    sources =
      Json.optional fields "sources"
        (Json.list calendar_event_source_content_of_yojson);
    status = Json.required fields "status" event_status_of_yojson;
    time = Json.required fields "time" event_time_of_yojson;
    title = Json.required fields "title" Json.string;
    transparency =
      Json.required fields "transparency" event_transparency_of_yojson;
    updated_at = Json.required fields "updatedAt" Json.string;
    viewer_can = Json.required fields "viewerCan" viewer_capabilities_of_yojson;
    visibility = Json.required fields "visibility" event_visibility_of_yojson;
  }

and yojson_of_calendar_event : calendar_event -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attendees",
        Some ((Json.of_list yojson_of_calendar_attendee) value.attendees) );
      ("calendarId", Option.map Json.of_string value.calendar_id);
      ( "conferenceProvider",
        Option.map yojson_of_conference_provider value.conference_provider );
      ("conferenceUrl", Option.map Json.of_string value.conference_url);
      ("createdAt", Some (Json.of_string value.created_at));
      ("creatorEmail", Option.map Json.of_string value.creator_email);
      ("creatorName", Option.map Json.of_string value.creator_name);
      ("description", Option.map Json.of_string value.description);
      ("eventType", Option.map yojson_of_event_type value.event_type);
      ("guestPolicy", Some (yojson_of_guest_policy value.guest_policy));
      ("icalUid", Some (Json.of_string value.ical_uid));
      ("id", Some (Json.of_string value.id));
      ("isReadOnly", Some (Json.of_bool value.is_read_only));
      ("isSnapshot", Some (Json.of_bool value.is_snapshot));
      ("location", Option.map Json.of_string value.location);
      ("organizerEmail", Option.map Json.of_string value.organizer_email);
      ("organizerName", Option.map Json.of_string value.organizer_name);
      ("ownerId", Some (Json.of_string value.owner_id));
      ( "recurrenceLines",
        Some ((Json.of_list Json.of_string) value.recurrence_lines) );
      ("reminders", Option.map yojson_of_event_reminders value.reminders);
      ("sequence", Some (Json.of_int value.sequence));
      ( "sources",
        Option.map
          (Json.of_list yojson_of_calendar_event_source_content)
          value.sources );
      ("status", Some (yojson_of_event_status value.status));
      ("time", Some (yojson_of_event_time value.time));
      ("title", Some (Json.of_string value.title));
      ("transparency", Some (yojson_of_event_transparency value.transparency));
      ("updatedAt", Some (Json.of_string value.updated_at));
      ("viewerCan", Some (yojson_of_viewer_capabilities value.viewer_can));
      ("visibility", Some (yojson_of_event_visibility value.visibility));
    ]

let make_calendar_event ~(attendees : calendar_attendee list) ?calendar_id
    ?conference_provider ?conference_url ~(created_at : string) ?creator_email
    ?creator_name ?description ?event_type ~(guest_policy : guest_policy)
    ~(ical_uid : string) ~(id : string) ~(is_read_only : bool)
    ~(is_snapshot : bool) ?location ?organizer_email ?organizer_name
    ~(owner_id : string) ~(recurrence_lines : string list) ?reminders
    ~(sequence : int) ?sources ~(status : event_status) ~(time : event_time)
    ~(title : string) ~(transparency : event_transparency)
    ~(updated_at : string) ~(viewer_can : viewer_capabilities)
    ~(visibility : event_visibility) () =
  ({
     attendees;
     calendar_id;
     conference_provider;
     conference_url;
     created_at;
     creator_email;
     creator_name;
     description;
     event_type;
     guest_policy;
     ical_uid;
     id;
     is_read_only;
     is_snapshot;
     location;
     organizer_email;
     organizer_name;
     owner_id;
     recurrence_lines;
     reminders;
     sequence;
     sources;
     status;
     time;
     title;
     transparency;
     updated_at;
     viewer_can;
     visibility;
   }
    : calendar_event)

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

let calendar_mutation_error_code_of_yojson :
    Yojson.Safe.t -> calendar_mutation_error_code =
 fun json ->
  match Json.string json with
  | "not_found" -> Not_found
  | "occurrence_not_found" -> Occurrence_not_found
  | "read_only" -> Read_only
  | "no_writable_calendar" -> No_writable_calendar
  | "not_attendee" -> Not_attendee
  | "not_organizer" -> Not_organizer
  | "guests_cannot_invite" -> Guests_cannot_invite
  | "guest_list_hidden" -> Guest_list_hidden
  | "guests_cannot_modify" -> Guests_cannot_modify
  | "already_on_calendar" -> Already_on_calendar
  | "join_request_open" -> Join_request_open
  | "copy_refused" -> Copy_refused
  | "snapshot" -> Snapshot
  | "invalid_input" -> Invalid_input
  | "reauth_required" -> Reauth_required
  | "provider_rejected" -> Provider_rejected
  | "retryable" -> Retryable
  | "persist_failed" -> Persist_failed
  | "macro_call_failed" -> Macro_call_failed
  | "copy_choice_required" -> Copy_choice_required
  | "confirmation_required" -> Confirmation_required
  | other -> Json.unknown "calendar_mutation_error_code" json (Unknown other)

and yojson_of_calendar_mutation_error_code :
    calendar_mutation_error_code -> Yojson.Safe.t =
 fun value ->
  match value with
  | Not_found -> `String "not_found"
  | Occurrence_not_found -> `String "occurrence_not_found"
  | Read_only -> `String "read_only"
  | No_writable_calendar -> `String "no_writable_calendar"
  | Not_attendee -> `String "not_attendee"
  | Not_organizer -> `String "not_organizer"
  | Guests_cannot_invite -> `String "guests_cannot_invite"
  | Guest_list_hidden -> `String "guest_list_hidden"
  | Guests_cannot_modify -> `String "guests_cannot_modify"
  | Already_on_calendar -> `String "already_on_calendar"
  | Join_request_open -> `String "join_request_open"
  | Copy_refused -> `String "copy_refused"
  | Snapshot -> `String "snapshot"
  | Invalid_input -> `String "invalid_input"
  | Reauth_required -> `String "reauth_required"
  | Provider_rejected -> `String "provider_rejected"
  | Retryable -> `String "retryable"
  | Persist_failed -> `String "persist_failed"
  | Macro_call_failed -> `String "macro_call_failed"
  | Copy_choice_required -> `String "copy_choice_required"
  | Confirmation_required -> `String "confirmation_required"
  | Unknown other -> `String other

type nonrec calendar_mutation_api_error = {
  code : calendar_mutation_error_code;
      (** Machine-readable failure category. *)
  message : string;  (** Human-readable failure description. *)
}
(** HTTP error body returned by calendar mutation endpoints. *)

let calendar_mutation_api_error_of_yojson :
    Yojson.Safe.t -> calendar_mutation_api_error =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" calendar_mutation_error_code_of_yojson;
    message = Json.required fields "message" Json.string;
  }

and yojson_of_calendar_mutation_api_error :
    calendar_mutation_api_error -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Some (yojson_of_calendar_mutation_error_code value.code));
      ("message", Some (Json.of_string value.message));
    ]

let make_calendar_mutation_api_error ~(code : calendar_mutation_error_code)
    ~(message : string) () =
  ({ code; message } : calendar_mutation_api_error)

type nonrec calendar_occurrence = {
  event_id : string;  (** Owning event entity. *)
  is_cancelled : bool;  (** Whether the instance was cancelled. *)
  occurrence_key : string;  (** Stable key within the event. *)
  recurrence_id : string option;
      (** Provider recurrence identifier, when applicable. *)
  time : event_time;  (** Instance time. *)
}
(** A materialized recurrence instance optimized for range queries. *)

let calendar_occurrence_of_yojson : Yojson.Safe.t -> calendar_occurrence =
 fun json ->
  let fields = Json.obj json in
  {
    event_id = Json.required fields "eventId" Json.string;
    is_cancelled = Json.required fields "isCancelled" Json.bool;
    occurrence_key = Json.required fields "occurrenceKey" Json.string;
    recurrence_id = Json.optional fields "recurrenceId" Json.string;
    time = Json.required fields "time" event_time_of_yojson;
  }

and yojson_of_calendar_occurrence : calendar_occurrence -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("eventId", Some (Json.of_string value.event_id));
      ("isCancelled", Some (Json.of_bool value.is_cancelled));
      ("occurrenceKey", Some (Json.of_string value.occurrence_key));
      ("recurrenceId", Option.map Json.of_string value.recurrence_id);
      ("time", Some (yojson_of_event_time value.time));
    ]

let make_calendar_occurrence ~(event_id : string) ~(is_cancelled : bool)
    ~(occurrence_key : string) ?recurrence_id ~(time : event_time) () =
  ({ event_id; is_cancelled; occurrence_key; recurrence_id; time }
    : calendar_occurrence)

type nonrec cancel_backfill_params = { job_id : string }

let cancel_backfill_params_of_yojson : Yojson.Safe.t -> cancel_backfill_params =
 fun json ->
  let fields = Json.obj json in
  { job_id = Json.required fields "job_id" Json.string }

and yojson_of_cancel_backfill_params : cancel_backfill_params -> Yojson.Safe.t =
 fun value -> Json.record [ ("job_id", Some (Json.of_string value.job_id)) ]

let make_cancel_backfill_params ~(job_id : string) () =
  ({ job_id } : cancel_backfill_params)

type nonrec contact = {
  email_address : string option;
  id : string;
  link_id : string;
  name : string option;
  original_photo_url : string option;
  sfs_photo_url : string option;
}

let contact_of_yojson : Yojson.Safe.t -> contact =
 fun json ->
  let fields = Json.obj json in
  {
    email_address = Json.optional fields "email_address" Json.string;
    id = Json.required fields "id" Json.string;
    link_id = Json.required fields "link_id" Json.string;
    name = Json.optional fields "name" Json.string;
    original_photo_url = Json.optional fields "original_photo_url" Json.string;
    sfs_photo_url = Json.optional fields "sfs_photo_url" Json.string;
  }

and yojson_of_contact : contact -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email_address", Option.map Json.of_string value.email_address);
      ("id", Some (Json.of_string value.id));
      ("link_id", Some (Json.of_string value.link_id));
      ("name", Option.map Json.of_string value.name);
      ("original_photo_url", Option.map Json.of_string value.original_photo_url);
      ("sfs_photo_url", Option.map Json.of_string value.sfs_photo_url);
    ]

let make_contact ?email_address ~(id : string) ~(link_id : string) ?name
    ?original_photo_url ?sfs_photo_url () =
  ({ email_address; id; link_id; name; original_photo_url; sfs_photo_url }
    : contact)

type nonrec contact_info = {
  email : string;
  name : string option;
  photo_url : string option;
}

let contact_info_of_yojson : Yojson.Safe.t -> contact_info =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    name = Json.optional fields "name" Json.string;
    photo_url = Json.optional fields "photo_url" Json.string;
  }

and yojson_of_contact_info : contact_info -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("name", Option.map Json.of_string value.name);
      ("photo_url", Option.map Json.of_string value.photo_url);
    ]

let make_contact_info ~(email : string) ?name ?photo_url () =
  ({ email; name; photo_url } : contact_info)

type nonrec contact_info_legacy = {
  email : string;
  email_address : string;
  name : string option;
  photo_url : string option;
}

let contact_info_legacy_of_yojson : Yojson.Safe.t -> contact_info_legacy =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    email_address = Json.required fields "email_address" Json.string;
    name = Json.optional fields "name" Json.string;
    photo_url = Json.optional fields "photo_url" Json.string;
  }

and yojson_of_contact_info_legacy : contact_info_legacy -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("email_address", Some (Json.of_string value.email_address));
      ("name", Option.map Json.of_string value.name);
      ("photo_url", Option.map Json.of_string value.photo_url);
    ]

let make_contact_info_legacy ~(email : string) ~(email_address : string) ?name
    ?photo_url () =
  ({ email; email_address; name; photo_url } : contact_info_legacy)

type nonrec contact_info_with_interaction = {
  email : string;
  email_address : string;
  name : string option;
  photo_url : string option;
  last_interaction : string;
}

let contact_info_with_interaction_of_yojson :
    Yojson.Safe.t -> contact_info_with_interaction =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    email_address = Json.required fields "email_address" Json.string;
    name = Json.optional fields "name" Json.string;
    photo_url = Json.optional fields "photo_url" Json.string;
    last_interaction = Json.required fields "last_interaction" Json.string;
  }

and yojson_of_contact_info_with_interaction :
    contact_info_with_interaction -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("email_address", Some (Json.of_string value.email_address));
      ("name", Option.map Json.of_string value.name);
      ("photo_url", Option.map Json.of_string value.photo_url);
      ("last_interaction", Some (Json.of_string value.last_interaction));
    ]

let make_contact_info_with_interaction ~(email : string)
    ~(email_address : string) ?name ?photo_url ~(last_interaction : string) () =
  ({ email; email_address; name; photo_url; last_interaction }
    : contact_info_with_interaction)

type nonrec copy_calendar_event_request = {
  calendar_id : string option;
      (** Google calendar to add the copy to; defaults to the requester's
primary inbox's primary calendar. *)
}
(** Request body adding a shared event to the requester's calendar. *)

let copy_calendar_event_request_of_yojson :
    Yojson.Safe.t -> copy_calendar_event_request =
 fun json ->
  let fields = Json.obj json in
  { calendar_id = Json.optional fields "calendarId" Json.string }

and yojson_of_copy_calendar_event_request :
    copy_calendar_event_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("calendarId", Option.map Json.of_string value.calendar_id) ]

let make_copy_calendar_event_request ?calendar_id () =
  ({ calendar_id } : copy_calendar_event_request)

type nonrec create_draft_request = {
  draft : api_draft_input;  (** The draft content. *)
  send_time : string option;  (** Scheduled send time. *)
}
(** Request body for creating a draft. *)

let create_draft_request_of_yojson : Yojson.Safe.t -> create_draft_request =
 fun json ->
  let fields = Json.obj json in
  {
    draft = Json.required fields "draft" api_draft_input_of_yojson;
    send_time = Json.optional fields "send_time" Json.string;
  }

and yojson_of_create_draft_request : create_draft_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("draft", Some (yojson_of_api_draft_input value.draft));
      ("send_time", Option.map Json.of_string value.send_time);
    ]

let make_create_draft_request ~(draft : api_draft_input) ?send_time () =
  ({ draft; send_time } : create_draft_request)

type nonrec create_draft_response = {
  draft : api_draft_output;  (** The created draft. *)
}
(** Response body for creating a draft. *)

let create_draft_response_of_yojson : Yojson.Safe.t -> create_draft_response =
 fun json ->
  let fields = Json.obj json in
  { draft = Json.required fields "draft" api_draft_output_of_yojson }

and yojson_of_create_draft_response : create_draft_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("draft", Some (yojson_of_api_draft_output value.draft)) ]

let make_create_draft_response ~(draft : api_draft_output) () =
  ({ draft } : create_draft_response)

type nonrec create_label_request = { label_name : string }

let create_label_request_of_yojson : Yojson.Safe.t -> create_label_request =
 fun json ->
  let fields = Json.obj json in
  { label_name = Json.required fields "label_name" Json.string }

and yojson_of_create_label_request : create_label_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("label_name", Some (Json.of_string value.label_name)) ]

let make_create_label_request ~(label_name : string) () =
  ({ label_name } : create_label_request)

type nonrec label_list_visibility =
  | Label_show
  | Label_show_if_unread
  | Label_hide
  | Unknown of string  (** A value this SDK version does not know. *)

let label_list_visibility_of_yojson : Yojson.Safe.t -> label_list_visibility =
 fun json ->
  match Json.string json with
  | "LabelShow" -> Label_show
  | "LabelShowIfUnread" -> Label_show_if_unread
  | "LabelHide" -> Label_hide
  | other -> Json.unknown "label_list_visibility" json (Unknown other)

and yojson_of_label_list_visibility : label_list_visibility -> Yojson.Safe.t =
 fun value ->
  match value with
  | Label_show -> `String "LabelShow"
  | Label_show_if_unread -> `String "LabelShowIfUnread"
  | Label_hide -> `String "LabelHide"
  | Unknown other -> `String other

type nonrec message_list_visibility =
  | Show
  | Hide
  | Unknown of string  (** A value this SDK version does not know. *)

let message_list_visibility_of_yojson : Yojson.Safe.t -> message_list_visibility
    =
 fun json ->
  match Json.string json with
  | "Show" -> Show
  | "Hide" -> Hide
  | other -> Json.unknown "message_list_visibility" json (Unknown other)

and yojson_of_message_list_visibility : message_list_visibility -> Yojson.Safe.t
    =
 fun value ->
  match value with
  | Show -> `String "Show"
  | Hide -> `String "Hide"
  | Unknown other -> `String other

type nonrec label_type =
  | System
  | User
  | Unknown of string  (** A value this SDK version does not know. *)

let label_type_of_yojson : Yojson.Safe.t -> label_type =
 fun json ->
  match Json.string json with
  | "System" -> System
  | "User" -> User
  | other -> Json.unknown "label_type" json (Unknown other)

and yojson_of_label_type : label_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | System -> `String "System"
  | User -> `String "User"
  | Unknown other -> `String other

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

let label_of_yojson : Yojson.Safe.t -> label =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    id = Json.optional fields "id" Json.string;
    label_list_visibility =
      Json.optional fields "label_list_visibility"
        label_list_visibility_of_yojson;
    link_id = Json.required fields "link_id" Json.string;
    message_list_visibility =
      Json.optional fields "message_list_visibility"
        message_list_visibility_of_yojson;
    name = Json.optional fields "name" Json.string;
    provider_label_id = Json.required fields "provider_label_id" Json.string;
    type_ = Json.optional fields "type_" label_type_of_yojson;
  }

and yojson_of_label : label -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("id", Option.map Json.of_string value.id);
      ( "label_list_visibility",
        Option.map yojson_of_label_list_visibility value.label_list_visibility
      );
      ("link_id", Some (Json.of_string value.link_id));
      ( "message_list_visibility",
        Option.map yojson_of_message_list_visibility
          value.message_list_visibility );
      ("name", Option.map Json.of_string value.name);
      ("provider_label_id", Some (Json.of_string value.provider_label_id));
      ("type_", Option.map yojson_of_label_type value.type_);
    ]

let make_label ~(created_at : string) ?id ?label_list_visibility
    ~(link_id : string) ?message_list_visibility ?name
    ~(provider_label_id : string) ?type_ () =
  ({
     created_at;
     id;
     label_list_visibility;
     link_id;
     message_list_visibility;
     name;
     provider_label_id;
     type_;
   }
    : label)

type nonrec create_label_response = {
  label : label;
      (** Local label. Pending provider creation is reported by settings operations. *)
}
(** The response returned from the create label endpoint *)

let create_label_response_of_yojson : Yojson.Safe.t -> create_label_response =
 fun json ->
  let fields = Json.obj json in
  { label = Json.required fields "label" label_of_yojson }

and yojson_of_create_label_response : create_label_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("label", Some (yojson_of_label value.label)) ]

let make_create_label_response ~(label : label) () =
  ({ label } : create_label_response)

type nonrec eml_file = string

let eml_file_of_yojson : Yojson.Safe.t -> eml_file =
 fun json -> Json.string json

and yojson_of_eml_file : eml_file -> Yojson.Safe.t =
 fun value -> Json.of_string value

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

let empty_response_of_yojson : Yojson.Safe.t -> empty_response =
 fun json -> Json.json json

and yojson_of_empty_response : empty_response -> Yojson.Safe.t =
 fun value -> Json.of_json value

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

(** Why a forward was not sent. *)
type nonrec forward_calendar_event_error_code =
  | Not_found
  | Invalid_recipients
  | Inbox_unavailable
  | Send_failed
  | Unknown of string  (** A value this SDK version does not know. *)

let forward_calendar_event_error_code_of_yojson :
    Yojson.Safe.t -> forward_calendar_event_error_code =
 fun json ->
  match Json.string json with
  | "not_found" -> Not_found
  | "invalid_recipients" -> Invalid_recipients
  | "inbox_unavailable" -> Inbox_unavailable
  | "send_failed" -> Send_failed
  | other ->
      Json.unknown "forward_calendar_event_error_code" json (Unknown other)

and yojson_of_forward_calendar_event_error_code :
    forward_calendar_event_error_code -> Yojson.Safe.t =
 fun value ->
  match value with
  | Not_found -> `String "not_found"
  | Invalid_recipients -> `String "invalid_recipients"
  | Inbox_unavailable -> `String "inbox_unavailable"
  | Send_failed -> `String "send_failed"
  | Unknown other -> `String other

type nonrec forward_calendar_event_error = {
  code : forward_calendar_event_error_code;  (** What went wrong. *)
  message : string;  (** A message fit to show the user. *)
}
(** A refused or failed forward. *)

let forward_calendar_event_error_of_yojson :
    Yojson.Safe.t -> forward_calendar_event_error =
 fun json ->
  let fields = Json.obj json in
  {
    code =
      Json.required fields "code" forward_calendar_event_error_code_of_yojson;
    message = Json.required fields "message" Json.string;
  }

and yojson_of_forward_calendar_event_error :
    forward_calendar_event_error -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Some (yojson_of_forward_calendar_event_error_code value.code));
      ("message", Some (Json.of_string value.message));
    ]

let make_forward_calendar_event_error
    ~(code : forward_calendar_event_error_code) ~(message : string) () =
  ({ code; message } : forward_calendar_event_error)

type nonrec forward_calendar_event_recipient = {
  email : string;  (** Their email address. *)
  name : string option;  (** Their display name. *)
}
(** One person a forwarded invitation goes to. *)

let forward_calendar_event_recipient_of_yojson :
    Yojson.Safe.t -> forward_calendar_event_recipient =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    name = Json.optional fields "name" Json.string;
  }

and yojson_of_forward_calendar_event_recipient :
    forward_calendar_event_recipient -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("name", Option.map Json.of_string value.name);
    ]

let make_forward_calendar_event_recipient ~(email : string) ?name () =
  ({ email; name } : forward_calendar_event_recipient)

type nonrec forward_calendar_event_request = {
  body_text : string option;
      (** A plain-text summary of the event the email opens with; the title
when absent. The email ends with a note saying what the recipient
can do with the forward. *)
  to_ : forward_calendar_event_recipient list;
      (** The people it goes to, at most 50. *)
}
(** Who a forwarded invitation goes to, and what its email says. *)

let forward_calendar_event_request_of_yojson :
    Yojson.Safe.t -> forward_calendar_event_request =
 fun json ->
  let fields = Json.obj json in
  {
    body_text = Json.optional fields "bodyText" Json.string;
    to_ =
      Json.required fields "to"
        (Json.list forward_calendar_event_recipient_of_yojson);
  }

and yojson_of_forward_calendar_event_request :
    forward_calendar_event_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bodyText", Option.map Json.of_string value.body_text);
      ( "to",
        Some
          ((Json.of_list yojson_of_forward_calendar_event_recipient) value.to_)
      );
    ]

let make_forward_calendar_event_request ?body_text
    ~(to_ : forward_calendar_event_recipient list) () =
  ({ body_text; to_ } : forward_calendar_event_request)

type nonrec forward_calendar_event_response = {
  message_id : string;  (** The sent message. *)
  thread_id : string;  (** Its thread. *)
}
(** The email the forward queued. *)

let forward_calendar_event_response_of_yojson :
    Yojson.Safe.t -> forward_calendar_event_response =
 fun json ->
  let fields = Json.obj json in
  {
    message_id = Json.required fields "messageId" Json.string;
    thread_id = Json.required fields "threadId" Json.string;
  }

and yojson_of_forward_calendar_event_response :
    forward_calendar_event_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("messageId", Some (Json.of_string value.message_id));
      ("threadId", Some (Json.of_string value.thread_id));
    ]

let make_forward_calendar_event_response ~(message_id : string)
    ~(thread_id : string) () =
  ({ message_id; thread_id } : forward_calendar_event_response)

type nonrec get_active_backfill_job_response = { job : backfill_job }
(** The response returned from the get backfill job endpoint *)

let get_active_backfill_job_response_of_yojson :
    Yojson.Safe.t -> get_active_backfill_job_response =
 fun json ->
  let fields = Json.obj json in
  { job = Json.required fields "job" backfill_job_of_yojson }

and yojson_of_get_active_backfill_job_response :
    get_active_backfill_job_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("job", Some (yojson_of_backfill_job value.job)) ]

let make_get_active_backfill_job_response ~(job : backfill_job) () =
  ({ job } : get_active_backfill_job_response)

type nonrec get_attachment_document_id_response = {
  attachment_id : string;
  document_id : string;
}
(** The response returned from the get attachment endpoint *)

let get_attachment_document_id_response_of_yojson :
    Yojson.Safe.t -> get_attachment_document_id_response =
 fun json ->
  let fields = Json.obj json in
  {
    attachment_id = Json.required fields "attachment_id" Json.string;
    document_id = Json.required fields "document_id" Json.string;
  }

and yojson_of_get_attachment_document_id_response :
    get_attachment_document_id_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attachment_id", Some (Json.of_string value.attachment_id));
      ("document_id", Some (Json.of_string value.document_id));
    ]

let make_get_attachment_document_id_response ~(attachment_id : string)
    ~(document_id : string) () =
  ({ attachment_id; document_id } : get_attachment_document_id_response)

type nonrec get_attachment_response = { attachment : attachment }
(** The response returned from the get attachment endpoint *)

let get_attachment_response_of_yojson : Yojson.Safe.t -> get_attachment_response
    =
 fun json ->
  let fields = Json.obj json in
  { attachment = Json.required fields "attachment" attachment_of_yojson }

and yojson_of_get_attachment_response : get_attachment_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record [ ("attachment", Some (yojson_of_attachment value.attachment)) ]

let make_get_attachment_response ~(attachment : attachment) () =
  ({ attachment } : get_attachment_response)

type nonrec get_backfill_job_response = { job : backfill_job }
(** The response returned from the get backfill job endpoint *)

let get_backfill_job_response_of_yojson :
    Yojson.Safe.t -> get_backfill_job_response =
 fun json ->
  let fields = Json.obj json in
  { job = Json.required fields "job" backfill_job_of_yojson }

and yojson_of_get_backfill_job_response :
    get_backfill_job_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("job", Some (yojson_of_backfill_job value.job)) ]

let make_get_backfill_job_response ~(job : backfill_job) () =
  ({ job } : get_backfill_job_response)

type nonrec get_previews_cursor_params = {
  limit : int option;  (** Limit for pagination. Default is 20. Max is 500. *)
  sort_method : api_sort_method option;
}
(** Parameters for getting thread previews with cursor-based pagination. *)

let get_previews_cursor_params_of_yojson :
    Yojson.Safe.t -> get_previews_cursor_params =
 fun json ->
  let fields = Json.obj json in
  {
    limit = Json.optional fields "limit" Json.int;
    sort_method = Json.optional fields "sort_method" api_sort_method_of_yojson;
  }

and yojson_of_get_previews_cursor_params :
    get_previews_cursor_params -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("limit", Option.map Json.of_int value.limit);
      ("sort_method", Option.map yojson_of_api_sort_method value.sort_method);
    ]

let make_get_previews_cursor_params ?limit ?sort_method () =
  ({ limit; sort_method } : get_previews_cursor_params)

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

let message_of_yojson : Yojson.Safe.t -> message =
 fun json ->
  let fields = Json.obj json in
  {
    attachments =
      Json.required fields "attachments" (Json.list attachment_of_yojson);
    attachments_draft =
      Json.required fields "attachments_draft"
        (Json.list attachment_draft_of_yojson);
    attachments_forwarded =
      Json.required fields "attachments_forwarded"
        (Json.list attachment_forwarded_of_yojson);
    bcc = Json.required fields "bcc" (Json.list contact_info_of_yojson);
    body_html_sanitized = Json.optional fields "body_html_sanitized" Json.string;
    body_macro = Json.optional fields "body_macro" Json.string;
    body_text = Json.optional fields "body_text" Json.string;
    cc = Json.required fields "cc" (Json.list contact_info_of_yojson);
    created_at = Json.required fields "created_at" Json.string;
    db_id = Json.required fields "db_id" Json.string;
    from = Json.optional fields "from" contact_info_of_yojson;
    global_id = Json.optional fields "global_id" Json.string;
    has_attachments = Json.required fields "has_attachments" Json.bool;
    headers_json = Json.optional fields "headers_json" value_of_yojson;
    internal_date_ts = Json.optional fields "internal_date_ts" Json.string;
    is_draft = Json.required fields "is_draft" Json.bool;
    is_read = Json.required fields "is_read" Json.bool;
    is_sent = Json.required fields "is_sent" Json.bool;
    is_starred = Json.required fields "is_starred" Json.bool;
    labels = Json.required fields "labels" (Json.list label_of_yojson);
    link_id = Json.required fields "link_id" Json.string;
    provider_history_id = Json.optional fields "provider_history_id" Json.string;
    provider_id = Json.optional fields "provider_id" Json.string;
    provider_thread_id = Json.optional fields "provider_thread_id" Json.string;
    replying_to_id = Json.optional fields "replying_to_id" Json.string;
    scheduled_send_time = Json.optional fields "scheduled_send_time" Json.string;
    sent_at = Json.optional fields "sent_at" Json.string;
    size_estimate = Json.optional fields "size_estimate" Json.int64;
    snippet = Json.optional fields "snippet" Json.string;
    subject = Json.optional fields "subject" Json.string;
    thread_db_id = Json.required fields "thread_db_id" Json.string;
    to_ = Json.required fields "to" (Json.list contact_info_of_yojson);
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_message : message -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attachments",
        Some ((Json.of_list yojson_of_attachment) value.attachments) );
      ( "attachments_draft",
        Some ((Json.of_list yojson_of_attachment_draft) value.attachments_draft)
      );
      ( "attachments_forwarded",
        Some
          ((Json.of_list yojson_of_attachment_forwarded)
             value.attachments_forwarded) );
      ("bcc", Some ((Json.of_list yojson_of_contact_info) value.bcc));
      ( "body_html_sanitized",
        Option.map Json.of_string value.body_html_sanitized );
      ("body_macro", Option.map Json.of_string value.body_macro);
      ("body_text", Option.map Json.of_string value.body_text);
      ("cc", Some ((Json.of_list yojson_of_contact_info) value.cc));
      ("created_at", Some (Json.of_string value.created_at));
      ("db_id", Some (Json.of_string value.db_id));
      ("from", Option.map yojson_of_contact_info value.from);
      ("global_id", Option.map Json.of_string value.global_id);
      ("has_attachments", Some (Json.of_bool value.has_attachments));
      ("headers_json", Option.map yojson_of_value value.headers_json);
      ("internal_date_ts", Option.map Json.of_string value.internal_date_ts);
      ("is_draft", Some (Json.of_bool value.is_draft));
      ("is_read", Some (Json.of_bool value.is_read));
      ("is_sent", Some (Json.of_bool value.is_sent));
      ("is_starred", Some (Json.of_bool value.is_starred));
      ("labels", Some ((Json.of_list yojson_of_label) value.labels));
      ("link_id", Some (Json.of_string value.link_id));
      ( "provider_history_id",
        Option.map Json.of_string value.provider_history_id );
      ("provider_id", Option.map Json.of_string value.provider_id);
      ("provider_thread_id", Option.map Json.of_string value.provider_thread_id);
      ("replying_to_id", Option.map Json.of_string value.replying_to_id);
      ( "scheduled_send_time",
        Option.map Json.of_string value.scheduled_send_time );
      ("sent_at", Option.map Json.of_string value.sent_at);
      ("size_estimate", Option.map Json.of_int64 value.size_estimate);
      ("snippet", Option.map Json.of_string value.snippet);
      ("subject", Option.map Json.of_string value.subject);
      ("thread_db_id", Some (Json.of_string value.thread_db_id));
      ("to", Some ((Json.of_list yojson_of_contact_info) value.to_));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_message ~(attachments : attachment list)
    ~(attachments_draft : attachment_draft list)
    ~(attachments_forwarded : attachment_forwarded list)
    ~(bcc : contact_info list) ?body_html_sanitized ?body_macro ?body_text
    ~(cc : contact_info list) ~(created_at : string) ~(db_id : string) ?from
    ?global_id ~(has_attachments : bool) ?headers_json ?internal_date_ts
    ~(is_draft : bool) ~(is_read : bool) ~(is_sent : bool) ~(is_starred : bool)
    ~(labels : label list) ~(link_id : string) ?provider_history_id ?provider_id
    ?provider_thread_id ?replying_to_id ?scheduled_send_time ?sent_at
    ?size_estimate ?snippet ?subject ~(thread_db_id : string)
    ~(to_ : contact_info list) ~(updated_at : string) () =
  ({
     attachments;
     attachments_draft;
     attachments_forwarded;
     bcc;
     body_html_sanitized;
     body_macro;
     body_text;
     cc;
     created_at;
     db_id;
     from;
     global_id;
     has_attachments;
     headers_json;
     internal_date_ts;
     is_draft;
     is_read;
     is_sent;
     is_starred;
     labels;
     link_id;
     provider_history_id;
     provider_id;
     provider_thread_id;
     replying_to_id;
     scheduled_send_time;
     sent_at;
     size_estimate;
     snippet;
     subject;
     thread_db_id;
     to_;
     updated_at;
   }
    : message)

type nonrec get_scheduled_response = { messages : message list }

let get_scheduled_response_of_yojson : Yojson.Safe.t -> get_scheduled_response =
 fun json ->
  let fields = Json.obj json in
  { messages = Json.required fields "messages" (Json.list message_of_yojson) }

and yojson_of_get_scheduled_response : get_scheduled_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("messages", Some ((Json.of_list yojson_of_message) value.messages)) ]

let make_get_scheduled_response ~(messages : message list) () =
  ({ messages } : get_scheduled_response)

type nonrec get_thread_response = { thread : api_thread }
(** Response body for the get-thread endpoint. *)

let get_thread_response_of_yojson : Yojson.Safe.t -> get_thread_response =
 fun json ->
  let fields = Json.obj json in
  { thread = Json.required fields "thread" api_thread_of_yojson }

and yojson_of_get_thread_response : get_thread_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("thread", Some (yojson_of_api_thread value.thread)) ]

let make_get_thread_response ~(thread : api_thread) () =
  ({ thread } : get_thread_response)

type nonrec init_error_code_response = {
  code : string;  (** Stable machine-readable error code. *)
  message : string;  (** Human-readable explanation. *)
}
(** Structured 400 body carrying a machine-readable code. Clients branch on
[code] instead of parsing the human message. *)

let init_error_code_response_of_yojson :
    Yojson.Safe.t -> init_error_code_response =
 fun json ->
  let fields = Json.obj json in
  {
    code = Json.required fields "code" Json.string;
    message = Json.required fields "message" Json.string;
  }

and yojson_of_init_error_code_response :
    init_error_code_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("code", Some (Json.of_string value.code));
      ("message", Some (Json.of_string value.message));
    ]

let make_init_error_code_response ~(code : string) ~(message : string) () =
  ({ code; message } : init_error_code_response)

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

let init_response_of_yojson : Yojson.Safe.t -> init_response =
 fun json ->
  let fields = Json.obj json in
  {
    backfill_job_id = Json.optional fields "backfill_job_id" Json.string;
    link_id = Json.required fields "link_id" Json.string;
  }

and yojson_of_init_response : init_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("backfill_job_id", Option.map Json.of_string value.backfill_job_id);
      ("link_id", Some (Json.of_string value.link_id));
    ]

let make_init_response ?backfill_job_id ~(link_id : string) () =
  ({ backfill_job_id; link_id } : init_response)

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

let invitation_resolution_of_yojson : Yojson.Safe.t -> invitation_resolution =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "disconnected" -> Disconnected
  | "still_syncing" -> Still_syncing
  | "cancelled" -> Cancelled
  | "unavailable" -> Unavailable
  | "no_match" -> No_match
  | "ambiguous" -> Ambiguous
  | "resolved" ->
      Resolved
        {
          can_join = Json.required fields "can_join" Json.bool;
          can_respond = Json.required fields "can_respond" Json.bool;
          event = Json.required fields "event" calendar_event_of_yojson;
          is_stale = Json.required fields "is_stale" Json.bool;
          occurrence =
            Json.required fields "occurrence" calendar_occurrence_of_yojson;
          responding_email = Json.required fields "responding_email" Json.string;
        }
  | _ -> Json.unknown "invitation_resolution" json (Unknown json)

and yojson_of_invitation_resolution : invitation_resolution -> Yojson.Safe.t =
 fun value ->
  match value with
  | Disconnected -> Json.record [ ("kind", Some (`String "disconnected")) ]
  | Still_syncing -> Json.record [ ("kind", Some (`String "still_syncing")) ]
  | Cancelled -> Json.record [ ("kind", Some (`String "cancelled")) ]
  | Unavailable -> Json.record [ ("kind", Some (`String "unavailable")) ]
  | No_match -> Json.record [ ("kind", Some (`String "no_match")) ]
  | Ambiguous -> Json.record [ ("kind", Some (`String "ambiguous")) ]
  | Resolved case ->
      Json.record
        [
          ("kind", Some (`String "resolved"));
          ("can_join", Some (Json.of_bool case.can_join));
          ("can_respond", Some (Json.of_bool case.can_respond));
          ("event", Some (yojson_of_calendar_event case.event));
          ("is_stale", Some (Json.of_bool case.is_stale));
          ("occurrence", Some (yojson_of_calendar_occurrence case.occurrence));
          ("responding_email", Some (Json.of_string case.responding_email));
        ]
  | Unknown json -> json

let make_invitation_resolution_resolved ~(can_join : bool) ~(can_respond : bool)
    ~(event : calendar_event) ~(is_stale : bool)
    ~(occurrence : calendar_occurrence) ~(responding_email : string) () =
  (Resolved
     { can_join; can_respond; event; is_stale; occurrence; responding_email }
    : invitation_resolution)

type nonrec label_info = { name : string; provider_id : string }

let label_info_of_yojson : Yojson.Safe.t -> label_info =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.required fields "name" Json.string;
    provider_id = Json.required fields "provider_id" Json.string;
  }

and yojson_of_label_info : label_info -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Some (Json.of_string value.name));
      ("provider_id", Some (Json.of_string value.provider_id));
    ]

let make_label_info ~(name : string) ~(provider_id : string) () =
  ({ name; provider_id } : label_info)

type nonrec user_provider =
  | Gmail
  | Outlook
  | Unknown of string  (** A value this SDK version does not know. *)

let user_provider_of_yojson : Yojson.Safe.t -> user_provider =
 fun json ->
  match Json.string json with
  | "GMAIL" -> Gmail
  | "OUTLOOK" -> Outlook
  | other -> Json.unknown "user_provider" json (Unknown other)

and yojson_of_user_provider : user_provider -> Yojson.Safe.t =
 fun value ->
  match value with
  | Gmail -> `String "GMAIL"
  | Outlook -> `String "OUTLOOK"
  | Unknown other -> `String other

type nonrec settings = {
  read_receipts_enabled : bool option;
      (** Whether messages sent from this inbox carry an open-tracking pixel. *)
  signature : string option;
      (** The user's email signature content (HTML). On a patch, omit or send
[null] to leave unchanged (both deserialize to [None]); pass an empty
string to clear it. The column cannot be set to SQL NULL via patch. *)
  signature_on_replies_forwards : bool option;
}

let settings_of_yojson : Yojson.Safe.t -> settings =
 fun json ->
  let fields = Json.obj json in
  {
    read_receipts_enabled =
      Json.optional fields "read_receipts_enabled" Json.bool;
    signature = Json.optional fields "signature" Json.string;
    signature_on_replies_forwards =
      Json.optional fields "signature_on_replies_forwards" Json.bool;
  }

and yojson_of_settings : settings -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "read_receipts_enabled",
        Option.map Json.of_bool value.read_receipts_enabled );
      ("signature", Option.map Json.of_string value.signature);
      ( "signature_on_replies_forwards",
        Option.map Json.of_bool value.signature_on_replies_forwards );
    ]

let make_settings ?read_receipts_enabled ?signature
    ?signature_on_replies_forwards () =
  ({ read_receipts_enabled; signature; signature_on_replies_forwards }
    : settings)

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

let sync_status_of_yojson : Yojson.Safe.t -> sync_status =
 fun json ->
  match Json.string json with
  | "SYNCING" -> Syncing
  | "UP_TO_DATE" -> Up_to_date
  | "ERROR" -> Error_
  | "NEEDS_REAUTH" -> Needs_reauth
  | "INACTIVE" -> Inactive
  | other -> Json.unknown "sync_status" json (Unknown other)

and yojson_of_sync_status : sync_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Syncing -> `String "SYNCING"
  | Up_to_date -> `String "UP_TO_DATE"
  | Error_ -> `String "ERROR"
  | Needs_reauth -> `String "NEEDS_REAUTH"
  | Inactive -> `String "INACTIVE"
  | Unknown other -> `String other

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

let link_of_yojson : Yojson.Safe.t -> link =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_disabled = Json.required fields "calendar_disabled" Json.bool;
    created_at = Json.required fields "created_at" Json.string;
    email_address = Json.required fields "email_address" Json.string;
    fusionauth_user_id = Json.required fields "fusionauth_user_id" Json.string;
    has_calendar_data = Json.required fields "has_calendar_data" Json.bool;
    id = Json.required fields "id" Json.string;
    is_primary = Json.required fields "is_primary" Json.bool;
    is_sync_active = Json.required fields "is_sync_active" Json.bool;
    macro_id = Json.required fields "macro_id" Json.string;
    needs_calendar_permission =
      Json.required fields "needs_calendar_permission" Json.bool;
    needs_reauth = Json.required fields "needs_reauth" Json.bool;
    photo_url = Json.optional fields "photo_url" Json.string;
    provider = Json.required fields "provider" user_provider_of_yojson;
    settings = Json.required fields "settings" settings_of_yojson;
    sync_status = Json.required fields "sync_status" sync_status_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_link : link -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("calendar_disabled", Some (Json.of_bool value.calendar_disabled));
      ("created_at", Some (Json.of_string value.created_at));
      ("email_address", Some (Json.of_string value.email_address));
      ("fusionauth_user_id", Some (Json.of_string value.fusionauth_user_id));
      ("has_calendar_data", Some (Json.of_bool value.has_calendar_data));
      ("id", Some (Json.of_string value.id));
      ("is_primary", Some (Json.of_bool value.is_primary));
      ("is_sync_active", Some (Json.of_bool value.is_sync_active));
      ("macro_id", Some (Json.of_string value.macro_id));
      ( "needs_calendar_permission",
        Some (Json.of_bool value.needs_calendar_permission) );
      ("needs_reauth", Some (Json.of_bool value.needs_reauth));
      ("photo_url", Option.map Json.of_string value.photo_url);
      ("provider", Some (yojson_of_user_provider value.provider));
      ("settings", Some (yojson_of_settings value.settings));
      ("sync_status", Some (yojson_of_sync_status value.sync_status));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_link ~(calendar_disabled : bool) ~(created_at : string)
    ~(email_address : string) ~(fusionauth_user_id : string)
    ~(has_calendar_data : bool) ~(id : string) ~(is_primary : bool)
    ~(is_sync_active : bool) ~(macro_id : string)
    ~(needs_calendar_permission : bool) ~(needs_reauth : bool) ?photo_url
    ~(provider : user_provider) ~(settings : settings)
    ~(sync_status : sync_status) ~(updated_at : string) () =
  ({
     calendar_disabled;
     created_at;
     email_address;
     fusionauth_user_id;
     has_calendar_data;
     id;
     is_primary;
     is_sync_active;
     macro_id;
     needs_calendar_permission;
     needs_reauth;
     photo_url;
     provider;
     settings;
     sync_status;
     updated_at;
   }
    : link)

type nonrec list_backfill_jobs_response = { jobs : backfill_job list }
(** The response returned from the list backfill jobs endpoint *)

let list_backfill_jobs_response_of_yojson :
    Yojson.Safe.t -> list_backfill_jobs_response =
 fun json ->
  let fields = Json.obj json in
  { jobs = Json.required fields "jobs" (Json.list backfill_job_of_yojson) }

and yojson_of_list_backfill_jobs_response :
    list_backfill_jobs_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("jobs", Some ((Json.of_list yojson_of_backfill_job) value.jobs)) ]

let make_list_backfill_jobs_response ~(jobs : backfill_job list) () =
  ({ jobs } : list_backfill_jobs_response)

type nonrec list_blocked_response = {
  blocked_emails : string list;
      (** List of email addresses that are currently blocked. *)
}
(** Response containing list of blocked email addresses. *)

let list_blocked_response_of_yojson : Yojson.Safe.t -> list_blocked_response =
 fun json ->
  let fields = Json.obj json in
  {
    blocked_emails =
      Json.required fields "blocked_emails" (Json.list Json.string);
  }

and yojson_of_list_blocked_response : list_blocked_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "blocked_emails",
        Some ((Json.of_list Json.of_string) value.blocked_emails) );
    ]

let make_list_blocked_response ~(blocked_emails : string list) () =
  ({ blocked_emails } : list_blocked_response)

type nonrec list_contacts_response = {
  contacts : (string * contact_info_with_interaction list) list;
      (** the thread, with messages inside *)
}

let list_contacts_response_of_yojson : Yojson.Safe.t -> list_contacts_response =
 fun json ->
  let fields = Json.obj json in
  {
    contacts =
      Json.required fields "contacts"
        (Json.map (Json.list contact_info_with_interaction_of_yojson));
  }

and yojson_of_list_contacts_response : list_contacts_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "contacts",
        Some
          ((Json.of_map (Json.of_list yojson_of_contact_info_with_interaction))
             value.contacts) );
    ]

let make_list_contacts_response
    ~(contacts : (string * contact_info_with_interaction list) list) () =
  ({ contacts } : list_contacts_response)

type nonrec list_email_filters_response = { filters : api_email_filter list }
(** Response body for listing email filters. *)

let list_email_filters_response_of_yojson :
    Yojson.Safe.t -> list_email_filters_response =
 fun json ->
  let fields = Json.obj json in
  {
    filters =
      Json.required fields "filters" (Json.list api_email_filter_of_yojson);
  }

and yojson_of_list_email_filters_response :
    list_email_filters_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("filters", Some ((Json.of_list yojson_of_api_email_filter) value.filters));
    ]

let make_list_email_filters_response ~(filters : api_email_filter list) () =
  ({ filters } : list_email_filters_response)

type nonrec list_labels_response = { labels : api_label list }
(** Response body for listing labels. *)

let list_labels_response_of_yojson : Yojson.Safe.t -> list_labels_response =
 fun json ->
  let fields = Json.obj json in
  { labels = Json.required fields "labels" (Json.list api_label_of_yojson) }

and yojson_of_list_labels_response : list_labels_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("labels", Some ((Json.of_list yojson_of_api_label) value.labels)) ]

let make_list_labels_response ~(labels : api_label list) () =
  ({ labels } : list_labels_response)

type nonrec list_links_response = {
  links : link list;  (** the thread, with messages inside *)
}
(** The response returned from the list links endpoint *)

let list_links_response_of_yojson : Yojson.Safe.t -> list_links_response =
 fun json ->
  let fields = Json.obj json in
  { links = Json.required fields "links" (Json.list link_of_yojson) }

and yojson_of_list_links_response : list_links_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("links", Some ((Json.of_list yojson_of_link) value.links)) ]

let make_list_links_response ~(links : link list) () =
  ({ links } : list_links_response)

type nonrec mailbox_action_category_value = { name : string; present : bool }
(** Add/remove a category while preserving other provider assignments. *)

let mailbox_action_category_value_of_yojson :
    Yojson.Safe.t -> mailbox_action_category_value =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.required fields "name" Json.string;
    present = Json.required fields "present" Json.bool;
  }

and yojson_of_mailbox_action_category_value :
    mailbox_action_category_value -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Some (Json.of_string value.name));
      ("present", Some (Json.of_bool value.present));
    ]

let make_mailbox_action_category_value ~(name : string) ~(present : bool) () =
  ({ name; present } : mailbox_action_category_value)

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

let mailbox_action_of_yojson : Yojson.Safe.t -> mailbox_action =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "kind" with
  | "read" -> Read { value = Json.required fields "value" Json.bool }
  | "flagged" -> Flagged { value = Json.required fields "value" Json.bool }
  | "archived" -> Archived { value = Json.required fields "value" Json.bool }
  | "trashed" -> Trashed { value = Json.required fields "value" Json.bool }
  | "junk" -> Junk { value = Json.required fields "value" Json.bool }
  | "category" ->
      Category
        {
          value =
            Json.required fields "value" mailbox_action_category_value_of_yojson;
        }
  | _ -> Json.unknown "mailbox_action" json (Unknown json)

and yojson_of_mailbox_action : mailbox_action -> Yojson.Safe.t =
 fun value ->
  match value with
  | Read case ->
      Json.record
        [
          ("kind", Some (`String "read"));
          ("value", Some (Json.of_bool case.value));
        ]
  | Flagged case ->
      Json.record
        [
          ("kind", Some (`String "flagged"));
          ("value", Some (Json.of_bool case.value));
        ]
  | Archived case ->
      Json.record
        [
          ("kind", Some (`String "archived"));
          ("value", Some (Json.of_bool case.value));
        ]
  | Trashed case ->
      Json.record
        [
          ("kind", Some (`String "trashed"));
          ("value", Some (Json.of_bool case.value));
        ]
  | Junk case ->
      Json.record
        [
          ("kind", Some (`String "junk"));
          ("value", Some (Json.of_bool case.value));
        ]
  | Category case ->
      Json.record
        [
          ("kind", Some (`String "category"));
          ("value", Some (yojson_of_mailbox_action_category_value case.value));
        ]
  | Unknown json -> json

let make_mailbox_action_read ~(value : bool) () =
  (Read { value } : mailbox_action)

let make_mailbox_action_flagged ~(value : bool) () =
  (Flagged { value } : mailbox_action)

let make_mailbox_action_archived ~(value : bool) () =
  (Archived { value } : mailbox_action)

let make_mailbox_action_trashed ~(value : bool) () =
  (Trashed { value } : mailbox_action)

let make_mailbox_action_junk ~(value : bool) () =
  (Junk { value } : mailbox_action)

let make_mailbox_action_category ~(value : mailbox_action_category_value) () =
  (Category { value } : mailbox_action)

type nonrec mailbox_operation_state =
  | Pending
  | Applied
  | Failed
  | Cancelled
  | Unknown of string  (** A value this SDK version does not know. *)

let mailbox_operation_state_of_yojson : Yojson.Safe.t -> mailbox_operation_state
    =
 fun json ->
  match Json.string json with
  | "pending" -> Pending
  | "applied" -> Applied
  | "failed" -> Failed
  | "cancelled" -> Cancelled
  | other -> Json.unknown "mailbox_operation_state" json (Unknown other)

and yojson_of_mailbox_operation_state : mailbox_operation_state -> Yojson.Safe.t
    =
 fun value ->
  match value with
  | Pending -> `String "pending"
  | Applied -> `String "applied"
  | Failed -> `String "failed"
  | Cancelled -> `String "cancelled"
  | Unknown other -> `String other

type nonrec mailbox_operation = {
  action : mailbox_action;
  id : string;
  state : mailbox_operation_state;
  updated_at : string;
}
(** Durable outcome of an accepted organization action. *)

let mailbox_operation_of_yojson : Yojson.Safe.t -> mailbox_operation =
 fun json ->
  let fields = Json.obj json in
  {
    action = Json.required fields "action" mailbox_action_of_yojson;
    id = Json.required fields "id" Json.string;
    state = Json.required fields "state" mailbox_operation_state_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_mailbox_operation : mailbox_operation -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("action", Some (yojson_of_mailbox_action value.action));
      ("id", Some (Json.of_string value.id));
      ("state", Some (yojson_of_mailbox_operation_state value.state));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_mailbox_operation ~(action : mailbox_action) ~(id : string)
    ~(state : mailbox_operation_state) ~(updated_at : string) () =
  ({ action; id; state; updated_at } : mailbox_operation)

type nonrec mailbox_settings_change =
  | Create_label
  | Delete_label
  | Sender_block
  | Unknown of string  (** A value this SDK version does not know. *)

let mailbox_settings_change_of_yojson : Yojson.Safe.t -> mailbox_settings_change
    =
 fun json ->
  match Json.string json with
  | "create_label" -> Create_label
  | "delete_label" -> Delete_label
  | "sender_block" -> Sender_block
  | other -> Json.unknown "mailbox_settings_change" json (Unknown other)

and yojson_of_mailbox_settings_change : mailbox_settings_change -> Yojson.Safe.t
    =
 fun value ->
  match value with
  | Create_label -> `String "create_label"
  | Delete_label -> `String "delete_label"
  | Sender_block -> `String "sender_block"
  | Unknown other -> `String other

type nonrec mailbox_settings_operation = {
  enabled : bool;
  id : string;
  kind : mailbox_settings_change;
  needs_attention : bool;
  resource : string;
}
(** An accepted inbox configuration change awaiting provider confirmation. *)

let mailbox_settings_operation_of_yojson :
    Yojson.Safe.t -> mailbox_settings_operation =
 fun json ->
  let fields = Json.obj json in
  {
    enabled = Json.required fields "enabled" Json.bool;
    id = Json.required fields "id" Json.string;
    kind = Json.required fields "kind" mailbox_settings_change_of_yojson;
    needs_attention = Json.required fields "needs_attention" Json.bool;
    resource = Json.required fields "resource" Json.string;
  }

and yojson_of_mailbox_settings_operation :
    mailbox_settings_operation -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("enabled", Some (Json.of_bool value.enabled));
      ("id", Some (Json.of_string value.id));
      ("kind", Some (yojson_of_mailbox_settings_change value.kind));
      ("needs_attention", Some (Json.of_bool value.needs_attention));
      ("resource", Some (Json.of_string value.resource));
    ]

let make_mailbox_settings_operation ~(enabled : bool) ~(id : string)
    ~(kind : mailbox_settings_change) ~(needs_attention : bool)
    ~(resource : string) () =
  ({ enabled; id; kind; needs_attention; resource }
    : mailbox_settings_operation)

type nonrec message_operation_response = {
  operation : api_message_operation option;
}
(** Authorized polling response. Gmail has no asynchronous draft operation. *)

let message_operation_response_of_yojson :
    Yojson.Safe.t -> message_operation_response =
 fun json ->
  let fields = Json.obj json in
  {
    operation = Json.optional fields "operation" api_message_operation_of_yojson;
  }

and yojson_of_message_operation_response :
    message_operation_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("operation", Option.map yojson_of_api_message_operation value.operation);
    ]

let make_message_operation_response ?operation () =
  ({ operation } : message_operation_response)

type nonrec message_read_receipt = {
  first_opened_at : string option;  (** First counted fetch. *)
  last_opened_at : string option;  (** Latest counted fetch. *)
  message_id : string;  (** The tracked message. *)
  open_count : int;  (** Counted pixel fetches. *)
}
(** Open state of one tracked, sent message. *)

let message_read_receipt_of_yojson : Yojson.Safe.t -> message_read_receipt =
 fun json ->
  let fields = Json.obj json in
  {
    first_opened_at = Json.optional fields "first_opened_at" Json.string;
    last_opened_at = Json.optional fields "last_opened_at" Json.string;
    message_id = Json.required fields "message_id" Json.string;
    open_count = Json.required fields "open_count" Json.int;
  }

and yojson_of_message_read_receipt : message_read_receipt -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("first_opened_at", Option.map Json.of_string value.first_opened_at);
      ("last_opened_at", Option.map Json.of_string value.last_opened_at);
      ("message_id", Some (Json.of_string value.message_id));
      ("open_count", Some (Json.of_int value.open_count));
    ]

let make_message_read_receipt ?first_opened_at ?last_opened_at
    ~(message_id : string) ~(open_count : int) () =
  ({ first_opened_at; last_opened_at; message_id; open_count }
    : message_read_receipt)

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

let parsed_message_of_yojson : Yojson.Safe.t -> parsed_message =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.required fields "bcc" (Json.list contact_info_of_yojson);
    body_parsed = Json.optional fields "body_parsed" Json.string;
    cc = Json.required fields "cc" (Json.list contact_info_of_yojson);
    db_id = Json.required fields "db_id" Json.string;
    draft_generation = Json.optional fields "draft_generation" Json.int;
    from = Json.optional fields "from" contact_info_of_yojson;
    internal_date_ts = Json.optional fields "internal_date_ts" Json.string;
    labels = Json.required fields "labels" (Json.list label_info_of_yojson);
    link_id = Json.required fields "link_id" Json.string;
    subject = Json.optional fields "subject" Json.string;
    thread_db_id = Json.required fields "thread_db_id" Json.string;
    to_ = Json.required fields "to" (Json.list contact_info_of_yojson);
  }

and yojson_of_parsed_message : parsed_message -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Some ((Json.of_list yojson_of_contact_info) value.bcc));
      ("body_parsed", Option.map Json.of_string value.body_parsed);
      ("cc", Some ((Json.of_list yojson_of_contact_info) value.cc));
      ("db_id", Some (Json.of_string value.db_id));
      ("draft_generation", Option.map Json.of_int value.draft_generation);
      ("from", Option.map yojson_of_contact_info value.from);
      ("internal_date_ts", Option.map Json.of_string value.internal_date_ts);
      ("labels", Some ((Json.of_list yojson_of_label_info) value.labels));
      ("link_id", Some (Json.of_string value.link_id));
      ("subject", Option.map Json.of_string value.subject);
      ("thread_db_id", Some (Json.of_string value.thread_db_id));
      ("to", Some ((Json.of_list yojson_of_contact_info) value.to_));
    ]

let make_parsed_message ~(bcc : contact_info list) ?body_parsed
    ~(cc : contact_info list) ~(db_id : string) ?draft_generation ?from
    ?internal_date_ts ~(labels : label_info list) ~(link_id : string) ?subject
    ~(thread_db_id : string) ~(to_ : contact_info list) () =
  ({
     bcc;
     body_parsed;
     cc;
     db_id;
     draft_generation;
     from;
     internal_date_ts;
     labels;
     link_id;
     subject;
     thread_db_id;
     to_;
   }
    : parsed_message)

type nonrec patch_settings_request = { settings : settings }

let patch_settings_request_of_yojson : Yojson.Safe.t -> patch_settings_request =
 fun json ->
  let fields = Json.obj json in
  { settings = Json.required fields "settings" settings_of_yojson }

and yojson_of_patch_settings_request : patch_settings_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("settings", Some (yojson_of_settings value.settings)) ]

let make_patch_settings_request ~(settings : settings) () =
  ({ settings } : patch_settings_request)

type nonrec patch_settings_response = { settings : settings }

let patch_settings_response_of_yojson : Yojson.Safe.t -> patch_settings_response
    =
 fun json ->
  let fields = Json.obj json in
  { settings = Json.required fields "settings" settings_of_yojson }

and yojson_of_patch_settings_response : patch_settings_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record [ ("settings", Some (yojson_of_settings value.settings)) ]

let make_patch_settings_response ~(settings : settings) () =
  ({ settings } : patch_settings_response)

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

let preview_view_1_of_yojson : Yojson.Safe.t -> preview_view_1 =
 fun json ->
  match Json.string json with
  | "inbox" -> Inbox
  | "sent" -> Sent
  | "drafts" -> Drafts
  | "starred" -> Starred
  | "all" -> All
  | "spam" -> Spam
  | "trash" -> Trash
  | "important" -> Important
  | "other" -> Other
  | other -> Json.unknown "preview_view_1" json (Unknown other)

and yojson_of_preview_view_1 : preview_view_1 -> Yojson.Safe.t =
 fun value ->
  match value with
  | Inbox -> `String "inbox"
  | Sent -> `String "sent"
  | Drafts -> `String "drafts"
  | Starred -> `String "starred"
  | All -> `String "all"
  | Spam -> `String "spam"
  | Trash -> `String "trash"
  | Important -> `String "important"
  | Other -> `String "other"
  | Unknown other -> `String other

(** View type. Supported values include standard labels and a custom user label user:<label> *)
type nonrec preview_view =
  | Preview_view_1 of preview_view_1
  | String of string
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let preview_view_of_yojson : Yojson.Safe.t -> preview_view =
 fun json ->
  match
    Json.first_ok
      [
        (fun json ->
          Preview_view_1
            (match preview_view_1_of_yojson json with
            | Unknown _ -> Json.fail "unknown value"
            | known -> known));
        (fun json -> String (Json.string json));
      ]
      json
  with
  | Some value -> value
  | None -> Json.unknown "preview_view" json (Unknown json)

and yojson_of_preview_view : preview_view -> Yojson.Safe.t =
 fun value ->
  match value with
  | Preview_view_1 inner -> yojson_of_preview_view_1 inner
  | String inner -> Json.of_string inner
  | Unknown json -> json

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

let preview_view_standard_label_of_yojson :
    Yojson.Safe.t -> preview_view_standard_label =
 fun json ->
  match Json.string json with
  | "inbox" -> Inbox
  | "sent" -> Sent
  | "drafts" -> Drafts
  | "starred" -> Starred
  | "all" -> All
  | "spam" -> Spam
  | "trash" -> Trash
  | "important" -> Important
  | "other" -> Other
  | other -> Json.unknown "preview_view_standard_label" json (Unknown other)

and yojson_of_preview_view_standard_label :
    preview_view_standard_label -> Yojson.Safe.t =
 fun value ->
  match value with
  | Inbox -> `String "inbox"
  | Sent -> `String "sent"
  | Drafts -> `String "drafts"
  | Starred -> `String "starred"
  | All -> `String "all"
  | Spam -> `String "spam"
  | Trash -> `String "trash"
  | Important -> `String "important"
  | Other -> `String "other"
  | Unknown other -> `String other

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

let refresh_email_event_of_yojson : Yojson.Safe.t -> refresh_email_event =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "event" with
  | "backfill" ->
      Backfill
        {
          link_id = Json.required fields "link_id" Json.string;
          status = Json.required fields "status" backfill_status_of_yojson;
        }
  | "upsert_message" ->
      Upsert_message { link_id = Json.required fields "link_id" Json.string }
  | "update_labels" ->
      Update_labels { link_id = Json.required fields "link_id" Json.string }
  | "delete_message" ->
      Delete_message { link_id = Json.required fields "link_id" Json.string }
  | "link_removed" ->
      Link_removed { link_id = Json.required fields "link_id" Json.string }
  | "photo_synced" ->
      Photo_synced { link_id = Json.required fields "link_id" Json.string }
  | "backfill_progress" ->
      Backfill_progress
        {
          completed_threads = Json.required fields "completed_threads" Json.int;
          link_id = Json.required fields "link_id" Json.string;
          status = Json.required fields "status" backfill_status_of_yojson;
          total_threads = Json.required fields "total_threads" Json.int;
        }
  | "focus_updated" ->
      Focus_updated
        {
          link_id = Json.required fields "link_id" Json.string;
          traceparent = Json.optional fields "traceparent" Json.string;
        }
  | _ -> Json.unknown "refresh_email_event" json (Unknown json)

and yojson_of_refresh_email_event : refresh_email_event -> Yojson.Safe.t =
 fun value ->
  match value with
  | Backfill case ->
      Json.record
        [
          ("event", Some (`String "backfill"));
          ("link_id", Some (Json.of_string case.link_id));
          ("status", Some (yojson_of_backfill_status case.status));
        ]
  | Upsert_message case ->
      Json.record
        [
          ("event", Some (`String "upsert_message"));
          ("link_id", Some (Json.of_string case.link_id));
        ]
  | Update_labels case ->
      Json.record
        [
          ("event", Some (`String "update_labels"));
          ("link_id", Some (Json.of_string case.link_id));
        ]
  | Delete_message case ->
      Json.record
        [
          ("event", Some (`String "delete_message"));
          ("link_id", Some (Json.of_string case.link_id));
        ]
  | Link_removed case ->
      Json.record
        [
          ("event", Some (`String "link_removed"));
          ("link_id", Some (Json.of_string case.link_id));
        ]
  | Photo_synced case ->
      Json.record
        [
          ("event", Some (`String "photo_synced"));
          ("link_id", Some (Json.of_string case.link_id));
        ]
  | Backfill_progress case ->
      Json.record
        [
          ("event", Some (`String "backfill_progress"));
          ("completed_threads", Some (Json.of_int case.completed_threads));
          ("link_id", Some (Json.of_string case.link_id));
          ("status", Some (yojson_of_backfill_status case.status));
          ("total_threads", Some (Json.of_int case.total_threads));
        ]
  | Focus_updated case ->
      Json.record
        [
          ("event", Some (`String "focus_updated"));
          ("link_id", Some (Json.of_string case.link_id));
          ("traceparent", Option.map Json.of_string case.traceparent);
        ]
  | Unknown json -> json

let make_refresh_email_event_backfill ~(link_id : string)
    ~(status : backfill_status) () =
  (Backfill { link_id; status } : refresh_email_event)

let make_refresh_email_event_upsert_message ~(link_id : string) () =
  (Upsert_message { link_id } : refresh_email_event)

let make_refresh_email_event_update_labels ~(link_id : string) () =
  (Update_labels { link_id } : refresh_email_event)

let make_refresh_email_event_delete_message ~(link_id : string) () =
  (Delete_message { link_id } : refresh_email_event)

let make_refresh_email_event_link_removed ~(link_id : string) () =
  (Link_removed { link_id } : refresh_email_event)

let make_refresh_email_event_photo_synced ~(link_id : string) () =
  (Photo_synced { link_id } : refresh_email_event)

let make_refresh_email_event_backfill_progress ~(completed_threads : int)
    ~(link_id : string) ~(status : backfill_status) ~(total_threads : int) () =
  (Backfill_progress { completed_threads; link_id; status; total_threads }
    : refresh_email_event)

let make_refresh_email_event_focus_updated ~(link_id : string) ?traceparent () =
  (Focus_updated { link_id; traceparent } : refresh_email_event)

type nonrec resolve_message_operation_request = {
  accept_duplicate_risk : bool option;
  action : api_message_resolution_action;
  remote_version : string option;
  revision : string;
}
(** Stale versions fail without altering the current operation. *)

let resolve_message_operation_request_of_yojson :
    Yojson.Safe.t -> resolve_message_operation_request =
 fun json ->
  let fields = Json.obj json in
  {
    accept_duplicate_risk =
      Json.optional fields "accept_duplicate_risk" Json.bool;
    action =
      Json.required fields "action" api_message_resolution_action_of_yojson;
    remote_version = Json.optional fields "remote_version" Json.string;
    revision = Json.required fields "revision" Json.string;
  }

and yojson_of_resolve_message_operation_request :
    resolve_message_operation_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "accept_duplicate_risk",
        Option.map Json.of_bool value.accept_duplicate_risk );
      ("action", Some (yojson_of_api_message_resolution_action value.action));
      ("remote_version", Option.map Json.of_string value.remote_version);
      ("revision", Some (Json.of_string value.revision));
    ]

let make_resolve_message_operation_request ?accept_duplicate_risk
    ~(action : api_message_resolution_action) ?remote_version
    ~(revision : string) () =
  ({ accept_duplicate_risk; action; remote_version; revision }
    : resolve_message_operation_request)

type nonrec resync_response = {
  already_in_progress : bool;
      (** True when a backfill was already running and this call was a no-op. *)
  backfill_job_id : string;
      (** Opaque ID of the backfill job or provider sync stream driving the resync.
the one already in progress. *)
}
(** The response returned from the resync endpoint. *)

let resync_response_of_yojson : Yojson.Safe.t -> resync_response =
 fun json ->
  let fields = Json.obj json in
  {
    already_in_progress = Json.required fields "already_in_progress" Json.bool;
    backfill_job_id = Json.required fields "backfill_job_id" Json.string;
  }

and yojson_of_resync_response : resync_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("already_in_progress", Some (Json.of_bool value.already_in_progress));
      ("backfill_job_id", Some (Json.of_string value.backfill_job_id));
    ]

let make_resync_response ~(already_in_progress : bool)
    ~(backfill_job_id : string) () =
  ({ already_in_progress; backfill_job_id } : resync_response)

type nonrec send_message_request = {
  message : api_draft_input;  (** The message content. *)
}
(** Request body for sending a message (backward-compatible with [{ message: MessageToSend }]). *)

let send_message_request_of_yojson : Yojson.Safe.t -> send_message_request =
 fun json ->
  let fields = Json.obj json in
  { message = Json.required fields "message" api_draft_input_of_yojson }

and yojson_of_send_message_request : send_message_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("message", Some (yojson_of_api_draft_input value.message)) ]

let make_send_message_request ~(message : api_draft_input) () =
  ({ message } : send_message_request)

type nonrec send_message_response = {
  message : api_draft_output;  (** The created message. *)
}
(** Response body for sending a message. *)

let send_message_response_of_yojson : Yojson.Safe.t -> send_message_response =
 fun json ->
  let fields = Json.obj json in
  { message = Json.required fields "message" api_draft_output_of_yojson }

and yojson_of_send_message_response : send_message_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("message", Some (yojson_of_api_draft_output value.message)) ]

let make_send_message_response ~(message : api_draft_output) () =
  ({ message } : send_message_response)

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

let shared_inbox_conflict_response_of_yojson :
    Yojson.Safe.t -> shared_inbox_conflict_response =
 fun json ->
  let fields = Json.obj json in
  {
    email_address = Json.required fields "email_address" Json.string;
    existing_link_id = Json.required fields "existing_link_id" Json.string;
    existing_owner_email =
      Json.required fields "existing_owner_email" Json.string;
  }

and yojson_of_shared_inbox_conflict_response :
    shared_inbox_conflict_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email_address", Some (Json.of_string value.email_address));
      ("existing_link_id", Some (Json.of_string value.existing_link_id));
      ("existing_owner_email", Some (Json.of_string value.existing_owner_email));
    ]

let make_shared_inbox_conflict_response ~(email_address : string)
    ~(existing_link_id : string) ~(existing_owner_email : string) () =
  ({ email_address; existing_link_id; existing_owner_email }
    : shared_inbox_conflict_response)

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

let thread_of_yojson : Yojson.Safe.t -> thread =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    db_id = Json.required fields "db_id" Json.string;
    inbox_visible = Json.required fields "inbox_visible" Json.bool;
    is_read = Json.required fields "is_read" Json.bool;
    latest_inbound_message_ts =
      Json.optional fields "latest_inbound_message_ts" Json.string;
    latest_non_spam_message_ts =
      Json.optional fields "latest_non_spam_message_ts" Json.string;
    latest_outbound_message_ts =
      Json.optional fields "latest_outbound_message_ts" Json.string;
    link_id = Json.required fields "link_id" Json.string;
    messages = Json.required fields "messages" (Json.list message_of_yojson);
    provider_id = Json.optional fields "provider_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_thread : thread -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("db_id", Some (Json.of_string value.db_id));
      ("inbox_visible", Some (Json.of_bool value.inbox_visible));
      ("is_read", Some (Json.of_bool value.is_read));
      ( "latest_inbound_message_ts",
        Option.map Json.of_string value.latest_inbound_message_ts );
      ( "latest_non_spam_message_ts",
        Option.map Json.of_string value.latest_non_spam_message_ts );
      ( "latest_outbound_message_ts",
        Option.map Json.of_string value.latest_outbound_message_ts );
      ("link_id", Some (Json.of_string value.link_id));
      ("messages", Some ((Json.of_list yojson_of_message) value.messages));
      ("provider_id", Option.map Json.of_string value.provider_id);
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_thread ~(created_at : string) ~(db_id : string) ~(inbox_visible : bool)
    ~(is_read : bool) ?latest_inbound_message_ts ?latest_non_spam_message_ts
    ?latest_outbound_message_ts ~(link_id : string) ~(messages : message list)
    ?provider_id ~(updated_at : string) () =
  ({
     created_at;
     db_id;
     inbox_visible;
     is_read;
     latest_inbound_message_ts;
     latest_non_spam_message_ts;
     latest_outbound_message_ts;
     link_id;
     messages;
     provider_id;
     updated_at;
   }
    : thread)

type nonrec thread_summary = { provider_id : string }

let thread_summary_of_yojson : Yojson.Safe.t -> thread_summary =
 fun json ->
  let fields = Json.obj json in
  { provider_id = Json.required fields "provider_id" Json.string }

and yojson_of_thread_summary : thread_summary -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("provider_id", Some (Json.of_string value.provider_id)) ]

let make_thread_summary ~(provider_id : string) () =
  ({ provider_id } : thread_summary)

type nonrec thread_list = {
  next_page_token : string option;
  threads : thread_summary list;
}

let thread_list_of_yojson : Yojson.Safe.t -> thread_list =
 fun json ->
  let fields = Json.obj json in
  {
    next_page_token = Json.optional fields "next_page_token" Json.string;
    threads =
      Json.required fields "threads" (Json.list thread_summary_of_yojson);
  }

and yojson_of_thread_list : thread_list -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("next_page_token", Option.map Json.of_string value.next_page_token);
      ("threads", Some ((Json.of_list yojson_of_thread_summary) value.threads));
    ]

let make_thread_list ?next_page_token ~(threads : thread_summary list) () =
  ({ next_page_token; threads } : thread_list)

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

let thread_preview_cursor_of_yojson : Yojson.Safe.t -> thread_preview_cursor =
 fun json ->
  let fields = Json.obj json in
  {
    attachments =
      Json.required fields "attachments" (Json.list attachment_of_yojson);
    created_at = Json.required fields "createdAt" Json.string;
    id = Json.required fields "id" Json.string;
    inbox_visible = Json.required fields "inboxVisible" Json.bool;
    is_draft = Json.required fields "isDraft" Json.bool;
    is_important = Json.required fields "isImportant" Json.bool;
    is_read = Json.required fields "isRead" Json.bool;
    name = Json.optional fields "name" Json.string;
    owner_id = Json.required fields "ownerId" Json.string;
    participants =
      Json.required fields "participants" (Json.list contact_of_yojson);
    provider_id = Json.optional fields "providerId" Json.string;
    sender_email = Json.optional fields "senderEmail" Json.string;
    sender_name = Json.optional fields "senderName" Json.string;
    sender_photo_url = Json.optional fields "senderPhotoUrl" Json.string;
    snippet = Json.optional fields "snippet" Json.string;
    sort_ts = Json.required fields "sortTs" Json.string;
    updated_at = Json.required fields "updatedAt" Json.string;
    viewed_at = Json.optional fields "viewedAt" Json.string;
  }

and yojson_of_thread_preview_cursor : thread_preview_cursor -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attachments",
        Some ((Json.of_list yojson_of_attachment) value.attachments) );
      ("createdAt", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("inboxVisible", Some (Json.of_bool value.inbox_visible));
      ("isDraft", Some (Json.of_bool value.is_draft));
      ("isImportant", Some (Json.of_bool value.is_important));
      ("isRead", Some (Json.of_bool value.is_read));
      ("name", Option.map Json.of_string value.name);
      ("ownerId", Some (Json.of_string value.owner_id));
      ( "participants",
        Some ((Json.of_list yojson_of_contact) value.participants) );
      ("providerId", Option.map Json.of_string value.provider_id);
      ("senderEmail", Option.map Json.of_string value.sender_email);
      ("senderName", Option.map Json.of_string value.sender_name);
      ("senderPhotoUrl", Option.map Json.of_string value.sender_photo_url);
      ("snippet", Option.map Json.of_string value.snippet);
      ("sortTs", Some (Json.of_string value.sort_ts));
      ("updatedAt", Some (Json.of_string value.updated_at));
      ("viewedAt", Option.map Json.of_string value.viewed_at);
    ]

let make_thread_preview_cursor ~(attachments : attachment list)
    ~(created_at : string) ~(id : string) ~(inbox_visible : bool)
    ~(is_draft : bool) ~(is_important : bool) ~(is_read : bool) ?name
    ~(owner_id : string) ~(participants : contact list) ?provider_id
    ?sender_email ?sender_name ?sender_photo_url ?snippet ~(sort_ts : string)
    ~(updated_at : string) ?viewed_at () =
  ({
     attachments;
     created_at;
     id;
     inbox_visible;
     is_draft;
     is_important;
     is_read;
     name;
     owner_id;
     participants;
     provider_id;
     sender_email;
     sender_name;
     sender_photo_url;
     snippet;
     sort_ts;
     updated_at;
     viewed_at;
   }
    : thread_preview_cursor)

type nonrec thread_read_receipts = { receipts : message_read_receipt list }
(** Open state of the caller's tracked, sent messages in one thread. *)

let thread_read_receipts_of_yojson : Yojson.Safe.t -> thread_read_receipts =
 fun json ->
  let fields = Json.obj json in
  {
    receipts =
      Json.required fields "receipts" (Json.list message_read_receipt_of_yojson);
  }

and yojson_of_thread_read_receipts : thread_read_receipts -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "receipts",
        Some ((Json.of_list yojson_of_message_read_receipt) value.receipts) );
    ]

let make_thread_read_receipts ~(receipts : message_read_receipt list) () =
  ({ receipts } : thread_read_receipts)

(** Semantic mailbox facts, independent of folder/category names. *)
type nonrec thread_state_field =
  | Read
  | Starred
  | Trashed
  | Junk
  | Unknown of string  (** A value this SDK version does not know. *)

let thread_state_field_of_yojson : Yojson.Safe.t -> thread_state_field =
 fun json ->
  match Json.string json with
  | "read" -> Read
  | "starred" -> Starred
  | "trashed" -> Trashed
  | "junk" -> Junk
  | other -> Json.unknown "thread_state_field" json (Unknown other)

and yojson_of_thread_state_field : thread_state_field -> Yojson.Safe.t =
 fun value ->
  match value with
  | Read -> `String "read"
  | Starred -> `String "starred"
  | Trashed -> `String "trashed"
  | Junk -> `String "junk"
  | Unknown other -> `String other

type nonrec transfer_draft_request = {
  destination_link_id : string;
  draft_generation : int option;
      (** Generation captured with the source draft. *)
  operation_id : string;
}
(** Reuse the same operation ID when retrying after a lost response. *)

let transfer_draft_request_of_yojson : Yojson.Safe.t -> transfer_draft_request =
 fun json ->
  let fields = Json.obj json in
  {
    destination_link_id = Json.required fields "destination_link_id" Json.string;
    draft_generation = Json.optional fields "draft_generation" Json.int;
    operation_id = Json.required fields "operation_id" Json.string;
  }

and yojson_of_transfer_draft_request : transfer_draft_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("destination_link_id", Some (Json.of_string value.destination_link_id));
      ("draft_generation", Option.map Json.of_int value.draft_generation);
      ("operation_id", Some (Json.of_string value.operation_id));
    ]

let make_transfer_draft_request ~(destination_link_id : string)
    ?draft_generation ~(operation_id : string) () =
  ({ destination_link_id; draft_generation; operation_id }
    : transfer_draft_request)

type nonrec transfer_draft_response = {
  attachments : api_attachment_draft list;
  message_id : string;
  source_id : string;
  source_thread_id : string;
  thread_id : string;
}
(** A new identity prevents delayed writes from mutating the moved copy. *)

let transfer_draft_response_of_yojson : Yojson.Safe.t -> transfer_draft_response
    =
 fun json ->
  let fields = Json.obj json in
  {
    attachments =
      Json.required fields "attachments"
        (Json.list api_attachment_draft_of_yojson);
    message_id = Json.required fields "message_id" Json.string;
    source_id = Json.required fields "source_id" Json.string;
    source_thread_id = Json.required fields "source_thread_id" Json.string;
    thread_id = Json.required fields "thread_id" Json.string;
  }

and yojson_of_transfer_draft_response : transfer_draft_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ( "attachments",
        Some ((Json.of_list yojson_of_api_attachment_draft) value.attachments)
      );
      ("message_id", Some (Json.of_string value.message_id));
      ("source_id", Some (Json.of_string value.source_id));
      ("source_thread_id", Some (Json.of_string value.source_thread_id));
      ("thread_id", Some (Json.of_string value.thread_id));
    ]

let make_transfer_draft_response ~(attachments : api_attachment_draft list)
    ~(message_id : string) ~(source_id : string) ~(source_thread_id : string)
    ~(thread_id : string) () =
  ({ attachments; message_id; source_id; source_thread_id; thread_id }
    : transfer_draft_response)

type nonrec transfer_recovery_response = {
  committed : transfer_draft_response option;
}
(** A null result confirms that the move cannot commit, even if its request was delayed. *)

let transfer_recovery_response_of_yojson :
    Yojson.Safe.t -> transfer_recovery_response =
 fun json ->
  let fields = Json.obj json in
  {
    committed =
      Json.optional fields "committed" transfer_draft_response_of_yojson;
  }

and yojson_of_transfer_recovery_response :
    transfer_recovery_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("committed", Option.map yojson_of_transfer_draft_response value.committed);
    ]

let make_transfer_recovery_response ?committed () =
  ({ committed } : transfer_recovery_response)

type nonrec unblock_sender_request = {
  email_address : string;  (** The email address of the sender to unblock. *)
}
(** Request to unblock a sender. *)

let unblock_sender_request_of_yojson : Yojson.Safe.t -> unblock_sender_request =
 fun json ->
  let fields = Json.obj json in
  { email_address = Json.required fields "email_address" Json.string }

and yojson_of_unblock_sender_request : unblock_sender_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("email_address", Some (Json.of_string value.email_address)) ]

let make_unblock_sender_request ~(email_address : string) () =
  ({ email_address } : unblock_sender_request)

type nonrec unresolved_signature_images_error = { unresolved_image_count : int }
(** Body returned with a 422 when signature images can't be loaded. *)

let unresolved_signature_images_error_of_yojson :
    Yojson.Safe.t -> unresolved_signature_images_error =
 fun json ->
  let fields = Json.obj json in
  {
    unresolved_image_count =
      Json.required fields "unresolved_image_count" Json.int;
  }

and yojson_of_unresolved_signature_images_error :
    unresolved_signature_images_error -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("unresolved_image_count", Some (Json.of_int value.unresolved_image_count));
    ]

let make_unresolved_signature_images_error ~(unresolved_image_count : int) () =
  ({ unresolved_image_count } : unresolved_signature_images_error)

type nonrec update_label_batch_request = {
  label_id : string;
  message_ids : string list;
  value : bool;
}

let update_label_batch_request_of_yojson :
    Yojson.Safe.t -> update_label_batch_request =
 fun json ->
  let fields = Json.obj json in
  {
    label_id = Json.required fields "label_id" Json.string;
    message_ids = Json.required fields "message_ids" (Json.list Json.string);
    value = Json.required fields "value" Json.bool;
  }

and yojson_of_update_label_batch_request :
    update_label_batch_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("label_id", Some (Json.of_string value.label_id));
      ("message_ids", Some ((Json.of_list Json.of_string) value.message_ids));
      ("value", Some (Json.of_bool value.value));
    ]

let make_update_label_batch_request ~(label_id : string)
    ~(message_ids : string list) ~(value : bool) () =
  ({ label_id; message_ids; value } : update_label_batch_request)

type nonrec update_label_batch_response = {
  failed_ids : string list;
  missing_ids : string list;
  successful_ids : string list;
}

let update_label_batch_response_of_yojson :
    Yojson.Safe.t -> update_label_batch_response =
 fun json ->
  let fields = Json.obj json in
  {
    failed_ids = Json.required fields "failed_ids" (Json.list Json.string);
    missing_ids = Json.required fields "missing_ids" (Json.list Json.string);
    successful_ids =
      Json.required fields "successful_ids" (Json.list Json.string);
  }

and yojson_of_update_label_batch_response :
    update_label_batch_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("failed_ids", Some ((Json.of_list Json.of_string) value.failed_ids));
      ("missing_ids", Some ((Json.of_list Json.of_string) value.missing_ids));
      ( "successful_ids",
        Some ((Json.of_list Json.of_string) value.successful_ids) );
    ]

let make_update_label_batch_response ~(failed_ids : string list)
    ~(missing_ids : string list) ~(successful_ids : string list) () =
  ({ failed_ids; missing_ids; successful_ids } : update_label_batch_response)

type nonrec update_thread_label_request = { label_id : string; value : bool }
(** Request body for updating a thread's labels. *)

let update_thread_label_request_of_yojson :
    Yojson.Safe.t -> update_thread_label_request =
 fun json ->
  let fields = Json.obj json in
  {
    label_id = Json.required fields "label_id" Json.string;
    value = Json.required fields "value" Json.bool;
  }

and yojson_of_update_thread_label_request :
    update_thread_label_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("label_id", Some (Json.of_string value.label_id));
      ("value", Some (Json.of_bool value.value));
    ]

let make_update_thread_label_request ~(label_id : string) ~(value : bool) () =
  ({ label_id; value } : update_thread_label_request)

type nonrec update_thread_labels_response = {
  failed_ids : string list;
  successful_ids : string list;
}
(** Response body for updating a thread's labels. *)

let update_thread_labels_response_of_yojson :
    Yojson.Safe.t -> update_thread_labels_response =
 fun json ->
  let fields = Json.obj json in
  {
    failed_ids = Json.required fields "failed_ids" (Json.list Json.string);
    successful_ids =
      Json.required fields "successful_ids" (Json.list Json.string);
  }

and yojson_of_update_thread_labels_response :
    update_thread_labels_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("failed_ids", Some ((Json.of_list Json.of_string) value.failed_ids));
      ( "successful_ids",
        Some ((Json.of_list Json.of_string) value.successful_ids) );
    ]

let make_update_thread_labels_response ~(failed_ids : string list)
    ~(successful_ids : string list) () =
  ({ failed_ids; successful_ids } : update_thread_labels_response)

type nonrec update_thread_project_request = {
  project_id : string option;
      (** The project ID to assign to the thread, or null to remove from project. *)
}
(** Request body for updating a thread's project. *)

let update_thread_project_request_of_yojson :
    Yojson.Safe.t -> update_thread_project_request =
 fun json ->
  let fields = Json.obj json in
  { project_id = Json.optional fields "projectId" Json.string }

and yojson_of_update_thread_project_request :
    update_thread_project_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("projectId", Option.map Json.of_string value.project_id) ]

let make_update_thread_project_request ?project_id () =
  ({ project_id } : update_thread_project_request)

type nonrec update_thread_project_response = {
  old_project_id : string option;  (** The previous project ID of the thread. *)
}
(** Response body for updating a thread's project. *)

let update_thread_project_response_of_yojson :
    Yojson.Safe.t -> update_thread_project_response =
 fun json ->
  let fields = Json.obj json in
  { old_project_id = Json.optional fields "oldProjectId" Json.string }

and yojson_of_update_thread_project_response :
    update_thread_project_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("oldProjectId", Option.map Json.of_string value.old_project_id) ]

let make_update_thread_project_response ?old_project_id () =
  ({ old_project_id } : update_thread_project_response)

type nonrec update_thread_state_request = {
  field : thread_state_field;
  value : bool;
}
(** Desired state for every applicable message in an authorized thread. *)

let update_thread_state_request_of_yojson :
    Yojson.Safe.t -> update_thread_state_request =
 fun json ->
  let fields = Json.obj json in
  {
    field = Json.required fields "field" thread_state_field_of_yojson;
    value = Json.required fields "value" Json.bool;
  }

and yojson_of_update_thread_state_request :
    update_thread_state_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("field", Some (yojson_of_thread_state_field value.field));
      ("value", Some (Json.of_bool value.value));
    ]

let make_update_thread_state_request ~(field : thread_state_field)
    ~(value : bool) () =
  ({ field; value } : update_thread_state_request)

type nonrec upsert_email_filter_request = {
  email_address : string option;
      (** Exact email address to match. Mutually exclusive with [email_domain]. *)
  email_domain : string option;
      (** Email domain to match. Mutually exclusive with [email_address]. *)
  is_important : bool;
      (** Whether matching senders should be considered important. *)
}
(** Request body for creating or updating an email filter. *)

let upsert_email_filter_request_of_yojson :
    Yojson.Safe.t -> upsert_email_filter_request =
 fun json ->
  let fields = Json.obj json in
  {
    email_address = Json.optional fields "email_address" Json.string;
    email_domain = Json.optional fields "email_domain" Json.string;
    is_important = Json.required fields "is_important" Json.bool;
  }

and yojson_of_upsert_email_filter_request :
    upsert_email_filter_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email_address", Option.map Json.of_string value.email_address);
      ("email_domain", Option.map Json.of_string value.email_domain);
      ("is_important", Some (Json.of_bool value.is_important));
    ]

let make_upsert_email_filter_request ?email_address ?email_domain
    ~(is_important : bool) () =
  ({ email_address; email_domain; is_important } : upsert_email_filter_request)

type nonrec upsert_email_filter_response = { filter : api_email_filter }
(** Response body for upsert email filter. *)

let upsert_email_filter_response_of_yojson :
    Yojson.Safe.t -> upsert_email_filter_response =
 fun json ->
  let fields = Json.obj json in
  { filter = Json.required fields "filter" api_email_filter_of_yojson }

and yojson_of_upsert_email_filter_response :
    upsert_email_filter_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("filter", Some (yojson_of_api_email_filter value.filter)) ]

let make_upsert_email_filter_response ~(filter : api_email_filter) () =
  ({ filter } : upsert_email_filter_response)

type nonrec upsert_scheduled_request = {
  include_signature : bool option;
      (** Per-message signature override; absent uses the inbox's send defaults. *)
  send_time : string;  (** The time to send the message (ISO 8601 format). *)
  user_confirmation : string option;
      (** The user's own reply approving this send, quoted verbatim. Required
from an agent's program, which is refused without it; ignored for a
person in the app, whose Send Later is their confirmation. *)
}

let upsert_scheduled_request_of_yojson :
    Yojson.Safe.t -> upsert_scheduled_request =
 fun json ->
  let fields = Json.obj json in
  {
    include_signature = Json.optional fields "include_signature" Json.bool;
    send_time = Json.required fields "send_time" Json.string;
    user_confirmation = Json.optional fields "user_confirmation" Json.string;
  }

and yojson_of_upsert_scheduled_request :
    upsert_scheduled_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("include_signature", Option.map Json.of_bool value.include_signature);
      ("send_time", Some (Json.of_string value.send_time));
      ("user_confirmation", Option.map Json.of_string value.user_confirmation);
    ]

let make_upsert_scheduled_request ?include_signature ~(send_time : string)
    ?user_confirmation () =
  ({ include_signature; send_time; user_confirmation }
    : upsert_scheduled_request)

type nonrec upsert_scheduled_response = {
  message_id : string;
  send_time : string;
}

let upsert_scheduled_response_of_yojson :
    Yojson.Safe.t -> upsert_scheduled_response =
 fun json ->
  let fields = Json.obj json in
  {
    message_id = Json.required fields "message_id" Json.string;
    send_time = Json.required fields "send_time" Json.string;
  }

and yojson_of_upsert_scheduled_response :
    upsert_scheduled_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("message_id", Some (Json.of_string value.message_id));
      ("send_time", Some (Json.of_string value.send_time));
    ]

let make_upsert_scheduled_response ~(message_id : string) ~(send_time : string)
    () =
  ({ message_id; send_time } : upsert_scheduled_response)

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

(** [GET /email/attachments/{id}]

Get an attachment by ID. *)
let get_attachment ~(id : string) () =
  ({
     Request.service = "email";
     operation = "get_attachment";
     meth = `GET;
     path =
       String.concat ""
         [ "/email/attachments/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_attachment_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 401; 403; 404; 409; 429; 500 ]
         error_response_of_yojson;
   }
    : (get_attachment_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/attachments/{id}/document_id]

Get the Macro document id for an email attachment, uploading it if it doesn't already exist. *)
let get_attachment_document_id ~(id : string) () =
  ({
     Request.service = "email";
     operation = "get_attachment_document_id";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/attachments/";
           Request.segment ((fun value -> value) id);
           "/document_id";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_attachment_document_id_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : ( get_attachment_document_id_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /email/backfill/gmail]

List all backfill jobs for the authenticated user, across every link they
own. Scoped by the user's fusionauth id from the request context rather than
a single resolved link. *)
let list_backfill_gmail () =
  ({
     Request.service = "email";
     operation = "list_backfill_gmail";
     meth = `GET;
     path = "/email/backfill/gmail";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json list_backfill_jobs_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (list_backfill_jobs_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /email/backfill/gmail]

Cancel a backfill job. *)
let cancel_backfill_gmail ~(job_id : string) () =
  ({
     Request.service = "email";
     operation = "cancel_backfill_gmail";
     meth = `DELETE;
     path = "/email/backfill/gmail";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_cancel_backfill_params
               ({ job_id } : cancel_backfill_params)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 404; 429; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/backfill/gmail/active]

Get any active backfill job for the user. *)
let get_backfill_gmail_active () =
  ({
     Request.service = "email";
     operation = "get_backfill_gmail_active";
     meth = `GET;
     path = "/email/backfill/gmail/active";
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
                  (get_active_backfill_job_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : get_backfill_gmail_active_reply) );
           ( 204,
             fun body ->
               (No_content
                  (empty_response_of_yojson (Yojson.Safe.from_string body))
                 : get_backfill_gmail_active_reply) );
         ];
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : ( get_backfill_gmail_active_reply,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /email/backfill/gmail/{id}]

Get a backfill job. *)
let get_backfill_gmail ~(id : string) () =
  ({
     Request.service = "email";
     operation = "get_backfill_gmail";
     meth = `GET;
     path =
       String.concat ""
         [ "/email/backfill/gmail/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_backfill_job_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 500 ] error_response_of_yojson;
   }
    : (get_backfill_job_response, error_response) Macro_sdk_runtime.Request.t)

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
let forward_calendar_event ~(event_id : string)
    ~(to_ : forward_calendar_event_recipient list) ?body_text () =
  ({
     Request.service = "email";
     operation = "forward_calendar_event";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/calendar-events/";
           Request.segment ((fun value -> value) event_id);
           "/forward";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_forward_calendar_event_request
               ({ body_text; to_ } : forward_calendar_event_request)));
     decode_reply = Request.json forward_calendar_event_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 403; 404; 502 ]
         forward_calendar_event_error_of_yojson;
   }
    : ( forward_calendar_event_response,
        forward_calendar_event_error )
      Macro_sdk_runtime.Request.t)

(** [GET /email/contacts]

List all contacts belonging to the user, grouped by link. *)
let list_contacts () =
  ({
     Request.service = "email";
     operation = "list_contacts";
     meth = `GET;
     path = "/email/contacts";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json list_contacts_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (list_contacts_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/contacts/block]

Durably block a sender in the selected inbox. *)
let block_sender ~(email_address : string) () =
  ({
     Request.service = "email";
     operation = "block_sender";
     meth = `POST;
     path = "/email/contacts/block";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_block_sender_request
               ({ email_address } : block_sender_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/contacts/blocked]

List all blocked senders for the authenticated user. *)
let list_blocked_senders () =
  ({
     Request.service = "email";
     operation = "list_blocked_senders";
     meth = `GET;
     path = "/email/contacts/blocked";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json list_blocked_response_of_yojson;
     decode_error =
       Request.error_json
         [ 401; 403; 404; 409; 429; 500 ]
         error_response_of_yojson;
   }
    : (list_blocked_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/contacts/unblock]

Durably remove Macro-managed sender blocking in the selected inbox. *)
let unblock_sender ~(email_address : string) () =
  ({
     Request.service = "email";
     operation = "unblock_sender";
     meth = `POST;
     path = "/email/contacts/unblock";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_unblock_sender_request
               ({ email_address } : unblock_sender_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/draft-transfers/{id}/recover] *)
let recover_draft_transfer ~(id : string) () =
  ({
     Request.service = "email";
     operation = "recover_draft_transfer";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/draft-transfers/";
           Request.segment ((fun value -> value) id);
           "/recover";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json transfer_recovery_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( transfer_recovery_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /email/drafts]

Create a draft. *)
let create_draft ~(draft : api_draft_input) ?send_time () =
  ({
     Request.service = "email";
     operation = "create_draft";
     meth = `POST;
     path = "/email/drafts";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_draft_request
               ({ draft; send_time } : create_draft_request)));
     decode_reply = Request.json create_draft_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 404; 500 ] error_response_of_yojson;
   }
    : (create_draft_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/drafts/scheduled]

List scheduled drafts. *)
let get_scheduled_messages ?offset ?limit () =
  ({
     Request.service = "email";
     operation = "get_scheduled_messages";
     meth = `GET;
     path = "/email/drafts/scheduled";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "offset",
             match offset with
             | None -> []
             | Some value -> [ string_of_int value ] );
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
     decode_reply = Request.json get_scheduled_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (get_scheduled_response, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /email/drafts/scheduled/{id}]

Schedule or update a scheduled draft. *)
let upsert_scheduled_message ~(id : string) ~(send_time : string)
    ?draft_generation ?include_signature ?user_confirmation () =
  ({
     Request.service = "email";
     operation = "upsert_scheduled_message";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/email/drafts/scheduled/"; Request.segment ((fun value -> value) id);
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "draft_generation",
             match draft_generation with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_upsert_scheduled_request
               ({ include_signature; send_time; user_confirmation }
                 : upsert_scheduled_request)));
     decode_reply = Request.json upsert_scheduled_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : (upsert_scheduled_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /email/drafts/scheduled/{message_id}]

Remove the scheduled send from a draft, including immediate-send undo. *)
let delete_scheduled_draft ~(message_id : string) ?draft_generation () =
  ({
     Request.service = "email";
     operation = "delete_scheduled_draft";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/email/drafts/scheduled/";
           Request.segment ((fun value -> value) message_id);
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "draft_generation",
             match draft_generation with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /email/drafts/{id}]

Delete a draft. *)
let delete_draft ~(id : string) ?draft_generation () =
  ({
     Request.service = "email";
     operation = "delete_draft";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/email/drafts/"; Request.segment ((fun value -> value) id) ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "draft_generation",
             match draft_generation with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/drafts/{id}/attachments]

Add an attachment to a draft. *)
let add_draft_attachment ~(id : string) ~(file_name : string) ~(sha : string)
    ~(size : int) ?draft_generation ?upload_id () =
  ({
     Request.service = "email";
     operation = "add_draft_attachment";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/drafts/";
           Request.segment ((fun value -> value) id);
           "/attachments";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "draft_generation",
             match draft_generation with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_add_draft_attachment_request
               ({ file_name; sha; size; upload_id }
                 : add_draft_attachment_request)));
     decode_reply = Request.json add_draft_attachment_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : ( add_draft_attachment_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [DELETE /email/drafts/{id}/attachments/{attachment_id}]

Remove an attachment from a draft. *)
let remove_draft_attachment ~(id : string) ~(attachment_id : string)
    ?draft_generation () =
  ({
     Request.service = "email";
     operation = "remove_draft_attachment";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/email/drafts/";
           Request.segment ((fun value -> value) id);
           "/attachments/";
           Request.segment ((fun value -> value) attachment_id);
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "draft_generation",
             match draft_generation with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/drafts/{id}/attachments/{attachment_id}/complete]

Confirm an uploaded attachment before it becomes part of a sendable draft. *)
let complete_draft_attachment ~(id : string) ~(attachment_id : string)
    ?draft_generation () =
  ({
     Request.service = "email";
     operation = "complete_draft_attachment";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/drafts/";
           Request.segment ((fun value -> value) id);
           "/attachments/";
           Request.segment ((fun value -> value) attachment_id);
           "/complete";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "draft_generation",
             match draft_generation with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /email/drafts/{id}/forwarded-attachments]

Add a forwarded attachment to a draft. *)
let add_forwarded_attachment ~(id : string) ~(attachment_id : string)
    ?draft_generation () =
  ({
     Request.service = "email";
     operation = "add_forwarded_attachment";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/drafts/";
           Request.segment ((fun value -> value) id);
           "/forwarded-attachments";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "draft_generation",
             match draft_generation with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_add_forwarded_attachment_request
               ({ attachment_id } : add_forwarded_attachment_request)));
     decode_reply = Request.json add_forwarded_attachment_response_of_yojson;
     decode_error = Request.error_json [ 404; 500 ] error_response_of_yojson;
   }
    : ( add_forwarded_attachment_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [DELETE /email/drafts/{id}/forwarded-attachments/{attachment_id}]

Remove a forwarded attachment from a draft. *)
let remove_forwarded_attachment ~(id : string) ~(attachment_id : string)
    ?draft_generation () =
  ({
     Request.service = "email";
     operation = "remove_forwarded_attachment";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/email/drafts/";
           Request.segment ((fun value -> value) id);
           "/forwarded-attachments/";
           Request.segment ((fun value -> value) attachment_id);
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "draft_generation",
             match draft_generation with
             | None -> []
             | Some value -> [ string_of_int value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error = Request.error_json [ 404; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/drafts/{id}/operation]

The same provider-neutral state returned on fully hydrated email messages. *)
let message_operation_status ~(id : string) () =
  ({
     Request.service = "email";
     operation = "message_operation_status";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/drafts/";
           Request.segment ((fun value -> value) id);
           "/operation";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json message_operation_response_of_yojson;
     decode_error = Request.error_json [ 403; 404 ] error_response_of_yojson;
   }
    : (message_operation_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/drafts/{id}/resolve]

Resolve an observed draft conflict or uncertain provider operation. *)
let resolve_message_operation ~(id : string)
    ~(action : api_message_resolution_action) ~(revision : string)
    ?accept_duplicate_risk ?remote_version () =
  ({
     Request.service = "email";
     operation = "resolve_message_operation";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/drafts/";
           Request.segment ((fun value -> value) id);
           "/resolve";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_resolve_message_operation_request
               ({ accept_duplicate_risk; action; remote_version; revision }
                 : resolve_message_operation_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 403; 404; 409 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/drafts/{id}/transfer] *)
let transfer_draft ~(id : string) ~(destination_link_id : string)
    ~(operation_id : string) ?draft_generation () =
  ({
     Request.service = "email";
     operation = "transfer_draft";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/drafts/";
           Request.segment ((fun value -> value) id);
           "/transfer";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_transfer_draft_request
               ({ destination_link_id; draft_generation; operation_id }
                 : transfer_draft_request)));
     decode_reply = Request.json transfer_draft_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( transfer_draft_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /email/filters]

List all email filters for the current user. *)
let list_email_filters () =
  ({
     Request.service = "email";
     operation = "list_email_filters";
     meth = `GET;
     path = "/email/filters";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json list_email_filters_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (list_email_filters_response, error_response) Macro_sdk_runtime.Request.t)

(** [PUT /email/filters]

Create or update an email filter. *)
let upsert_email_filter ~(is_important : bool) ?email_address ?email_domain () =
  ({
     Request.service = "email";
     operation = "upsert_email_filter";
     meth = `PUT;
     path = "/email/filters";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_upsert_email_filter_request
               ({ email_address; email_domain; is_important }
                 : upsert_email_filter_request)));
     decode_reply = Request.json upsert_email_filter_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (upsert_email_filter_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /email/filters/{id}]

Delete an email filter by ID. *)
let delete_email_filter ~(id : string) () =
  ({
     Request.service = "email";
     operation = "delete_email_filter";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/email/filters/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 401; 404; 500 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/init]

Initialize email functionality for the user. Populates initial threads and enables inbox syncing. *)
let init_user ?link_id ?force_share () =
  ({
     Request.service = "email";
     operation = "init_user";
     meth = `POST;
     path = "/email/init";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "link_id",
             match link_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "force_share",
             match force_share with
             | None -> []
             | Some value -> [ string_of_bool value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json init_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 400 ->
             Some
               (Bad_request
                  (init_error_code_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : init_user_error)
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : init_user_error)
         | 402 ->
             Some
               (Payment_required
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : init_user_error)
         | 409 ->
             Some
               (Conflict
                  (shared_inbox_conflict_response_of_yojson
                     (Yojson.Safe.from_string body))
                 : init_user_error)
         | 429 ->
             Some
               (Too_many_requests
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : init_user_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : init_user_error)
         | _ -> None);
   }
    : (init_response, init_user_error) Macro_sdk_runtime.Request.t)

(** [GET /email/labels]

List all labels for the user's email link. *)
let list_labels () =
  ({
     Request.service = "email";
     operation = "list_labels";
     meth = `GET;
     path = "/email/labels";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json list_labels_response_of_yojson;
     decode_error = Request.error_json [ 401; 500 ] error_response_of_yojson;
   }
    : (list_labels_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/labels]

Create a label. *)
let create_label ~(label_name : string) () =
  ({
     Request.service = "email";
     operation = "create_label";
     meth = `POST;
     path = "/email/labels";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_label_request
               ({ label_name } : create_label_request)));
     decode_reply = Request.json create_label_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 401; 403; 404; 409; 429; 500 ]
         error_response_of_yojson;
   }
    : (create_label_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /email/labels/{id}]

Delete a label. *)
let delete_label ~(id : string) () =
  ({
     Request.service = "email";
     operation = "delete_label";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/email/labels/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/links]

List all links belonging to the user. *)
let list_links () =
  ({
     Request.service = "email";
     operation = "list_links";
     meth = `GET;
     path = "/email/links";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json list_links_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 500 ] error_response_of_yojson;
   }
    : (list_links_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/links/health-check]

Probes the live auth state of each of the caller's inboxes (owned and delegated)
against the auth service and records the result on each link. A grant that died
while the caller was inactive is detected here within minutes instead of waiting on
the daily refresh sweep; the side effects (clearing or setting the reauth flag, and
the one-time reauth fan-out) are handled by the email service token source. *)
let health_check_links () =
  ({
     Request.service = "email";
     operation = "health_check_links";
     meth = `POST;
     path = "/email/links/health-check";
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

(** [DELETE /email/links/{link_id}]

Removes a linked inbox. *)
let delete_link ~(link_id : string) () =
  ({
     Request.service = "email";
     operation = "delete_link";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/email/links/"; Request.segment ((fun value -> value) link_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [DELETE /email/links/{link_id}/calendar]

Turns calendar off for a connected inbox. *)
let disable_link_calendar ~(link_id : string) () =
  ({
     Request.service = "email";
     operation = "disable_link_calendar";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/email/links/";
           Request.segment ((fun value -> value) link_id);
           "/calendar";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/links/{link_id}/resync]

Re-syncs a linked inbox by enqueuing a fresh backfill. *)
let resync_link ~(link_id : string) () =
  ({
     Request.service = "email";
     operation = "resync_link";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/links/";
           Request.segment ((fun value -> value) link_id);
           "/resync";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json resync_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 403; 404; 500 ] error_response_of_yojson;
   }
    : (resync_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/messages]

Send a message. *)
let send_message ~(message : api_draft_input) () =
  ({
     Request.service = "email";
     operation = "send_message";
     meth = `POST;
     path = "/email/messages";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_send_message_request
               ({ message } : send_message_request)));
     decode_reply = Request.json send_message_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 403; 404; 500 ] error_response_of_yojson;
   }
    : (send_message_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/messages/batch] *)
let get_messages_batch ~(body : string list) () =
  ({
     Request.service = "email";
     operation = "get_messages_batch";
     meth = `POST;
     path = "/email/messages/batch";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json ((Json.of_list Json.of_string) body));
     decode_reply = Request.json (Json.list parsed_message_of_yojson);
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (parsed_message list, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /email/messages/labels]

Add or remove a label from a batch of messages *)
let add_remove_label ~(label_id : string) ~(message_ids : string list)
    ~(value : bool) () =
  ({
     Request.service = "email";
     operation = "add_remove_label";
     meth = `PATCH;
     path = "/email/messages/labels";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_label_batch_request
               ({ label_id; message_ids; value } : update_label_batch_request)));
     decode_reply = Request.json update_label_batch_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (update_label_batch_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/messages/{id}] *)
let get_message ~(id : string) () =
  ({
     Request.service = "email";
     operation = "get_message";
     meth = `GET;
     path =
       String.concat ""
         [ "/email/messages/"; Request.segment ((fun value -> value) id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json parsed_message_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (parsed_message, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/messages/{id}/eml]

Download a message's original source as an [.eml] file. *)
let get_message_eml ~(id : string) () =
  ({
     Request.service = "email";
     operation = "get_message_eml";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/messages/"; Request.segment ((fun value -> value) id); "/eml";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.text;
     decode_error =
       Request.error_json
         [ 401; 403; 404; 409; 429; 503 ]
         error_response_of_yojson;
   }
    : (string, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /email/settings]

Patch user settings. *)
let patch_settings ~(settings : settings) () =
  ({
     Request.service = "email";
     operation = "patch_settings";
     meth = `PATCH;
     path = "/email/settings";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_patch_settings_request
               ({ settings } : patch_settings_request)));
     decode_reply = Request.json patch_settings_response_of_yojson;
     decode_error =
       (fun ~status body ->
         match status with
         | 400 ->
             Some
               (Bad_request
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : patch_settings_error)
         | 401 ->
             Some
               (Unauthorized
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : patch_settings_error)
         | 422 ->
             Some
               (Unprocessable_entity
                  (unresolved_signature_images_error_of_yojson
                     (Yojson.Safe.from_string body))
                 : patch_settings_error)
         | 500 ->
             Some
               (Internal_server_error
                  (error_response_of_yojson (Yojson.Safe.from_string body))
                 : patch_settings_error)
         | _ -> None);
   }
    : ( patch_settings_response,
        patch_settings_error )
      Macro_sdk_runtime.Request.t)

(** [GET /email/settings/operations]

Accepted label and sender-policy changes awaiting provider confirmation. *)
let mailbox_settings_operations () =
  ({
     Request.service = "email";
     operation = "mailbox_settings_operations";
     meth = `GET;
     path = "/email/settings/operations";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.json (Json.list mailbox_settings_operation_of_yojson);
     decode_error = Request.no_error;
   }
    : ( mailbox_settings_operation list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /email/sync]

Disables inbox syncing for the selected inbox. *)
let disable_sync ?x_email_link_id () =
  ({
     Request.service = "email";
     operation = "disable_sync";
     meth = `DELETE;
     path = "/email/sync";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [
           ( "X-Email-Link-Id",
             match x_email_link_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 401; 403; 404; 409; 500 ]
         error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /email/threads/archived]

Change the archived status of up to 100 threads, sending one provider
write per inbox. A thread that can't change is reported, not fatal. *)
let archive_threads ~(thread_ids : string list) ~(value : bool) () =
  ({
     Request.service = "email";
     operation = "archive_threads";
     meth = `PATCH;
     path = "/email/threads/archived";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_archive_threads_request
               ({ thread_ids; value } : archive_threads_request)));
     decode_reply = Request.json archive_threads_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (archive_threads_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/threads/previews/cursor/{view}]

Get paginated thread previews with cursor-based pagination. *)
let previews_inbox_cursor ~(view : string) ?limit ?sort_method ?cursor () =
  ({
     Request.service = "email";
     operation = "previews_inbox_cursor";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/threads/previews/cursor/";
           Request.segment ((fun value -> value) view);
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "limit",
             match limit with
             | None -> []
             | Some value -> [ string_of_int value ] );
           ( "sort_method",
             match sort_method with
             | None -> []
             | Some value ->
                 [
                   (fun value -> Json.string (yojson_of_api_sort_method value))
                     value;
                 ] );
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
     decode_reply = Request.json api_paginated_thread_cursor_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (api_paginated_thread_cursor, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /email/threads/{id}/archived]

Change the archived status of a thread. *)
let archive_thread ~(id : string) ~(value : bool) () =
  ({
     Request.service = "email";
     operation = "archive_thread";
     meth = `PATCH;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) id);
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
            (yojson_of_archive_thread_request
               ({ value } : archive_thread_request)));
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /email/threads/{id}/labels]

Add or remove a label from all messages in a thread. *)
let add_remove_thread_label ~(id : string) ~(label_id : string) ~(value : bool)
    () =
  ({
     Request.service = "email";
     operation = "add_remove_thread_label";
     meth = `PATCH;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) id);
           "/labels";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_thread_label_request
               ({ label_id; value } : update_thread_label_request)));
     decode_reply = Request.json update_thread_labels_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : ( update_thread_labels_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /email/threads/{id}/messages] *)
let get_thread_messages_handler ~(id : string) ?since ?limit () =
  ({
     Request.service = "email";
     operation = "get_thread_messages_handler";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) id);
           "/messages";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "since",
             match since with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "limit",
             match limit with
             | None -> []
             | Some value -> [ Int64.to_string value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list parsed_message_of_yojson);
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (parsed_message list, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/threads/{id}/operations]

Fetch the latest organization action outcomes without provider-specific status strings. *)
let thread_operations ~(id : string) () =
  ({
     Request.service = "email";
     operation = "thread_operations";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) id);
           "/operations";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list mailbox_operation_of_yojson);
     decode_error = Request.error_json [ 404 ] error_response_of_yojson;
   }
    : (mailbox_operation list, error_response) Macro_sdk_runtime.Request.t)

(** [POST /email/threads/{id}/seen]

Called by FE when the user has seen a thread. *)
let thread_seen ~(id : string) () =
  ({
     Request.service = "email";
     operation = "thread_seen";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/threads/"; Request.segment ((fun value -> value) id); "/seen";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json empty_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 500 ] error_response_of_yojson;
   }
    : (empty_response, error_response) Macro_sdk_runtime.Request.t)

(** [PATCH /email/threads/{id}/state]

Set mailbox state without client-side provider label lookup. *)
let update_thread_state ~(id : string) ~(field : thread_state_field)
    ~(value : bool) () =
  ({
     Request.service = "email";
     operation = "update_thread_state";
     meth = `PATCH;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) id);
           "/state";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_thread_state_request
               ({ field; value } : update_thread_state_request)));
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 400; 401; 404; 409 ] error_response_of_yojson;
   }
    : (unit, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/threads/{thread_id}]

Get a thread with paginated messages. *)
let get_thread ~(thread_id : string) ?offset ?limit () =
  ({
     Request.service = "email";
     operation = "get_thread";
     meth = `GET;
     path =
       String.concat ""
         [ "/email/threads/"; Request.segment ((fun value -> value) thread_id) ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "offset",
             match offset with
             | None -> []
             | Some value -> [ Int64.to_string value ] );
           ( "limit",
             match limit with
             | None -> []
             | Some value -> [ Int64.to_string value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json get_thread_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 404; 500 ] error_response_of_yojson;
   }
    : (get_thread_response, error_response) Macro_sdk_runtime.Request.t)

(** [GET /email/threads/{thread_id}/calendar-invitations] *)
let get_thread_calendar_invitations ~(thread_id : string) () =
  ({
     Request.service = "email";
     operation = "get_thread_calendar_invitations";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) thread_id);
           "/calendar-invitations";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.map invitation_resolution_of_yojson);
     decode_error = Request.no_error;
   }
    : ( (string * invitation_resolution) list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy]

Add a shared event saved from one of the thread's messages to one of the
viewer's Google calendars, the way Add to calendar adds a channel-shared
event: a snapshot under the meeting's iCalendar UID and organizer, with the
viewer as its only guest and no join link. Nobody is notified. Only a
published event file ([METHOD:PUBLISH]) can be added; an invitation is
answered from the calendar it reached. *)
let copy_thread_calendar_invitation ~(thread_id : string) ~(message_id : string)
    ~(invitation_id : string) ?calendar_id () =
  ({
     Request.service = "email";
     operation = "copy_thread_calendar_invitation";
     meth = `POST;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) thread_id);
           "/messages/";
           Request.segment ((fun value -> value) message_id);
           "/calendar-invitations/";
           Request.segment ((fun value -> value) invitation_id);
           "/copy";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_copy_calendar_event_request
               ({ calendar_id } : copy_calendar_event_request)));
     decode_reply = Request.json calendar_event_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 403; 404; 409; 503 ]
         calendar_mutation_api_error_of_yojson;
   }
    : (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t)

(** [PATCH /email/threads/{thread_id}/project]

Update the project assignment for a thread. *)
let update_thread_project ~(thread_id : string) ?project_id () =
  ({
     Request.service = "email";
     operation = "update_thread_project";
     meth = `PATCH;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) thread_id);
           "/project";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_thread_project_request
               ({ project_id } : update_thread_project_request)));
     decode_reply = Request.json update_thread_project_response_of_yojson;
     decode_error =
       Request.error_json [ 401; 404; 500 ] error_response_of_yojson;
   }
    : ( update_thread_project_response,
        error_response )
      Macro_sdk_runtime.Request.t)

(** [GET /email/threads/{thread_id}/read-receipts] *)
let get_thread_read_receipts ~(thread_id : string) () =
  ({
     Request.service = "email";
     operation = "get_thread_read_receipts";
     meth = `GET;
     path =
       String.concat ""
         [
           "/email/threads/";
           Request.segment ((fun value -> value) thread_id);
           "/read-receipts";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json thread_read_receipts_of_yojson;
     decode_error = Request.no_error;
   }
    : ( thread_read_receipts,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /health]

Health check *)
let health_handler () =
  ({
     Request.service = "email";
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

(** [GET /opens/{token}]

Every request gets the same uncacheable pixel so the response reveals nothing
about the token, and each open reaches the server. *)
let get_read_receipt_pixel ~(token : string) () =
  ({
     Request.service = "email";
     operation = "get_read_receipt_pixel";
     meth = `GET;
     path =
       String.concat ""
         [ "/opens/"; Request.segment ((fun value -> value) token) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.text;
     decode_error = Request.no_error;
   }
    : (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)
