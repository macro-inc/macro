(* Generated from packages/sdk/specs/properties.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

type nonrec add_number_option_request = { display_order : int; value : float }
(** Type-safe request to add a number option to a SelectNumber property. *)

let add_number_option_request_of_yojson :
    Yojson.Safe.t -> add_number_option_request =
 fun json ->
  let fields = Json.obj json in
  {
    display_order = Json.required fields "display_order" Json.int;
    value = Json.required fields "value" Json.float;
  }

and yojson_of_add_number_option_request :
    add_number_option_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("display_order", Some (Json.of_int value.display_order));
      ("value", Some (Json.of_float value.value));
    ]

let make_add_number_option_request ~(display_order : int) ~(value : float) () =
  ({ display_order; value } : add_number_option_request)

type nonrec add_string_option_request = {
  color : string option;
  display_order : int;
  value : string;
}
(** Type-safe request to add a string option to a SelectString property. *)

let add_string_option_request_of_yojson :
    Yojson.Safe.t -> add_string_option_request =
 fun json ->
  let fields = Json.obj json in
  {
    color = Json.optional fields "color" Json.string;
    display_order = Json.required fields "display_order" Json.int;
    value = Json.required fields "value" Json.string;
  }

and yojson_of_add_string_option_request :
    add_string_option_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("color", Option.map Json.of_string value.color);
      ("display_order", Some (Json.of_int value.display_order));
      ("value", Some (Json.of_string value.value));
    ]

let make_add_string_option_request ?color ~(display_order : int)
    ~(value : string) () =
  ({ color; display_order; value } : add_string_option_request)

