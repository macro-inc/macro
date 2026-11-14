(* Generated from packages/sdk/specs/connection.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

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

type nonrec batch_send_message_body = {
  entities : entity list;  (** all entities to send the message to *)
  message : Yojson.Safe.t;  (** the message to send *)
  message_type : string;  (** the type of the message we are sending *)
}
(** The body of a batch send message request. *)

let batch_send_message_body_of_yojson : Yojson.Safe.t -> batch_send_message_body
    =
 fun json ->
  let fields = Json.obj json in
  {
    entities = Json.required fields "entities" (Json.list entity_of_yojson);
    message = Json.required fields "message" Json.json;
    message_type = Json.required fields "message_type" Json.string;
  }

and yojson_of_batch_send_message_body : batch_send_message_body -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("entities", Some ((Json.of_list yojson_of_entity) value.entities));
      ("message", Some (Json.of_json value.message));
      ("message_type", Some (Json.of_string value.message_type));
    ]

let make_batch_send_message_body ~(entities : entity list)
    ~(message : Yojson.Safe.t) ~(message_type : string) () =
  ({ entities; message; message_type } : batch_send_message_body)

type nonrec generic_error_response = {
  error : bool;  (** Indicates if an error occurred *)
  message : string;  (** Message to explain failure *)
}

let generic_error_response_of_yojson : Yojson.Safe.t -> generic_error_response =
 fun json ->
  let fields = Json.obj json in
  {
    error = Json.required fields "error" Json.bool;
    message = Json.required fields "message" Json.string;
  }

and yojson_of_generic_error_response : generic_error_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("error", Some (Json.of_bool value.error));
      ("message", Some (Json.of_string value.message));
    ]

let make_generic_error_response ~(error : bool) ~(message : string) () =
  ({ error; message } : generic_error_response)

type nonrec message_receipt = {
  active : bool;  (** If one of those connections was active for the entity *)
  delivery_count : int64;
      (** The numer of times the message was delivered to the user *)
  user_id : string;  (** The user id of the user who received the message *)
}
(** A receipt for a message that was sent to a user. *)

let message_receipt_of_yojson : Yojson.Safe.t -> message_receipt =
 fun json ->
  let fields = Json.obj json in
  {
    active = Json.required fields "active" Json.bool;
    delivery_count = Json.required fields "delivery_count" Json.int64;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_message_receipt : message_receipt -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("active", Some (Json.of_bool value.active));
      ("delivery_count", Some (Json.of_int64 value.delivery_count));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_message_receipt ~(active : bool) ~(delivery_count : int64)
    ~(user_id : string) () =
  ({ active; delivery_count; user_id } : message_receipt)

type nonrec send_message_body = {
  message : Yojson.Safe.t;  (** the message to send *)
  message_type : string;  (** the type of the message we are sending *)
}
(** The body of a send message request. *)

let send_message_body_of_yojson : Yojson.Safe.t -> send_message_body =
 fun json ->
  let fields = Json.obj json in
  {
    message = Json.required fields "message" Json.json;
    message_type = Json.required fields "message_type" Json.string;
  }

and yojson_of_send_message_body : send_message_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("message", Some (Json.of_json value.message));
      ("message_type", Some (Json.of_string value.message_type));
    ]

let make_send_message_body ~(message : Yojson.Safe.t) ~(message_type : string)
    () =
  ({ message; message_type } : send_message_body)

type nonrec send_message_response = {
  receipts : message_receipt list;  (** the receipts for each message sent *)
}
(** The response from sending a message. *)

let send_message_response_of_yojson : Yojson.Safe.t -> send_message_response =
 fun json ->
  let fields = Json.obj json in
  {
    receipts =
      Json.required fields "receipts" (Json.list message_receipt_of_yojson);
  }

and yojson_of_send_message_response : send_message_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "receipts",
        Some ((Json.of_list yojson_of_message_receipt) value.receipts) );
    ]

let make_send_message_response ~(receipts : message_receipt list) () =
  ({ receipts } : send_message_response)

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

