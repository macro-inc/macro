(* Generated from packages/sdk/specs/properties.json by packages/sdk-ocaml/gen. Do not edit. *)

type nonrec add_number_option_request = { display_order : int; value : float }
(** Type-safe request to add a number option to a SelectNumber property. *)

val add_number_option_request_of_yojson :
  Yojson.Safe.t -> add_number_option_request

val yojson_of_add_number_option_request :
  add_number_option_request -> Yojson.Safe.t

val make_add_number_option_request :
  display_order:int -> value:float -> unit -> add_number_option_request
(** Type-safe request to add a number option to a SelectNumber property. *)

type nonrec add_string_option_request = {
  color : string option;
  display_order : int;
  value : string;
}
(** Type-safe request to add a string option to a SelectString property. *)

val add_string_option_request_of_yojson :
  Yojson.Safe.t -> add_string_option_request

val yojson_of_add_string_option_request :
  add_string_option_request -> Yojson.Safe.t

val make_add_string_option_request :
  ?color:string ->
  display_order:int ->
  value:string ->
  unit ->
  add_string_option_request
(** Type-safe request to add a string option to a SelectString property. *)

(** Enum for type-safe property option addition requests. *)
type nonrec add_property_option_request =
  | Select_string of { option : add_string_option_request }
      (** Add a string option to a SelectString property *)
  | Select_number of { option : add_number_option_request }
      (** Add a number option to a SelectNumber property *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val add_property_option_request_of_yojson :
  Yojson.Safe.t -> add_property_option_request

val yojson_of_add_property_option_request :
  add_property_option_request -> Yojson.Safe.t

val make_add_property_option_request_select_string :
  option:add_string_option_request -> unit -> add_property_option_request
(** Add a string option to a SelectString property *)

val make_add_property_option_request_select_number :
  option:add_number_option_request -> unit -> add_property_option_request
(** Add a number option to a SelectNumber property *)

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

val property_target_entity_type_of_yojson :
  Yojson.Safe.t -> property_target_entity_type

val yojson_of_property_target_entity_type :
  property_target_entity_type -> Yojson.Safe.t

(** Per-entity outcome of a cross-entity bulk option update. *)
type nonrec bulk_entity_option_update_status =
  | Applied
  | Skipped_no_permission
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val bulk_entity_option_update_status_of_yojson :
  Yojson.Safe.t -> bulk_entity_option_update_status

val yojson_of_bulk_entity_option_update_status :
  bulk_entity_option_update_status -> Yojson.Safe.t

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

val bulk_entity_option_update_result_of_yojson :
  Yojson.Safe.t -> bulk_entity_option_update_result

val yojson_of_bulk_entity_option_update_result :
  bulk_entity_option_update_result -> Yojson.Safe.t

val make_bulk_entity_option_update_result :
  entity_id:string ->
  entity_type:property_target_entity_type ->
  ?error:string ->
  ?option_ids:string list ->
  status:bulk_entity_option_update_status ->
  unit ->
  bulk_entity_option_update_result
(** One entity's result in a cross-entity bulk option update. *)

type nonrec property_target_reference = {
  entity_id : string;  (** Entity identifier. *)
  entity_type : property_target_entity_type;  (** Canonical entity type. *)
}
(** Canonical reference to an entity receiving properties. *)

val property_target_reference_of_yojson :
  Yojson.Safe.t -> property_target_reference

val yojson_of_property_target_reference :
  property_target_reference -> Yojson.Safe.t

val make_property_target_reference :
  entity_id:string ->
  entity_type:property_target_entity_type ->
  unit ->
  property_target_reference
(** Canonical reference to an entity receiving properties. *)

type nonrec bulk_entity_properties_request = {
  entities : property_target_reference list;
      (** Array of entity references (entity_id and entity_type pairs) *)
  property_ids : string list option;
      (** Optional: only return properties with these definition IDs. If empty, returns all. *)
}
(** Request for getting properties for multiple entities in bulk *)

val bulk_entity_properties_request_of_yojson :
  Yojson.Safe.t -> bulk_entity_properties_request

val yojson_of_bulk_entity_properties_request :
  bulk_entity_properties_request -> Yojson.Safe.t

val make_bulk_entity_properties_request :
  entities:property_target_reference list ->
  ?property_ids:string list ->
  unit ->
  bulk_entity_properties_request
(** Request for getting properties for multiple entities in bulk *)

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

val bulk_update_entities_property_options_request_of_yojson :
  Yojson.Safe.t -> bulk_update_entities_property_options_request

val yojson_of_bulk_update_entities_property_options_request :
  bulk_update_entities_property_options_request -> Yojson.Safe.t

val make_bulk_update_entities_property_options_request :
  ?add_option_ids:string list ->
  entities:property_target_reference list ->
  property_id:string ->
  ?remove_option_ids:string list ->
  unit ->
  bulk_update_entities_property_options_request
(** Request to apply one shared option delta across several entities in a single
call. Mirrors the per-entity bulk endpoint's delta semantics, applied to
every listed entity (e.g. tag N emails with one label in one request). *)

type nonrec bulk_update_entities_property_options_response = {
  results : bulk_entity_option_update_result list;
      (** Per-entity results, aligned to the request's [entities] order. *)
}
(** Response for a cross-entity bulk option update: one result per requested
entity, in request order. *)

val bulk_update_entities_property_options_response_of_yojson :
  Yojson.Safe.t -> bulk_update_entities_property_options_response

val yojson_of_bulk_update_entities_property_options_response :
  bulk_update_entities_property_options_response -> Yojson.Safe.t

val make_bulk_update_entities_property_options_response :
  results:bulk_entity_option_update_result list ->
  unit ->
  bulk_update_entities_property_options_response
(** Response for a cross-entity bulk option update: one result per requested
entity, in request order. *)

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

val entity_property_option_update_request_of_yojson :
  Yojson.Safe.t -> entity_property_option_update_request

val yojson_of_entity_property_option_update_request :
  entity_property_option_update_request -> Yojson.Safe.t

val make_entity_property_option_update_request :
  ?add_option_ids:string list ->
  property_id:string ->
  ?remove_option_ids:string list ->
  unit ->
  entity_property_option_update_request
(** One property's option changes in a bulk selection update. The change is a
delta (options to add / remove) so it composes with concurrent edits rather
than replacing the whole value. *)

type nonrec bulk_update_entity_property_options_request = {
  properties : entity_property_option_update_request list;
      (** The per-property option changes to apply. *)
}
(** Request to apply option deltas across one or more of an entity's multi-select
properties in a single transaction. *)

val bulk_update_entity_property_options_request_of_yojson :
  Yojson.Safe.t -> bulk_update_entity_property_options_request

val yojson_of_bulk_update_entity_property_options_request :
  bulk_update_entity_property_options_request -> Yojson.Safe.t

val make_bulk_update_entity_property_options_request :
  properties:entity_property_option_update_request list ->
  unit ->
  bulk_update_entity_property_options_request
(** Request to apply option deltas across one or more of an entity's multi-select
properties in a single transaction. *)

type nonrec entity_property_option_selection_response = {
  option_ids : string list;
      (** The final option ids the server persisted, in stored order. *)
  property_id : string;  (** The property definition the options belong to. *)
}
(** The reconciled final option ids stored for one property after a bulk update. *)

val entity_property_option_selection_response_of_yojson :
  Yojson.Safe.t -> entity_property_option_selection_response

val yojson_of_entity_property_option_selection_response :
  entity_property_option_selection_response -> Yojson.Safe.t

val make_entity_property_option_selection_response :
  option_ids:string list ->
  property_id:string ->
  unit ->
  entity_property_option_selection_response
(** The reconciled final option ids stored for one property after a bulk update. *)

type nonrec bulk_update_entity_property_options_response = {
  properties : entity_property_option_selection_response list;
      (** The final option ids per updated property. *)
}
(** Response for a bulk option update: each property's reconciled final ids. *)

val bulk_update_entity_property_options_response_of_yojson :
  Yojson.Safe.t -> bulk_update_entity_property_options_response

val yojson_of_bulk_update_entity_property_options_response :
  bulk_update_entity_property_options_response -> Yojson.Safe.t

val make_bulk_update_entity_property_options_response :
  properties:entity_property_option_selection_response list ->
  unit ->
  bulk_update_entity_property_options_response
(** Response for a bulk option update: each property's reconciled final ids. *)

type nonrec select_number_option = { display_order : int; value : float }
(** Option for select number properties in requests. *)

val select_number_option_of_yojson : Yojson.Safe.t -> select_number_option
val yojson_of_select_number_option : select_number_option -> Yojson.Safe.t

val make_select_number_option :
  display_order:int -> value:float -> unit -> select_number_option
(** Option for select number properties in requests. *)

type nonrec select_string_option = { display_order : int; value : string }
(** Option for select-type properties in requests. *)

val select_string_option_of_yojson : Yojson.Safe.t -> select_string_option
val yojson_of_select_string_option : select_string_option -> Yojson.Safe.t

val make_select_string_option :
  display_order:int -> value:string -> unit -> select_string_option
(** Option for select-type properties in requests. *)

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

val entity_type_of_yojson : Yojson.Safe.t -> entity_type
val yojson_of_entity_type : entity_type -> Yojson.Safe.t

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

val property_data_type_of_yojson : Yojson.Safe.t -> property_data_type
val yojson_of_property_data_type : property_data_type -> Yojson.Safe.t

val make_property_data_type_select_number :
  multi:bool -> options:select_number_option list -> unit -> property_data_type
(** Select property with numeric options. *)

val make_property_data_type_select_string :
  multi:bool -> options:select_string_option list -> unit -> property_data_type
(** Select property with string options. *)

val make_property_data_type_entity :
  multi:bool -> ?specific_type:entity_type -> unit -> property_data_type
(** Entity reference property. *)

val make_property_data_type_link : multi:bool -> unit -> property_data_type
(** Link property. *)

(** Ownership scope a client may request when creating a property definition.
The owning user or team is derived server-side from the authenticated caller -
clients never supply owner ids. System properties are not creatable via the API. *)
type nonrec create_property_scope =
  | User
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

val create_property_scope_of_yojson : Yojson.Safe.t -> create_property_scope
val yojson_of_create_property_scope : create_property_scope -> Yojson.Safe.t

type nonrec create_property_definition_request = {
  data_type : property_data_type;
  display_name : string;
  scope : create_property_scope;
}
(** Request to create a new property definition. *)

val create_property_definition_request_of_yojson :
  Yojson.Safe.t -> create_property_definition_request

val yojson_of_create_property_definition_request :
  create_property_definition_request -> Yojson.Safe.t

val make_create_property_definition_request :
  data_type:property_data_type ->
  display_name:string ->
  scope:create_property_scope ->
  unit ->
  create_property_definition_request
(** Request to create a new property definition. *)

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

val data_type_of_yojson : Yojson.Safe.t -> data_type
val yojson_of_data_type : data_type -> Yojson.Safe.t

type nonrec date_range = { end_ : string; start : string }
(** A span of time from [start] to [end], both included. The end is never
before the start: a range that would end earlier does not deserialize. *)

val date_range_of_yojson : Yojson.Safe.t -> date_range
val yojson_of_date_range : date_range -> Yojson.Safe.t

val make_date_range : end_:string -> start:string -> unit -> date_range
(** A span of time from [start] to [end], both included. The end is never
before the start: a range that would end earlier does not deserialize. *)

(** Which owner a tag set belongs to. *)
type nonrec tag_scope =
  | User
  | Team
  | Unknown of string  (** A value this SDK version does not know. *)

val tag_scope_of_yojson : Yojson.Safe.t -> tag_scope
val yojson_of_tag_scope : tag_scope -> Yojson.Safe.t

type nonrec ensure_tag_set_request = { scope : tag_scope }
(** Request to provision (get-or-create) the caller's tag set for a scope. *)

val ensure_tag_set_request_of_yojson : Yojson.Safe.t -> ensure_tag_set_request
val yojson_of_ensure_tag_set_request : ensure_tag_set_request -> Yojson.Safe.t

val make_ensure_tag_set_request :
  scope:tag_scope -> unit -> ensure_tag_set_request
(** Request to provision (get-or-create) the caller's tag set for a scope. *)

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

val property_owner_of_yojson : Yojson.Safe.t -> property_owner
val yojson_of_property_owner : property_owner -> Yojson.Safe.t

val make_property_owner_user : user_id:string -> unit -> property_owner
(** User-scoped property. *)

val make_property_owner_team : team_id:string -> unit -> property_owner
(** Team-scoped property. *)

val make_property_owner_database : database_id:string -> unit -> property_owner
(** Database-scoped property: the definition is a column of one Macro
database and is invisible to the shared user/team property namespace. *)

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

val property_definition_of_yojson : Yojson.Safe.t -> property_definition
val yojson_of_property_definition : property_definition -> Yojson.Safe.t

val make_property_definition :
  created_at:string ->
  data_type:data_type ->
  display_name:string ->
  id:string ->
  is_metadata:bool ->
  is_multi_select:bool ->
  is_system:bool ->
  owner:property_owner ->
  ?specific_entity_type:entity_type ->
  updated_at:string ->
  unit ->
  property_definition
(** Property definition model (service representation). *)

(** The value of a property option - either a string or a number. *)
type nonrec property_option_value =
  | String of {
      value : string;  (** String value for SelectString properties *)
    }  (** String value for SelectString properties *)
  | Number of { value : float  (** Number value for SelectNumber properties *) }
      (** Number value for SelectNumber properties *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val property_option_value_of_yojson : Yojson.Safe.t -> property_option_value
val yojson_of_property_option_value : property_option_value -> Yojson.Safe.t

val make_property_option_value_string :
  value:string -> unit -> property_option_value
(** String value for SelectString properties *)

val make_property_option_value_number :
  value:float -> unit -> property_option_value
(** Number value for SelectNumber properties *)

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

val property_option_of_yojson : Yojson.Safe.t -> property_option
val yojson_of_property_option : property_option -> Yojson.Safe.t

val make_property_option :
  ?color:string ->
  created_at:string ->
  display_order:int ->
  id:string ->
  property_definition_id:string ->
  updated_at:string ->
  value:property_option_value ->
  unit ->
  property_option
(** A selectable option for select-type properties (service representation). *)

type nonrec entity_property = {
  created_at : string;
  entity_id : string;
  entity_type : entity_type;
  id : string;
  property_definition_id : string;
  updated_at : string;
}
(** Assignment of a property definition to a specific entity (service representation). *)

val entity_property_of_yojson : Yojson.Safe.t -> entity_property
val yojson_of_entity_property : entity_property -> Yojson.Safe.t

val make_entity_property :
  created_at:string ->
  entity_id:string ->
  entity_type:entity_type ->
  id:string ->
  property_definition_id:string ->
  updated_at:string ->
  unit ->
  entity_property
(** Assignment of a property definition to a specific entity (service representation). *)

type nonrec entity_reference = {
  entity_id : string;
  entity_type : entity_type;
  specific_message_id : string option;
      (** For CHANNEL, CHAT, THREAD entity types - optional specific message ID.
This allows referencing a specific message within a thread/channel/chat. *)
}
(** Entity reference for entity-type property values. *)

val entity_reference_of_yojson : Yojson.Safe.t -> entity_reference
val yojson_of_entity_reference : entity_reference -> Yojson.Safe.t

val make_entity_reference :
  entity_id:string ->
  entity_type:entity_type ->
  ?specific_message_id:string ->
  unit ->
  entity_reference
(** Entity reference for entity-type property values. *)

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

val property_value_of_yojson : Yojson.Safe.t -> property_value
val yojson_of_property_value : property_value -> Yojson.Safe.t

val make_property_value_boolean : value:bool -> unit -> property_value
(** Boolean value
Serializes as: \{"type": "Boolean", "value": true\} *)

val make_property_value_number : value:float -> unit -> property_value
(** Numeric value
Serializes as: \{"type": "Number", "value": 42.5\} *)

val make_property_value_string : value:string -> unit -> property_value
(** String value
Serializes as: \{"type": "String", "value": "text"\} *)

val make_property_value_date : value:string -> unit -> property_value
(** Date/timestamp value
Serializes as: \{"type": "Date", "value": "2025-01-01T00:00:00Z"\} *)

val make_property_value_date_range : value:date_range -> unit -> property_value
(** Date range value
Serializes as: \{"type": "DateRange", "value": \{"start": "2025-01-01T00:00:00Z", "end": "2025-01-31T00:00:00Z"\}\} *)

val make_property_value_select_option :
  value:string list -> unit -> property_value
(** Select option(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "SelectOption", "value": \["uuid"\]\} (length 0 or 1)
Multi-select: \{"type": "SelectOption", "value": \["uuid1", "uuid2", ...\]\} (length 0+) *)

val make_property_value_entity_reference :
  value:entity_reference list -> unit -> property_value
(** Entity reference(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "EntityReference", "value": \[\{...\}\]\} (length 0 or 1)
Multi-select: \{"type": "EntityReference", "value": \[\{...\}, \{...\}, ...\]\} (length 0+) *)

val make_property_value_link : value:string list -> unit -> property_value
(** Link value(s) - always an array (check is_multi_select to determine if single or multi)
Single-select: \{"type": "Link", "value": \["https://example.com"\]\} (length 0 or 1)
Multi-select: \{"type": "Link", "value": \["https://example.com", "https://other.com"\]\} (length 0+) *)

type nonrec entity_property_with_definition = {
  definition : property_definition;
  options : property_option list option;
  property : entity_property;
  value : property_value option;
}
(** Entity property with its definition, value, and options (service representation). *)

val entity_property_with_definition_of_yojson :
  Yojson.Safe.t -> entity_property_with_definition

val yojson_of_entity_property_with_definition :
  entity_property_with_definition -> Yojson.Safe.t

val make_entity_property_with_definition :
  definition:property_definition ->
  ?options:property_option list ->
  property:entity_property ->
  ?value:property_value ->
  unit ->
  entity_property_with_definition
(** Entity property with its definition, value, and options (service representation). *)

type nonrec entity_properties_response = {
  entity_id : string;
  properties : entity_property_with_definition list;
}
(** Response for document/entity properties endpoint. *)

val entity_properties_response_of_yojson :
  Yojson.Safe.t -> entity_properties_response

val yojson_of_entity_properties_response :
  entity_properties_response -> Yojson.Safe.t

val make_entity_properties_response :
  entity_id:string ->
  properties:entity_property_with_definition list ->
  unit ->
  entity_properties_response
(** Response for document/entity properties endpoint. *)

type nonrec entity_property_response = {
  created_at : string option;
  entity_id : string;
  entity_type : entity_type;
  id : string;
  property_definition_id : string;
  updated_at : string option;
}
(** Entity property response (API representation). *)

val entity_property_response_of_yojson :
  Yojson.Safe.t -> entity_property_response

val yojson_of_entity_property_response :
  entity_property_response -> Yojson.Safe.t

val make_entity_property_response :
  ?created_at:string ->
  entity_id:string ->
  entity_type:entity_type ->
  id:string ->
  property_definition_id:string ->
  ?updated_at:string ->
  unit ->
  entity_property_response
(** Entity property response (API representation). *)

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

val property_definition_detail_response_of_yojson :
  Yojson.Safe.t -> property_definition_detail_response

val yojson_of_property_definition_detail_response :
  property_definition_detail_response -> Yojson.Safe.t

val make_property_definition_detail_response :
  property_owner:property_owner ->
  ?created_at:string ->
  data_type:data_type ->
  display_name:string ->
  id:string ->
  is_metadata:bool ->
  is_multi_select:bool ->
  is_system:bool ->
  ?specific_entity_type:entity_type ->
  ?updated_at:string ->
  unit ->
  property_definition_detail_response
(** Property definition response (API representation). *)

type nonrec property_option_response = {
  color : string option;
  display_order : int;
  id : string;
  property_definition_id : string;
  value : property_option_value;
}
(** Property option response (API representation). *)

val property_option_response_of_yojson :
  Yojson.Safe.t -> property_option_response

val yojson_of_property_option_response :
  property_option_response -> Yojson.Safe.t

val make_property_option_response :
  ?color:string ->
  display_order:int ->
  id:string ->
  property_definition_id:string ->
  value:property_option_value ->
  unit ->
  property_option_response
(** Property option response (API representation). *)

type nonrec entity_property_with_definition_response = {
  definition : property_definition_detail_response;
  options : property_option_response list option;
  property : entity_property_response;
  value : property_value option;
}
(** Entity property with definition response (API representation). *)

val entity_property_with_definition_response_of_yojson :
  Yojson.Safe.t -> entity_property_with_definition_response

val yojson_of_entity_property_with_definition_response :
  entity_property_with_definition_response -> Yojson.Safe.t

val make_entity_property_with_definition_response :
  definition:property_definition_detail_response ->
  ?options:property_option_response list ->
  property:entity_property_response ->
  ?value:property_value ->
  unit ->
  entity_property_with_definition_response
(** Entity property with definition response (API representation). *)

type nonrec entity_query_params = {
  include_metadata : bool option;
      (** Whether to include system metadata properties (default: false) *)
}
(** Query parameters for entity properties endpoint. *)

val entity_query_params_of_yojson : Yojson.Safe.t -> entity_query_params
val yojson_of_entity_query_params : entity_query_params -> Yojson.Safe.t

val make_entity_query_params :
  ?include_metadata:bool -> unit -> entity_query_params
(** Query parameters for entity properties endpoint. *)

(** Scope filter for property queries *)
type nonrec property_scope =
  | User
  | Team
  | System
  | All
  | Unknown of string  (** A value this SDK version does not know. *)

val property_scope_of_yojson : Yojson.Safe.t -> property_scope
val yojson_of_property_scope : property_scope -> Yojson.Safe.t

type nonrec list_properties_query = {
  for_entity_type : entity_type option;
  include_options : bool option;
      (** Whether to include property options in the response *)
  scope : property_scope;  (** Scope filter for properties *)
}
(** Query parameters for listing properties *)

val list_properties_query_of_yojson : Yojson.Safe.t -> list_properties_query
val yojson_of_list_properties_query : list_properties_query -> Yojson.Safe.t

val make_list_properties_query :
  ?for_entity_type:entity_type ->
  ?include_options:bool ->
  scope:property_scope ->
  unit ->
  list_properties_query
(** Query parameters for listing properties *)

type nonrec merge_tag_request = {
  option_id : string;  (** The personal label to retire. *)
  target_option_id : string;
      (** The team label every entity carrying [option_id] is retagged with. *)
}
(** Request to replace a personal label with an existing team label. *)

val merge_tag_request_of_yojson : Yojson.Safe.t -> merge_tag_request
val yojson_of_merge_tag_request : merge_tag_request -> Yojson.Safe.t

val make_merge_tag_request :
  option_id:string -> target_option_id:string -> unit -> merge_tag_request
(** Request to replace a personal label with an existing team label. *)

type nonrec promote_tag_request = {
  option_id : string;  (** The personal label to move into the team tag set. *)
}
(** Request to share one of the caller's personal labels with their team. *)

val promote_tag_request_of_yojson : Yojson.Safe.t -> promote_tag_request
val yojson_of_promote_tag_request : promote_tag_request -> Yojson.Safe.t

val make_promote_tag_request : option_id:string -> unit -> promote_tag_request
(** Request to share one of the caller's personal labels with their team. *)

type nonrec property_definition_with_options = {
  definition : property_definition;
  property_options : property_option list;
}
(** Property definition with its associated options (service representation). *)

val property_definition_with_options_of_yojson :
  Yojson.Safe.t -> property_definition_with_options

val yojson_of_property_definition_with_options :
  property_definition_with_options -> Yojson.Safe.t

val make_property_definition_with_options :
  definition:property_definition ->
  property_options:property_option list ->
  unit ->
  property_definition_with_options
(** Property definition with its associated options (service representation). *)

(** Response for property definition with optional property options *)
type nonrec property_definition_response =
  | Property_definition of property_definition
  | Property_definition_with_options of property_definition_with_options

val property_definition_response_of_yojson :
  Yojson.Safe.t -> property_definition_response

val yojson_of_property_definition_response :
  property_definition_response -> Yojson.Safe.t

type nonrec property_definition_with_options_response = {
  definition : property_definition_detail_response;
  property_options : property_option_response list;
}
(** Property definition with options response. *)

val property_definition_with_options_response_of_yojson :
  Yojson.Safe.t -> property_definition_with_options_response

val yojson_of_property_definition_with_options_response :
  property_definition_with_options_response -> Yojson.Safe.t

val make_property_definition_with_options_response :
  definition:property_definition_detail_response ->
  property_options:property_option_response list ->
  unit ->
  property_definition_with_options_response
(** Property definition with options response. *)

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

val set_property_value_of_yojson : Yojson.Safe.t -> set_property_value
val yojson_of_set_property_value : set_property_value -> Yojson.Safe.t

val make_set_property_value_boolean : value:bool -> unit -> set_property_value
(** Boolean true/false value *)

val make_set_property_value_date : value:string -> unit -> set_property_value
(** Date and time value *)

val make_set_property_value_date_range :
  value:date_range -> unit -> set_property_value
(** Date range value *)

val make_set_property_value_number : value:float -> unit -> set_property_value
(** Numeric value *)

val make_set_property_value_string : value:string -> unit -> set_property_value
(** String/text value *)

val make_set_property_value_select_option :
  option_id:string -> unit -> set_property_value
(** Select option by ID (for select-type properties) *)

val make_set_property_value_multi_select_option :
  option_ids:string list -> unit -> set_property_value
(** Multiple select options by ID (for multi-select properties) *)

val make_set_property_value_entity_reference :
  reference:entity_reference -> unit -> set_property_value
(** Entity reference *)

val make_set_property_value_multi_entity_reference :
  references:entity_reference list -> unit -> set_property_value
(** Multiple entity references (for multi-select entity properties) *)

val make_set_property_value_link : url:string -> unit -> set_property_value
(** Link value *)

val make_set_property_value_multi_link :
  urls:string list -> unit -> set_property_value
(** Multiple link values (for multi-select link properties) *)

type nonrec set_entity_property_request = { value : set_property_value option }
(** Type-safe request for setting entity property values. *)

val set_entity_property_request_of_yojson :
  Yojson.Safe.t -> set_entity_property_request

val yojson_of_set_entity_property_request :
  set_entity_property_request -> Yojson.Safe.t

val make_set_entity_property_request :
  ?value:set_property_value -> unit -> set_entity_property_request
(** Type-safe request for setting entity property values. *)

type nonrec tag_promotion_conflict_response = {
  conflicting_option : property_option_response;
      (** The team label that already uses this name. *)
  message : string;  (** Human-readable description of the collision. *)
}
(** Body returned when a promotion collides with a label the team already has.
The caller confirms with the user, then calls the merge endpoint with
[conflicting_option.id] as the target. *)

val tag_promotion_conflict_response_of_yojson :
  Yojson.Safe.t -> tag_promotion_conflict_response

val yojson_of_tag_promotion_conflict_response :
  tag_promotion_conflict_response -> Yojson.Safe.t

val make_tag_promotion_conflict_response :
  conflicting_option:property_option_response ->
  message:string ->
  unit ->
  tag_promotion_conflict_response
(** Body returned when a promotion collides with a label the team already has.
The caller confirms with the user, then calls the merge endpoint with
[conflicting_option.id] as the target. *)

type nonrec tag_set_response = {
  definition : property_definition_detail_response option;
  options : property_option_response list;
  scope : tag_scope;
}
(** A tag set the caller can use. [definition] is absent until the set is provisioned
(on first label create), in which case [options] is empty. *)

val tag_set_response_of_yojson : Yojson.Safe.t -> tag_set_response
val yojson_of_tag_set_response : tag_set_response -> Yojson.Safe.t

val make_tag_set_response :
  ?definition:property_definition_detail_response ->
  options:property_option_response list ->
  scope:tag_scope ->
  unit ->
  tag_set_response
(** A tag set the caller can use. [definition] is absent until the set is provisioned
(on first label create), in which case [options] is empty. *)

type nonrec update_property_option_request = {
  color : string option;  (** New color as a hex string like [#RRGGBB]. *)
  display_order : int option;  (** New display order. *)
  value : string option;
      (** New string value (label text). Only valid for SelectString and Tag properties. *)
}
(** Request to update a property option in place. Omitted fields keep their current value.
The option id is preserved, so the change propagates to every entity referencing it. *)

val update_property_option_request_of_yojson :
  Yojson.Safe.t -> update_property_option_request

val yojson_of_update_property_option_request :
  update_property_option_request -> Yojson.Safe.t

val make_update_property_option_request :
  ?color:string ->
  ?display_order:int ->
  ?value:string ->
  unit ->
  update_property_option_request
(** Request to update a property option in place. Omitted fields keep their current value.
The option id is preserved, so the change propagates to every entity referencing it. *)

val list_properties :
  scope:property_scope ->
  ?include_options:bool ->
  ?for_entity_type:entity_type ->
  unit ->
  ( property_definition_response list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /properties/definitions]

List property definitions with flexible filtering *)

val create_property_definition :
  data_type:property_data_type ->
  display_name:string ->
  scope:create_property_scope ->
  unit ->
  ( property_definition,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /properties/definitions]

Create a new property definition *)

val get_property_definition :
  definition_id:string ->
  unit ->
  ( property_definition,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /properties/definitions/{definition_id}]

Get a property definition by ID *)

val delete_property_definition :
  definition_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /properties/definitions/{definition_id}]

Delete a property definition *)

val get_property_options :
  definition_id:string ->
  unit ->
  ( property_option list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /properties/definitions/{definition_id}/options]

Get all options for a property (for dropdowns) *)

val add_property_option :
  definition_id:string ->
  body:add_property_option_request ->
  unit ->
  ( property_option,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /properties/definitions/{definition_id}/options]

Add a new option to a property dropdown *)

val delete_property_option :
  definition_id:string ->
  option_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /properties/definitions/{definition_id}/options/{option_id}]

Delete a property option *)

val update_property_option :
  definition_id:string ->
  option_id:string ->
  ?color:string ->
  ?display_order:int ->
  ?value:string ->
  unit ->
  ( property_option,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PATCH /properties/definitions/{definition_id}/options/{option_id}]

Update a property option in place (rename / recolor / reorder). *)

val get_bulk_entity_properties :
  entities:property_target_reference list ->
  ?property_ids:string list ->
  unit ->
  ( (string * entity_properties_response) list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /properties/entities/bulk]

Get properties for multiple entities in bulk (public endpoint with user auth) *)

val get_entity_properties :
  entity_type:property_target_entity_type ->
  entity_id:string ->
  ?include_metadata:bool ->
  unit ->
  ( entity_properties_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /properties/entities/{entity_type}/{entity_id}]

Get all properties for an entity *)