(** Enum for type-safe property option addition requests. *)
type nonrec add_property_option_request =
  | Select_string of { option : add_string_option_request }
      (** Add a string option to a SelectString property *)
  | Select_number of { option : add_number_option_request }
      (** Add a number option to a SelectNumber property *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let add_property_option_request_of_yojson :
    Yojson.Safe.t -> add_property_option_request =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "select_string" ->
      Select_string
        {
          option =
            Json.required fields "option" add_string_option_request_of_yojson;
        }
  | "select_number" ->
      Select_number
        {
          option =
            Json.required fields "option" add_number_option_request_of_yojson;
        }
  | _ -> Unknown json

and yojson_of_add_property_option_request :
    add_property_option_request -> Yojson.Safe.t =
 fun value ->
  match value with
  | Select_string case ->
      Json.record
        [
          ("type", Some (`String "select_string"));
          ("option", Some (yojson_of_add_string_option_request case.option));
        ]
  | Select_number case ->
      Json.record
        [
          ("type", Some (`String "select_number"));
          ("option", Some (yojson_of_add_number_option_request case.option));
        ]
  | Unknown json -> json

let make_add_property_option_request_select_string
    ~(option : add_string_option_request) () =
  (Select_string { option } : add_property_option_request)

let make_add_property_option_request_select_number
    ~(option : add_number_option_request) () =
  (Select_number { option } : add_property_option_request)

(** Canonical type of an entity receiving properties.

Tasks are documents at API boundaries. [Task] intentionally does not exist
here; task classification is resolved by the properties domain from the
document subtype. *)
type nonrec property_target_entity_type =
  | Call_record
  | Channel
  | Chat
  | Company
  | Database_row
  | Document
  | Initiative
  | Project
  | Thread
  | User
  | Unknown of string  (** A value this SDK version does not know. *)

let property_target_entity_type_of_yojson :
    Yojson.Safe.t -> property_target_entity_type =
 fun json ->
  match Json.string json with
  | "CALL_RECORD" -> Call_record
  | "CHANNEL" -> Channel
  | "CHAT" -> Chat
  | "COMPANY" -> Company
  | "DATABASE_ROW" -> Database_row
  | "DOCUMENT" -> Document
  | "INITIATIVE" -> Initiative
  | "PROJECT" -> Project
  | "THREAD" -> Thread
  | "USER" -> User
  | other -> Unknown other

and yojson_of_property_target_entity_type :
    property_target_entity_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Call_record -> `String "CALL_RECORD"
  | Channel -> `String "CHANNEL"
  | Chat -> `String "CHAT"
  | Company -> `String "COMPANY"
  | Database_row -> `String "DATABASE_ROW"
  | Document -> `String "DOCUMENT"
  | Initiative -> `String "INITIATIVE"
  | Project -> `String "PROJECT"
  | Thread -> `String "THREAD"
  | User -> `String "USER"
  | Unknown other -> `String other

(** Per-entity outcome of a cross-entity bulk option update. *)
type nonrec bulk_entity_option_update_status =
  | Applied
  | Skipped_no_permission
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let bulk_entity_option_update_status_of_yojson :
    Yojson.Safe.t -> bulk_entity_option_update_status =
 fun json ->
  match Json.string json with
  | "applied" -> Applied
  | "skipped_no_permission" -> Skipped_no_permission
  | "failed" -> Failed
  | other -> Unknown other

and yojson_of_bulk_entity_option_update_status :
    bulk_entity_option_update_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Applied -> `String "applied"
  | Skipped_no_permission -> `String "skipped_no_permission"
  | Failed -> `String "failed"
  | Unknown other -> `String other

type nonrec bulk_entity_option_update_result = {
  entity_id : string;  (** The entity's id this result is for. *)
  entity_type : property_target_entity_type;
      (** The entity's type this result is for. *)
  error : string option;
      (** A human-readable reason, present only when [failed]. *)
  option_ids : string list option;
      (** The entity's reconciled final option ids, present only when [applied]. *)
  status : bulk_entity_option_update_status;
      (** Whether the delta was applied, skipped, or failed for this entity. *)
}
(** One entity's result in a cross-entity bulk option update. *)

let bulk_entity_option_update_result_of_yojson :
    Yojson.Safe.t -> bulk_entity_option_update_result =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type =
      Json.required fields "entity_type" property_target_entity_type_of_yojson;
    error = Json.optional fields "error" Json.string;
    option_ids = Json.optional fields "option_ids" (Json.list Json.string);
    status =
      Json.required fields "status" bulk_entity_option_update_status_of_yojson;
  }

and yojson_of_bulk_entity_option_update_result :
    bulk_entity_option_update_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ( "entity_type",
        Some (yojson_of_property_target_entity_type value.entity_type) );
      ("error", Option.map Json.of_string value.error);
      ("option_ids", Option.map (Json.of_list Json.of_string) value.option_ids);
      ("status", Some (yojson_of_bulk_entity_option_update_status value.status));
    ]

let make_bulk_entity_option_update_result ~(entity_id : string)
    ~(entity_type : property_target_entity_type) ?error ?option_ids
    ~(status : bulk_entity_option_update_status) () =
  ({ entity_id; entity_type; error; option_ids; status }
    : bulk_entity_option_update_result)

type nonrec property_target_reference = {
  entity_id : string;  (** Entity identifier. *)
  entity_type : property_target_entity_type;  (** Canonical entity type. *)
}
(** Canonical reference to an entity receiving properties. *)

let property_target_reference_of_yojson :
    Yojson.Safe.t -> property_target_reference =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type =
      Json.required fields "entity_type" property_target_entity_type_of_yojson;
  }

and yojson_of_property_target_reference :
    property_target_reference -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ( "entity_type",
        Some (yojson_of_property_target_entity_type value.entity_type) );
    ]

let make_property_target_reference ~(entity_id : string)
    ~(entity_type : property_target_entity_type) () =
  ({ entity_id; entity_type } : property_target_reference)

type nonrec bulk_entity_properties_request = {
  entities : property_target_reference list;
      (** Array of entity references (entity_id and entity_type pairs) *)
  property_ids : string list option;
      (** Optional: only return properties with these definition IDs. If empty, returns all. *)
}
(** Request for getting properties for multiple entities in bulk *)

let bulk_entity_properties_request_of_yojson :
    Yojson.Safe.t -> bulk_entity_properties_request =
 fun json ->
  let fields = Json.obj json in
  {
    entities =
      Json.required fields "entities"
        (Json.list property_target_reference_of_yojson);
    property_ids = Json.optional fields "property_ids" (Json.list Json.string);
  }

and yojson_of_bulk_entity_properties_request :
    bulk_entity_properties_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "entities",
        Some ((Json.of_list yojson_of_property_target_reference) value.entities)
      );
      ( "property_ids",
        Option.map (Json.of_list Json.of_string) value.property_ids );
    ]

let make_bulk_entity_properties_request
    ~(entities : property_target_reference list) ?property_ids () =
  ({ entities; property_ids } : bulk_entity_properties_request)

type nonrec bulk_update_entities_property_options_request = {
  add_option_ids : string list option;
      (** Options to add to each entity's current value (deduped). *)
  entities : property_target_reference list;
      (** The entities to update. Entities the caller cannot edit are skipped. *)
  property_id : string;
      (** The multi-select property definition changed on every entity. *)
  remove_option_ids : string list option;
      (** Options to remove from each entity's current value (a no-op if absent). *)
}
(** Request to apply one shared option delta across several entities in a single
call. Mirrors the per-entity bulk endpoint's delta semantics, applied to
every listed entity (e.g. tag N emails with one label in one request). *)

let bulk_update_entities_property_options_request_of_yojson :
    Yojson.Safe.t -> bulk_update_entities_property_options_request =
 fun json ->
  let fields = Json.obj json in
  {
    add_option_ids =
      Json.optional fields "add_option_ids" (Json.list Json.string);
    entities =
      Json.required fields "entities"
        (Json.list property_target_reference_of_yojson);
    property_id = Json.required fields "property_id" Json.string;
    remove_option_ids =
      Json.optional fields "remove_option_ids" (Json.list Json.string);
  }

and yojson_of_bulk_update_entities_property_options_request :
    bulk_update_entities_property_options_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "add_option_ids",
        Option.map (Json.of_list Json.of_string) value.add_option_ids );
      ( "entities",
        Some ((Json.of_list yojson_of_property_target_reference) value.entities)
      );
      ("property_id", Some (Json.of_string value.property_id));
      ( "remove_option_ids",
        Option.map (Json.of_list Json.of_string) value.remove_option_ids );
    ]

let make_bulk_update_entities_property_options_request ?add_option_ids
    ~(entities : property_target_reference list) ~(property_id : string)
    ?remove_option_ids () =
  ({ add_option_ids; entities; property_id; remove_option_ids }
    : bulk_update_entities_property_options_request)

type nonrec bulk_update_entities_property_options_response = {
  results : bulk_entity_option_update_result list;
      (** Per-entity results, aligned to the request's [entities] order. *)
}
(** Response for a cross-entity bulk option update: one result per requested
entity, in request order. *)

let bulk_update_entities_property_options_response_of_yojson :
    Yojson.Safe.t -> bulk_update_entities_property_options_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list bulk_entity_option_update_result_of_yojson);
  }

and yojson_of_bulk_update_entities_property_options_response :
    bulk_update_entities_property_options_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_bulk_entity_option_update_result)
             value.results) );
    ]

let make_bulk_update_entities_property_options_response
    ~(results : bulk_entity_option_update_result list) () =
  ({ results } : bulk_update_entities_property_options_response)

type nonrec entity_property_option_update_request = {
  add_option_ids : string list option;
      (** Options to add (deduped against the current value). *)
  property_id : string;
      (** The multi-select property definition being changed. *)
  remove_option_ids : string list option;
      (** Options to remove (a no-op if not present). *)
}
(** One property's option changes in a bulk selection update. The change is a
delta (options to add / remove) so it composes with concurrent edits rather
than replacing the whole value. *)

let entity_property_option_update_request_of_yojson :
    Yojson.Safe.t -> entity_property_option_update_request =
 fun json ->
  let fields = Json.obj json in
  {
    add_option_ids =
      Json.optional fields "add_option_ids" (Json.list Json.string);
    property_id = Json.required fields "property_id" Json.string;
    remove_option_ids =
      Json.optional fields "remove_option_ids" (Json.list Json.string);
  }

and yojson_of_entity_property_option_update_request :
    entity_property_option_update_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "add_option_ids",
        Option.map (Json.of_list Json.of_string) value.add_option_ids );
      ("property_id", Some (Json.of_string value.property_id));
      ( "remove_option_ids",
        Option.map (Json.of_list Json.of_string) value.remove_option_ids );
    ]

let make_entity_property_option_update_request ?add_option_ids
    ~(property_id : string) ?remove_option_ids () =
  ({ add_option_ids; property_id; remove_option_ids }
    : entity_property_option_update_request)

type nonrec bulk_update_entity_property_options_request = {
  properties : entity_property_option_update_request list;
      (** The per-property option changes to apply. *)
}
(** Request to apply option deltas across one or more of an entity's multi-select
properties in a single transaction. *)

let bulk_update_entity_property_options_request_of_yojson :
    Yojson.Safe.t -> bulk_update_entity_property_options_request =
 fun json ->
  let fields = Json.obj json in
  {
    properties =
      Json.required fields "properties"
        (Json.list entity_property_option_update_request_of_yojson);
  }

and yojson_of_bulk_update_entity_property_options_request :
    bulk_update_entity_property_options_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "properties",
        Some
          ((Json.of_list yojson_of_entity_property_option_update_request)
             value.properties) );
    ]

let make_bulk_update_entity_property_options_request
    ~(properties : entity_property_option_update_request list) () =
  ({ properties } : bulk_update_entity_property_options_request)

type nonrec entity_property_option_selection_response = {
  option_ids : string list;
      (** The final option ids the server persisted, in stored order. *)
  property_id : string;  (** The property definition the options belong to. *)
}
(** The reconciled final option ids stored for one property after a bulk update. *)

let entity_property_option_selection_response_of_yojson :
    Yojson.Safe.t -> entity_property_option_selection_response =
 fun json ->
  let fields = Json.obj json in
  {
    option_ids = Json.required fields "option_ids" (Json.list Json.string);
    property_id = Json.required fields "property_id" Json.string;
  }

and yojson_of_entity_property_option_selection_response :
    entity_property_option_selection_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("option_ids", Some ((Json.of_list Json.of_string) value.option_ids));
      ("property_id", Some (Json.of_string value.property_id));
    ]

let make_entity_property_option_selection_response ~(option_ids : string list)
    ~(property_id : string) () =
  ({ option_ids; property_id } : entity_property_option_selection_response)

type nonrec bulk_update_entity_property_options_response = {
  properties : entity_property_option_selection_response list;
      (** The final option ids per updated property. *)
}
(** Response for a bulk option update: each property's reconciled final ids. *)

let bulk_update_entity_property_options_response_of_yojson :
    Yojson.Safe.t -> bulk_update_entity_property_options_response =
 fun json ->
  let fields = Json.obj json in
  {
    properties =
      Json.required fields "properties"
        (Json.list entity_property_option_selection_response_of_yojson);
  }

and yojson_of_bulk_update_entity_property_options_response :
    bulk_update_entity_property_options_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "properties",
        Some
          ((Json.of_list yojson_of_entity_property_option_selection_response)
             value.properties) );
    ]

let make_bulk_update_entity_property_options_response
    ~(properties : entity_property_option_selection_response list) () =
  ({ properties } : bulk_update_entity_property_options_response)

type nonrec select_number_option = { display_order : int; value : float }
(** Option for select number properties in requests. *)

let select_number_option_of_yojson : Yojson.Safe.t -> select_number_option =
 fun json ->
  let fields = Json.obj json in
  {
    display_order = Json.required fields "display_order" Json.int;
    value = Json.required fields "value" Json.float;
  }

and yojson_of_select_number_option : select_number_option -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("display_order", Some (Json.of_int value.display_order));
      ("value", Some (Json.of_float value.value));
    ]

let make_select_number_option ~(display_order : int) ~(value : float) () =
  ({ display_order; value } : select_number_option)

type nonrec select_string_option = { display_order : int; value : string }
(** Option for select-type properties in requests. *)

let select_string_option_of_yojson : Yojson.Safe.t -> select_string_option =
 fun json ->
  let fields = Json.obj json in
  {
    display_order = Json.required fields "display_order" Json.int;
    value = Json.required fields "value" Json.string;
  }

and yojson_of_select_string_option : select_string_option -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("display_order", Some (Json.of_int value.display_order));
      ("value", Some (Json.of_string value.value));
    ]

let make_select_string_option ~(display_order : int) ~(value : string) () =
  ({ display_order; value } : select_string_option)

(** Type of entity that can be referenced by entity properties. *)
type nonrec entity_type =
  | Calendar_event
  | Call_record
  | Channel
  | Chat
  | Company
  | Database_row
  | Contact
  | Document
  | Initiative
  | Project
  | Task
  | Thread
  | User
  | Unknown of string  (** A value this SDK version does not know. *)

let entity_type_of_yojson : Yojson.Safe.t -> entity_type =
 fun json ->
  match Json.string json with
  | "CALENDAR_EVENT" -> Calendar_event
  | "CALL_RECORD" -> Call_record
  | "CHANNEL" -> Channel
  | "CHAT" -> Chat
  | "COMPANY" -> Company
  | "DATABASE_ROW" -> Database_row
  | "CONTACT" -> Contact
  | "DOCUMENT" -> Document
  | "INITIATIVE" -> Initiative
  | "PROJECT" -> Project
  | "TASK" -> Task
  | "THREAD" -> Thread
  | "USER" -> User
  | other -> Unknown other

and yojson_of_entity_type : entity_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Calendar_event -> `String "CALENDAR_EVENT"
  | Call_record -> `String "CALL_RECORD"
  | Channel -> `String "CHANNEL"
  | Chat -> `String "CHAT"
  | Company -> `String "COMPANY"
  | Database_row -> `String "DATABASE_ROW"
  | Contact -> `String "CONTACT"
  | Document -> `String "DOCUMENT"
  | Initiative -> `String "INITIATIVE"
  | Project -> `String "PROJECT"
  | Task -> `String "TASK"
  | Thread -> `String "THREAD"
  | User -> `String "USER"
  | Unknown other -> `String other

(** Data type with embedded options for requests - provides compile-time validation. *)
type nonrec property_data_type =
  | Boolean  (** Boolean true/false values. *)
  | Date  (** Date and time values. *)
  | Date_range  (** A span from a start date-time to an end one. *)
  | Number  (** Numeric values. *)
  | String  (** String/text values. *)
  | Select_number of { multi : bool; options : select_number_option list }
      (** Select property with numeric options. *)
  | Select_string of { multi : bool; options : select_string_option list }
      (** Select property with string options. *)
  | Entity of { multi : bool; specific_type : entity_type option }
      (** Entity reference property. *)
  | Link of { multi : bool }  (** Link property. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let property_data_type_of_yojson : Yojson.Safe.t -> property_data_type =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "boolean" -> Boolean
  | "date" -> Date
  | "date_range" -> Date_range
  | "number" -> Number
  | "string" -> String
  | "select_number" ->
      Select_number
        {
          multi = Json.required fields "multi" Json.bool;
          options =
            Json.required fields "options"
              (Json.list select_number_option_of_yojson);
        }
  | "select_string" ->
      Select_string
        {
          multi = Json.required fields "multi" Json.bool;
          options =
            Json.required fields "options"
              (Json.list select_string_option_of_yojson);
        }
  | "entity" ->
      Entity
        {
          multi = Json.required fields "multi" Json.bool;
          specific_type =
            Json.optional fields "specific_type" entity_type_of_yojson;
        }
  | "link" -> Link { multi = Json.required fields "multi" Json.bool }
  | _ -> Unknown json

and yojson_of_property_data_type : property_data_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Boolean -> Json.record [ ("type", Some (`String "boolean")) ]
  | Date -> Json.record [ ("type", Some (`String "date")) ]
  | Date_range -> Json.record [ ("type", Some (`String "date_range")) ]
  | Number -> Json.record [ ("type", Some (`String "number")) ]
  | String -> Json.record [ ("type", Some (`String "string")) ]
  | Select_number case ->
      Json.record
        [
          ("type", Some (`String "select_number"));
          ("multi", Some (Json.of_bool case.multi));
          ( "options",
            Some ((Json.of_list yojson_of_select_number_option) case.options) );
        ]
  | Select_string case ->
      Json.record
        [
          ("type", Some (`String "select_string"));
          ("multi", Some (Json.of_bool case.multi));
          ( "options",
            Some ((Json.of_list yojson_of_select_string_option) case.options) );
        ]
  | Entity case ->
      Json.record
        [
          ("type", Some (`String "entity"));
          ("multi", Some (Json.of_bool case.multi));
          ("specific_type", Option.map yojson_of_entity_type case.specific_type);
        ]
  | Link case ->
      Json.record
        [
          ("type", Some (`String "link"));
          ("multi", Some (Json.of_bool case.multi));
        ]
  | Unknown json -> json