let stored_connection_entity_of_yojson :
    Yojson.Safe.t -> stored_connection_entity =
 fun json ->
  let fields = Json.obj json in
  {
    pk = Json.required fields "PK" Json.string;
    sk = Json.required fields "SK" Json.string;
    connection_id = Json.required fields "connection_id" Json.string;
    created_at = Json.required fields "created_at" Json.int64;
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    last_ping = Json.optional fields "last_ping" Json.int64;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_stored_connection_entity :
    stored_connection_entity -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("PK", Some (Json.of_string value.pk));
      ("SK", Some (Json.of_string value.sk));
      ("connection_id", Some (Json.of_string value.connection_id));
      ("created_at", Some (Json.of_int64 value.created_at));
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ("last_ping", Option.map Json.of_int64 value.last_ping);
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_stored_connection_entity ~(pk : string) ~(sk : string)
    ~(connection_id : string) ~(created_at : int64) ~(entity_id : string)
    ~(entity_type : entity_type) ?last_ping ~(user_id : string) () =
  ({
     pk;
     sk;
     connection_id;
     created_at;
     entity_id;
     entity_type;
     last_ping;
     user_id;
   }
    : stored_connection_entity)

type nonrec stream_id = {
  entity_id : string;
  entity_type : entity_type;
  stream_id : string;
}

let stream_id_of_yojson : Yojson.Safe.t -> stream_id =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    stream_id = Json.required fields "stream_id" Json.string;
  }

and yojson_of_stream_id : stream_id -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ("stream_id", Some (Json.of_string value.stream_id));
    ]

let make_stream_id ~(entity_id : string) ~(entity_type : entity_type)
    ~(stream_id : string) () =
  ({ entity_id; entity_type; stream_id } : stream_id)

(** Events published through the notification channel. *)
type nonrec stream_event =
  | Created of stream_id  (** A new stream was created. *)
  | Closed of stream_id  (** A stream was closed. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let stream_event_of_yojson : Yojson.Safe.t -> stream_event =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "created" -> Created (stream_id_of_yojson json)
  | "closed" -> Closed (stream_id_of_yojson json)
  | _ -> Json.unknown "stream_event" json (Unknown json)

and yojson_of_stream_event : stream_event -> Yojson.Safe.t =
 fun value ->
  match value with
  | Created inner -> Json.with_tag "type" "created" (yojson_of_stream_id inner)
  | Closed inner -> Json.with_tag "type" "closed" (yojson_of_stream_id inner)
  | Unknown json -> json

type nonrec stream_events = entity
(** subscribe to stream events from entity *)

let stream_events_of_yojson : Yojson.Safe.t -> stream_events =
 fun json -> entity_of_yojson json

and yojson_of_stream_events : stream_events -> Yojson.Safe.t =
 fun value -> yojson_of_entity value

type nonrec stream_item = { id : stream_id; payload : Yojson.Safe.t }

let stream_item_of_yojson : Yojson.Safe.t -> stream_item =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" stream_id_of_yojson;
    payload = Json.required fields "payload" Json.json;
  }

and yojson_of_stream_item : stream_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (yojson_of_stream_id value.id));
      ("payload", Some (Json.of_json value.payload));
    ]

let make_stream_item ~(id : stream_id) ~(payload : Yojson.Safe.t) () =
  ({ id; payload } : stream_item)

type nonrec string_id_response = { id : string }

let string_id_response_of_yojson : Yojson.Safe.t -> string_id_response =
 fun json ->
  let fields = Json.obj json in
  { id = Json.required fields "id" Json.string }

and yojson_of_string_id_response : string_id_response -> Yojson.Safe.t =
 fun value -> Json.record [ ("id", Some (Json.of_string value.id)) ]

let make_string_id_response ~(id : string) () = ({ id } : string_id_response)

type nonrec to_websocket_message_track_entity_type =
  | Track_entity
  | Unknown of string  (** A value this SDK version does not know. *)

let to_websocket_message_track_entity_type_of_yojson :
    Yojson.Safe.t -> to_websocket_message_track_entity_type =
 fun json ->
  match Json.string json with
  | "track_entity" -> Track_entity
  | other ->
      Json.unknown "to_websocket_message_track_entity_type" json (Unknown other)

