(* Generated from packages/sdk/specs/connection.json by packages/sdk-ocaml/gen. Do not edit. *)

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

type nonrec batch_send_message_body = {
  entities : entity list;  (** all entities to send the message to *)
  message : Yojson.Safe.t;  (** the message to send *)
  message_type : string;  (** the type of the message we are sending *)
}
(** The body of a batch send message request. *)

val batch_send_message_body_of_yojson : Yojson.Safe.t -> batch_send_message_body
val yojson_of_batch_send_message_body : batch_send_message_body -> Yojson.Safe.t

val make_batch_send_message_body :
  entities:entity list ->
  message:Yojson.Safe.t ->
  message_type:string ->
  unit ->
  batch_send_message_body
(** The body of a batch send message request. *)

type nonrec generic_error_response = {
  error : bool;  (** Indicates if an error occurred *)
  message : string;  (** Message to explain failure *)
}

val generic_error_response_of_yojson : Yojson.Safe.t -> generic_error_response
val yojson_of_generic_error_response : generic_error_response -> Yojson.Safe.t

val make_generic_error_response :
  error:bool -> message:string -> unit -> generic_error_response

type nonrec message_receipt = {
  active : bool;  (** If one of those connections was active for the entity *)
  delivery_count : int64;
      (** The numer of times the message was delivered to the user *)
  user_id : string;  (** The user id of the user who received the message *)
}
(** A receipt for a message that was sent to a user. *)

val message_receipt_of_yojson : Yojson.Safe.t -> message_receipt
val yojson_of_message_receipt : message_receipt -> Yojson.Safe.t

val make_message_receipt :
  active:bool ->
  delivery_count:int64 ->
  user_id:string ->
  unit ->
  message_receipt
(** A receipt for a message that was sent to a user. *)

type nonrec send_message_body = {
  message : Yojson.Safe.t;  (** the message to send *)
  message_type : string;  (** the type of the message we are sending *)
}
(** The body of a send message request. *)

val send_message_body_of_yojson : Yojson.Safe.t -> send_message_body
val yojson_of_send_message_body : send_message_body -> Yojson.Safe.t

val make_send_message_body :
  message:Yojson.Safe.t -> message_type:string -> unit -> send_message_body
(** The body of a send message request. *)

type nonrec send_message_response = {
  receipts : message_receipt list;  (** the receipts for each message sent *)
}
(** The response from sending a message. *)

val send_message_response_of_yojson : Yojson.Safe.t -> send_message_response
val yojson_of_send_message_response : send_message_response -> Yojson.Safe.t

val make_send_message_response :
  receipts:message_receipt list -> unit -> send_message_response
(** The response from sending a message. *)

type nonrec stored_connection_entity = {
  pk : string;
  sk : string;
  connection_id : string;  (** id of the connection *)
  created_at : int64;  (** timestamp when the connection was initiated *)
  entity_id : string;  (** id of the entity *)
  entity_type : entity_type;  (** type of the entity *)
  last_ping : int64 option;  (** the timestamp of the last ping *)
  user_id : string;  (** user id to whom the conneciton belongs to *)
}

val stored_connection_entity_of_yojson :
  Yojson.Safe.t -> stored_connection_entity

val yojson_of_stored_connection_entity :
  stored_connection_entity -> Yojson.Safe.t

val make_stored_connection_entity :
  pk:string ->
  sk:string ->
  connection_id:string ->
  created_at:int64 ->
  entity_id:string ->
  entity_type:entity_type ->
  ?last_ping:int64 ->
  user_id:string ->
  unit ->
  stored_connection_entity

type nonrec stream_id = {
  entity_id : string;
  entity_type : entity_type;
  stream_id : string;
}

val stream_id_of_yojson : Yojson.Safe.t -> stream_id
val yojson_of_stream_id : stream_id -> Yojson.Safe.t

val make_stream_id :
  entity_id:string ->
  entity_type:entity_type ->
  stream_id:string ->
  unit ->
  stream_id