val bulk_update_entity_property_options :
  entity_type:property_target_entity_type ->
  entity_id:string ->
  properties:entity_property_option_update_request list ->
  unit ->
  ( bulk_update_entity_property_options_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /properties/entities/{entity_type}/{entity_id}/options/bulk]

Apply a complete tag-picker selection across an entity's multi-select
properties in one request. *)

val set_entity_property :
  entity_type:property_target_entity_type ->
  entity_id:string ->
  property_id:string ->
  ?value:set_property_value ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PUT /properties/entities/{entity_type}/{entity_id}/{property_id}]

Set or update a property value for an entity, or attach a property without a value *)

val add_entity_property_option :
  entity_type:property_target_entity_type ->
  entity_id:string ->
  property_id:string ->
  option_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}]

Add a single option to an entity's multi-select property value. *)

val remove_entity_property_option :
  entity_type:property_target_entity_type ->
  entity_id:string ->
  property_id:string ->
  option_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}]

Remove a single option from an entity's multi-select property value. *)

val delete_entity_property :
  entity_property_id:string ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [DELETE /properties/entity_properties/{entity_property_id}]

Remove a specific entity property by its ID *)

val bulk_update_entities_property_options :
  entities:property_target_reference list ->
  property_id:string ->
  ?add_option_ids:string list ->
  ?remove_option_ids:string list ->
  unit ->
  ( bulk_update_entities_property_options_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /properties/options/bulk]

Apply one shared option delta (add / remove option ids on a single
multi-select property) to many entities in one request — e.g. tag a set of
emails with one label. *)

val list_tags :
  unit ->
  ( tag_set_response list,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /properties/tags]

List the caller's tag sets: their personal set, plus their team's set when on a team.
Pure read - a scope with no provisioned definition yet returns an empty set. *)

val ensure_tag_set :
  scope:tag_scope ->
  unit ->
  ( tag_set_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /properties/tags]

Provision (get-or-create) the caller's tag set for a scope and return it. Called when
the caller creates their first label for that scope, so the read path stays side-effect free. *)

val merge_tag :
  option_id:string ->
  target_option_id:string ->
  unit ->
  ( property_option_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /properties/tags/merge]

Replace one of the caller's personal labels with an existing team label. *)

val promote_tag :
  option_id:string ->
  unit ->
  ( property_option_response,
    tag_promotion_conflict_response )
  Macro_sdk_runtime.Request.t
(** [POST /properties/tags/promote]

Share one of the caller's personal labels with their team. *)