let make_property_data_type_select_number ~(multi : bool)
    ~(options : select_number_option list) () =
  (Select_number { multi; options } : property_data_type)

let make_property_data_type_select_string ~(multi : bool)
    ~(options : select_string_option list) () =
  (Select_string { multi; options } : property_data_type)

let make_property_data_type_entity ~(multi : bool) ?specific_type () =
  (Entity { multi; specific_type } : property_data_type)

let make_property_data_type_link ~(multi : bool) () =
  (Link { multi } : property_data_type)

(** Ownership scope a client may request when creating a property definition.
The owning user or team is derived server-side from the authenticated caller -
clients never supply owner ids. System properties are not creatable via the API. *)
type nonrec create_property_scope =
  | User
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

let create_property_scope_of_yojson : Yojson.Safe.t -> create_property_scope =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "team" -> Team
  | other -> Unknown other

and yojson_of_create_property_scope : create_property_scope -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Team -> `String "team"
  | Unknown other -> `String other

type nonrec create_property_definition_request = {
  data_type : property_data_type;
  display_name : string;
  scope : create_property_scope;
}
(** Request to create a new property definition. *)

let create_property_definition_request_of_yojson :
    Yojson.Safe.t -> create_property_definition_request =
 fun json ->
  let fields = Json.obj json in
  {
    data_type = Json.required fields "data_type" property_data_type_of_yojson;
    display_name = Json.required fields "display_name" Json.string;
    scope = Json.required fields "scope" create_property_scope_of_yojson;
  }

and yojson_of_create_property_definition_request :
    create_property_definition_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("data_type", Some (yojson_of_property_data_type value.data_type));
      ("display_name", Some (Json.of_string value.display_name));
      ("scope", Some (yojson_of_create_property_scope value.scope));
    ]

let make_create_property_definition_request ~(data_type : property_data_type)
    ~(display_name : string) ~(scope : create_property_scope) () =
  ({ data_type; display_name; scope } : create_property_definition_request)

(** Data type for property values, determining storage and validation. *)
type nonrec data_type =
  | Boolean
  | Date
  | Date_range
  | Number
  | String
  | Select_number
  | Select_string
  | Tag
  | Entity
  | Link
  | Unknown of string  (** A value this SDK version does not know. *)

let data_type_of_yojson : Yojson.Safe.t -> data_type =
 fun json ->
  match Json.string json with
  | "BOOLEAN" -> Boolean
  | "DATE" -> Date
  | "DATE_RANGE" -> Date_range
  | "NUMBER" -> Number
  | "STRING" -> String
  | "SELECT_NUMBER" -> Select_number
  | "SELECT_STRING" -> Select_string
  | "TAG" -> Tag
  | "ENTITY" -> Entity
  | "LINK" -> Link
  | other -> Unknown other