(** Events published through the notification channel. *)
type nonrec stream_event =
  | Created of stream_id  (** A new stream was created. *)
  | Closed of stream_id  (** A stream was closed. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val stream_event_of_yojson : Yojson.Safe.t -> stream_event
val yojson_of_stream_event : stream_event -> Yojson.Safe.t

type nonrec stream_events = entity
(** subscribe to stream events from entity *)

val stream_events_of_yojson : Yojson.Safe.t -> stream_events
val yojson_of_stream_events : stream_events -> Yojson.Safe.t

type nonrec stream_item = { id : stream_id; payload : Yojson.Safe.t }

val stream_item_of_yojson : Yojson.Safe.t -> stream_item
val yojson_of_stream_item : stream_item -> Yojson.Safe.t

val make_stream_item :
  id:stream_id -> payload:Yojson.Safe.t -> unit -> stream_item

type nonrec string_id_response = { id : string }

val string_id_response_of_yojson : Yojson.Safe.t -> string_id_response
val yojson_of_string_id_response : string_id_response -> Yojson.Safe.t
val make_string_id_response : id:string -> unit -> string_id_response

type nonrec to_websocket_message_track_entity_type =
  | Track_entity
  | Unknown of string  (** A value this SDK version does not know. *)

val to_websocket_message_track_entity_type_of_yojson :
  Yojson.Safe.t -> to_websocket_message_track_entity_type

val yojson_of_to_websocket_message_track_entity_type :
  to_websocket_message_track_entity_type -> Yojson.Safe.t

type nonrec to_websocket_message_stream_events_type =
  | Stream_events
  | Unknown of string  (** A value this SDK version does not know. *)

val to_websocket_message_stream_events_type_of_yojson :
  Yojson.Safe.t -> to_websocket_message_stream_events_type

val yojson_of_to_websocket_message_stream_events_type :
  to_websocket_message_stream_events_type -> Yojson.Safe.t

(** The type of action that can occur on an \[Entity\] *)
type nonrec track_action =
  | Open
  | Ping
  | Close
  | Unknown of string  (** A value this SDK version does not know. *)

val track_action_of_yojson : Yojson.Safe.t -> track_action
val yojson_of_track_action : track_action -> Yojson.Safe.t

type nonrec to_websocket_message =
  | Track_entity of {
      entity_id : string;  (** The id of that entity *)
      entity_type : entity_type;  (** The type of entity we are describing *)
      action : track_action;
    }
  | Stream_events of {
      entity_id : string;  (** The id of that entity *)
      entity_type : entity_type;  (** The type of entity we are describing *)
    }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val to_websocket_message_of_yojson : Yojson.Safe.t -> to_websocket_message
val yojson_of_to_websocket_message : to_websocket_message -> Yojson.Safe.t

val make_to_websocket_message_track_entity :
  entity_id:string ->
  entity_type:entity_type ->
  action:track_action ->
  unit ->
  to_websocket_message

val make_to_websocket_message_stream_events :
  entity_id:string -> entity_type:entity_type -> unit -> to_websocket_message

type nonrec track_entity_message = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
  action : track_action;
}

val track_entity_message_of_yojson : Yojson.Safe.t -> track_entity_message
val yojson_of_track_entity_message : track_entity_message -> Yojson.Safe.t

val make_track_entity_message :
  entity_id:string ->
  entity_type:entity_type ->
  action:track_action ->
  unit ->
  track_entity_message

type nonrec upload_folder_status_update =
  | Completed of { project_id : string; request_id : string }
  | Partially_completed of { project_id : string; request_id : string }
  | Failed of { request_id : string }
  | Unknown_ of { request_id : string }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val upload_folder_status_update_of_yojson :
  Yojson.Safe.t -> upload_folder_status_update

val yojson_of_upload_folder_status_update :
  upload_folder_status_update -> Yojson.Safe.t

val make_upload_folder_status_update_completed :
  project_id:string -> request_id:string -> unit -> upload_folder_status_update

val make_upload_folder_status_update_partially_completed :
  project_id:string -> request_id:string -> unit -> upload_folder_status_update

val make_upload_folder_status_update_failed :
  request_id:string -> unit -> upload_folder_status_update

val make_upload_folder_status_update_unknown_ :
  request_id:string -> unit -> upload_folder_status_update

val batch_send_message_handler :
  entities:entity list ->
  message:Yojson.Safe.t ->
  message_type:string ->
  unit ->
  ( send_message_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /batch_send] *)

val broadcast_message_handler :
  message:Yojson.Safe.t ->
  message_type:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /message/broadcast]

Sends a message to every open connection on every instance. Delivery is
best-effort and asynchronous, so there are no receipts. *)

val send_message_handler :
  entity_type:string ->
  entity_id:string ->
  message:Yojson.Safe.t ->
  message_type:string ->
  unit ->
  ( send_message_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /message/send/{entity_type}/{entity_id}] *)

val get_entity_handler :
  entity_type:string ->
  entity_id:string ->
  unit ->
  (string list, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /track/{entity_type}/{entity_id}] *)