and yojson_of_to_websocket_message_track_entity_type :
    to_websocket_message_track_entity_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Track_entity -> `String "track_entity"
  | Unknown other -> `String other

type nonrec to_websocket_message_stream_events_type =
  | Stream_events
  | Unknown of string  (** A value this SDK version does not know. *)

let to_websocket_message_stream_events_type_of_yojson :
    Yojson.Safe.t -> to_websocket_message_stream_events_type =
 fun json ->
  match Json.string json with
  | "stream_events" -> Stream_events
  | other ->
      Json.unknown "to_websocket_message_stream_events_type" json
        (Unknown other)

and yojson_of_to_websocket_message_stream_events_type :
    to_websocket_message_stream_events_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Stream_events -> `String "stream_events"
  | Unknown other -> `String other

(** The type of action that can occur on an \[Entity\] *)
type nonrec track_action =
  | Open
  | Ping
  | Close
  | Unknown of string  (** A value this SDK version does not know. *)

let track_action_of_yojson : Yojson.Safe.t -> track_action =
 fun json ->
  match Json.string json with
  | "open" -> Open
  | "ping" -> Ping
  | "close" -> Close
  | other -> Json.unknown "track_action" json (Unknown other)

and yojson_of_track_action : track_action -> Yojson.Safe.t =
 fun value ->
  match value with
  | Open -> `String "open"
  | Ping -> `String "ping"
  | Close -> `String "close"
  | Unknown other -> `String other

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

let to_websocket_message_of_yojson : Yojson.Safe.t -> to_websocket_message =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "track_entity" ->
      Track_entity
        {
          entity_id = Json.required fields "entity_id" Json.string;
          entity_type = Json.required fields "entity_type" entity_type_of_yojson;
          action = Json.required fields "action" track_action_of_yojson;
        }
  | "stream_events" ->
      Stream_events
        {
          entity_id = Json.required fields "entity_id" Json.string;
          entity_type = Json.required fields "entity_type" entity_type_of_yojson;
        }
  | _ -> Json.unknown "to_websocket_message" json (Unknown json)

and yojson_of_to_websocket_message : to_websocket_message -> Yojson.Safe.t =
 fun value ->
  match value with
  | Track_entity case ->
      Json.record
        [
          ("type", Some (`String "track_entity"));
          ("entity_id", Some (Json.of_string case.entity_id));
          ("entity_type", Some (yojson_of_entity_type case.entity_type));
          ("action", Some (yojson_of_track_action case.action));
        ]
  | Stream_events case ->
      Json.record
        [
          ("type", Some (`String "stream_events"));
          ("entity_id", Some (Json.of_string case.entity_id));
          ("entity_type", Some (yojson_of_entity_type case.entity_type));
        ]
  | Unknown json -> json

let make_to_websocket_message_track_entity ~(entity_id : string)
    ~(entity_type : entity_type) ~(action : track_action) () =
  (Track_entity { entity_id; entity_type; action } : to_websocket_message)

let make_to_websocket_message_stream_events ~(entity_id : string)
    ~(entity_type : entity_type) () =
  (Stream_events { entity_id; entity_type } : to_websocket_message)

type nonrec track_entity_message = {
  entity_id : string;  (** The id of that entity *)
  entity_type : entity_type;  (** The type of entity we are describing *)
  action : track_action;
}

let track_entity_message_of_yojson : Yojson.Safe.t -> track_entity_message =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    action = Json.required fields "action" track_action_of_yojson;
  }

and yojson_of_track_entity_message : track_entity_message -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ("action", Some (yojson_of_track_action value.action));
    ]

let make_track_entity_message ~(entity_id : string) ~(entity_type : entity_type)
    ~(action : track_action) () =
  ({ entity_id; entity_type; action } : track_entity_message)