and yojson_of_data_type : data_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Boolean -> `String "BOOLEAN"
  | Date -> `String "DATE"
  | Date_range -> `String "DATE_RANGE"
  | Number -> `String "NUMBER"
  | String -> `String "STRING"
  | Select_number -> `String "SELECT_NUMBER"
  | Select_string -> `String "SELECT_STRING"
  | Tag -> `String "TAG"
  | Entity -> `String "ENTITY"
  | Link -> `String "LINK"
  | Unknown other -> `String other

type nonrec date_range = { end_ : string; start : string }
(** A span of time from [start] to [end], both included. The end is never
before the start: a range that would end earlier does not deserialize. *)

let date_range_of_yojson : Yojson.Safe.t -> date_range =
 fun json ->
  let fields = Json.obj json in
  {
    end_ = Json.required fields "end" Json.string;
    start = Json.required fields "start" Json.string;
  }

and yojson_of_date_range : date_range -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("end", Some (Json.of_string value.end_));
      ("start", Some (Json.of_string value.start));
    ]

let make_date_range ~(end_ : string) ~(start : string) () =
  ({ end_; start } : date_range)

(** Which owner a tag set belongs to. *)
type nonrec tag_scope =
  | User
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

let tag_scope_of_yojson : Yojson.Safe.t -> tag_scope =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "team" -> Team
  | other -> Unknown other

and yojson_of_tag_scope : tag_scope -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Team -> `String "team"
  | Unknown other -> `String other

type nonrec ensure_tag_set_request = { scope : tag_scope }
(** Request to provision (get-or-create) the caller's tag set for a scope. *)

let ensure_tag_set_request_of_yojson : Yojson.Safe.t -> ensure_tag_set_request =
 fun json ->
  let fields = Json.obj json in
  { scope = Json.required fields "scope" tag_scope_of_yojson }

and yojson_of_ensure_tag_set_request : ensure_tag_set_request -> Yojson.Safe.t =
 fun value -> Json.record [ ("scope", Some (yojson_of_tag_scope value.scope)) ]

let make_ensure_tag_set_request ~(scope : tag_scope) () =
  ({ scope } : ensure_tag_set_request)

(** Defines who owns a property - user-scoped, team-scoped, database-scoped, or system. *)
type nonrec property_owner =
  | User of { user_id : string }  (** User-scoped property. *)
  | Team of { team_id : string }  (** Team-scoped property. *)
  | Database of { database_id : string }
      (** Database-scoped property: the definition is a column of one Macro
database and is invisible to the shared user/team property namespace. *)
  | System  (** System-owned property (no user, team, or database owner). *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let property_owner_of_yojson : Yojson.Safe.t -> property_owner =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "scope" with
  | "user" -> User { user_id = Json.required fields "user_id" Json.string }
  | "team" -> Team { team_id = Json.required fields "team_id" Json.string }
  | "database" ->
      Database { database_id = Json.required fields "database_id" Json.string }
  | "system" -> System
  | _ -> Unknown json

and yojson_of_property_owner : property_owner -> Yojson.Safe.t =
 fun value ->
  match value with
  | User case ->
      Json.record
        [
          ("scope", Some (`String "user"));
          ("user_id", Some (Json.of_string case.user_id));
        ]
  | Team case ->
      Json.record
        [
          ("scope", Some (`String "team"));
          ("team_id", Some (Json.of_string case.team_id));
        ]
  | Database case ->
      Json.record
        [
          ("scope", Some (`String "database"));
          ("database_id", Some (Json.of_string case.database_id));
        ]
  | System -> Json.record [ ("scope", Some (`String "system")) ]
  | Unknown json -> json

let make_property_owner_user ~(user_id : string) () =
  (User { user_id } : property_owner)

let make_property_owner_team ~(team_id : string) () =
  (Team { team_id } : property_owner)

let make_property_owner_database ~(database_id : string) () =
  (Database { database_id } : property_owner)

type nonrec property_definition = {
  created_at : string;
  data_type : data_type;
  display_name : string;
  id : string;
  is_metadata : bool;
      (** Flag to indicate if this is a system-generated metadata property.
Not stored in database - computed at service layer. *)
  is_multi_select : bool;
  is_system : bool;
      (** Flag to indicate if this is a system property (stored in DB). *)
  owner : property_owner;
  specific_entity_type : entity_type option;
  updated_at : string;
}
(** Property definition model (service representation). *)

let property_definition_of_yojson : Yojson.Safe.t -> property_definition =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    data_type = Json.required fields "data_type" data_type_of_yojson;
    display_name = Json.required fields "display_name" Json.string;
    id = Json.required fields "id" Json.string;
    is_metadata = Json.required fields "is_metadata" Json.bool;
    is_multi_select = Json.required fields "is_multi_select" Json.bool;
    is_system = Json.required fields "is_system" Json.bool;
    owner = Json.required fields "owner" property_owner_of_yojson;
    specific_entity_type =
      Json.optional fields "specific_entity_type" entity_type_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_property_definition : property_definition -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("data_type", Some (yojson_of_data_type value.data_type));
      ("display_name", Some (Json.of_string value.display_name));
      ("id", Some (Json.of_string value.id));
      ("is_metadata", Some (Json.of_bool value.is_metadata));
      ("is_multi_select", Some (Json.of_bool value.is_multi_select));
      ("is_system", Some (Json.of_bool value.is_system));
      ("owner", Some (yojson_of_property_owner value.owner));
      ( "specific_entity_type",
        Some ((Json.of_option yojson_of_entity_type) value.specific_entity_type)
      );
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_property_definition ~(created_at : string) ~(data_type : data_type)
    ~(display_name : string) ~(id : string) ~(is_metadata : bool)
    ~(is_multi_select : bool) ~(is_system : bool) ~(owner : property_owner)
    ?specific_entity_type ~(updated_at : string) () =
  ({
     created_at;
     data_type;
     display_name;
     id;
     is_metadata;
     is_multi_select;
     is_system;
     owner;
     specific_entity_type;
     updated_at;
   }
    : property_definition)

(** The value of a property option - either a string or a number. *)
type nonrec property_option_value =
  | String of {
      value : string;  (** String value for SelectString properties *)
    }  (** String value for SelectString properties *)
  | Number of { value : float  (** Number value for SelectNumber properties *) }
      (** Number value for SelectNumber properties *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let property_option_value_of_yojson : Yojson.Safe.t -> property_option_value =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "string" -> String { value = Json.required fields "value" Json.string }
  | "number" -> Number { value = Json.required fields "value" Json.float }
  | _ -> Unknown json

and yojson_of_property_option_value : property_option_value -> Yojson.Safe.t =
 fun value ->
  match value with
  | String case ->
      Json.record
        [
          ("type", Some (`String "string"));
          ("value", Some (Json.of_string case.value));
        ]
  | Number case ->
      Json.record
        [
          ("type", Some (`String "number"));
          ("value", Some (Json.of_float case.value));
        ]
  | Unknown json -> json

let make_property_option_value_string ~(value : string) () =
  (String { value } : property_option_value)

let make_property_option_value_number ~(value : float) () =
  (Number { value } : property_option_value)

type nonrec property_option = {
  color : string option;
  created_at : string;
  display_order : int;
  id : string;
  property_definition_id : string;
  updated_at : string;
  value : property_option_value;
}
(** A selectable option for select-type properties (service representation). *)

let property_option_of_yojson : Yojson.Safe.t -> property_option =
 fun json ->
  let fields = Json.obj json in
  {
    color = Json.optional fields "color" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    display_order = Json.required fields "display_order" Json.int;
    id = Json.required fields "id" Json.string;
    property_definition_id =
      Json.required fields "property_definition_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    value = Json.required fields "value" property_option_value_of_yojson;
  }

and yojson_of_property_option : property_option -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("color", Some ((Json.of_option Json.of_string) value.color));
      ("created_at", Some (Json.of_string value.created_at));
      ("display_order", Some (Json.of_int value.display_order));
      ("id", Some (Json.of_string value.id));
      ( "property_definition_id",
        Some (Json.of_string value.property_definition_id) );
      ("updated_at", Some (Json.of_string value.updated_at));
      ("value", Some (yojson_of_property_option_value value.value));
    ]

let make_property_option ?color ~(created_at : string) ~(display_order : int)
    ~(id : string) ~(property_definition_id : string) ~(updated_at : string)
    ~(value : property_option_value) () =
  ({
     color;
     created_at;
     display_order;
     id;
     property_definition_id;
     updated_at;
     value;
   }
    : property_option)

type nonrec entity_property = {
  created_at : string;
  entity_id : string;
  entity_type : entity_type;
  id : string;
  property_definition_id : string;
  updated_at : string;
}
(** Assignment of a property definition to a specific entity (service representation). *)

let entity_property_of_yojson : Yojson.Safe.t -> entity_property =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    id = Json.required fields "id" Json.string;
    property_definition_id =
      Json.required fields "property_definition_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_entity_property : entity_property -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ("id", Some (Json.of_string value.id));
      ( "property_definition_id",
        Some (Json.of_string value.property_definition_id) );
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_entity_property ~(created_at : string) ~(entity_id : string)
    ~(entity_type : entity_type) ~(id : string)
    ~(property_definition_id : string) ~(updated_at : string) () =
  ({
     created_at;
     entity_id;
     entity_type;
     id;
     property_definition_id;
     updated_at;
   }
    : entity_property)

type nonrec entity_reference = {
  entity_id : string;
  entity_type : entity_type;
  specific_message_id : string option;
      (** For CHANNEL, CHAT, THREAD entity types - optional specific message ID.
This allows referencing a specific message within a thread/channel/chat. *)
}
(** Entity reference for entity-type property values. *)

let entity_reference_of_yojson : Yojson.Safe.t -> entity_reference =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" entity_type_of_yojson;
    specific_message_id = Json.optional fields "specific_message_id" Json.string;
  }

and yojson_of_entity_reference : entity_reference -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (yojson_of_entity_type value.entity_type));
      ( "specific_message_id",
        Option.map Json.of_string value.specific_message_id );
    ]

let make_entity_reference ~(entity_id : string) ~(entity_type : entity_type)
    ?specific_message_id () =
  ({ entity_id; entity_type; specific_message_id } : entity_reference)

(** Property value (service representation).

Represents the actual value stored for an entity property.
This is serialized to/from JSONB in the database. *)
type nonrec property_value =
  | Boolean of {
      value : bool;
          (** Boolean value
Serializes as: \{"type": "Boolean", "value": true\} *)
    }  (** Boolean value
Serializes as: \{"type": "Boolean", "value": true\} *)
  | Number of {
      value : float;
          (** Numeric value
Serializes as: \{"type": "Number", "value": 42.5\} *)
    }  (** Numeric value
Serializes as: \{"type": "Number", "value": 42.5\} *)
  | String of {
      value : string;
          (** String value
Serializes as: \{"type": "String", "value": "text"\} *)
    }  (** String value
Serializes as: \{"type": "String", "value": "text"\} *)
  | Date of {
      value : string;
          (** Date/timestamp value
Serializes as: \{"type": "Date", "value": "2025-01-01T00:00:00Z"\} *)
    }
      (** Date/timestamp value
Serializes as: \{"type": "Date", "value": "2025-01-01T00:00:00Z"\} *)
  | Date_range of {
      value : date_range;
          (** Date range value
Serializes as: \{"type": "DateRange", "value": \{"start": "2025-01-01T00:00:00Z", "end": "2025-01-31T00:00:00Z"\}\} *)
    }
      (** Date range value
Serializes as: \{"type": "DateRange", "value": \{"start": "2025-01-01T00:00:00Z", "end": "2025-01-31T00:00:00Z"\}\} *)
  | Select_option of {
      value : string list;
          (** Select option(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "SelectOption", "value": \["uuid"\]\} (length 0 or 1)
Multi-select: \{"type": "SelectOption", "value": \["uuid1", "uuid2", ...\]\} (length 0+) *)
    }
      (** Select option(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "SelectOption", "value": \["uuid"\]\} (length 0 or 1)
Multi-select: \{"type": "SelectOption", "value": \["uuid1", "uuid2", ...\]\} (length 0+) *)
  | Entity_reference of {
      value : entity_reference list;
          (** Entity reference(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "EntityReference", "value": \[\{...\}\]\} (length 0 or 1)
Multi-select: \{"type": "EntityReference", "value": \[\{...\}, \{...\}, ...\]\} (length 0+) *)
    }
      (** Entity reference(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "EntityReference", "value": \[\{...\}\]\} (length 0 or 1)
Multi-select: \{"type": "EntityReference", "value": \[\{...\}, \{...\}, ...\]\} (length 0+) *)
  | Link of {
      value : string list;
          (** Link value(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "Link", "value": \["https://example.com"\]\} (length 0 or 1)
Multi-select: \{"type": "Link", "value": \["https://example.com", "https://other.com"\]\} (length 0+) *)
    }
      (** Link value(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "Link", "value": \["https://example.com"\]\} (length 0 or 1)
Multi-select: \{"type": "Link", "value": \["https://example.com", "https://other.com"\]\} (length 0+) *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let property_value_of_yojson : Yojson.Safe.t -> property_value =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "Boolean" -> Boolean { value = Json.required fields "value" Json.bool }
  | "Number" -> Number { value = Json.required fields "value" Json.float }
  | "String" -> String { value = Json.required fields "value" Json.string }
  | "Date" -> Date { value = Json.required fields "value" Json.string }
  | "DateRange" ->
      Date_range { value = Json.required fields "value" date_range_of_yojson }
  | "SelectOption" ->
      Select_option
        { value = Json.required fields "value" (Json.list Json.string) }
  | "EntityReference" ->
      Entity_reference
        {
          value =
            Json.required fields "value" (Json.list entity_reference_of_yojson);
        }
  | "Link" ->
      Link { value = Json.required fields "value" (Json.list Json.string) }
  | _ -> Unknown json

and yojson_of_property_value : property_value -> Yojson.Safe.t =
 fun value ->
  match value with
  | Boolean case ->
      Json.record
        [
          ("type", Some (`String "Boolean"));
          ("value", Some (Json.of_bool case.value));
        ]
  | Number case ->
      Json.record
        [
          ("type", Some (`String "Number"));
          ("value", Some (Json.of_float case.value));
        ]
  | String case ->
      Json.record
        [
          ("type", Some (`String "String"));
          ("value", Some (Json.of_string case.value));
        ]
  | Date case ->
      Json.record
        [
          ("type", Some (`String "Date"));
          ("value", Some (Json.of_string case.value));
        ]
  | Date_range case ->
      Json.record
        [
          ("type", Some (`String "DateRange"));
          ("value", Some (yojson_of_date_range case.value));
        ]
  | Select_option case ->
      Json.record
        [
          ("type", Some (`String "SelectOption"));
          ("value", Some ((Json.of_list Json.of_string) case.value));
        ]
  | Entity_reference case ->
      Json.record
        [
          ("type", Some (`String "EntityReference"));
          ("value", Some ((Json.of_list yojson_of_entity_reference) case.value));
        ]
  | Link case ->
      Json.record
        [
          ("type", Some (`String "Link"));
          ("value", Some ((Json.of_list Json.of_string) case.value));
        ]
  | Unknown json -> json

let make_property_value_boolean ~(value : bool) () =
  (Boolean { value } : property_value)

let make_property_value_number ~(value : float) () =
  (Number { value } : property_value)

let make_property_value_string ~(value : string) () =
  (String { value } : property_value)

let make_property_value_date ~(value : string) () =
  (Date { value } : property_value)

let make_property_value_date_range ~(value : date_range) () =
  (Date_range { value } : property_value)

let make_property_value_select_option ~(value : string list) () =
  (Select_option { value } : property_value)

let make_property_value_entity_reference ~(value : entity_reference list) () =
  (Entity_reference { value } : property_value)

let make_property_value_link ~(value : string list) () =
  (Link { value } : property_value)

type nonrec entity_property_with_definition = {
  definition : property_definition;
  options : property_option list option;
  property : entity_property;
  value : property_value option;
}
(** Entity property with its definition, value, and options (service representation). *)

let entity_property_with_definition_of_yojson :
    Yojson.Safe.t -> entity_property_with_definition =
 fun json ->
  let fields = Json.obj json in
  {
    definition = Json.required fields "definition" property_definition_of_yojson;
    options =
      Json.optional fields "options" (Json.list property_option_of_yojson);
    property = Json.required fields "property" entity_property_of_yojson;
    value = Json.optional fields "value" property_value_of_yojson;
  }

and yojson_of_entity_property_with_definition :
    entity_property_with_definition -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("definition", Some (yojson_of_property_definition value.definition));
      ( "options",
        Option.map (Json.of_list yojson_of_property_option) value.options );
      ("property", Some (yojson_of_entity_property value.property));
      ("value", Option.map yojson_of_property_value value.value);
    ]

let make_entity_property_with_definition ~(definition : property_definition)
    ?options ~(property : entity_property) ?value () =
  ({ definition; options; property; value } : entity_property_with_definition)

type nonrec entity_properties_response = {
  entity_id : string;
  properties : entity_property_with_definition list;
}
(** Response for document/entity properties endpoint. *)

let entity_properties_response_of_yojson :
    Yojson.Safe.t -> entity_properties_response =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    properties =
      Json.required fields "properties"
        (Json.list entity_property_with_definition_of_yojson);
  }

and yojson_of_entity_properties_response :
    entity_properties_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ( "properties",
        Some
          ((Json.of_list yojson_of_entity_property_with_definition)
             value.properties) );
    ]

let make_entity_properties_response ~(entity_id : string)
    ~(properties : entity_property_with_definition list) () =
  ({ entity_id; properties } : entity_properties_response)

type nonrec entity_property_response = {
  created_at : string option;
  entity_id : string;
  entity_type : entity_type;
  id : string;
  property_definition_id : string;
  updated_at : string option;
}
(** Entity property response (API representation). *)

let entity_property_response_of_yojson :
    Yojson.Safe.t -> entity_property_response =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.optional fields "createdAt" Json.string;
    entity_id = Json.required fields "entityId" Json.string;
    entity_type = Json.required fields "entityType" entity_type_of_yojson;
    id = Json.required fields "id" Json.string;
    property_definition_id =
      Json.required fields "propertyDefinitionId" Json.string;
    updated_at = Json.optional fields "updatedAt" Json.string;
  }

and yojson_of_entity_property_response :
    entity_property_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Option.map Json.of_string value.created_at);
      ("entityId", Some (Json.of_string value.entity_id));
      ("entityType", Some (yojson_of_entity_type value.entity_type));
      ("id", Some (Json.of_string value.id));
      ( "propertyDefinitionId",
        Some (Json.of_string value.property_definition_id) );
      ("updatedAt", Option.map Json.of_string value.updated_at);
    ]

let make_entity_property_response ?created_at ~(entity_id : string)
    ~(entity_type : entity_type) ~(id : string)
    ~(property_definition_id : string) ?updated_at () =
  ({
     created_at;
     entity_id;
     entity_type;
     id;
     property_definition_id;
     updated_at;
   }
    : entity_property_response)

type nonrec property_definition_detail_response = {
  property_owner : property_owner;
  created_at : string option;
  data_type : data_type;
  display_name : string;
  id : string;
  is_metadata : bool;
      (** Flag to indicate if this is a system-generated metadata property *)
  is_multi_select : bool;
  is_system : bool;
      (** Flag to indicate if this is a system property (managed by the system) *)
  specific_entity_type : entity_type option;
  updated_at : string option;
}
(** Property definition response (API representation). *)

let property_definition_detail_response_of_yojson :
    Yojson.Safe.t -> property_definition_detail_response =
 fun json ->
  let fields = Json.obj json in
  {
    property_owner = property_owner_of_yojson json;
    created_at = Json.optional fields "createdAt" Json.string;
    data_type = Json.required fields "dataType" data_type_of_yojson;
    display_name = Json.required fields "displayName" Json.string;
    id = Json.required fields "id" Json.string;
    is_metadata = Json.required fields "isMetadata" Json.bool;
    is_multi_select = Json.required fields "isMultiSelect" Json.bool;
    is_system = Json.required fields "isSystem" Json.bool;
    specific_entity_type =
      Json.optional fields "specificEntityType" entity_type_of_yojson;
    updated_at = Json.optional fields "updatedAt" Json.string;
  }

and yojson_of_property_definition_detail_response :
    property_definition_detail_response -> Yojson.Safe.t =
 fun value ->
  Json.merge
    [
      Json.record
        [
          ("createdAt", Option.map Json.of_string value.created_at);
          ("dataType", Some (yojson_of_data_type value.data_type));
          ("displayName", Some (Json.of_string value.display_name));
          ("id", Some (Json.of_string value.id));
          ("isMetadata", Some (Json.of_bool value.is_metadata));
          ("isMultiSelect", Some (Json.of_bool value.is_multi_select));
          ("isSystem", Some (Json.of_bool value.is_system));
          ( "specificEntityType",
            Option.map yojson_of_entity_type value.specific_entity_type );
          ("updatedAt", Option.map Json.of_string value.updated_at);
        ];
      yojson_of_property_owner value.property_owner;
    ]

let make_property_definition_detail_response ~(property_owner : property_owner)
    ?created_at ~(data_type : data_type) ~(display_name : string) ~(id : string)
    ~(is_metadata : bool) ~(is_multi_select : bool) ~(is_system : bool)
    ?specific_entity_type ?updated_at () =
  ({
     property_owner;
     created_at;
     data_type;
     display_name;
     id;
     is_metadata;
     is_multi_select;
     is_system;
     specific_entity_type;
     updated_at;
   }
    : property_definition_detail_response)

type nonrec property_option_response = {
  color : string option;
  display_order : int;
  id : string;
  property_definition_id : string;
  value : property_option_value;
}
(** Property option response (API representation). *)

let property_option_response_of_yojson :
    Yojson.Safe.t -> property_option_response =
 fun json ->
  let fields = Json.obj json in
  {
    color = Json.optional fields "color" Json.string;
    display_order = Json.required fields "displayOrder" Json.int;
    id = Json.required fields "id" Json.string;
    property_definition_id =
      Json.required fields "propertyDefinitionId" Json.string;
    value = Json.required fields "value" property_option_value_of_yojson;
  }

and yojson_of_property_option_response :
    property_option_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("color", Option.map Json.of_string value.color);
      ("displayOrder", Some (Json.of_int value.display_order));
      ("id", Some (Json.of_string value.id));
      ( "propertyDefinitionId",
        Some (Json.of_string value.property_definition_id) );
      ("value", Some (yojson_of_property_option_value value.value));
    ]

let make_property_option_response ?color ~(display_order : int) ~(id : string)
    ~(property_definition_id : string) ~(value : property_option_value) () =
  ({ color; display_order; id; property_definition_id; value }
    : property_option_response)

type nonrec entity_property_with_definition_response = {
  definition : property_definition_detail_response;
  options : property_option_response list option;
  property : entity_property_response;
  value : property_value option;
}
(** Entity property with definition response (API representation). *)

let entity_property_with_definition_response_of_yojson :
    Yojson.Safe.t -> entity_property_with_definition_response =
 fun json ->
  let fields = Json.obj json in
  {
    definition =
      Json.required fields "definition"
        property_definition_detail_response_of_yojson;
    options =
      Json.optional fields "options"
        (Json.list property_option_response_of_yojson);
    property =
      Json.required fields "property" entity_property_response_of_yojson;
    value = Json.optional fields "value" property_value_of_yojson;
  }

and yojson_of_entity_property_with_definition_response :
    entity_property_with_definition_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "definition",
        Some (yojson_of_property_definition_detail_response value.definition) );
      ( "options",
        Option.map
          (Json.of_list yojson_of_property_option_response)
          value.options );
      ("property", Some (yojson_of_entity_property_response value.property));
      ("value", Option.map yojson_of_property_value value.value);
    ]

let make_entity_property_with_definition_response
    ~(definition : property_definition_detail_response) ?options
    ~(property : entity_property_response) ?value () =
  ({ definition; options; property; value }
    : entity_property_with_definition_response)

type nonrec entity_query_params = {
  include_metadata : bool option;
      (** Whether to include system metadata properties (default: false) *)
}
(** Query parameters for entity properties endpoint. *)

let entity_query_params_of_yojson : Yojson.Safe.t -> entity_query_params =
 fun json ->
  let fields = Json.obj json in
  { include_metadata = Json.optional fields "include_metadata" Json.bool }

and yojson_of_entity_query_params : entity_query_params -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("include_metadata", Option.map Json.of_bool value.include_metadata) ]

let make_entity_query_params ?include_metadata () =
  ({ include_metadata } : entity_query_params)

(** Scope filter for property queries *)
type nonrec property_scope =
  | User
  | Team
  | System
  | All
  | Unknown of string  (** A value this SDK version does not know. *)

let property_scope_of_yojson : Yojson.Safe.t -> property_scope =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "team" -> Team
  | "system" -> System
  | "all" -> All
  | other -> Unknown other

and yojson_of_property_scope : property_scope -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Team -> `String "team"
  | System -> `String "system"
  | All -> `String "all"
  | Unknown other -> `String other

type nonrec list_properties_query = {
  for_entity_type : entity_type option;
  include_options : bool option;
      (** Whether to include property options in the response *)
  scope : property_scope;  (** Scope filter for properties *)
}
(** Query parameters for listing properties *)

let list_properties_query_of_yojson : Yojson.Safe.t -> list_properties_query =
 fun json ->
  let fields = Json.obj json in
  {
    for_entity_type =
      Json.optional fields "for_entity_type" entity_type_of_yojson;
    include_options = Json.optional fields "include_options" Json.bool;
    scope = Json.required fields "scope" property_scope_of_yojson;
  }

and yojson_of_list_properties_query : list_properties_query -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("for_entity_type", Option.map yojson_of_entity_type value.for_entity_type);
      ("include_options", Option.map Json.of_bool value.include_options);
      ("scope", Some (yojson_of_property_scope value.scope));
    ]

let make_list_properties_query ?for_entity_type ?include_options
    ~(scope : property_scope) () =
  ({ for_entity_type; include_options; scope } : list_properties_query)

type nonrec merge_tag_request = {
  option_id : string;  (** The personal label to retire. *)
  target_option_id : string;
      (** The team label every entity carrying [option_id] is retagged with. *)
}
(** Request to replace a personal label with an existing team label. *)

let merge_tag_request_of_yojson : Yojson.Safe.t -> merge_tag_request =
 fun json ->
  let fields = Json.obj json in
  {
    option_id = Json.required fields "option_id" Json.string;
    target_option_id = Json.required fields "target_option_id" Json.string;
  }

and yojson_of_merge_tag_request : merge_tag_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("option_id", Some (Json.of_string value.option_id));
      ("target_option_id", Some (Json.of_string value.target_option_id));
    ]

let make_merge_tag_request ~(option_id : string) ~(target_option_id : string) ()
    =
  ({ option_id; target_option_id } : merge_tag_request)

type nonrec promote_tag_request = {
  option_id : string;  (** The personal label to move into the team tag set. *)
}
(** Request to share one of the caller's personal labels with their team. *)

let promote_tag_request_of_yojson : Yojson.Safe.t -> promote_tag_request =
 fun json ->
  let fields = Json.obj json in
  { option_id = Json.required fields "option_id" Json.string }

and yojson_of_promote_tag_request : promote_tag_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("option_id", Some (Json.of_string value.option_id)) ]

let make_promote_tag_request ~(option_id : string) () =
  ({ option_id } : promote_tag_request)

type nonrec property_definition_with_options = {
  definition : property_definition;
  property_options : property_option list;
}
(** Property definition with its associated options (service representation). *)

let property_definition_with_options_of_yojson :
    Yojson.Safe.t -> property_definition_with_options =
 fun json ->
  let fields = Json.obj json in
  {
    definition = Json.required fields "definition" property_definition_of_yojson;
    property_options =
      Json.required fields "property_options"
        (Json.list property_option_of_yojson);
  }

and yojson_of_property_definition_with_options :
    property_definition_with_options -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("definition", Some (yojson_of_property_definition value.definition));
      ( "property_options",
        Some ((Json.of_list yojson_of_property_option) value.property_options)
      );
    ]

let make_property_definition_with_options ~(definition : property_definition)
    ~(property_options : property_option list) () =
  ({ definition; property_options } : property_definition_with_options)

(** Response for property definition with optional property options *)
type nonrec property_definition_response =
  | Property_definition of property_definition
  | Property_definition_with_options of property_definition_with_options

let property_definition_response_of_yojson :
    Yojson.Safe.t -> property_definition_response =
 fun json ->
  Json.first_ok
    [
      (fun json -> Property_definition (property_definition_of_yojson json));
      (fun json ->
        Property_definition_with_options
          (property_definition_with_options_of_yojson json));
    ]
    json

and yojson_of_property_definition_response :
    property_definition_response -> Yojson.Safe.t =
 fun value ->
  match value with
  | Property_definition inner -> yojson_of_property_definition inner
  | Property_definition_with_options inner ->
      yojson_of_property_definition_with_options inner

type nonrec property_definition_with_options_response = {
  definition : property_definition_detail_response;
  property_options : property_option_response list;
}
(** Property definition with options response. *)

let property_definition_with_options_response_of_yojson :
    Yojson.Safe.t -> property_definition_with_options_response =
 fun json ->
  let fields = Json.obj json in
  {
    definition =
      Json.required fields "definition"
        property_definition_detail_response_of_yojson;
    property_options =
      Json.required fields "propertyOptions"
        (Json.list property_option_response_of_yojson);
  }

and yojson_of_property_definition_with_options_response :
    property_definition_with_options_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "definition",
        Some (yojson_of_property_definition_detail_response value.definition) );
      ( "propertyOptions",
        Some
          ((Json.of_list yojson_of_property_option_response)
             value.property_options) );
    ]

let make_property_definition_with_options_response
    ~(definition : property_definition_detail_response)
    ~(property_options : property_option_response list) () =
  ({ definition; property_options } : property_definition_with_options_response)

(** Type-safe enum for setting entity property values - provides compile-time validation. *)
type nonrec set_property_value =
  | Boolean of { value : bool }  (** Boolean true/false value *)
  | Date of { value : string }  (** Date and time value *)
  | Date_range of { value : date_range }  (** Date range value *)
  | Number of { value : float }  (** Numeric value *)
  | String of { value : string }  (** String/text value *)
  | Select_option of { option_id : string }
      (** Select option by ID (for select-type properties) *)
  | Multi_select_option of { option_ids : string list }
      (** Multiple select options by ID (for multi-select properties) *)
  | Entity_reference of { reference : entity_reference }
      (** Entity reference *)
  | Multi_entity_reference of { references : entity_reference list }
      (** Multiple entity references (for multi-select entity properties) *)
  | Link of { url : string }  (** Link value *)
  | Multi_link of { urls : string list }
      (** Multiple link values (for multi-select link properties) *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let set_property_value_of_yojson : Yojson.Safe.t -> set_property_value =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "boolean" -> Boolean { value = Json.required fields "value" Json.bool }
  | "date" -> Date { value = Json.required fields "value" Json.string }
  | "date_range" ->
      Date_range { value = Json.required fields "value" date_range_of_yojson }
  | "number" -> Number { value = Json.required fields "value" Json.float }
  | "string" -> String { value = Json.required fields "value" Json.string }
  | "select_option" ->
      Select_option { option_id = Json.required fields "option_id" Json.string }
  | "multi_select_option" ->
      Multi_select_option
        {
          option_ids = Json.required fields "option_ids" (Json.list Json.string);
        }
  | "entity_reference" ->
      Entity_reference
        {
          reference =
            Json.required fields "reference" entity_reference_of_yojson;
        }
  | "multi_entity_reference" ->
      Multi_entity_reference
        {
          references =
            Json.required fields "references"
              (Json.list entity_reference_of_yojson);
        }
  | "link" -> Link { url = Json.required fields "url" Json.string }
  | "multi_link" ->
      Multi_link { urls = Json.required fields "urls" (Json.list Json.string) }
  | _ -> Unknown json

and yojson_of_set_property_value : set_property_value -> Yojson.Safe.t =
 fun value ->
  match value with
  | Boolean case ->
      Json.record
        [
          ("type", Some (`String "boolean"));
          ("value", Some (Json.of_bool case.value));
        ]
  | Date case ->
      Json.record
        [
          ("type", Some (`String "date"));
          ("value", Some (Json.of_string case.value));
        ]
  | Date_range case ->
      Json.record
        [
          ("type", Some (`String "date_range"));
          ("value", Some (yojson_of_date_range case.value));
        ]
  | Number case ->
      Json.record
        [
          ("type", Some (`String "number"));
          ("value", Some (Json.of_float case.value));
        ]
  | String case ->
      Json.record
        [
          ("type", Some (`String "string"));
          ("value", Some (Json.of_string case.value));
        ]
  | Select_option case ->
      Json.record
        [
          ("type", Some (`String "select_option"));
          ("option_id", Some (Json.of_string case.option_id));
        ]
  | Multi_select_option case ->
      Json.record
        [
          ("type", Some (`String "multi_select_option"));
          ("option_ids", Some ((Json.of_list Json.of_string) case.option_ids));
        ]
  | Entity_reference case ->
      Json.record
        [
          ("type", Some (`String "entity_reference"));
          ("reference", Some (yojson_of_entity_reference case.reference));
        ]
  | Multi_entity_reference case ->
      Json.record
        [
          ("type", Some (`String "multi_entity_reference"));
          ( "references",
            Some ((Json.of_list yojson_of_entity_reference) case.references) );
        ]
  | Link case ->
      Json.record
        [
          ("type", Some (`String "link"));
          ("url", Some (Json.of_string case.url));
        ]
  | Multi_link case ->
      Json.record
        [
          ("type", Some (`String "multi_link"));
          ("urls", Some ((Json.of_list Json.of_string) case.urls));
        ]
  | Unknown json -> json

let make_set_property_value_boolean ~(value : bool) () =
  (Boolean { value } : set_property_value)

let make_set_property_value_date ~(value : string) () =
  (Date { value } : set_property_value)

let make_set_property_value_date_range ~(value : date_range) () =
  (Date_range { value } : set_property_value)

let make_set_property_value_number ~(value : float) () =
  (Number { value } : set_property_value)

let make_set_property_value_string ~(value : string) () =
  (String { value } : set_property_value)

let make_set_property_value_select_option ~(option_id : string) () =
  (Select_option { option_id } : set_property_value)

let make_set_property_value_multi_select_option ~(option_ids : string list) () =
  (Multi_select_option { option_ids } : set_property_value)

let make_set_property_value_entity_reference ~(reference : entity_reference) ()
    =
  (Entity_reference { reference } : set_property_value)

let make_set_property_value_multi_entity_reference
    ~(references : entity_reference list) () =
  (Multi_entity_reference { references } : set_property_value)

let make_set_property_value_link ~(url : string) () =
  (Link { url } : set_property_value)

let make_set_property_value_multi_link ~(urls : string list) () =
  (Multi_link { urls } : set_property_value)

type nonrec set_entity_property_request = { value : set_property_value option }
(** Type-safe request for setting entity property values. *)

let set_entity_property_request_of_yojson :
    Yojson.Safe.t -> set_entity_property_request =
 fun json ->
  let fields = Json.obj json in
  { value = Json.optional fields "value" set_property_value_of_yojson }