type nonrec upload_folder_status_update =
  | Completed of { project_id : string; request_id : string }
  | Partially_completed of { project_id : string; request_id : string }
  | Failed of { request_id : string }
  | Unknown_ of { request_id : string }
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let upload_folder_status_update_of_yojson :
    Yojson.Safe.t -> upload_folder_status_update =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "status" with
  | "completed" ->
      Completed
        {
          project_id = Json.required fields "projectId" Json.string;
          request_id = Json.required fields "requestId" Json.string;
        }
  | "partially_completed" ->
      Partially_completed
        {
          project_id = Json.required fields "projectId" Json.string;
          request_id = Json.required fields "requestId" Json.string;
        }
  | "failed" ->
      Failed { request_id = Json.required fields "requestId" Json.string }
  | "unknown" ->
      Unknown_ { request_id = Json.required fields "requestId" Json.string }
  | _ -> Json.unknown "upload_folder_status_update" json (Unknown json)

and yojson_of_upload_folder_status_update :
    upload_folder_status_update -> Yojson.Safe.t =
 fun value ->
  match value with
  | Completed case ->
      Json.record
        [
          ("status", Some (`String "completed"));
          ("projectId", Some (Json.of_string case.project_id));
          ("requestId", Some (Json.of_string case.request_id));
        ]
  | Partially_completed case ->
      Json.record
        [
          ("status", Some (`String "partially_completed"));
          ("projectId", Some (Json.of_string case.project_id));
          ("requestId", Some (Json.of_string case.request_id));
        ]
  | Failed case ->
      Json.record
        [
          ("status", Some (`String "failed"));
          ("requestId", Some (Json.of_string case.request_id));
        ]
  | Unknown_ case ->
      Json.record
        [
          ("status", Some (`String "unknown"));
          ("requestId", Some (Json.of_string case.request_id));
        ]
  | Unknown json -> json

let make_upload_folder_status_update_completed ~(project_id : string)
    ~(request_id : string) () =
  (Completed { project_id; request_id } : upload_folder_status_update)

let make_upload_folder_status_update_partially_completed ~(project_id : string)
    ~(request_id : string) () =
  (Partially_completed { project_id; request_id } : upload_folder_status_update)

let make_upload_folder_status_update_failed ~(request_id : string) () =
  (Failed { request_id } : upload_folder_status_update)

let make_upload_folder_status_update_unknown_ ~(request_id : string) () =
  (Unknown_ { request_id } : upload_folder_status_update)

(** [POST /batch_send] *)
let batch_send_message_handler ~(entities : entity list)
    ~(message : Yojson.Safe.t) ~(message_type : string) () =
  ({
     Request.service = "connection";
     operation = "batch_send_message_handler";
     meth = `POST;
     path = "/batch_send";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_batch_send_message_body
               ({ entities; message; message_type } : batch_send_message_body)));
     decode_reply = Request.json send_message_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( send_message_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /message/broadcast]

Sends a message to every open connection on every instance. Delivery is
best-effort and asynchronous, so there are no receipts. *)
let broadcast_message_handler ~(message : Yojson.Safe.t)
    ~(message_type : string) () =
  ({
     Request.service = "connection";
     operation = "broadcast_message_handler";
     meth = `POST;
     path = "/message/broadcast";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_send_message_body
               ({ message; message_type } : send_message_body)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /message/send/{entity_type}/{entity_id}] *)
let send_message_handler ~(entity_type : string) ~(entity_id : string)
    ~(message : Yojson.Safe.t) ~(message_type : string) () =
  ({
     Request.service = "connection";
     operation = "send_message_handler";
     meth = `POST;
     path =
       String.concat ""
         [
           "/message/send/";
           Request.segment ((fun value -> value) entity_type);
           "/";
           Request.segment ((fun value -> value) entity_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_send_message_body
               ({ message; message_type } : send_message_body)));
     decode_reply = Request.json send_message_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( send_message_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /track/{entity_type}/{entity_id}] *)
let get_entity_handler ~(entity_type : string) ~(entity_id : string) () =
  ({
     Request.service = "connection";
     operation = "get_entity_handler";
     meth = `GET;
     path =
       String.concat ""
         [
           "/track/";
           Request.segment ((fun value -> value) entity_type);
           "/";
           Request.segment ((fun value -> value) entity_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list Json.string);
     decode_error = Request.no_error;
   }
    : ( string list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)