and yojson_of_set_entity_property_request :
    set_entity_property_request -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("value", Option.map yojson_of_set_property_value value.value) ]

let make_set_entity_property_request ?value () =
  ({ value } : set_entity_property_request)

type nonrec tag_promotion_conflict_response = {
  conflicting_option : property_option_response;
      (** The team label that already uses this name. *)
  message : string;  (** Human-readable description of the collision. *)
}
(** Body returned when a promotion collides with a label the team already has.
The caller confirms with the user, then calls the merge endpoint with
[conflicting_option.id] as the target. *)

let tag_promotion_conflict_response_of_yojson :
    Yojson.Safe.t -> tag_promotion_conflict_response =
 fun json ->
  let fields = Json.obj json in
  {
    conflicting_option =
      Json.required fields "conflicting_option"
        property_option_response_of_yojson;
    message = Json.required fields "message" Json.string;
  }

and yojson_of_tag_promotion_conflict_response :
    tag_promotion_conflict_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "conflicting_option",
        Some (yojson_of_property_option_response value.conflicting_option) );
      ("message", Some (Json.of_string value.message));
    ]

let make_tag_promotion_conflict_response
    ~(conflicting_option : property_option_response) ~(message : string) () =
  ({ conflicting_option; message } : tag_promotion_conflict_response)

type nonrec tag_set_response = {
  definition : property_definition_detail_response option;
  options : property_option_response list;
  scope : tag_scope;
}
(** A tag set the caller can use. [definition] is absent until the set is provisioned
(on first label create), in which case [options] is empty. *)

let tag_set_response_of_yojson : Yojson.Safe.t -> tag_set_response =
 fun json ->
  let fields = Json.obj json in
  {
    definition =
      Json.optional fields "definition"
        property_definition_detail_response_of_yojson;
    options =
      Json.required fields "options"
        (Json.list property_option_response_of_yojson);
    scope = Json.required fields "scope" tag_scope_of_yojson;
  }

and yojson_of_tag_set_response : tag_set_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "definition",
        Option.map yojson_of_property_definition_detail_response
          value.definition );
      ( "options",
        Some ((Json.of_list yojson_of_property_option_response) value.options)
      );
      ("scope", Some (yojson_of_tag_scope value.scope));
    ]

let make_tag_set_response ?definition ~(options : property_option_response list)
    ~(scope : tag_scope) () =
  ({ definition; options; scope } : tag_set_response)

type nonrec update_property_option_request = {
  color : string option;  (** New color as a hex string like [#RRGGBB]. *)
  display_order : int option;  (** New display order. *)
  value : string option;
      (** New string value (label text). Only valid for SelectString and Tag properties. *)
}
(** Request to update a property option in place. Omitted fields keep their current value.
The option id is preserved, so the change propagates to every entity referencing it. *)

let update_property_option_request_of_yojson :
    Yojson.Safe.t -> update_property_option_request =
 fun json ->
  let fields = Json.obj json in
  {
    color = Json.optional fields "color" Json.string;
    display_order = Json.optional fields "display_order" Json.int;
    value = Json.optional fields "value" Json.string;
  }

and yojson_of_update_property_option_request :
    update_property_option_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("color", Option.map Json.of_string value.color);
      ("display_order", Option.map Json.of_int value.display_order);
      ("value", Option.map Json.of_string value.value);
    ]

let make_update_property_option_request ?color ?display_order ?value () =
  ({ color; display_order; value } : update_property_option_request)

(** [GET /properties/definitions]

List property definitions with flexible filtering *)
let list_properties ~(scope : property_scope) ?include_options ?for_entity_type
    () =
  ({
     Request.service = "properties";
     operation = "list_properties";
     meth = `GET;
     path = "/properties/definitions";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "scope",
             [
               (fun value -> Json.string (yojson_of_property_scope value)) scope;
             ] );
           ( "include_options",
             match include_options with
             | None -> []
             | Some value -> [ string_of_bool value ] );
           ( "for_entity_type",
             match for_entity_type with
             | None -> []
             | Some value ->
                 [
                   (fun value -> Json.string (yojson_of_entity_type value))
                     value;
                 ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply =
       Request.json (Json.list property_definition_response_of_yojson);
     decode_error = Request.no_error;
   }
    : ( property_definition_response list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /properties/definitions]

Create a new property definition *)
let create_property_definition ~(data_type : property_data_type)
    ~(display_name : string) ~(scope : create_property_scope) () =
  ({
     Request.service = "properties";
     operation = "create_property_definition";
     meth = `POST;
     path = "/properties/definitions";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_property_definition_request
               ({ data_type; display_name; scope }
                 : create_property_definition_request)));
     decode_reply = Request.json property_definition_of_yojson;
     decode_error = Request.no_error;
   }
    : ( property_definition,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /properties/definitions/{definition_id}]

Get a property definition by ID *)
let get_property_definition ~(definition_id : string) () =
  ({
     Request.service = "properties";
     operation = "get_property_definition";
     meth = `GET;
     path =
       String.concat ""
         [
           "/properties/definitions/";
           Request.segment ((fun value -> value) definition_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json property_definition_of_yojson;
     decode_error = Request.no_error;
   }
    : ( property_definition,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /properties/definitions/{definition_id}]

Delete a property definition *)
let delete_property_definition ~(definition_id : string) () =
  ({
     Request.service = "properties";
     operation = "delete_property_definition";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/properties/definitions/";
           Request.segment ((fun value -> value) definition_id);
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

(** [GET /properties/definitions/{definition_id}/options]

Get all options for a property (for dropdowns) *)
let get_property_options ~(definition_id : string) () =
  ({
     Request.service = "properties";
     operation = "get_property_options";
     meth = `GET;
     path =
       String.concat ""
         [
           "/properties/definitions/";
           Request.segment ((fun value -> value) definition_id);
           "/options";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list property_option_of_yojson);
     decode_error = Request.no_error;
   }
    : ( property_option list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /properties/definitions/{definition_id}/options]

Add a new option to a property dropdown *)
let add_property_option ~(definition_id : string)
    ~(body : add_property_option_request) () =
  ({
     Request.service = "properties";
     operation = "add_property_option";
     meth = `POST;
     path =
       String.concat ""
         [
           "/properties/definitions/";
           Request.segment ((fun value -> value) definition_id);
           "/options";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (yojson_of_add_property_option_request body));
     decode_reply = Request.json property_option_of_yojson;
     decode_error = Request.no_error;
   }
    : ( property_option,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /properties/definitions/{definition_id}/options/{option_id}]

Delete a property option *)
let delete_property_option ~(definition_id : string) ~(option_id : string) () =
  ({
     Request.service = "properties";
     operation = "delete_property_option";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/properties/definitions/";
           Request.segment ((fun value -> value) definition_id);
           "/options/";
           Request.segment ((fun value -> value) option_id);
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

(** [PATCH /properties/definitions/{definition_id}/options/{option_id}]

Update a property option in place (rename / recolor / reorder). *)
let update_property_option ~(definition_id : string) ~(option_id : string)
    ?color ?display_order ?value () =
  ({
     Request.service = "properties";
     operation = "update_property_option";
     meth = `PATCH;
     path =
       String.concat ""
         [
           "/properties/definitions/";
           Request.segment ((fun value -> value) definition_id);
           "/options/";
           Request.segment ((fun value -> value) option_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_property_option_request
               ({ color; display_order; value }
                 : update_property_option_request)));
     decode_reply = Request.json property_option_of_yojson;
     decode_error = Request.no_error;
   }
    : ( property_option,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /properties/entities/bulk]

Get properties for multiple entities in bulk (public endpoint with user auth) *)
let get_bulk_entity_properties ~(entities : property_target_reference list)
    ?property_ids () =
  ({
     Request.service = "properties";
     operation = "get_bulk_entity_properties";
     meth = `POST;
     path = "/properties/entities/bulk";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_bulk_entity_properties_request
               ({ entities; property_ids } : bulk_entity_properties_request)));
     decode_reply = Request.json (Json.map entity_properties_response_of_yojson);
     decode_error = Request.no_error;
   }
    : ( (string * entity_properties_response) list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /properties/entities/{entity_type}/{entity_id}]

Get all properties for an entity *)
let get_entity_properties ~(entity_type : property_target_entity_type)
    ~(entity_id : string) ?include_metadata () =
  ({
     Request.service = "properties";
     operation = "get_entity_properties";
     meth = `GET;
     path =
       String.concat ""
         [
           "/properties/entities/";
           Request.segment
             ((fun value ->
                Json.string (yojson_of_property_target_entity_type value))
                entity_type);
           "/";
           Request.segment ((fun value -> value) entity_id);
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "include_metadata",
             match include_metadata with
             | None -> []
             | Some value -> [ string_of_bool value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json entity_properties_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( entity_properties_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /properties/entities/{entity_type}/{entity_id}/options/bulk]

Apply a complete tag-picker selection across an entity's multi-select
properties in one request. *)
let bulk_update_entity_property_options
    ~(entity_type : property_target_entity_type) ~(entity_id : string)
    ~(properties : entity_property_option_update_request list) () =
  ({
     Request.service = "properties";
     operation = "bulk_update_entity_property_options";
     meth = `POST;
     path =
       String.concat ""
         [
           "/properties/entities/";
           Request.segment
             ((fun value ->
                Json.string (yojson_of_property_target_entity_type value))
                entity_type);
           "/";
           Request.segment ((fun value -> value) entity_id);
           "/options/bulk";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_bulk_update_entity_property_options_request
               ({ properties } : bulk_update_entity_property_options_request)));
     decode_reply =
       Request.json bulk_update_entity_property_options_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( bulk_update_entity_property_options_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /properties/entities/{entity_type}/{entity_id}/{property_id}]

Set or update a property value for an entity, or attach a property without a value *)
let set_entity_property ~(entity_type : property_target_entity_type)
    ~(entity_id : string) ~(property_id : string) ?value () =
  ({
     Request.service = "properties";
     operation = "set_entity_property";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/properties/entities/";
           Request.segment
             ((fun value ->
                Json.string (yojson_of_property_target_entity_type value))
                entity_type);
           "/";
           Request.segment ((fun value -> value) entity_id);
           "/";
           Request.segment ((fun value -> value) property_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_set_entity_property_request
               ({ value } : set_entity_property_request)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [POST /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}]

Add a single option to an entity's multi-select property value. *)
let add_entity_property_option ~(entity_type : property_target_entity_type)
    ~(entity_id : string) ~(property_id : string) ~(option_id : string) () =
  ({
     Request.service = "properties";
     operation = "add_entity_property_option";
     meth = `POST;
     path =
       String.concat ""
         [
           "/properties/entities/";
           Request.segment
             ((fun value ->
                Json.string (yojson_of_property_target_entity_type value))
                entity_type);
           "/";
           Request.segment ((fun value -> value) entity_id);
           "/";
           Request.segment ((fun value -> value) property_id);
           "/options/";
           Request.segment ((fun value -> value) option_id);
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

(** [DELETE /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}]

Remove a single option from an entity's multi-select property value. *)
let remove_entity_property_option ~(entity_type : property_target_entity_type)
    ~(entity_id : string) ~(property_id : string) ~(option_id : string) () =
  ({
     Request.service = "properties";
     operation = "remove_entity_property_option";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/properties/entities/";
           Request.segment
             ((fun value ->
                Json.string (yojson_of_property_target_entity_type value))
                entity_type);
           "/";
           Request.segment ((fun value -> value) entity_id);
           "/";
           Request.segment ((fun value -> value) property_id);
           "/options/";
           Request.segment ((fun value -> value) option_id);
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

(** [DELETE /properties/entity_properties/{entity_property_id}]

Remove a specific entity property by its ID *)
let delete_entity_property ~(entity_property_id : string) () =
  ({
     Request.service = "properties";
     operation = "delete_entity_property";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/properties/entity_properties/";
           Request.segment ((fun value -> value) entity_property_id);
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

(** [POST /properties/options/bulk]

Apply one shared option delta (add / remove option ids on a single
multi-select property) to many entities in one request — e.g. tag a set of
emails with one label. *)
let bulk_update_entities_property_options
    ~(entities : property_target_reference list) ~(property_id : string)
    ?add_option_ids ?remove_option_ids () =
  ({
     Request.service = "properties";
     operation = "bulk_update_entities_property_options";
     meth = `POST;
     path = "/properties/options/bulk";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_bulk_update_entities_property_options_request
               ({ add_option_ids; entities; property_id; remove_option_ids }
                 : bulk_update_entities_property_options_request)));
     decode_reply =
       Request.json bulk_update_entities_property_options_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( bulk_update_entities_property_options_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /properties/tags]

List the caller's tag sets: their personal set, plus their team's set when on a team.
Pure read - a scope with no provisioned definition yet returns an empty set. *)
let list_tags () =
  ({
     Request.service = "properties";
     operation = "list_tags";
     meth = `GET;
     path = "/properties/tags";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json (Json.list tag_set_response_of_yojson);
     decode_error = Request.no_error;
   }
    : ( tag_set_response list,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /properties/tags]

Provision (get-or-create) the caller's tag set for a scope and return it. Called when
the caller creates their first label for that scope, so the read path stays side-effect free. *)
let ensure_tag_set ~(scope : tag_scope) () =
  ({
     Request.service = "properties";
     operation = "ensure_tag_set";
     meth = `POST;
     path = "/properties/tags";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_ensure_tag_set_request
               ({ scope } : ensure_tag_set_request)));
     decode_reply = Request.json tag_set_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( tag_set_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /properties/tags/merge]

Replace one of the caller's personal labels with an existing team label. *)
let merge_tag ~(option_id : string) ~(target_option_id : string) () =
  ({
     Request.service = "properties";
     operation = "merge_tag";
     meth = `POST;
     path = "/properties/tags/merge";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_merge_tag_request
               ({ option_id; target_option_id } : merge_tag_request)));
     decode_reply = Request.json property_option_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( property_option_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /properties/tags/promote]

Share one of the caller's personal labels with their team. *)
let promote_tag ~(option_id : string) () =
  ({
     Request.service = "properties";
     operation = "promote_tag";
     meth = `POST;
     path = "/properties/tags/promote";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_promote_tag_request
               ({ option_id } : promote_tag_request)));
     decode_reply = Request.json property_option_response_of_yojson;
     decode_error =
       Request.error_json [ 409 ] tag_promotion_conflict_response_of_yojson;
   }
    : ( property_option_response,
        tag_promotion_conflict_response )
      Macro_sdk_runtime.Request.t)
