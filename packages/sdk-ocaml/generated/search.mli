(* Generated from packages/sdk/specs/search.json by packages/sdk-ocaml/gen. Do not edit. *)

(** Side of a folded conversation. *)
type nonrec agent_session_author =
  | User
  | Agent
  | Unknown of string  (** A value this SDK version does not know. *)

val agent_session_author_of_yojson : Yojson.Safe.t -> agent_session_author
val yojson_of_agent_session_author : agent_session_author -> Yojson.Safe.t

type nonrec agent_session_filters = {
  ids : string list option;
      (** Agent session ids to filter by. Empty to include all accessible sessions. *)
  include_ : bool option;
      (** Opt this query into agent sessions at all. Agent sessions are off by
default — see \[[crate::ast::agent_session::AgentSessionLiteral::Include]\].
Asking for specific [ids] or [owners] also opts in. *)
  owners : string list option;
      (** Filter by session owner principal — a user ('macro|user\@example.com'), a bot
('bot|<uuid>'), or a team (a bare hyphenated uuid). Empty to include every
owner. *)
}
(** Filters for agent sessions. *)

val agent_session_filters_of_yojson : Yojson.Safe.t -> agent_session_filters
val yojson_of_agent_session_filters : agent_session_filters -> Yojson.Safe.t

val make_agent_session_filters :
  ?ids:string list ->
  ?include_:bool ->
  ?owners:string list ->
  unit ->
  agent_session_filters
(** Filters for agent sessions. *)

type nonrec search_goto_agent_session = {
  author : agent_session_author;  (** Author within the turn. *)
  message_turn : int;  (** Fold-assigned turn. *)
}
(** Stable navigation target from the fold, independent of raw ACP log IDs. *)

val search_goto_agent_session_of_yojson :
  Yojson.Safe.t -> search_goto_agent_session

val yojson_of_search_goto_agent_session :
  search_goto_agent_session -> Yojson.Safe.t

val make_search_goto_agent_session :
  author:agent_session_author ->
  message_turn:int ->
  unit ->
  search_goto_agent_session
(** Stable navigation target from the fold, independent of raw ACP log IDs. *)

type nonrec search_highlight = {
  bcc : string list option;  (** The highlight match on the bcc (email only) *)
  cc : string list option;  (** The highlight match on the cc (email only) *)
  content : string list option;  (** The highlight match on the content field *)
  name : string option;  (** The highlight match on the name field *)
  recipients : string list option;
      (** The highlight match on the recipients (email only) *)
  sender : string option;  (** The highlight match on the sender (email only) *)
  user_id : string option;
      (** The highlight match on the user (owner) of the entity *)
}

val search_highlight_of_yojson : Yojson.Safe.t -> search_highlight
val yojson_of_search_highlight : search_highlight -> Yojson.Safe.t

val make_search_highlight :
  ?bcc:string list ->
  ?cc:string list ->
  ?content:string list ->
  ?name:string ->
  ?recipients:string list ->
  ?sender:string ->
  ?user_id:string ->
  unit ->
  search_highlight

type nonrec agent_session_search_result = {
  goto : search_goto_agent_session option;
  highlight : search_highlight;  (** Matched name/content fragments. *)
  score : float option;  (** Search score. *)
}
(** A name match or one matching folded message. *)

val agent_session_search_result_of_yojson :
  Yojson.Safe.t -> agent_session_search_result

val yojson_of_agent_session_search_result :
  agent_session_search_result -> Yojson.Safe.t

val make_agent_session_search_result :
  ?goto:search_goto_agent_session ->
  highlight:search_highlight ->
  ?score:float ->
  unit ->
  agent_session_search_result
(** A name match or one matching folded message. *)

type nonrec agent_session_search_response_item = {
  agent_session_search_results : agent_session_search_result list;
      (** Name and folded-message matches. *)
  bot_id : string;  (** Agent persona ID. *)
  created_at : string;  (** Session creation time. *)
  id : string;  (** Session ID. *)
  name : string;  (** Current persisted name. *)
  owner_id : string;  (** Session owner. *)
  updated_at : string;  (** Current persisted modification time. *)
}
(** One accessible agent session, grouped with its matching folded messages. *)

val agent_session_search_response_item_of_yojson :
  Yojson.Safe.t -> agent_session_search_response_item

val yojson_of_agent_session_search_response_item :
  agent_session_search_response_item -> Yojson.Safe.t

val make_agent_session_search_response_item :
  agent_session_search_results:agent_session_search_result list ->
  bot_id:string ->
  created_at:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  updated_at:string ->
  unit ->
  agent_session_search_response_item
(** One accessible agent session, grouped with its matching folded messages. *)

type nonrec calendar_event_filters = {
  attendees : string list option;  (** Attendee email addresses. *)
  calendar_event_ids : string list option;  (** Canonical event ids. *)
  ends_after : string option;
      (** Include master events ending after this instant. *)
  organizers : string list option;  (** Organizer email addresses. *)
  starts_before : string option;
      (** Include master events starting before this instant. *)
  statuses : string list option;
      (** Event statuses such as [confirmed], [tentative], or [cancelled]. *)
}
(** Filters for canonical calendar-event entities. *)

val calendar_event_filters_of_yojson : Yojson.Safe.t -> calendar_event_filters
val yojson_of_calendar_event_filters : calendar_event_filters -> Yojson.Safe.t

val make_calendar_event_filters :
  ?attendees:string list ->
  ?calendar_event_ids:string list ->
  ?ends_after:string ->
  ?organizers:string list ->
  ?starts_before:string ->
  ?statuses:string list ->
  unit ->
  calendar_event_filters
(** Filters for canonical calendar-event entities. *)

(** Timed or all-day span of a calendar event.

Deliberately a local mirror of [models_soup::calendar_event::SoupCalendarEventTime]
rather than a reuse of it: this module needs both [ToSchema] (OpenAPI) and
[JsonSchema] (AI tool schemas), and [models_soup] carries no schemars
dependency. The wire shape is identical and must stay that way, so a
client can decode a search row and a soup row with one mapping.

Fields are camelCased per variant rather than via [rename_all_fields],
which utoipa ignores. *)
type nonrec calendar_event_search_time =
  | Timed of {
      ends_at : string;  (** Exclusive end. *)
      starts_at : string;  (** Inclusive start. *)
      time_zone : string option;  (** Original IANA time zone. *)
    }  (** Absolute timed event. *)
  | All_day of {
      end_date : string;  (** Exclusive end date. *)
      start_date : string;  (** Inclusive start date. *)
    }  (** All-day event with an exclusive end date. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val calendar_event_search_time_of_yojson :
  Yojson.Safe.t -> calendar_event_search_time

val yojson_of_calendar_event_search_time :
  calendar_event_search_time -> Yojson.Safe.t

val make_calendar_event_search_time_timed :
  ends_at:string ->
  starts_at:string ->
  ?time_zone:string ->
  unit ->
  calendar_event_search_time
(** Absolute timed event. *)

val make_calendar_event_search_time_all_day :
  end_date:string -> start_date:string -> unit -> calendar_event_search_time
(** All-day event with an exclusive end date. *)

type nonrec calendar_event_search_occurrence = {
  occurrence_key : string;
      (** Stable key of the resolved instance within its series. *)
  time : calendar_event_search_time;  (** Span of the resolved instance. *)
}
(** The instance a search row points at.

A recurring series is indexed once, as its master. Which instance the row
should show is decided per request rather than baked into the index: the
next occurrence at or after now, else the most recent past one. This is
the same resolution a calendar mention performs, so a search row and a
mention of the same event agree on where they land. *)

val calendar_event_search_occurrence_of_yojson :
  Yojson.Safe.t -> calendar_event_search_occurrence

val yojson_of_calendar_event_search_occurrence :
  calendar_event_search_occurrence -> Yojson.Safe.t

val make_calendar_event_search_occurrence :
  occurrence_key:string ->
  time:calendar_event_search_time ->
  unit ->
  calendar_event_search_occurrence
(** The instance a search row points at.

A recurring series is indexed once, as its master. Which instance the row
should show is decided per request rather than baked into the index: the
next occurrence at or after now, else the most recent past one. This is
the same resolution a calendar mention performs, so a search row and a
mention of the same event agree on where they land. *)

type nonrec calendar_event_organizer = {
  email : string option;  (** Organizer email address, when known. *)
  name : string option;  (** Display name, when the source provided one. *)
}
(** The organizer the provider names on the event. Either field can be absent
when the source does not name it. On a read-only Outlook calendar, such as
its holidays, Microsoft names the mailbox owner on every event, so this
does not say the user organized anything: [role] does. *)

val calendar_event_organizer_of_yojson :
  Yojson.Safe.t -> calendar_event_organizer

val yojson_of_calendar_event_organizer :
  calendar_event_organizer -> Yojson.Safe.t

val make_calendar_event_organizer :
  ?email:string -> ?name:string -> unit -> calendar_event_organizer
(** The organizer the provider names on the event. Either field can be absent
when the source does not name it. On a read-only Outlook calendar, such as
its holidays, Microsoft names the mailbox owner on every event, so this
does not say the user organized anything: [role] does. *)

(** What the user is on one copy of an event, through the inbox holding it. *)
type nonrec calendar_event_search_role =
  | Organizer
  | Guest
  | Unknown of string  (** A value this SDK version does not know. *)

val calendar_event_search_role_of_yojson :
  Yojson.Safe.t -> calendar_event_search_role

val yojson_of_calendar_event_search_role :
  calendar_event_search_role -> Yojson.Safe.t

type nonrec calendar_event_metadata = {
  calendar_name : string option;
      (** Display name of the calendar holding this copy. Absent on an event
shared with the user, which is on none of their calendars. *)
  conference_url : string option;  (** Direct conference join URL when known. *)
  contributes_to_availability : bool option;
      (** Whether a calendar holding this copy is on the user's schedule. The
user can see calendars that are not theirs, such as a colleague's: a
row without this, and that they do not attend, says what that calendar
shows, not where the user is. *)
  created_at : string;
  description : string option;
      (** Free-text description, when the event carries one. May contain HTML from
the source; clients render a plain-text preview. *)
  inbox : string option;
      (** The connected inbox syncing that calendar. It stays the user's own
address on a colleague's calendar, so it never says whose calendar it
is. *)
  is_read_only : bool;  (** Whether the canonical source prohibits mutation. *)
  is_recurring : bool;
      (** Whether the series carries a recurrence rule. Lets a row render a
recurring badge without parsing the rules. *)
  occurrence : calendar_event_search_occurrence option;
  organizer : calendar_event_organizer option;
  role : calendar_event_search_role option;
  status : string;
      (** Canonical status ([confirmed], [tentative], [cancelled]). *)
  time : calendar_event_search_time;  (** The series' own span. *)
  updated_at : string;
}
(** Metadata for a calendar event fetched from the database.

The index carries the master span for ranking, but the occurrence a row
should display depends on when the query ran, so it is resolved here
rather than indexed. *)

val calendar_event_metadata_of_yojson : Yojson.Safe.t -> calendar_event_metadata
val yojson_of_calendar_event_metadata : calendar_event_metadata -> Yojson.Safe.t

val make_calendar_event_metadata :
  ?calendar_name:string ->
  ?conference_url:string ->
  ?contributes_to_availability:bool ->
  created_at:string ->
  ?description:string ->
  ?inbox:string ->
  is_read_only:bool ->
  is_recurring:bool ->
  ?occurrence:calendar_event_search_occurrence ->
  ?organizer:calendar_event_organizer ->
  ?role:calendar_event_search_role ->
  status:string ->
  time:calendar_event_search_time ->
  updated_at:string ->
  unit ->
  calendar_event_metadata
(** Metadata for a calendar event fetched from the database.

The index carries the master span for ranking, but the occurrence a row
should display depends on when the query ran, so it is resolved here
rather than indexed. *)

type nonrec calendar_event_search_result = {
  highlight : search_highlight;
  score : float option;  (** The score of the result *)
}

val calendar_event_search_result_of_yojson :
  Yojson.Safe.t -> calendar_event_search_result

val yojson_of_calendar_event_search_result :
  calendar_event_search_result -> Yojson.Safe.t

val make_calendar_event_search_result :
  highlight:search_highlight ->
  ?score:float ->
  unit ->
  calendar_event_search_result

type nonrec calendar_event_search_response_item = {
  calendar_event_search_results : calendar_event_search_result list;
  created_at : string;
  id : string;  (** Standardized fields that all item types will share. *)
  name : string;
  owner_id : string;
  updated_at : string;
}
(** A single response item, part of the CalendarEventSearchResponse object *)

val calendar_event_search_response_item_of_yojson :
  Yojson.Safe.t -> calendar_event_search_response_item

val yojson_of_calendar_event_search_response_item :
  calendar_event_search_response_item -> Yojson.Safe.t

val make_calendar_event_search_response_item :
  calendar_event_search_results:calendar_event_search_result list ->
  created_at:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  updated_at:string ->
  unit ->
  calendar_event_search_response_item
(** A single response item, part of the CalendarEventSearchResponse object *)

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

type nonrec date_range = { end_ : string; start : string }
(** A span of time from [start] to [end], both included. The end is never
before the start: a range that would end earlier does not deserialize. *)

val date_range_of_yojson : Yojson.Safe.t -> date_range
val yojson_of_date_range : date_range -> Yojson.Safe.t

val make_date_range : end_:string -> start:string -> unit -> date_range
(** A span of time from [start] to [end], both included. The end is never
before the start: a range that would end earlier does not deserialize. *)

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

type nonrec soup_property = {
  definition : property_definition;  (** The property definition *)
  id : string;
      (** Globally unique id of the assignment attaching this property to an entity. *)
  value : property_value option;
}
(** A property attached to a Soup item.

This is a simplified representation that includes only the definition and value,
omitting the entity property assignment metadata and options. *)

val soup_property_of_yojson : Yojson.Safe.t -> soup_property
val yojson_of_soup_property : soup_property -> Yojson.Safe.t

val make_soup_property :
  definition:property_definition ->
  id:string ->
  ?value:property_value ->
  unit ->
  soup_property
(** A property attached to a Soup item.

This is a simplified representation that includes only the definition and value,
omitting the entity property assignment metadata and options. *)

type nonrec calendar_event_search_response_item_with_metadata = {
  calendar_event_search_results : calendar_event_search_result list;
  created_at : string;
  id : string;  (** Standardized fields that all item types will share. *)
  name : string;
  owner_id : string;
  updated_at : string;
  metadata : calendar_event_metadata option;
  properties : soup_property list option;
      (** Entity properties (e.g. tags) on the event. *)
}
(** CalendarEventSearchResponseItem with metadata fetched from macrodb. *)

val calendar_event_search_response_item_with_metadata_of_yojson :
  Yojson.Safe.t -> calendar_event_search_response_item_with_metadata

val yojson_of_calendar_event_search_response_item_with_metadata :
  calendar_event_search_response_item_with_metadata -> Yojson.Safe.t

val make_calendar_event_search_response_item_with_metadata :
  calendar_event_search_results:calendar_event_search_result list ->
  created_at:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  updated_at:string ->
  ?metadata:calendar_event_metadata ->
  ?properties:soup_property list ->
  unit ->
  calendar_event_search_response_item_with_metadata
(** CalendarEventSearchResponseItem with metadata fetched from macrodb. *)

(** Which calendar events a unified search covers.

Sharing an event with a channel lets its members see the sharer's copy,
which is on none of their own calendars, so the default scope never finds
it. Shared events are a separate scope rather than part of the default, so
a caller can list them after the caller's own events without reordering
those. *)
type nonrec calendar_event_search_scope =
  | Own
  | Shared_with_you
  | Unknown of string  (** A value this SDK version does not know. *)

val calendar_event_search_scope_of_yojson :
  Yojson.Safe.t -> calendar_event_search_scope

val yojson_of_calendar_event_search_scope :
  calendar_event_search_scope -> Yojson.Safe.t

(** Viewer-relative attendance status for a call record.
Serializes as [ATTENDED], [MISSED], or [UNATTENDED]. *)
type nonrec call_status =
  | Attended
  | Missed
  | Unattended
  | Unknown of string  (** A value this SDK version does not know. *)

val call_status_of_yojson : Yojson.Safe.t -> call_status
val yojson_of_call_status : call_status -> Yojson.Safe.t

type nonrec call_filters = {
  attended : bool option;
      (** Legacy filter by whether the requesting user attended the call.
Prefer \[[CallFilters::status]\] for new callers.
[None] = no filter, [Some(true)] = only calls the user joined,
[Some(false)] = only calls the user did not join. *)
  call_ids : string list option;
      (** Call record IDs to filter by. Empty to include all calls. *)
  channel_ids : string list option;
      (** Channel IDs to filter calls by. Empty to include all calls. *)
  speaker_ids : string list option;
      (** Speaker macro user ids. Empty to include all. *)
  status : call_status option;
}
(** Filters for call records. *)

val call_filters_of_yojson : Yojson.Safe.t -> call_filters
val yojson_of_call_filters : call_filters -> Yojson.Safe.t

val make_call_filters :
  ?attended:bool ->
  ?call_ids:string list ->
  ?channel_ids:string list ->
  ?speaker_ids:string list ->
  ?status:call_status ->
  unit ->
  call_filters
(** Filters for call records. *)

type nonrec call_record_metadata = {
  attended : bool;
  channel_name : string option;
  created_by : string;
  duration_ms : int64;
  ended_at : string;
  started_at : string;
  status : call_status;
  updated_at : string;
}

val call_record_metadata_of_yojson : Yojson.Safe.t -> call_record_metadata
val yojson_of_call_record_metadata : call_record_metadata -> Yojson.Safe.t

val make_call_record_metadata :
  attended:bool ->
  ?channel_name:string ->
  created_by:string ->
  duration_ms:int64 ->
  ended_at:string ->
  started_at:string ->
  status:call_status ->
  updated_at:string ->
  unit ->
  call_record_metadata

type nonrec call_record_search_result = {
  ended_at : string option;
  highlight : search_highlight;
  score : float option;
  sequence_num : int option;
  speaker_id : string option;
  started_at : string option;
  transcript_id : string option;
}

val call_record_search_result_of_yojson :
  Yojson.Safe.t -> call_record_search_result

val yojson_of_call_record_search_result :
  call_record_search_result -> Yojson.Safe.t

val make_call_record_search_result :
  ?ended_at:string ->
  highlight:search_highlight ->
  ?score:float ->
  ?sequence_num:int ->
  ?speaker_id:string ->
  ?started_at:string ->
  ?transcript_id:string ->
  unit ->
  call_record_search_result

type nonrec call_record_search_response_item = {
  call_id : string;
  call_search_results : call_record_search_result list;
  channel_id : string option;
  id : string;
  name : string option;
  owner_id : string;
  participant_ids : string list;
}

val call_record_search_response_item_of_yojson :
  Yojson.Safe.t -> call_record_search_response_item

val yojson_of_call_record_search_response_item :
  call_record_search_response_item -> Yojson.Safe.t

val make_call_record_search_response_item :
  call_id:string ->
  call_search_results:call_record_search_result list ->
  ?channel_id:string ->
  id:string ->
  ?name:string ->
  owner_id:string ->
  participant_ids:string list ->
  unit ->
  call_record_search_response_item

type nonrec call_record_search_response_item_with_metadata = {
  call_id : string;
  call_search_results : call_record_search_result list;
  channel_id : string option;
  id : string;
  name : string option;
  owner_id : string;
  participant_ids : string list;
  metadata : call_record_metadata option;
  properties : soup_property list option;
      (** Entity properties (e.g. tags) on the call. *)
}

val call_record_search_response_item_with_metadata_of_yojson :
  Yojson.Safe.t -> call_record_search_response_item_with_metadata

val yojson_of_call_record_search_response_item_with_metadata :
  call_record_search_response_item_with_metadata -> Yojson.Safe.t

val make_call_record_search_response_item_with_metadata :
  call_id:string ->
  call_search_results:call_record_search_result list ->
  ?channel_id:string ->
  id:string ->
  ?name:string ->
  owner_id:string ->
  participant_ids:string list ->
  ?metadata:call_record_metadata ->
  ?properties:soup_property list ->
  unit ->
  call_record_search_response_item_with_metadata

(** The mutually exclusive lifecycle states of a user's notification. *)
type nonrec notification_state =
  | Unseen
  | Seen
  | Done
  | Unknown of string  (** A value this SDK version does not know. *)

val notification_state_of_yojson : Yojson.Safe.t -> notification_state
val yojson_of_notification_state : notification_state -> Yojson.Safe.t

type nonrec notification_filters = {
  states : notification_state list option;
      (** Include entities with a non-deleted notification in any of these exact states.
Empty means no notification restriction. Active means `\[unseen, seen\]`. *)
}
(** Notification-level filters that apply to an entity type. *)

val notification_filters_of_yojson : Yojson.Safe.t -> notification_filters
val yojson_of_notification_filters : notification_filters -> Yojson.Safe.t

val make_notification_filters :
  ?states:notification_state list -> unit -> notification_filters
(** Notification-level filters that apply to an entity type. *)

type nonrec channel_filters = {
  channel_ids : string list option;
      (** Channel IDs to search within. Examples: \['general'\]. Empty to search all accessible channels. *)
  channel_types : string list option;
      (** Channel types to filter by. Examples: \['public'\], \['direct_message', 'private'\]. Empty to search all channel types. *)
  importance : bool option;
      (** Filter by channel importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. *)
  is_participant : bool option;
      (** Filter by whether the requesting user is an active participant of the channel.
Presence of this filter also widens the candidate set to team channels of the
user's teams that they have not joined, so [false] matches those channels.
None to ignore (participant channels only, today's default). *)
  mentions : string list option;
      (** Channel user mentions to search for. Examples: \['\@username'\]. Empty if not filtering by mentions. *)
  notification_filters : notification_filters option;
      (** Filter by channel notification state. *)
  org_id : int64 option;
      (** Channel organization ID to search within. Empty to ignore organization filtering. *)
  sender_ids : string list option;
      (** Sender IDs to search within. Examples: \['user1'\]. Empty to search all accessible senders. *)
  team_id : string option;
      (** Channel team ID to search within. Empty to ignore team filtering. *)
  thread_ids : string list option;
      (** Channel thread IDs to search within. Examples: \['thread123'\]. Empty to search all threads. *)
}
(** The channel message filters used to filter down what channel messages you search over. *)

val channel_filters_of_yojson : Yojson.Safe.t -> channel_filters
val yojson_of_channel_filters : channel_filters -> Yojson.Safe.t

val make_channel_filters :
  ?channel_ids:string list ->
  ?channel_types:string list ->
  ?importance:bool ->
  ?is_participant:bool ->
  ?mentions:string list ->
  ?notification_filters:notification_filters ->
  ?org_id:int64 ->
  ?sender_ids:string list ->
  ?team_id:string ->
  ?thread_ids:string list ->
  unit ->
  channel_filters
(** The channel message filters used to filter down what channel messages you search over. *)

type nonrec channel_message_search_response_item = {
  channel_id : string;  (** The id of the channel the message belongs to *)
  channel_type : string;  (** The type of channel *)
  created_at : string;  (** When the channel message was created *)
  deleted_at : string option;
      (** When the channel message was deleted, if it has been *)
  highlight : search_highlight;  (** The highlights for the channel message *)
  id : string;
      (** Standardized id field shared by all item types; the channel id. *)
  message_id : string;  (** The channel message id *)
  owner_id : string option;
      (** we don't store this for channels atm but keeping it here for consistency *)
  score : float option;  (** The score of the result *)
  sender_id : string;  (** The sender id *)
  thread_id : string option;  (** The channel message thread id *)
  updated_at : string;  (** When the channel message was last updated *)
}
(** A single channel-message content hit in the unified search response.
One item per matching message, timestamped by the message itself, so the
unified sort interleaves channel messages with other entity types by
their own recency. *)

val channel_message_search_response_item_of_yojson :
  Yojson.Safe.t -> channel_message_search_response_item

val yojson_of_channel_message_search_response_item :
  channel_message_search_response_item -> Yojson.Safe.t

val make_channel_message_search_response_item :
  channel_id:string ->
  channel_type:string ->
  created_at:string ->
  ?deleted_at:string ->
  highlight:search_highlight ->
  id:string ->
  message_id:string ->
  ?owner_id:string ->
  ?score:float ->
  sender_id:string ->
  ?thread_id:string ->
  updated_at:string ->
  unit ->
  channel_message_search_response_item
(** A single channel-message content hit in the unified search response.
One item per matching message, timestamped by the message itself, so the
unified sort interleaves channel messages with other entity types by
their own recency. *)

type nonrec channel_metadata = {
  created_at : string;
  interacted_at : string option;
  updated_at : string;
  viewed_at : string option;
}
(** Metadata for a channel fetched from the database *)

val channel_metadata_of_yojson : Yojson.Safe.t -> channel_metadata
val yojson_of_channel_metadata : channel_metadata -> Yojson.Safe.t

val make_channel_metadata :
  created_at:string ->
  ?interacted_at:string ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  channel_metadata
(** Metadata for a channel fetched from the database *)

type nonrec channel_name_search_response_item = {
  channel_id : string;  (** The channel id. *)
  channel_type : string;  (** The type of channel. *)
  highlight : search_highlight;  (** The matched channel-name highlight. *)
  id : string;
      (** Standardized id field shared by all item types; the channel id. *)
  metadata : channel_metadata option;
  owner_id : string option;  (** The channel owner. *)
  score : float option;  (** The score of the result. *)
}
(** A channel-name search hit. *)

val channel_name_search_response_item_of_yojson :
  Yojson.Safe.t -> channel_name_search_response_item

val yojson_of_channel_name_search_response_item :
  channel_name_search_response_item -> Yojson.Safe.t

val make_channel_name_search_response_item :
  channel_id:string ->
  channel_type:string ->
  highlight:search_highlight ->
  id:string ->
  ?metadata:channel_metadata ->
  ?owner_id:string ->
  ?score:float ->
  unit ->
  channel_name_search_response_item
(** A channel-name search hit. *)

type nonrec match_type =
  | Exact
  | Partial
  | Regexp
  | Query
  | Unknown of string  (** A value this SDK version does not know. *)

val match_type_of_yojson : Yojson.Safe.t -> match_type
val yojson_of_match_type : match_type -> Yojson.Safe.t

type nonrec search_on =
  | Name
  | Content
  | Name_content
  | Unknown of string  (** A value this SDK version does not know. *)

val search_on_of_yojson : Yojson.Safe.t -> search_on
val yojson_of_search_on : search_on -> Yojson.Safe.t

(** Sort key for channel content search results. *)
type nonrec channel_sort_timestamp =
  | Message
  | Thread
  | Unknown of string  (** A value this SDK version does not know. *)

val channel_sort_timestamp_of_yojson : Yojson.Safe.t -> channel_sort_timestamp
val yojson_of_channel_sort_timestamp : channel_sort_timestamp -> Yojson.Safe.t

type nonrec channel_search_request = {
  channel_ids : string list option;
      (** Channel IDs to search within. Examples: \['general'\]. Empty to search all accessible channels. *)
  channel_types : string list option;
      (** Channel types to filter by. Examples: \['public'\], \['direct_message', 'private'\]. Empty to search all channel types. *)
  importance : bool option;
      (** Filter by channel importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. *)
  is_participant : bool option;
      (** Filter by whether the requesting user is an active participant of the channel.
Presence of this filter also widens the candidate set to team channels of the
user's teams that they have not joined, so [false] matches those channels.
None to ignore (participant channels only, today's default). *)
  mentions : string list option;
      (** Channel user mentions to search for. Examples: \['\@username'\]. Empty if not filtering by mentions. *)
  notification_filters : notification_filters option;
      (** Filter by channel notification state. *)
  org_id : int64 option;
      (** Channel organization ID to search within. Empty to ignore organization filtering. *)
  sender_ids : string list option;
      (** Sender IDs to search within. Examples: \['user1'\]. Empty to search all accessible senders. *)
  team_id : string option;
      (** Channel team ID to search within. Empty to ignore team filtering. *)
  thread_ids : string list option;
      (** Channel thread IDs to search within. Examples: \['thread123'\]. Empty to search all threads. *)
  collapse : bool option;
      (** If true, returns only 1 result per entity. False by default. *)
  match_type : match_type;  (** The match type to use when searching *)
  query : string option;  (** The query to search for *)
  search_on : search_on option;
      (** Fields to search on (Name, Content, NameContent). Defaults to Content *)
  sort : channel_sort_timestamp option;
      (** Sort key for results. Defaults to [message]. *)
  terms : string list option;  (** Multiple terms to search over *)
}

val channel_search_request_of_yojson : Yojson.Safe.t -> channel_search_request
val yojson_of_channel_search_request : channel_search_request -> Yojson.Safe.t

val make_channel_search_request :
  ?channel_ids:string list ->
  ?channel_types:string list ->
  ?importance:bool ->
  ?is_participant:bool ->
  ?mentions:string list ->
  ?notification_filters:notification_filters ->
  ?org_id:int64 ->
  ?sender_ids:string list ->
  ?team_id:string ->
  ?thread_ids:string list ->
  ?collapse:bool ->
  match_type:match_type ->
  ?query:string ->
  ?search_on:search_on ->
  ?sort:channel_sort_timestamp ->
  ?terms:string list ->
  unit ->
  channel_search_request

type nonrec channel_search_result = {
  created_at : string option;
      (** When the channel message was created
This is only prsent if the search result is on the message content *)
  deleted_at : string option;
      (** When the channel message was deleted, if it has been *)
  highlight : search_highlight;  (** The highlights for the channel message *)
  message_id : string option;
      (** The channel message id
This is only prsent if the search result is on the message content *)
  score : float option;  (** The score of the result *)
  sender_id : string option;
      (** The sender id
This is only prsent if the search result is on the message content *)
  thread_id : string option;  (** The channel message thread id *)
  updated_at : string option;
      (** When the channel message was last updated
This is only prsent if the search result is on the message content *)
}
(** A channel message match for a given channel id *)

val channel_search_result_of_yojson : Yojson.Safe.t -> channel_search_result
val yojson_of_channel_search_result : channel_search_result -> Yojson.Safe.t

val make_channel_search_result :
  ?created_at:string ->
  ?deleted_at:string ->
  highlight:search_highlight ->
  ?message_id:string ->
  ?score:float ->
  ?sender_id:string ->
  ?thread_id:string ->
  ?updated_at:string ->
  unit ->
  channel_search_result
(** A channel message match for a given channel id *)

type nonrec channel_search_response_item_with_metadata = {
  channel_id : string;  (** The id of the channel *)
  channel_message_search_results : channel_search_result list;
      (** The search results for the channel
This may be empty if the search result match was not on content *)
  channel_type : string;  (** The type of channel *)
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  owner_id : string option;
      (** we don't store this for channels atm but keeping it here for consistency *)
  metadata : channel_metadata option;
}
(** ChannelSearchResponseItem object with channel metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update each chat message record for the chat
every time the chat updates (specifically for updated_at and viewed_at and interacted_at) *)

val channel_search_response_item_with_metadata_of_yojson :
  Yojson.Safe.t -> channel_search_response_item_with_metadata

val yojson_of_channel_search_response_item_with_metadata :
  channel_search_response_item_with_metadata -> Yojson.Safe.t

val make_channel_search_response_item_with_metadata :
  channel_id:string ->
  channel_message_search_results:channel_search_result list ->
  channel_type:string ->
  id:string ->
  ?owner_id:string ->
  ?metadata:channel_metadata ->
  unit ->
  channel_search_response_item_with_metadata
(** ChannelSearchResponseItem object with channel metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update each chat message record for the chat
every time the chat updates (specifically for updated_at and viewed_at and interacted_at) *)

type nonrec channel_search_response = {
  next_cursor : string option;
      (** Base64-encoded cursor for the next page; [None] when exhausted. *)
  results : channel_search_response_item_with_metadata list;
      (** List containing results from email threads *)
  total_count : int64;
      (** Total number of matching channel messages across all pages. *)
}
(** The document search response object *)

val channel_search_response_of_yojson : Yojson.Safe.t -> channel_search_response
val yojson_of_channel_search_response : channel_search_response -> Yojson.Safe.t

val make_channel_search_response :
  ?next_cursor:string ->
  results:channel_search_response_item_with_metadata list ->
  total_count:int64 ->
  unit ->
  channel_search_response
(** The document search response object *)

type nonrec channel_search_response_item = {
  channel_id : string;  (** The id of the channel *)
  channel_message_search_results : channel_search_result list;
      (** The search results for the channel
This may be empty if the search result match was not on content *)
  channel_type : string;  (** The type of channel *)
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  owner_id : string option;
      (** we don't store this for channels atm but keeping it here for consistency *)
}
(** A single response item, part of the ChannelSearchResponse object *)

val channel_search_response_item_of_yojson :
  Yojson.Safe.t -> channel_search_response_item

val yojson_of_channel_search_response_item :
  channel_search_response_item -> Yojson.Safe.t

val make_channel_search_response_item :
  channel_id:string ->
  channel_message_search_results:channel_search_result list ->
  channel_type:string ->
  id:string ->
  ?owner_id:string ->
  unit ->
  channel_search_response_item
(** A single response item, part of the ChannelSearchResponse object *)

type nonrec channel_thread_filters = {
  channel_ids : string list option;
      (** Channel IDs containing the thread. Empty to include threads from all accessible channels. *)
  participant_ids : string list option;
      (** Thread participant user IDs. A participant is the root message sender, anyone
who replied in the thread, or anyone \@-mentioned in the thread (group mentions
like \@here count through their per-user expansion at send time). Empty to
include threads regardless of participants. *)
  root_sender_ids : string list option;
      (** Sender IDs for the root thread message. Empty to include all root senders. *)
  thread_ids : string list option;
      (** Channel thread parent message IDs to include. Empty to include all accessible threads. *)
}
(** The channel thread filters used to filter down channel-thread entities. *)

val channel_thread_filters_of_yojson : Yojson.Safe.t -> channel_thread_filters
val yojson_of_channel_thread_filters : channel_thread_filters -> Yojson.Safe.t

val make_channel_thread_filters :
  ?channel_ids:string list ->
  ?participant_ids:string list ->
  ?root_sender_ids:string list ->
  ?thread_ids:string list ->
  unit ->
  channel_thread_filters
(** The channel thread filters used to filter down channel-thread entities. *)

type nonrec chat_filters = {
  chat_ids : string list option;
      (** Chat ids to search over. Examples: \['chat1'\], \['chat1', 'chat2'\]. When provided, chat search will only match results on these chats. Empty to search all accessible chats. *)
  importance : bool option;
      (** Filter by chat importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. *)
  notification_filters : notification_filters option;
      (** Filter by chat notification state. *)
  owners : string list option;
      (** Filter by chat owner principal — a user ('macro|user\@example.com'), a bot
('bot|<uuid>'), or a team (a bare hyphenated uuid). Examples:
\['macro|user\@example.com'\], \['macro|user\@example.com', 'bot|0199...'\]. Empty to
search all owners. *)
  project_ids : string list option;
      (** A list of project ids to search within. Examples: \['project1'\]. Empty to ignore project filtering. *)
  role : string list option;
      (** Chat message roles to search. Examples: \['user'\], \['assistant'\]. Empty to search all roles. *)
}
(** The chat filters used to filter down what chats you search over. *)

val chat_filters_of_yojson : Yojson.Safe.t -> chat_filters
val yojson_of_chat_filters : chat_filters -> Yojson.Safe.t

val make_chat_filters :
  ?chat_ids:string list ->
  ?importance:bool ->
  ?notification_filters:notification_filters ->
  ?owners:string list ->
  ?project_ids:string list ->
  ?role:string list ->
  unit ->
  chat_filters
(** The chat filters used to filter down what chats you search over. *)

type nonrec chat_message_search_result = {
  chat_message_id : string option;
      (** The chat message id for the chat
This is only present if the search match was on the chat message content *)
  highlight : search_highlight;  (** The highlights for the chat message *)
  role : string option;
      (** The role of the chat message
This is only present if the search match was on the chat message content *)
  score : float option;  (** The score of the result *)
}
(** A chat match for a given message id *)

val chat_message_search_result_of_yojson :
  Yojson.Safe.t -> chat_message_search_result

val yojson_of_chat_message_search_result :
  chat_message_search_result -> Yojson.Safe.t

val make_chat_message_search_result :
  ?chat_message_id:string ->
  highlight:search_highlight ->
  ?role:string ->
  ?score:float ->
  unit ->
  chat_message_search_result
(** A chat match for a given message id *)

type nonrec chat_metadata = {
  created_at : string;
  deleted_at : string option;
  project_id : string option;
  updated_at : string;
  viewed_at : string option;
}
(** Metadata for a chat fetched from the database *)

val chat_metadata_of_yojson : Yojson.Safe.t -> chat_metadata
val yojson_of_chat_metadata : chat_metadata -> Yojson.Safe.t

val make_chat_metadata :
  created_at:string ->
  ?deleted_at:string ->
  ?project_id:string ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  chat_metadata
(** Metadata for a chat fetched from the database *)

type nonrec chat_search_request = {
  chat_ids : string list option;
      (** Chat ids to search over. Examples: \['chat1'\], \['chat1', 'chat2'\]. When provided, chat search will only match results on these chats. Empty to search all accessible chats. *)
  importance : bool option;
      (** Filter by chat importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. *)
  notification_filters : notification_filters option;
      (** Filter by chat notification state. *)
  owners : string list option;
      (** Filter by chat owner principal — a user ('macro|user\@example.com'), a bot
('bot|<uuid>'), or a team (a bare hyphenated uuid). Examples:
\['macro|user\@example.com'\], \['macro|user\@example.com', 'bot|0199...'\]. Empty to
search all owners. *)
  project_ids : string list option;
      (** A list of project ids to search within. Examples: \['project1'\]. Empty to ignore project filtering. *)
  role : string list option;
      (** Chat message roles to search. Examples: \['user'\], \['assistant'\]. Empty to search all roles. *)
  collapse : bool option;
      (** If true, returns only 1 result per entity. False by default. *)
  match_type : match_type;  (** The match type to use when searching *)
  query : string option;  (** The query to search for *)
  search_on : search_on option;
      (** Fields to search on (Name, Content, NameContent). Defaults to Content *)
  terms : string list option;  (** Multiple terms to search over *)
}

val chat_search_request_of_yojson : Yojson.Safe.t -> chat_search_request
val yojson_of_chat_search_request : chat_search_request -> Yojson.Safe.t

val make_chat_search_request :
  ?chat_ids:string list ->
  ?importance:bool ->
  ?notification_filters:notification_filters ->
  ?owners:string list ->
  ?project_ids:string list ->
  ?role:string list ->
  ?collapse:bool ->
  match_type:match_type ->
  ?query:string ->
  ?search_on:search_on ->
  ?terms:string list ->
  unit ->
  chat_search_request

type nonrec chat_search_response_item_with_metadata = {
  chat_id : string;  (** The id of the chat *)
  chat_search_results : chat_message_search_result list;
      (** The search results for the chat
This may be empty if the search result match was on the chat title only *)
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  name : string;
  owner_id : string;
  user_id : string;  (** The id of the creator of the chat *)
  metadata : chat_metadata option;
  properties : soup_property list option;
      (** Entity properties (e.g. tags) on the chat. *)
}
(** ChatSearchResponse object with channel metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update each chat message record for the chat
every time the chat updates (specifically for updated_at and viewed_at) *)

val chat_search_response_item_with_metadata_of_yojson :
  Yojson.Safe.t -> chat_search_response_item_with_metadata

val yojson_of_chat_search_response_item_with_metadata :
  chat_search_response_item_with_metadata -> Yojson.Safe.t

val make_chat_search_response_item_with_metadata :
  chat_id:string ->
  chat_search_results:chat_message_search_result list ->
  id:string ->
  name:string ->
  owner_id:string ->
  user_id:string ->
  ?metadata:chat_metadata ->
  ?properties:soup_property list ->
  unit ->
  chat_search_response_item_with_metadata
(** ChatSearchResponse object with channel metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update each chat message record for the chat
every time the chat updates (specifically for updated_at and viewed_at) *)

type nonrec chat_search_response = {
  results : chat_search_response_item_with_metadata list;
      (** List containing results from chats *)
}
(** The chat search response object *)

val chat_search_response_of_yojson : Yojson.Safe.t -> chat_search_response
val yojson_of_chat_search_response : chat_search_response -> Yojson.Safe.t

val make_chat_search_response :
  results:chat_search_response_item_with_metadata list ->
  unit ->
  chat_search_response
(** The chat search response object *)

type nonrec chat_search_response_item = {
  chat_id : string;  (** The id of the chat *)
  chat_search_results : chat_message_search_result list;
      (** The search results for the chat
This may be empty if the search result match was on the chat title only *)
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  name : string;
  owner_id : string;
  user_id : string;  (** The id of the creator of the chat *)
}
(** A single response item, part of the ChatSearchResponse object *)

val chat_search_response_item_of_yojson :
  Yojson.Safe.t -> chat_search_response_item

val yojson_of_chat_search_response_item :
  chat_search_response_item -> Yojson.Safe.t

val make_chat_search_response_item :
  chat_id:string ->
  chat_search_results:chat_message_search_result list ->
  id:string ->
  name:string ->
  owner_id:string ->
  user_id:string ->
  unit ->
  chat_search_response_item
(** A single response item, part of the ChatSearchResponse object *)

type nonrec crm_company_filters = {
  company_ids : string list option;
      (** CRM company ids to filter by. Examples: \['11111111-...'\]. Empty to
include all of the team's visible CRM companies. *)
  hidden : bool option;
      (** Optional [crm_companies.hidden] filter. [None] = visible only
(default for back-compat with non-admin callers). [Some(false)] =
visible only (explicit). [Some(true)] = hidden only — requires
admin/owner team role; enforced by the CRM service from the
caller's team receipt. *)
}
(** The crm company filters used to narrow which CRM companies appear in soup. *)

val crm_company_filters_of_yojson : Yojson.Safe.t -> crm_company_filters
val yojson_of_crm_company_filters : crm_company_filters -> Yojson.Safe.t

val make_crm_company_filters :
  ?company_ids:string list -> ?hidden:bool -> unit -> crm_company_filters
(** The crm company filters used to narrow which CRM companies appear in soup. *)

type nonrec crm_company_search_domain = {
  company_id : string;  (** The id of the company the domain belongs to. *)
  created_at : string;  (** When the domain record was created. *)
  domain : string;  (** The domain (lowercased, e.g. "acme.com"). *)
  id : string;  (** The id of the domain record. *)
}
(** A CRM domain attached to a company in search results. *)

val crm_company_search_domain_of_yojson :
  Yojson.Safe.t -> crm_company_search_domain

val yojson_of_crm_company_search_domain :
  crm_company_search_domain -> Yojson.Safe.t

val make_crm_company_search_domain :
  company_id:string ->
  created_at:string ->
  domain:string ->
  id:string ->
  unit ->
  crm_company_search_domain
(** A CRM domain attached to a company in search results. *)

type nonrec crm_company_search_response_item = {
  created_at : string;  (** When the company was created. *)
  description : string option;
      (** Display description from the primary domain's directory entry. *)
  domains : crm_company_search_domain list;
      (** Domains associated with this company, primary first. *)
  hidden : bool;  (** Whether the company is hidden from CRM listings. *)
  id : string;  (** The id of the company. *)
  name : string option;
      (** Display name from the primary domain's directory entry. *)
  name_highlighted : string option;
      (** [name] with matched spans wrapped in [<macro_em>…</macro_em>]. *)
  team_id : string;  (** The id of the team that owns this company record. *)
  updated_at : string;  (** When the company was last updated (the sort key). *)
}
(** A CRM company match in unified search results. Carries the display
metadata resolved from the primary domain plus the highlighted name. *)

val crm_company_search_response_item_of_yojson :
  Yojson.Safe.t -> crm_company_search_response_item

val yojson_of_crm_company_search_response_item :
  crm_company_search_response_item -> Yojson.Safe.t

val make_crm_company_search_response_item :
  created_at:string ->
  ?description:string ->
  domains:crm_company_search_domain list ->
  hidden:bool ->
  id:string ->
  ?name:string ->
  ?name_highlighted:string ->
  team_id:string ->
  updated_at:string ->
  unit ->
  crm_company_search_response_item
(** A CRM company match in unified search results. Carries the display
metadata resolved from the primary domain plus the highlighted name. *)

type nonrec task_filters = {
  include_cbm_atm_nc : bool option;
      (** Include tasks that are created by me, assigned to me, and not completed,
even when they do not match other document filters. *)
}
(** Task-only filters nested under document filters. *)

val task_filters_of_yojson : Yojson.Safe.t -> task_filters
val yojson_of_task_filters : task_filters -> Yojson.Safe.t

val make_task_filters : ?include_cbm_atm_nc:bool -> unit -> task_filters
(** Task-only filters nested under document filters. *)

type nonrec document_filters = {
  document_ids : string list option;
      (** Document ids to search over. Examples: \['doc1'\], \['doc1', 'doc2'\]. Empty to search all accessible documents. *)
  file_types : string list option;
      (** Document file types to search. Examples: \['pdf'\], \['md', 'txt'\]. Empty to search all file types. *)
  importance : bool option;
      (** Filter by document importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. *)
  is_email_attachment : bool option;
      (** Filter by email attachment status. true = only email attachments, false = only non-email attachments, None = both. *)
  notification_filters : notification_filters option;
      (** Filter by document notification state. *)
  owners : string list option;
      (** Filter by document owner principal — a user ('macro|user\@example.com'), a bot
('bot|<uuid>'), or a team (a bare hyphenated uuid). Examples:
\['macro|user\@example.com'\], \['macro|user\@example.com', 'bot|0199...'\]. Empty to
search all owners. *)
  project_ids : string list option;
      (** A list of project ids to search within. Examples: \['project1'\].
filtering. Empty to ignore project filtering. *)
  sub_types : string list option;
      (** Filter by document sub type. Examples: \['task'\]. Empty to search all sub types. *)
  task_filters : task_filters option;
      (** Task-specific filters that only apply to task subtype documents. *)
}
(** The document filters used to filter down what documents you search over. *)

val document_filters_of_yojson : Yojson.Safe.t -> document_filters
val yojson_of_document_filters : document_filters -> Yojson.Safe.t

val make_document_filters :
  ?document_ids:string list ->
  ?file_types:string list ->
  ?importance:bool ->
  ?is_email_attachment:bool ->
  ?notification_filters:notification_filters ->
  ?owners:string list ->
  ?project_ids:string list ->
  ?sub_types:string list ->
  ?task_filters:task_filters ->
  unit ->
  document_filters
(** The document filters used to filter down what documents you search over. *)

type nonrec document_metadata = {
  created_at : string;
  deleted_at : string option;
  project_id : string option;
  updated_at : string;
  viewed_at : string option;
}
(** Metadata for a document fetched from the database *)

val document_metadata_of_yojson : Yojson.Safe.t -> document_metadata
val yojson_of_document_metadata : document_metadata -> Yojson.Safe.t

val make_document_metadata :
  created_at:string ->
  ?deleted_at:string ->
  ?project_id:string ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  document_metadata
(** Metadata for a document fetched from the database *)

type nonrec document_search_request = {
  document_ids : string list option;
      (** Document ids to search over. Examples: \['doc1'\], \['doc1', 'doc2'\]. Empty to search all accessible documents. *)
  file_types : string list option;
      (** Document file types to search. Examples: \['pdf'\], \['md', 'txt'\]. Empty to search all file types. *)
  importance : bool option;
      (** Filter by document importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. *)
  is_email_attachment : bool option;
      (** Filter by email attachment status. true = only email attachments, false = only non-email attachments, None = both. *)
  notification_filters : notification_filters option;
      (** Filter by document notification state. *)
  owners : string list option;
      (** Filter by document owner principal — a user ('macro|user\@example.com'), a bot
('bot|<uuid>'), or a team (a bare hyphenated uuid). Examples:
\['macro|user\@example.com'\], \['macro|user\@example.com', 'bot|0199...'\]. Empty to
search all owners. *)
  project_ids : string list option;
      (** A list of project ids to search within. Examples: \['project1'\].
filtering. Empty to ignore project filtering. *)
  sub_types : string list option;
      (** Filter by document sub type. Examples: \['task'\]. Empty to search all sub types. *)
  task_filters : task_filters option;
      (** Task-specific filters that only apply to task subtype documents. *)
  collapse : bool option;
      (** If true, returns only 1 result per entity. False by default. *)
  match_type : match_type;  (** The match type to use when searching *)
  query : string option;  (** The query to search for *)
  search_on : search_on option;
      (** Fields to search on (Name, Content, NameContent). Defaults to Content *)
  terms : string list option;  (** Multiple terms to search over *)
}

val document_search_request_of_yojson : Yojson.Safe.t -> document_search_request
val yojson_of_document_search_request : document_search_request -> Yojson.Safe.t

val make_document_search_request :
  ?document_ids:string list ->
  ?file_types:string list ->
  ?importance:bool ->
  ?is_email_attachment:bool ->
  ?notification_filters:notification_filters ->
  ?owners:string list ->
  ?project_ids:string list ->
  ?sub_types:string list ->
  ?task_filters:task_filters ->
  ?collapse:bool ->
  match_type:match_type ->
  ?query:string ->
  ?search_on:search_on ->
  ?terms:string list ->
  unit ->
  document_search_request

type nonrec document_search_result = {
  highlight : search_highlight;  (** The highlights for the document *)
  node_id : string option;
      (** The node id for the document.
This is only useful for markdown at the moment
This will only be provided if the match was on content *)
  raw_content : string option;
      (** The raw content of the document.
This is only included for markdown files and will be the raw json node of the match *)
  score : float option;  (** The score of the result *)
}
(** A document match for a given node *)

val document_search_result_of_yojson : Yojson.Safe.t -> document_search_result
val yojson_of_document_search_result : document_search_result -> Yojson.Safe.t

val make_document_search_result :
  highlight:search_highlight ->
  ?node_id:string ->
  ?raw_content:string ->
  ?score:float ->
  unit ->
  document_search_result
(** A document match for a given node *)

(** The document sub type enum represents all values of document sub types.
These values should match the [document_sub_type_value] table in macrodb.

Wire, database, and [Display] spellings are all [snake_case] so a
multi-word variant serializes identically in every system. *)
type nonrec document_sub_type =
  | Task
  | Snippet
  | Skill
  | Initiative_description
  | Unknown of string  (** A value this SDK version does not know. *)

val document_sub_type_of_yojson : Yojson.Safe.t -> document_sub_type
val yojson_of_document_sub_type : document_sub_type -> Yojson.Safe.t

type nonrec document_search_response_item_with_metadata = {
  document_id : string;  (** The id of the document *)
  document_name : string;  (** The name of the document *)
  document_search_results : document_search_result list;
      (** The search results for the document
This may be empty if the search result match was on the document name only *)
  file_type : string option;  (** The file type of the document *)
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  name : string;
  owner_id : string;
  sub_type : document_sub_type option;
  metadata : document_metadata option;
  properties : soup_property list option;
      (** Entity properties (assignees, status, priority, etc.) for markdown documents. *)
}
(** DocumentSearchResponseItem object with document metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update document page record
every time the document updates (specifically for updated_at and viewed_at) *)

val document_search_response_item_with_metadata_of_yojson :
  Yojson.Safe.t -> document_search_response_item_with_metadata

val yojson_of_document_search_response_item_with_metadata :
  document_search_response_item_with_metadata -> Yojson.Safe.t

val make_document_search_response_item_with_metadata :
  document_id:string ->
  document_name:string ->
  document_search_results:document_search_result list ->
  ?file_type:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  ?sub_type:document_sub_type ->
  ?metadata:document_metadata ->
  ?properties:soup_property list ->
  unit ->
  document_search_response_item_with_metadata
(** DocumentSearchResponseItem object with document metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update document page record
every time the document updates (specifically for updated_at and viewed_at) *)

type nonrec document_search_response = {
  results : document_search_response_item_with_metadata list;
      (** List containing results from documents *)
}
(** The document search response object *)

val document_search_response_of_yojson :
  Yojson.Safe.t -> document_search_response

val yojson_of_document_search_response :
  document_search_response -> Yojson.Safe.t

val make_document_search_response :
  results:document_search_response_item_with_metadata list ->
  unit ->
  document_search_response
(** The document search response object *)

type nonrec document_search_response_item = {
  document_id : string;  (** The id of the document *)
  document_name : string;  (** The name of the document *)
  document_search_results : document_search_result list;
      (** The search results for the document
This may be empty if the search result match was on the document name only *)
  file_type : string option;  (** The file type of the document *)
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  name : string;
  owner_id : string;
  sub_type : document_sub_type option;
}
(** A single response item, part of the DocumentSearchResponse object *)

val document_search_response_item_of_yojson :
  Yojson.Safe.t -> document_search_response_item

val yojson_of_document_search_response_item :
  document_search_response_item -> Yojson.Safe.t

val make_document_search_response_item :
  document_id:string ->
  document_name:string ->
  document_search_results:document_search_result list ->
  ?file_type:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  ?sub_type:document_sub_type ->
  unit ->
  document_search_response_item
(** A single response item, part of the DocumentSearchResponse object *)

(** Controls whether shared email threads are included in results. *)
type nonrec shared_email_filter =
  | Exclude
  | Include
  | Only
  | Unknown of string  (** A value this SDK version does not know. *)

val shared_email_filter_of_yojson : Yojson.Safe.t -> shared_email_filter
val yojson_of_shared_email_filter : shared_email_filter -> Yojson.Safe.t

type nonrec email_filters = {
  bcc : string list option;
      (** Email BCC addresses to filter by. Examples: \['user\@example.com'\]. Empty if not filtering by BCC. *)
  calendar_only : bool option;
      (** When [Some(true)], only include threads that have at least one message
with an iCalendar attachment ([.ics] filename or [application/ics] mime
type). [Some(false)] and [None] apply no constraint. *)
  cc : string list option;
      (** Email CC addresses to filter by. Examples: \['user\@example.com'\]. Empty if not filtering by CC. *)
  crm_addresses : string list option;
      (** CRM-scoped address filter. When non-empty, expands visibility to every
teammate's mailbox and restricts to threads involving any of these
fully-qualified addresses. Each address is authorized against
[crm_contacts] + [crm_companies] (contact must not be hidden, company
must not be hidden, [email_sync] must be true).
Mutually exclusive with [crm_domains]. *)
  crm_domains : string list option;
      (** CRM-scoped domain filter. When non-empty, expands visibility to every
teammate's mailbox and restricts to threads involving any of these
domains (in any of sender/cc/bcc/recipient). Each domain is authorized
against [crm_domains] + [crm_companies] (must exist for the caller's
team, company must not be hidden, [email_sync] must be true).
Mutually exclusive with [crm_addresses]. *)
  email_thread_ids : string list option;
      (** Email thread IDs to filter by. Examples: \['thread-uuid-1'\]. Empty to search all threads. *)
  exclude_labels : string list option;
      (** Exclude emails that have any of these labels. Supports both Gmail system labels (e.g. "CATEGORY_PROMOTIONS") and user-created labels. Empty to not exclude any labels.
Note: SPAM and TRASH emails are not indexed in OpenSearch, so they are already excluded by default. *)
  importance : bool option;
      (** Filter by email importance. None to not filter. True to show only important emails
(drafts, personal, sent, or uncategorized). False to show only unimportant emails
(those categorized as promotions, social, updates, or forums). *)
  include_labels : string list option;
      (** Only include emails that have at least one of these labels. Supports both Gmail system labels (e.g. "INBOX", "CATEGORY_PROMOTIONS") and user-created labels (e.g. "github"). Empty to not filter by included labels.
Note: SPAM and TRASH emails are not indexed in OpenSearch, so they will never appear in results regardless of this filter. *)
  is_read : bool option;
      (** Filter by the email thread's read flag, independently of notification state. *)
  link_ids : string list option;
      (** Restrict to specific inboxes by email_links.id. Empty means "any inbox the
caller can access" (soup expands to the full set at the router edge). *)
  notification_filters : notification_filters option;
      (** Filter by email notification state. *)
  project_ids : string list option;
      (** A list of project ids to search within. Empty to ignore project filtering. *)
  recipients : string list option;
      (** Email Recipient addresses to filter by. Examples: \['user\@example.com'\]. Empty if not filtering by Recipient. *)
  senders : string list option;
      (** Email sender addresses to filter by. Examples: \['user\@example.com'\]. Empty to search all senders. *)
  shared : shared_email_filter option;
      (** Controls whether shared email threads are included in results.
Defaults to "exclude" (only the user's own threads). *)
}
(** The email filters used to filter down what emails you search over. *)

val email_filters_of_yojson : Yojson.Safe.t -> email_filters
val yojson_of_email_filters : email_filters -> Yojson.Safe.t

val make_email_filters :
  ?bcc:string list ->
  ?calendar_only:bool ->
  ?cc:string list ->
  ?crm_addresses:string list ->
  ?crm_domains:string list ->
  ?email_thread_ids:string list ->
  ?exclude_labels:string list ->
  ?importance:bool ->
  ?include_labels:string list ->
  ?is_read:bool ->
  ?link_ids:string list ->
  ?notification_filters:notification_filters ->
  ?project_ids:string list ->
  ?recipients:string list ->
  ?senders:string list ->
  ?shared:shared_email_filter ->
  unit ->
  email_filters
(** The email filters used to filter down what emails you search over. *)

type nonrec email_search_participant = { email : string; name : string option }
(** A participant (sender) in an email thread *)

val email_search_participant_of_yojson :
  Yojson.Safe.t -> email_search_participant

val yojson_of_email_search_participant :
  email_search_participant -> Yojson.Safe.t

val make_email_search_participant :
  email:string -> ?name:string -> unit -> email_search_participant
(** A participant (sender) in an email thread *)

type nonrec email_search_request = {
  bcc : string list option;
      (** Email BCC addresses to filter by. Examples: \['user\@example.com'\]. Empty if not filtering by BCC. *)
  calendar_only : bool option;
      (** When [Some(true)], only include threads that have at least one message
with an iCalendar attachment ([.ics] filename or [application/ics] mime
type). [Some(false)] and [None] apply no constraint. *)
  cc : string list option;
      (** Email CC addresses to filter by. Examples: \['user\@example.com'\]. Empty if not filtering by CC. *)
  crm_addresses : string list option;
      (** CRM-scoped address filter. When non-empty, expands visibility to every
teammate's mailbox and restricts to threads involving any of these
fully-qualified addresses. Each address is authorized against
[crm_contacts] + [crm_companies] (contact must not be hidden, company
must not be hidden, [email_sync] must be true).
Mutually exclusive with [crm_domains]. *)
  crm_domains : string list option;
      (** CRM-scoped domain filter. When non-empty, expands visibility to every
teammate's mailbox and restricts to threads involving any of these
domains (in any of sender/cc/bcc/recipient). Each domain is authorized
against [crm_domains] + [crm_companies] (must exist for the caller's
team, company must not be hidden, [email_sync] must be true).
Mutually exclusive with [crm_addresses]. *)
  email_thread_ids : string list option;
      (** Email thread IDs to filter by. Examples: \['thread-uuid-1'\]. Empty to search all threads. *)
  exclude_labels : string list option;
      (** Exclude emails that have any of these labels. Supports both Gmail system labels (e.g. "CATEGORY_PROMOTIONS") and user-created labels. Empty to not exclude any labels.
Note: SPAM and TRASH emails are not indexed in OpenSearch, so they are already excluded by default. *)
  importance : bool option;
      (** Filter by email importance. None to not filter. True to show only important emails
(drafts, personal, sent, or uncategorized). False to show only unimportant emails
(those categorized as promotions, social, updates, or forums). *)
  include_labels : string list option;
      (** Only include emails that have at least one of these labels. Supports both Gmail system labels (e.g. "INBOX", "CATEGORY_PROMOTIONS") and user-created labels (e.g. "github"). Empty to not filter by included labels.
Note: SPAM and TRASH emails are not indexed in OpenSearch, so they will never appear in results regardless of this filter. *)
  is_read : bool option;
      (** Filter by the email thread's read flag, independently of notification state. *)
  link_ids : string list option;
      (** Restrict to specific inboxes by email_links.id. Empty means "any inbox the
caller can access" (soup expands to the full set at the router edge). *)
  notification_filters : notification_filters option;
      (** Filter by email notification state. *)
  project_ids : string list option;
      (** A list of project ids to search within. Empty to ignore project filtering. *)
  recipients : string list option;
      (** Email Recipient addresses to filter by. Examples: \['user\@example.com'\]. Empty if not filtering by Recipient. *)
  senders : string list option;
      (** Email sender addresses to filter by. Examples: \['user\@example.com'\]. Empty to search all senders. *)
  shared : shared_email_filter option;
      (** Controls whether shared email threads are included in results.
Defaults to "exclude" (only the user's own threads). *)
  collapse : bool option;
      (** If true, returns only 1 result per entity. False by default. *)
  match_type : match_type;  (** The match type to use when searching *)
  query : string option;  (** The query to search for *)
  search_on : search_on option;
      (** Fields to search on (Name, Content, NameContent). Defaults to Content *)
  terms : string list option;  (** Multiple terms to search over *)
}

val email_search_request_of_yojson : Yojson.Safe.t -> email_search_request
val yojson_of_email_search_request : email_search_request -> Yojson.Safe.t

val make_email_search_request :
  ?bcc:string list ->
  ?calendar_only:bool ->
  ?cc:string list ->
  ?crm_addresses:string list ->
  ?crm_domains:string list ->
  ?email_thread_ids:string list ->
  ?exclude_labels:string list ->
  ?importance:bool ->
  ?include_labels:string list ->
  ?is_read:bool ->
  ?link_ids:string list ->
  ?notification_filters:notification_filters ->
  ?project_ids:string list ->
  ?recipients:string list ->
  ?senders:string list ->
  ?shared:shared_email_filter ->
  ?collapse:bool ->
  match_type:match_type ->
  ?query:string ->
  ?search_on:search_on ->
  ?terms:string list ->
  unit ->
  email_search_request

type nonrec email_search_result = {
  bcc : string list;
      (** This is only present if the search result is on the message content *)
  cc : string list;
      (** This is only present if the search result is on the message content *)
  highlight : search_highlight;  (** The highlights for the email message *)
  labels : string list;
      (** This is only present if the search result is on the message content *)
  message_id : string option;
      (** The email message id.
This is only present if the search result is on the message content *)
  pretty_sender : string;
      (** The pretty sender.
If the match is on the subject, the pretty sender is the latest sender on the thread.
This could be the sender's email if there is no contact name for the sender. *)
  recipients : string list;
      (** This is only present if the search result is on the message content *)
  score : float option;  (** The score of the result *)
  sender : string;
      (** The sender.
If the match is on the subject, the sender is the latest sender on the thread. *)
  sent_at : string option;
      (** When the email message was sent
This is only present if the search result is on the message content *)
}
(** A email message match for a given thread id *)

val email_search_result_of_yojson : Yojson.Safe.t -> email_search_result
val yojson_of_email_search_result : email_search_result -> Yojson.Safe.t

val make_email_search_result :
  bcc:string list ->
  cc:string list ->
  highlight:search_highlight ->
  labels:string list ->
  ?message_id:string ->
  pretty_sender:string ->
  recipients:string list ->
  ?score:float ->
  sender:string ->
  ?sent_at:string ->
  unit ->
  email_search_result
(** A email message match for a given thread id *)

type nonrec email_search_response_item_with_metadata = {
  email_message_search_results : email_search_result list;
      (** The search results for the document
This may be empty if the search result match was on the email subject only *)
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  link_id : string;
      (** The inbox that owns the thread. Drives the multi-inbox indicator
when the caller has more than one inbox. *)
  name : string option;  (** Subject of the email thread *)
  owner_id : string;
  participants : email_search_participant list;
      (** The participants (senders) in this email thread *)
  subject : string option;
      (** The subject of the email
This is only present if the search result is on the message content *)
  thread_id : string;  (** The id of the email thread *)
  user_id : string;  (** The id of the owner of the email thread *)
  created_at : string;
  inbox_visible : bool;
  is_draft : bool;
  is_important : bool;
  is_read : bool;
  properties : soup_property list option;
      (** Entity properties (e.g. tags) on the thread. *)
  snippet : string option;
  updated_at : string;
  viewed_at : string option;
}
(** EmailSearchResponseItem object with email metadata we fetch from email service. we don't store these
timestamps in opensearch as they would require us to update each email message record for the thread
every time the thread updates (specifically for updated_at and viewed_at) *)

val email_search_response_item_with_metadata_of_yojson :
  Yojson.Safe.t -> email_search_response_item_with_metadata

val yojson_of_email_search_response_item_with_metadata :
  email_search_response_item_with_metadata -> Yojson.Safe.t

val make_email_search_response_item_with_metadata :
  email_message_search_results:email_search_result list ->
  id:string ->
  link_id:string ->
  ?name:string ->
  owner_id:string ->
  participants:email_search_participant list ->
  ?subject:string ->
  thread_id:string ->
  user_id:string ->
  created_at:string ->
  inbox_visible:bool ->
  is_draft:bool ->
  is_important:bool ->
  is_read:bool ->
  ?properties:soup_property list ->
  ?snippet:string ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  email_search_response_item_with_metadata
(** EmailSearchResponseItem object with email metadata we fetch from email service. we don't store these
timestamps in opensearch as they would require us to update each email message record for the thread
every time the thread updates (specifically for updated_at and viewed_at) *)

type nonrec email_search_response = {
  results : email_search_response_item_with_metadata list;
      (** List containing results from email threads *)
}
(** The document search response object *)

val email_search_response_of_yojson : Yojson.Safe.t -> email_search_response
val yojson_of_email_search_response : email_search_response -> Yojson.Safe.t

val make_email_search_response :
  results:email_search_response_item_with_metadata list ->
  unit ->
  email_search_response
(** The document search response object *)

type nonrec email_search_response_item = {
  email_message_search_results : email_search_result list;
      (** The search results for the document
This may be empty if the search result match was on the email subject only *)
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  link_id : string;
      (** The inbox that owns the thread. Drives the multi-inbox indicator
when the caller has more than one inbox. *)
  name : string option;  (** Subject of the email thread *)
  owner_id : string;
  participants : email_search_participant list;
      (** The participants (senders) in this email thread *)
  subject : string option;
      (** The subject of the email
This is only present if the search result is on the message content *)
  thread_id : string;  (** The id of the email thread *)
  user_id : string;  (** The id of the owner of the email thread *)
}
(** A single response item, part of the EmailSearchResponse object *)

val email_search_response_item_of_yojson :
  Yojson.Safe.t -> email_search_response_item

val yojson_of_email_search_response_item :
  email_search_response_item -> Yojson.Safe.t

val make_email_search_response_item :
  email_message_search_results:email_search_result list ->
  id:string ->
  link_id:string ->
  ?name:string ->
  owner_id:string ->
  participants:email_search_participant list ->
  ?subject:string ->
  thread_id:string ->
  user_id:string ->
  unit ->
  email_search_response_item
(** A single response item, part of the EmailSearchResponse object *)

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

val empty_response_of_yojson : Yojson.Safe.t -> empty_response
val yojson_of_empty_response : empty_response -> Yojson.Safe.t

type nonrec foreign_entity_filters = {
  foreign_entity_ids : string list option;
      (** External entity identifiers to filter by. Empty to include all external IDs. *)
  foreign_entity_sources : string list option;
      (** External source names to filter by. Empty to include all sources. *)
  ids : string list option;
      (** Internal foreign entity record IDs to filter by. Empty to include all records. *)
  includes_me : bool option;
      (** When true, only return foreign entities whose metadata lists the requesting user as a
participant (GitHub [involves:me] semantics for [github_pull_request] records). False or
absent applies no filter. Serialized in filter ASTs as the ["me"] literal. *)
  notification_filters : notification_filters option;
      (** Filter by the notification state of the foreign entity (e.g. whether the requesting user's
GitHub PR notification is done/seen). *)
}
(** Filters for foreign entity records. *)

val foreign_entity_filters_of_yojson : Yojson.Safe.t -> foreign_entity_filters
val yojson_of_foreign_entity_filters : foreign_entity_filters -> Yojson.Safe.t

val make_foreign_entity_filters :
  ?foreign_entity_ids:string list ->
  ?foreign_entity_sources:string list ->
  ?ids:string list ->
  ?includes_me:bool ->
  ?notification_filters:notification_filters ->
  unit ->
  foreign_entity_filters
(** Filters for foreign entity records. *)

type nonrec initiative_filters = {
  due_after : string option;  (** Inclusive lower due-date bound. *)
  due_before : string option;  (** Inclusive upper due-date bound. *)
  include_ : bool option;
      (** Opt this query into initiatives at all. Initiatives are off by
default — see \[[crate::ast::initiative::InitiativeLiteral::Include]\].
Asking for specific [initiative_ids], [owners] or [notification_filters]
also opts in. *)
  initiative_ids : string list option;
      (** Initiative ids to filter by. Empty to include all accessible initiatives. *)
  name : string option;  (** Case-insensitive name substring. *)
  notification_filters : notification_filters option;
      (** Filter by initiative notification state. *)
  owners : string list option;
      (** Filter by initiative owner principal — a user ('macro|user\@example.com'), a
bot ('bot|<uuid>'), or a team (a bare hyphenated uuid). Empty to include
every owner. *)
}
(** Filters for initiatives. *)

val initiative_filters_of_yojson : Yojson.Safe.t -> initiative_filters
val yojson_of_initiative_filters : initiative_filters -> Yojson.Safe.t

val make_initiative_filters :
  ?due_after:string ->
  ?due_before:string ->
  ?include_:bool ->
  ?initiative_ids:string list ->
  ?name:string ->
  ?notification_filters:notification_filters ->
  ?owners:string list ->
  unit ->
  initiative_filters
(** Filters for initiatives. *)

type nonrec project_filters = {
  importance : bool option;
      (** Filter by project importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. *)
  include_root : bool option;
      (** When true, [project_ids] also matches the projects themselves in addition to their children. *)
  notification_filters : notification_filters option;
      (** Filter by project notification state. *)
  owners : string list option;
      (** Filter by project owner principal — a user ('macro|user\@example.com'), a bot
('bot|<uuid>'), or a team (a bare hyphenated uuid). Examples:
\['macro|user\@example.com'\], \['macro|user\@example.com', 'bot|0199...'\]. Empty to
search all owners. *)
  project_ids : string list option;
      (** Project IDs to search within. Examples: \['project1'\]. Empty to search all accessible projects.
By default matches children of these projects; set [include_root] to also match the projects themselves. *)
}
(** The project filters used to filter down what projects you search over. *)

val project_filters_of_yojson : Yojson.Safe.t -> project_filters
val yojson_of_project_filters : project_filters -> Yojson.Safe.t

val make_project_filters :
  ?importance:bool ->
  ?include_root:bool ->
  ?notification_filters:notification_filters ->
  ?owners:string list ->
  ?project_ids:string list ->
  unit ->
  project_filters
(** The project filters used to filter down what projects you search over. *)

type nonrec property_date_filter_range = {
  end_ : string option;
      (** Exclusive UTC upper bound, omitted for an open end. *)
  start : string option;
      (** Inclusive UTC lower bound, omitted for an open start. *)
}
(** UTC timestamp interval. Lower bounds are inclusive; upper bounds are exclusive. *)

val property_date_filter_range_of_yojson :
  Yojson.Safe.t -> property_date_filter_range

val yojson_of_property_date_filter_range :
  property_date_filter_range -> Yojson.Safe.t

val make_property_date_filter_range :
  ?end_:string -> ?start:string -> unit -> property_date_filter_range
(** UTC timestamp interval. Lower bounds are inclusive; upper bounds are exclusive. *)

type nonrec property_filter = {
  date_range : property_date_filter_range option;
  entity_ids : string list option;
      (** Entity reference IDs to match. Multiple values are OR'd together. *)
  entity_type : string option;
      (** The entity type for the property lookup (e.g., "TASK", "DOCUMENT", "PROJECT").
When None, matches across all entity types. *)
  has_date : bool option;
      (** Flat Soup/search presence filter: true expands to an open date range, false to its negation. *)
  option_ids : string list option;
      (** Select option UUIDs to match. Multiple values are OR'd together. *)
  property_definition_id : string;
      (** The UUID of the property definition to filter on. *)
}
(** A single property-based filter condition.

Each filter targets a specific property definition on entities of a given type,
matching against select option UUIDs or entity reference IDs.
Multiple values within a single filter are OR'd together.
Multiple filters are AND'd together. *)

val property_filter_of_yojson : Yojson.Safe.t -> property_filter
val yojson_of_property_filter : property_filter -> Yojson.Safe.t

val make_property_filter :
  ?date_range:property_date_filter_range ->
  ?entity_ids:string list ->
  ?entity_type:string ->
  ?has_date:bool ->
  ?option_ids:string list ->
  property_definition_id:string ->
  unit ->
  property_filter
(** A single property-based filter condition.

Each filter targets a specific property definition on entities of a given type,
matching against select option UUIDs or entity reference IDs.
Multiple values within a single filter are OR'd together.
Multiple filters are AND'd together. *)

(** How multiple [tag_option_ids] combine when filtering. *)
type nonrec tag_filter_mode =
  | Any
  | All
  | Unknown of string  (** A value this SDK version does not know. *)

val tag_filter_mode_of_yojson : Yojson.Safe.t -> tag_filter_mode
val yojson_of_tag_filter_mode : tag_filter_mode -> Yojson.Safe.t

type nonrec entity_filters = {
  agent_session_filters : agent_session_filters option;
      (** the bundled \[AgentSessionFilters\] *)
  calendar_event_filters : calendar_event_filters option;
      (** the bundled \[CalendarEventFilters\] *)
  call_filters : call_filters option;  (** the bundled \[CallFilters\] *)
  channel_filters : channel_filters option;
      (** the bundled \[ChannelFilters\] *)
  channel_thread_filters : channel_thread_filters option;
      (** the bundled \[ChannelThreadFilters\] *)
  chat_filters : chat_filters option;  (** the bundled \[ChatFilters\] *)
  crm_company_filters : crm_company_filters option;
      (** the bundled \[CrmCompanyFilters\] *)
  document_filters : document_filters option;
      (** the bundled \[DocumentFilters\] *)
  email_filters : email_filters option;  (** the bundled \[EmailFilters\] *)
  favorites_only : bool option;
      (** Restrict results to the authenticated viewer's favorites when true. *)
  foreign_entity_filters : foreign_entity_filters option;
      (** the bundled \[ForeignEntityFilters\] *)
  initiative_filters : initiative_filters option;
      (** Initiative filters. Initiatives are opt-in. *)
  project_filters : project_filters option;
      (** the bundled \[ProjectFilters\] *)
  property_filters : property_filter list option;
      (** property-based filters applied across entity types *)
  tag_filter_mode : tag_filter_mode option;
      (** How the [tag_option_ids] combine: [any] (default) matches entities
holding at least one selected tag, [all] requires every selected tag. *)
  tag_option_ids : string list option;
      (** tag option ids matched against [properties.values], OR'd together across
all tag definitions. Option ids are globally unique, so the match ignores
the owning definition id (personal and team tags combine into one OR). *)
}
(** a bundle of all of the filters for each entity type *)

val entity_filters_of_yojson : Yojson.Safe.t -> entity_filters
val yojson_of_entity_filters : entity_filters -> Yojson.Safe.t

val make_entity_filters :
  ?agent_session_filters:agent_session_filters ->
  ?calendar_event_filters:calendar_event_filters ->
  ?call_filters:call_filters ->
  ?channel_filters:channel_filters ->
  ?channel_thread_filters:channel_thread_filters ->
  ?chat_filters:chat_filters ->
  ?crm_company_filters:crm_company_filters ->
  ?document_filters:document_filters ->
  ?email_filters:email_filters ->
  ?favorites_only:bool ->
  ?foreign_entity_filters:foreign_entity_filters ->
  ?initiative_filters:initiative_filters ->
  ?project_filters:project_filters ->
  ?property_filters:property_filter list ->
  ?tag_filter_mode:tag_filter_mode ->
  ?tag_option_ids:string list ->
  unit ->
  entity_filters
(** a bundle of all of the filters for each entity type *)

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

(** Generates a FileType enum and associated ContentType enum with their implementations.

This macro takes a list of tuples in the format:
(Variant, "extension", "mime_type", CONTENT_TYPE_VARIANT)

For each tuple it generates:
- A variant in the FileType enum
- A variant in the ContentType enum
- Implementations for:
  - FileType::to_str() - Converts FileType to extension string
  - FileType::from_str() - Converts extension string to FileType
  - From<FileType> for ContentType - Maps FileType to ContentType
  - ContentType::mime_type() - Gets MIME type for ContentType *)
type nonrec file_type =
  | Docx
  | Pdf
  | Md
  | Spreadsheet
  | Canvas
  | Coffee
  | Cson
  | Iced
  | C
  | I
  | Cpp
  | Cppm
  | Cc
  | Ccm
  | Cxx
  | Cxxm
  | Cplusplus
  | Cplusplusm
  | Hpp
  | Hh
  | Hxx
  | Hplusplus
  | H
  | Ii
  | Ino
  | Inl
  | Ipp
  | Ixx
  | Tpp
  | Txx
  | Hppin
  | Hin
  | Cu
  | Cuh
  | Cs
  | Csx
  | Cake
  | Css
  | Dart
  | Diff
  | Patch
  | Rej
  | Dockerfile
  | Containerfile
  | Go
  | Handlebars
  | Hbs
  | Hjs
  | Hlsl
  | Hlsli
  | Fx
  | Fxh
  | Vsh
  | Psh
  | Cginc
  | Compute
  | Html
  | Htm
  | Shtml
  | Xhtml
  | Xht
  | Mdoc
  | Jsp
  | Asp
  | Aspx
  | Jshtm
  | Volt
  | Ejs
  | Rhtml
  | Ini
  | Conf
  | Properties
  | Cfg
  | Directory
  | Gitattributes
  | Gitconfig
  | Gitmodules
  | Editorconfig
  | Repo
  | Java
  | Jav
  | Jsx
  | Js
  | Es6
  | Mjs
  | Cjs
  | Pac
  | Json
  | Bowerrc
  | Jscsrc
  | Webmanifest
  | Jsmap
  | Cssmap
  | Tsmap
  | Har
  | Jslintrc
  | Jsonld
  | Geojson
  | Ipynb
  | Vuerc
  | Jsonc
  | Eslintrc
  | Eslintrcjson
  | Jsfmtrc
  | Jshintrc
  | Swcrc
  | Hintrc
  | Babelrc
  | Jsonl
  | Ndjson
  | Codesnippets
  | Jl
  | Jmd
  | Sty
  | Cls
  | Bbx
  | Cbx
  | Tex
  | Ltx
  | Ctx
  | Bib
  | Less
  | Log
  | Lua
  | Mak
  | Mk
  | Mkd
  | Mdwn
  | Mdown
  | Markdown
  | Markdn
  | Mdtxt
  | Mdtext
  | Workbook
  | M
  | Mm
  | Pl
  | Pm
  | Pod
  | T
  | Psgi
  | Raku
  | Rakumod
  | Rakutest
  | Rakudoc
  | Nqp
  | P6
  | Pl6
  | Pm6
  | Php
  | Php4
  | Php5
  | Phtml
  | Ctp
  | Ps1
  | Psm1
  | Psd1
  | Pssc
  | Psrc
  | Py
  | Rpy
  | Pyw
  | Cpy
  | Gyp
  | Gypi
  | Pyi
  | Ipy
  | Pyt
  | R
  | Rhistory
  | Rprofile
  | Rt
  | Cshtml
  | Razor
  | Rb
  | Rbx
  | Rjs
  | Gemspec
  | Rake
  | Ru
  | Erb
  | Podspec
  | Rbi
  | Rs
  | Scss
  | Sass
  | Shader
  | Sh
  | Bash
  | Bashrc
  | Bashaliases
  | Bashprofile
  | Bashlogin
  | Ebuild
  | Eclass
  | Profile
  | Bashlogout
  | Xprofile
  | Xsession
  | Xsessionrc
  | Zsh
  | Zshrc
  | Zprofile
  | Zlogin
  | Zlogout
  | Zshenv
  | Zshtheme
  | Fish
  | Ksh
  | Csh
  | Cshrc
  | Tcshrc
  | Yashrc
  | Yashprofile
  | Sql
  | Dsql
  | Swift
  | Ts
  | Cts
  | Mts
  | Tsx
  | Tsbuildinfo
  | Xml
  | Xsd
  | Ascx
  | Atom
  | Axml
  | Axaml
  | Bpmn
  | Cpt
  | Csl
  | Csproj
  | Csprojuser
  | Dita
  | Ditamap
  | Dtd
  | Ent
  | Mod
  | Dtml
  | Fsproj
  | Fxml
  | Iml
  | Isml
  | Jmx
  | Launch
  | Menu
  | Mxml
  | Nuspec
  | Opml
  | Owl
  | Proj
  | Props
  | Pt
  | Publishsettings
  | Pubxml
  | Pubxmluser
  | Rbxlx
  | Rbxmx
  | Rdf
  | Rng
  | Rss
  | Shproj
  | Storyboard
  | Targets
  | Tld
  | Tmx
  | Vbproj
  | Vbprojuser
  | Vcxproj
  | Vcxprojfilters
  | Wsdl
  | Wxi
  | Wxl
  | Wxs
  | Xaml
  | Xbl
  | Xib
  | Xlf
  | Xliff
  | Xpdl
  | Xul
  | Xoml
  | Xsl
  | Xslt
  | Yaml
  | Yml
  | Eyaml
  | Eyml
  | Cff
  | Yamltmlanguage
  | Yamltmpreferences
  | Yamltmtheme
  | Winget
  | Txt
  | Csv
  | Tsv
  | Jpeg
  | Jpg
  | Png
  | Gif
  | Svg
  | Webp
  | Avif
  | Bmp
  | Ico
  | Tiff
  | Tif
  | Heic
  | Heif
  | Tar
  | Targz
  | Tgz
  | Gz
  | Bz2
  | Tarbz2
  | Tbz2
  | Z
  | Tarz
  | Lz
  | Tarlz
  | Xz
  | Tarxz
  | Txz
  | Lzma
  | Tarlzma
  | Rar
  | Sevenz
  | Zst
  | Tarzst
  | Tzst
  | Zip
  | Exe
  | Msi
  | Dll
  | Bat
  | Cmd
  | Com
  | Appimage
  | App
  | Bin
  | Deb
  | Rpm
  | Apk
  | Dmg
  | Pkg
  | Crx
  | Xpi
  | Mp3
  | Wav
  | Ogg
  | Flac
  | Aac
  | M4a
  | Wma
  | Mid
  | Midi
  | Mp4
  | Mkv
  | Webm
  | Avi
  | Mov
  | Wmv
  | Mpg
  | Mpeg
  | M4v
  | Flv
  | F4v
  | Threegp
  | Ttf
  | Otf
  | Woff
  | Woff2
  | Eot
  | Rtf
  | Odt
  | Ods
  | Odp
  | Odg
  | Odf
  | Epub
  | Mobi
  | Azw
  | Azw3
  | Djvu
  | Xls
  | Xlsm
  | Ppt
  | Doc
  | Pptx
  | Xlsx
  | Db
  | Sqlite
  | Sqlite3
  | Mdb
  | Accdb
  | Dbf
  | Plist
  | Toml
  | Env
  | Dot
  | Gv
  | Torrent
  | Ics
  | Vcf
  | Ai
  | Eps
  | Ps
  | Dxf
  | Dwg
  | Fig
  | Psd
  | Psb
  | Stl
  | Obj
  | Fbx
  | Blend
  | Dae
  | Threeds
  | Gltf
  | Glb
  | Vhd
  | Vhdx
  | Vmdk
  | Ova
  | Ovf
  | Iso
  | Img
  | Swf
  | Unknown of string  (** A value this SDK version does not know. *)

val file_type_of_yojson : Yojson.Safe.t -> file_type
val yojson_of_file_type : file_type -> Yojson.Safe.t

type nonrec highlight = {
  content : string list option;
      (** If the match was on the entity content, this will provide a list of highlights
for each content match *)
  name : string option;
      (** If the match was on the entity name, this will be present with that highlight *)
}
(** The search service version of a highlight *)

val highlight_of_yojson : Yojson.Safe.t -> highlight
val yojson_of_highlight : highlight -> Yojson.Safe.t

val make_highlight : ?content:string list -> ?name:string -> unit -> highlight
(** The search service version of a highlight *)

type nonrec project_metadata = {
  created_at : string;
  deleted_at : string option;
  parent_project_id : string option;
  updated_at : string;
  viewed_at : string option;
}
(** Metadata for a project fetched from the database *)

val project_metadata_of_yojson : Yojson.Safe.t -> project_metadata
val yojson_of_project_metadata : project_metadata -> Yojson.Safe.t

val make_project_metadata :
  created_at:string ->
  ?deleted_at:string ->
  ?parent_project_id:string ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  project_metadata
(** Metadata for a project fetched from the database *)

type nonrec project_search_metadata = {
  created_at : string;
  owner_id : string;
  project_id : string;
  project_name : string;
  updated_at : string;
}
(** Metadata associated with Project Search, to be used with SearchResponseItem *)

val project_search_metadata_of_yojson : Yojson.Safe.t -> project_search_metadata
val yojson_of_project_search_metadata : project_search_metadata -> Yojson.Safe.t

val make_project_search_metadata :
  created_at:string ->
  owner_id:string ->
  project_id:string ->
  project_name:string ->
  updated_at:string ->
  unit ->
  project_search_metadata
(** Metadata associated with Project Search, to be used with SearchResponseItem *)

type nonrec project_search_request = {
  importance : bool option;
      (** Filter by project importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. *)
  include_root : bool option;
      (** When true, [project_ids] also matches the projects themselves in addition to their children. *)
  notification_filters : notification_filters option;
      (** Filter by project notification state. *)
  owners : string list option;
      (** Filter by project owner principal — a user ('macro|user\@example.com'), a bot
('bot|<uuid>'), or a team (a bare hyphenated uuid). Examples:
\['macro|user\@example.com'\], \['macro|user\@example.com', 'bot|0199...'\]. Empty to
search all owners. *)
  project_ids : string list option;
      (** Project IDs to search within. Examples: \['project1'\]. Empty to search all accessible projects.
By default matches children of these projects; set [include_root] to also match the projects themselves. *)
  collapse : bool option;
      (** If true, returns only 1 result per entity. False by default. *)
  match_type : match_type;  (** The match type to use when searching *)
  query : string option;  (** The query to search for *)
  search_on : search_on option;
      (** Fields to search on (Name, Content, NameContent). Defaults to Content *)
  terms : string list option;  (** Multiple terms to search over *)
}

val project_search_request_of_yojson : Yojson.Safe.t -> project_search_request
val yojson_of_project_search_request : project_search_request -> Yojson.Safe.t

val make_project_search_request :
  ?importance:bool ->
  ?include_root:bool ->
  ?notification_filters:notification_filters ->
  ?owners:string list ->
  ?project_ids:string list ->
  ?collapse:bool ->
  match_type:match_type ->
  ?query:string ->
  ?search_on:search_on ->
  ?terms:string list ->
  unit ->
  project_search_request

type nonrec project_search_result = {
  highlight : search_highlight;
  score : float option;  (** The score of the result *)
}

val project_search_result_of_yojson : Yojson.Safe.t -> project_search_result
val yojson_of_project_search_result : project_search_result -> Yojson.Safe.t

val make_project_search_result :
  highlight:search_highlight -> ?score:float -> unit -> project_search_result

type nonrec project_search_response_item = {
  created_at : string;
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  name : string;
  owner_id : string;
  project_search_results : project_search_result list;
  updated_at : string;
}
(** A single response item, part of the ProjectSearchResponse object *)

val project_search_response_item_of_yojson :
  Yojson.Safe.t -> project_search_response_item

val yojson_of_project_search_response_item :
  project_search_response_item -> Yojson.Safe.t

val make_project_search_response_item :
  created_at:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  project_search_results:project_search_result list ->
  updated_at:string ->
  unit ->
  project_search_response_item
(** A single response item, part of the ProjectSearchResponse object *)

type nonrec project_search_response_item_with_metadata = {
  created_at : string;
  id : string;
      (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
  name : string;
  owner_id : string;
  project_search_results : project_search_result list;
  updated_at : string;
  metadata : project_metadata option;
  properties : soup_property list option;
      (** Entity properties (e.g. tags) on the project. *)
}
(** ProjectSearchResponseItem object with project metadata we fetch from macrodb.
The index carries created_at/updated_at for ranking, but viewed_at is
per-user and deleted_at changes without a reindex, so metadata stays
database-sourced. *)

val project_search_response_item_with_metadata_of_yojson :
  Yojson.Safe.t -> project_search_response_item_with_metadata

val yojson_of_project_search_response_item_with_metadata :
  project_search_response_item_with_metadata -> Yojson.Safe.t

val make_project_search_response_item_with_metadata :
  created_at:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  project_search_results:project_search_result list ->
  updated_at:string ->
  ?metadata:project_metadata ->
  ?properties:soup_property list ->
  unit ->
  project_search_response_item_with_metadata
(** ProjectSearchResponseItem object with project metadata we fetch from macrodb.
The index carries created_at/updated_at for ranking, but viewed_at is
per-user and deleted_at changes without a reindex, so metadata stays
database-sourced. *)

type nonrec search_goto_call_record = {
  channel_id : string option;
  ended_at : string option;
  participant_ids : string list;
  sequence_num : int;
  speaker_id : string;
  started_at : string;
  transcript_id : string;
}

val search_goto_call_record_of_yojson : Yojson.Safe.t -> search_goto_call_record
val yojson_of_search_goto_call_record : search_goto_call_record -> Yojson.Safe.t

val make_search_goto_call_record :
  ?channel_id:string ->
  ?ended_at:string ->
  participant_ids:string list ->
  sequence_num:int ->
  speaker_id:string ->
  started_at:string ->
  transcript_id:string ->
  unit ->
  search_goto_call_record

type nonrec search_goto_channel = {
  channel_message_id : string;  (** The channel message id *)
}

val search_goto_channel_of_yojson : Yojson.Safe.t -> search_goto_channel
val yojson_of_search_goto_channel : search_goto_channel -> Yojson.Safe.t

val make_search_goto_channel :
  channel_message_id:string -> unit -> search_goto_channel

type nonrec search_goto_chat = {
  chat_message_id : string;  (** The chat message id *)
  role : string;  (** The role of the chat message *)
}

val search_goto_chat_of_yojson : Yojson.Safe.t -> search_goto_chat
val yojson_of_search_goto_chat : search_goto_chat -> Yojson.Safe.t

val make_search_goto_chat :
  chat_message_id:string -> role:string -> unit -> search_goto_chat

type nonrec search_goto_document = {
  node_id : string;
      (** The node id of the document
This can be a stringified page number 0-indexed for pdf/docx files,
or it can be a unique id that is used in lexical for markdown files. *)
  raw_content : string option;  (** The raw content of the document *)
}

val search_goto_document_of_yojson : Yojson.Safe.t -> search_goto_document
val yojson_of_search_goto_document : search_goto_document -> Yojson.Safe.t

val make_search_goto_document :
  node_id:string -> ?raw_content:string -> unit -> search_goto_document

type nonrec search_goto_email = {
  bcc : string list;
  cc : string list;
  email_message_id : string;  (** The email message id *)
  labels : string list;
  recipients : string list;
  sender : string;
  sent_at : string option;
}

val search_goto_email_of_yojson : Yojson.Safe.t -> search_goto_email
val yojson_of_search_goto_email : search_goto_email -> Yojson.Safe.t

val make_search_goto_email :
  bcc:string list ->
  cc:string list ->
  email_message_id:string ->
  labels:string list ->
  recipients:string list ->
  sender:string ->
  ?sent_at:string ->
  unit ->
  search_goto_email

(** The search service version of a goto *)
type nonrec search_goto_content =
  | Search_goto_agent_session of search_goto_agent_session
  | Search_goto_document of search_goto_document
  | Search_goto_chat of search_goto_chat
  | Search_goto_email of search_goto_email
  | Search_goto_channel of search_goto_channel
  | Search_goto_call_record of search_goto_call_record

val search_goto_content_of_yojson : Yojson.Safe.t -> search_goto_content
val yojson_of_search_goto_content : search_goto_content -> Yojson.Safe.t

type nonrec search_response = {
  results : project_search_response_item_with_metadata list;
      (** List containing results from a request *)
}

val search_response_of_yojson : Yojson.Safe.t -> search_response
val yojson_of_search_response : search_response -> Yojson.Safe.t

val make_search_response :
  results:project_search_response_item_with_metadata list ->
  unit ->
  search_response

type nonrec simple_calendar_event_search_response_base_item_human_readable_timestamp = {
  calendar_event_id : string;  (** The calendar event id *)
  created_at : string;  (** The time the event was created *)
  highlight : search_highlight;  (** The highlights on the event *)
  is_recurring : bool;  (** Whether the series carries a recurrence rule *)
  occurrence_key : string option;
      (** Stable key of the instance this row points at, when one resolved *)
  title : string;  (** The event title *)
  updated_at : string;  (** The time the event was last updated *)
  user_id : string;  (** The owner of this event projection *)
}

val simple_calendar_event_search_response_base_item_human_readable_timestamp_of_yojson :
  Yojson.Safe.t ->
  simple_calendar_event_search_response_base_item_human_readable_timestamp

val yojson_of_simple_calendar_event_search_response_base_item_human_readable_timestamp :
  simple_calendar_event_search_response_base_item_human_readable_timestamp ->
  Yojson.Safe.t

val make_simple_calendar_event_search_response_base_item_human_readable_timestamp :
  calendar_event_id:string ->
  created_at:string ->
  highlight:search_highlight ->
  is_recurring:bool ->
  ?occurrence_key:string ->
  title:string ->
  updated_at:string ->
  user_id:string ->
  unit ->
  simple_calendar_event_search_response_base_item_human_readable_timestamp

type nonrec simple_call_record_search_response_base_item_human_readable_timestamp = {
  call_id : string;
  channel_id : string option;
  channel_name : string option;
  duration_ms : int64;
  ended_at : string;
      (** DateTime<Utc> ts_seconds deserialization + RFC3339 serialization *)
  highlight : search_highlight;
  participant_ids : string list;
  started_at : string;
      (** DateTime<Utc> ts_seconds deserialization + RFC3339 serialization *)
  user_id : string;
}

val simple_call_record_search_response_base_item_human_readable_timestamp_of_yojson :
  Yojson.Safe.t ->
  simple_call_record_search_response_base_item_human_readable_timestamp

val yojson_of_simple_call_record_search_response_base_item_human_readable_timestamp :
  simple_call_record_search_response_base_item_human_readable_timestamp ->
  Yojson.Safe.t

val make_simple_call_record_search_response_base_item_human_readable_timestamp :
  call_id:string ->
  ?channel_id:string ->
  ?channel_name:string ->
  duration_ms:int64 ->
  ended_at:string ->
  highlight:search_highlight ->
  participant_ids:string list ->
  started_at:string ->
  user_id:string ->
  unit ->
  simple_call_record_search_response_base_item_human_readable_timestamp

type nonrec simple_channel_search_reponse_base_item = {
  channel_id : string;  (** The channel id *)
  channel_type : string;  (** The channel type *)
  created_at : string;  (** The time the channel message was created *)
  highlight : search_highlight;  (** The highlights on the channel message *)
  mentions : string list;  (** The mentions *)
  message_id : string;  (** The message id *)
  org_id : int64 option;  (** The org id *)
  sender_id : string;  (** The sender id *)
  thread_id : string option;  (** The thread id *)
  updated_at : string;  (** The time the channel message was last updated *)
}

val simple_channel_search_reponse_base_item_of_yojson :
  Yojson.Safe.t -> simple_channel_search_reponse_base_item

val yojson_of_simple_channel_search_reponse_base_item :
  simple_channel_search_reponse_base_item -> Yojson.Safe.t

val make_simple_channel_search_reponse_base_item :
  channel_id:string ->
  channel_type:string ->
  created_at:string ->
  highlight:search_highlight ->
  mentions:string list ->
  message_id:string ->
  ?org_id:int64 ->
  sender_id:string ->
  ?thread_id:string ->
  updated_at:string ->
  unit ->
  simple_channel_search_reponse_base_item

type nonrec simple_channel_search_reponse_base_item_human_readable_timestamp = {
  channel_id : string;  (** The channel id *)
  channel_type : string;  (** The channel type *)
  created_at : string;  (** The time the channel message was created *)
  highlight : search_highlight;  (** The highlights on the channel message *)
  mentions : string list;  (** The mentions *)
  message_id : string;  (** The message id *)
  org_id : int64 option;  (** The org id *)
  sender_id : string;  (** The sender id *)
  thread_id : string option;  (** The thread id *)
  updated_at : string;  (** The time the channel message was last updated *)
}

val simple_channel_search_reponse_base_item_human_readable_timestamp_of_yojson :
  Yojson.Safe.t ->
  simple_channel_search_reponse_base_item_human_readable_timestamp

val yojson_of_simple_channel_search_reponse_base_item_human_readable_timestamp :
  simple_channel_search_reponse_base_item_human_readable_timestamp ->
  Yojson.Safe.t

val make_simple_channel_search_reponse_base_item_human_readable_timestamp :
  channel_id:string ->
  channel_type:string ->
  created_at:string ->
  highlight:search_highlight ->
  mentions:string list ->
  message_id:string ->
  ?org_id:int64 ->
  sender_id:string ->
  ?thread_id:string ->
  updated_at:string ->
  unit ->
  simple_channel_search_reponse_base_item_human_readable_timestamp

type nonrec simple_channel_search_response = {
  results : simple_channel_search_reponse_base_item list;
      (** List containing results from channels.
Each item in the list is for a specific message in a channel. *)
}

val simple_channel_search_response_of_yojson :
  Yojson.Safe.t -> simple_channel_search_response

val yojson_of_simple_channel_search_response :
  simple_channel_search_response -> Yojson.Safe.t

val make_simple_channel_search_response :
  results:simple_channel_search_reponse_base_item list ->
  unit ->
  simple_channel_search_response

type nonrec simple_chat_search_response_base_item = {
  chat_id : string;  (** The chat id *)
  chat_message_id : string;  (** The chat message id *)
  highlight : search_highlight;  (** The highlights on the chat *)
  role : string;  (** The role *)
  title : string;  (** The title *)
  updated_at : string;  (** The time the chat was last updated *)
  user_id : string;  (** The user id *)
}

val simple_chat_search_response_base_item_of_yojson :
  Yojson.Safe.t -> simple_chat_search_response_base_item

val yojson_of_simple_chat_search_response_base_item :
  simple_chat_search_response_base_item -> Yojson.Safe.t

val make_simple_chat_search_response_base_item :
  chat_id:string ->
  chat_message_id:string ->
  highlight:search_highlight ->
  role:string ->
  title:string ->
  updated_at:string ->
  user_id:string ->
  unit ->
  simple_chat_search_response_base_item

type nonrec simple_chat_search_response = {
  results : simple_chat_search_response_base_item list;
      (** List containing results from chats.
Each item in the list is for a specific message in a chat. *)
}

val simple_chat_search_response_of_yojson :
  Yojson.Safe.t -> simple_chat_search_response

val yojson_of_simple_chat_search_response :
  simple_chat_search_response -> Yojson.Safe.t

val make_simple_chat_search_response :
  results:simple_chat_search_response_base_item list ->
  unit ->
  simple_chat_search_response

type nonrec simple_chat_search_response_base_item_human_readable_timestamp = {
  chat_id : string;  (** The chat id *)
  chat_message_id : string;  (** The chat message id *)
  highlight : search_highlight;  (** The highlights on the chat *)
  role : string;  (** The role *)
  title : string;  (** The title *)
  updated_at : string;  (** The time the chat was last updated *)
  user_id : string;  (** The user id *)
}

val simple_chat_search_response_base_item_human_readable_timestamp_of_yojson :
  Yojson.Safe.t ->
  simple_chat_search_response_base_item_human_readable_timestamp

val yojson_of_simple_chat_search_response_base_item_human_readable_timestamp :
  simple_chat_search_response_base_item_human_readable_timestamp ->
  Yojson.Safe.t

val make_simple_chat_search_response_base_item_human_readable_timestamp :
  chat_id:string ->
  chat_message_id:string ->
  highlight:search_highlight ->
  role:string ->
  title:string ->
  updated_at:string ->
  user_id:string ->
  unit ->
  simple_chat_search_response_base_item_human_readable_timestamp

type nonrec simple_document_search_response_base_item = {
  document_id : string;  (** The document id *)
  document_name : string;  (** The document name *)
  file_type : string;  (** The file type *)
  highlight : search_highlight;  (** The highlights on the document *)
  node_id : string;  (** The node id *)
  owner_id : string;  (** The owner id *)
  raw_content : string option;  (** The raw content of the document *)
  updated_at : string;  (** The time the document was last updated *)
}

val simple_document_search_response_base_item_of_yojson :
  Yojson.Safe.t -> simple_document_search_response_base_item

val yojson_of_simple_document_search_response_base_item :
  simple_document_search_response_base_item -> Yojson.Safe.t

val make_simple_document_search_response_base_item :
  document_id:string ->
  document_name:string ->
  file_type:string ->
  highlight:search_highlight ->
  node_id:string ->
  owner_id:string ->
  ?raw_content:string ->
  updated_at:string ->
  unit ->
  simple_document_search_response_base_item

type nonrec simple_document_search_response = {
  results : simple_document_search_response_base_item list;
      (** List containing results from documents.
Each item in the list is for a specific page/node of a document. *)
}

val simple_document_search_response_of_yojson :
  Yojson.Safe.t -> simple_document_search_response

val yojson_of_simple_document_search_response :
  simple_document_search_response -> Yojson.Safe.t

val make_simple_document_search_response :
  results:simple_document_search_response_base_item list ->
  unit ->
  simple_document_search_response

type nonrec simple_document_search_response_base_item_human_readable_timestamp = {
  document_id : string;  (** The document id *)
  document_name : string;  (** The document name *)
  file_type : string;  (** The file type *)
  highlight : search_highlight;  (** The highlights on the document *)
  node_id : string;  (** The node id *)
  owner_id : string;  (** The owner id *)
  raw_content : string option;  (** The raw content of the document *)
  updated_at : string;  (** The time the document was last updated *)
}

val simple_document_search_response_base_item_human_readable_timestamp_of_yojson :
  Yojson.Safe.t ->
  simple_document_search_response_base_item_human_readable_timestamp

val yojson_of_simple_document_search_response_base_item_human_readable_timestamp :
  simple_document_search_response_base_item_human_readable_timestamp ->
  Yojson.Safe.t

val make_simple_document_search_response_base_item_human_readable_timestamp :
  document_id:string ->
  document_name:string ->
  file_type:string ->
  highlight:search_highlight ->
  node_id:string ->
  owner_id:string ->
  ?raw_content:string ->
  updated_at:string ->
  unit ->
  simple_document_search_response_base_item_human_readable_timestamp

type nonrec simple_email_search_response_base_item = {
  bcc : string list;  (** The bcc *)
  cc : string list;  (** The cc *)
  highlight : search_highlight;  (** The highlights on the email *)
  labels : string list;  (** The labels *)
  link_id : string;  (** The link id *)
  message_id : string;  (** The message id *)
  recipients : string list;  (** The recipients *)
  sender : string;  (** The sender *)
  sent_at : string option;  (** The time the email was sent *)
  subject : string option;  (** The subject *)
  thread_id : string;  (** The thread id *)
  updated_at : string;  (** The time the email was last updated *)
  user_id : string;  (** The user id *)
}

val simple_email_search_response_base_item_of_yojson :
  Yojson.Safe.t -> simple_email_search_response_base_item

val yojson_of_simple_email_search_response_base_item :
  simple_email_search_response_base_item -> Yojson.Safe.t

val make_simple_email_search_response_base_item :
  bcc:string list ->
  cc:string list ->
  highlight:search_highlight ->
  labels:string list ->
  link_id:string ->
  message_id:string ->
  recipients:string list ->
  sender:string ->
  ?sent_at:string ->
  ?subject:string ->
  thread_id:string ->
  updated_at:string ->
  user_id:string ->
  unit ->
  simple_email_search_response_base_item

type nonrec simple_email_search_response = {
  results : simple_email_search_response_base_item list;
      (** List containing results from emails.
Each item in the list is for a specific message in an email thread. *)
}

val simple_email_search_response_of_yojson :
  Yojson.Safe.t -> simple_email_search_response

val yojson_of_simple_email_search_response :
  simple_email_search_response -> Yojson.Safe.t

val make_simple_email_search_response :
  results:simple_email_search_response_base_item list ->
  unit ->
  simple_email_search_response

type nonrec simple_email_search_response_base_item_human_readable_timestamp = {
  bcc : string list;  (** The bcc *)
  cc : string list;  (** The cc *)
  highlight : search_highlight;  (** The highlights on the email *)
  labels : string list;  (** The labels *)
  link_id : string;  (** The link id *)
  message_id : string;  (** The message id *)
  recipients : string list;  (** The recipients *)
  sender : string;  (** The sender *)
  sent_at : string option;  (** The time the email was sent *)
  subject : string option;  (** The subject *)
  thread_id : string;  (** The thread id *)
  updated_at : string;  (** The time the email was last updated *)
  user_id : string;  (** The user id *)
}

val simple_email_search_response_base_item_human_readable_timestamp_of_yojson :
  Yojson.Safe.t ->
  simple_email_search_response_base_item_human_readable_timestamp

val yojson_of_simple_email_search_response_base_item_human_readable_timestamp :
  simple_email_search_response_base_item_human_readable_timestamp ->
  Yojson.Safe.t

val make_simple_email_search_response_base_item_human_readable_timestamp :
  bcc:string list ->
  cc:string list ->
  highlight:search_highlight ->
  labels:string list ->
  link_id:string ->
  message_id:string ->
  recipients:string list ->
  sender:string ->
  ?sent_at:string ->
  ?subject:string ->
  thread_id:string ->
  updated_at:string ->
  user_id:string ->
  unit ->
  simple_email_search_response_base_item_human_readable_timestamp

type nonrec simple_project_search_response_base_item = {
  created_at : string;  (** The time the project was created *)
  highlight : search_highlight;  (** The highlights on the project *)
  project_id : string;  (** The project id *)
  project_name : string;  (** The project name *)
  updated_at : string;  (** The time the project was last updated *)
  user_id : string;  (** The id of the user who created the project *)
}

val simple_project_search_response_base_item_of_yojson :
  Yojson.Safe.t -> simple_project_search_response_base_item

val yojson_of_simple_project_search_response_base_item :
  simple_project_search_response_base_item -> Yojson.Safe.t

val make_simple_project_search_response_base_item :
  created_at:string ->
  highlight:search_highlight ->
  project_id:string ->
  project_name:string ->
  updated_at:string ->
  user_id:string ->
  unit ->
  simple_project_search_response_base_item

type nonrec simple_project_search_response = {
  results : simple_project_search_response_base_item list;
      (** List containing results from projects.
Each item in the list is for a specific project. *)
}

val simple_project_search_response_of_yojson :
  Yojson.Safe.t -> simple_project_search_response

val yojson_of_simple_project_search_response :
  simple_project_search_response -> Yojson.Safe.t

val make_simple_project_search_response :
  results:simple_project_search_response_base_item list ->
  unit ->
  simple_project_search_response

type nonrec simple_project_search_response_base_item_human_readable_timestamp = {
  created_at : string;  (** The time the project was created *)
  highlight : search_highlight;  (** The highlights on the project *)
  project_id : string;  (** The project id *)
  project_name : string;  (** The project name *)
  updated_at : string;  (** The time the project was last updated *)
  user_id : string;  (** The id of the user who created the project *)
}

val simple_project_search_response_base_item_human_readable_timestamp_of_yojson :
  Yojson.Safe.t ->
  simple_project_search_response_base_item_human_readable_timestamp

val yojson_of_simple_project_search_response_base_item_human_readable_timestamp :
  simple_project_search_response_base_item_human_readable_timestamp ->
  Yojson.Safe.t

val make_simple_project_search_response_base_item_human_readable_timestamp :
  created_at:string ->
  highlight:search_highlight ->
  project_id:string ->
  project_name:string ->
  updated_at:string ->
  user_id:string ->
  unit ->
  simple_project_search_response_base_item_human_readable_timestamp

type nonrec simple_search_response_item = {
  entity_id : string;  (** ID of the chat, channel, email, or document *)
  entity_type : string;
  goto : search_goto_content option;
  highlight : highlight;
  score : float option;
}
(** Simple response item to mimic what we get back from opensearch *)

val simple_search_response_item_of_yojson :
  Yojson.Safe.t -> simple_search_response_item

val yojson_of_simple_search_response_item :
  simple_search_response_item -> Yojson.Safe.t

val make_simple_search_response_item :
  entity_id:string ->
  entity_type:string ->
  ?goto:search_goto_content ->
  highlight:highlight ->
  ?score:float ->
  unit ->
  simple_search_response_item
(** Simple response item to mimic what we get back from opensearch *)

type nonrec simple_search_response = {
  results : simple_search_response_item list;
}
(** The response for simple search *)

val simple_search_response_of_yojson : Yojson.Safe.t -> simple_search_response
val yojson_of_simple_search_response : simple_search_response -> Yojson.Safe.t

val make_simple_search_response :
  results:simple_search_response_item list -> unit -> simple_search_response
(** The response for simple search *)

type nonrec simple_unified_search_response_base_item_human_readable_timestamp =
  | Document of
      simple_document_search_response_base_item_human_readable_timestamp
  | Chat of simple_chat_search_response_base_item_human_readable_timestamp
  | Email of simple_email_search_response_base_item_human_readable_timestamp
  | Channel of simple_channel_search_reponse_base_item_human_readable_timestamp
  | Project of simple_project_search_response_base_item_human_readable_timestamp
  | Call of
      simple_call_record_search_response_base_item_human_readable_timestamp
  | Calendar_event of
      simple_calendar_event_search_response_base_item_human_readable_timestamp
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val simple_unified_search_response_base_item_human_readable_timestamp_of_yojson :
  Yojson.Safe.t ->
  simple_unified_search_response_base_item_human_readable_timestamp

val yojson_of_simple_unified_search_response_base_item_human_readable_timestamp :
  simple_unified_search_response_base_item_human_readable_timestamp ->
  Yojson.Safe.t

type nonrec simple_unified_search_base_response = {
  results :
    simple_unified_search_response_base_item_human_readable_timestamp list;
}

val simple_unified_search_base_response_of_yojson :
  Yojson.Safe.t -> simple_unified_search_base_response

val yojson_of_simple_unified_search_base_response :
  simple_unified_search_base_response -> Yojson.Safe.t

val make_simple_unified_search_base_response :
  results:simple_unified_search_response_base_item_human_readable_timestamp list ->
  unit ->
  simple_unified_search_base_response

type nonrec simple_unified_search_response_base_item =
  | Document of
      simple_document_search_response_base_item_human_readable_timestamp
  | Chat of simple_chat_search_response_base_item_human_readable_timestamp
  | Email of simple_email_search_response_base_item_human_readable_timestamp
  | Channel of simple_channel_search_reponse_base_item_human_readable_timestamp
  | Project of simple_project_search_response_base_item_human_readable_timestamp
  | Call of
      simple_call_record_search_response_base_item_human_readable_timestamp
  | Calendar_event of
      simple_calendar_event_search_response_base_item_human_readable_timestamp
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val simple_unified_search_response_base_item_of_yojson :
  Yojson.Safe.t -> simple_unified_search_response_base_item

val yojson_of_simple_unified_search_response_base_item :
  simple_unified_search_response_base_item -> Yojson.Safe.t

(** How a query of several terms matches document content. *)
type nonrec term_matching =
  | All
  | Dynamic
  | Unknown of string  (** A value this SDK version does not know. *)

val term_matching_of_yojson : Yojson.Safe.t -> term_matching
val yojson_of_term_matching : term_matching -> Yojson.Safe.t

type nonrec unified_search_request = {
  calendar_event_scope : calendar_event_search_scope option;
      (** Which calendar events to search. Defaults to [own]: events on the
caller's own and delegated calendars. [shared_with_you] searches only
events shared with a channel the caller belongs to that are on none of
their calendars. *)
  collapse : bool option;
  filters : entity_filters option;
      (** Entity filters in the same shape as soup. Entity types with a NIL UUID in their primary ID field are excluded from search. *)
  include_crm : bool option;
      (** Opt in to searching the caller's team CRM companies (name/domain).
Off by default: CRM results are only included when this is true and
the caller has a qualifying team membership. CRM has no content
index, so it is searched only under Name / NameContent. *)
  match_type : match_type;
      (** How to match the search terms. 'exact' for precise case-sensitive phrase matches, 'partial' for prefix/partial matches. REQUIRED field. *)
  query : string;
      (** The search query string. Must not be empty; one character is enough. *)
  search_on : search_on option;
      (** Fields to search on (Name, Content, NameContent). Defaults to Content *)
  term_matching : term_matching option;
      (** How a query of several terms matches document content. Defaults to
[all], the strict AND that AI tools and the SDK rely on; the web
app's Search view asks for [dynamic]. *)
}

val unified_search_request_of_yojson : Yojson.Safe.t -> unified_search_request
val yojson_of_unified_search_request : unified_search_request -> Yojson.Safe.t

val make_unified_search_request :
  ?calendar_event_scope:calendar_event_search_scope ->
  ?collapse:bool ->
  ?filters:entity_filters ->
  ?include_crm:bool ->
  match_type:match_type ->
  query:string ->
  ?search_on:search_on ->
  ?term_matching:term_matching ->
  unit ->
  unified_search_request

type nonrec unified_search_response_item =
  | Document of {
      document_id : string;  (** The id of the document *)
      document_name : string;  (** The name of the document *)
      document_search_results : document_search_result list;
          (** The search results for the document
This may be empty if the search result match was on the document name only *)
      file_type : string option;  (** The file type of the document *)
      id : string;
          (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
      name : string;
      owner_id : string;
      sub_type : document_sub_type option;
      metadata : document_metadata option;
      properties : soup_property list option;
          (** Entity properties (assignees, status, priority, etc.) for markdown documents. *)
    }
  | Chat of {
      chat_id : string;  (** The id of the chat *)
      chat_search_results : chat_message_search_result list;
          (** The search results for the chat
This may be empty if the search result match was on the chat title only *)
      id : string;
          (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
      name : string;
      owner_id : string;
      user_id : string;  (** The id of the creator of the chat *)
      metadata : chat_metadata option;
      properties : soup_property list option;
          (** Entity properties (e.g. tags) on the chat. *)
    }
  | Email of {
      email_message_search_results : email_search_result list;
          (** The search results for the document
This may be empty if the search result match was on the email subject only *)
      id : string;
          (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
      link_id : string;
          (** The inbox that owns the thread. Drives the multi-inbox indicator
when the caller has more than one inbox. *)
      name : string option;  (** Subject of the email thread *)
      owner_id : string;
      participants : email_search_participant list;
          (** The participants (senders) in this email thread *)
      subject : string option;
          (** The subject of the email
This is only present if the search result is on the message content *)
      thread_id : string;  (** The id of the email thread *)
      user_id : string;  (** The id of the owner of the email thread *)
      created_at : string;
      inbox_visible : bool;
      is_draft : bool;
      is_important : bool;
      is_read : bool;
      properties : soup_property list option;
          (** Entity properties (e.g. tags) on the thread. *)
      snippet : string option;
      updated_at : string;
      viewed_at : string option;
    }
  | Channel_message of channel_message_search_response_item
  | Channel of channel_name_search_response_item
  | Project of {
      created_at : string;
      id : string;
          (** Standardized fields that all item types will share.
These field names are being aligned across all item types
for consistency in our data model. *)
      name : string;
      owner_id : string;
      project_search_results : project_search_result list;
      updated_at : string;
      metadata : project_metadata option;
      properties : soup_property list option;
          (** Entity properties (e.g. tags) on the project. *)
    }
  | Call of {
      call_id : string;
      call_search_results : call_record_search_result list;
      channel_id : string option;
      id : string;
      name : string option;
      owner_id : string;
      participant_ids : string list;
      metadata : call_record_metadata option;
      properties : soup_property list option;
          (** Entity properties (e.g. tags) on the call. *)
    }
  | Company of crm_company_search_response_item
  | Calendar_event of {
      calendar_event_search_results : calendar_event_search_result list;
      created_at : string;
      id : string;  (** Standardized fields that all item types will share. *)
      name : string;
      owner_id : string;
      updated_at : string;
      metadata : calendar_event_metadata option;
      properties : soup_property list option;
          (** Entity properties (e.g. tags) on the event. *)
    }
  | Agent_session of agent_session_search_response_item
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

val unified_search_response_item_of_yojson :
  Yojson.Safe.t -> unified_search_response_item

val yojson_of_unified_search_response_item :
  unified_search_response_item -> Yojson.Safe.t

val make_unified_search_response_item_document :
  document_id:string ->
  document_name:string ->
  document_search_results:document_search_result list ->
  ?file_type:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  ?sub_type:document_sub_type ->
  ?metadata:document_metadata ->
  ?properties:soup_property list ->
  unit ->
  unified_search_response_item

val make_unified_search_response_item_chat :
  chat_id:string ->
  chat_search_results:chat_message_search_result list ->
  id:string ->
  name:string ->
  owner_id:string ->
  user_id:string ->
  ?metadata:chat_metadata ->
  ?properties:soup_property list ->
  unit ->
  unified_search_response_item

val make_unified_search_response_item_email :
  email_message_search_results:email_search_result list ->
  id:string ->
  link_id:string ->
  ?name:string ->
  owner_id:string ->
  participants:email_search_participant list ->
  ?subject:string ->
  thread_id:string ->
  user_id:string ->
  created_at:string ->
  inbox_visible:bool ->
  is_draft:bool ->
  is_important:bool ->
  is_read:bool ->
  ?properties:soup_property list ->
  ?snippet:string ->
  updated_at:string ->
  ?viewed_at:string ->
  unit ->
  unified_search_response_item

val make_unified_search_response_item_project :
  created_at:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  project_search_results:project_search_result list ->
  updated_at:string ->
  ?metadata:project_metadata ->
  ?properties:soup_property list ->
  unit ->
  unified_search_response_item

val make_unified_search_response_item_call :
  call_id:string ->
  call_search_results:call_record_search_result list ->
  ?channel_id:string ->
  id:string ->
  ?name:string ->
  owner_id:string ->
  participant_ids:string list ->
  ?metadata:call_record_metadata ->
  ?properties:soup_property list ->
  unit ->
  unified_search_response_item

val make_unified_search_response_item_calendar_event :
  calendar_event_search_results:calendar_event_search_result list ->
  created_at:string ->
  id:string ->
  name:string ->
  owner_id:string ->
  updated_at:string ->
  ?metadata:calendar_event_metadata ->
  ?properties:soup_property list ->
  unit ->
  unified_search_response_item

type nonrec unified_search_response = {
  next_cursor : string option;
      (** The next cursor to use for paginating results *)
  results : unified_search_response_item list;  (** The search results *)
}

val unified_search_response_of_yojson : Yojson.Safe.t -> unified_search_response
val yojson_of_unified_search_response : unified_search_response -> Yojson.Safe.t

val make_unified_search_response :
  ?next_cursor:string ->
  results:unified_search_response_item list ->
  unit ->
  unified_search_response

type nonrec unified_search_response_item_document_type =
  | Document
  | Unknown of string  (** A value this SDK version does not know. *)

val unified_search_response_item_document_type_of_yojson :
  Yojson.Safe.t -> unified_search_response_item_document_type

val yojson_of_unified_search_response_item_document_type :
  unified_search_response_item_document_type -> Yojson.Safe.t

type nonrec unified_search_response_item_chat_type =
  | Chat
  | Unknown of string  (** A value this SDK version does not know. *)

val unified_search_response_item_chat_type_of_yojson :
  Yojson.Safe.t -> unified_search_response_item_chat_type

val yojson_of_unified_search_response_item_chat_type :
  unified_search_response_item_chat_type -> Yojson.Safe.t

type nonrec unified_search_response_item_email_type =
  | Email
  | Unknown of string  (** A value this SDK version does not know. *)

val unified_search_response_item_email_type_of_yojson :
  Yojson.Safe.t -> unified_search_response_item_email_type

val yojson_of_unified_search_response_item_email_type :
  unified_search_response_item_email_type -> Yojson.Safe.t

type nonrec unified_search_response_item_project_type =
  | Project
  | Unknown of string  (** A value this SDK version does not know. *)

val unified_search_response_item_project_type_of_yojson :
  Yojson.Safe.t -> unified_search_response_item_project_type

val yojson_of_unified_search_response_item_project_type :
  unified_search_response_item_project_type -> Yojson.Safe.t

type nonrec unified_search_response_item_call_type =
  | Call
  | Unknown of string  (** A value this SDK version does not know. *)

val unified_search_response_item_call_type_of_yojson :
  Yojson.Safe.t -> unified_search_response_item_call_type

val yojson_of_unified_search_response_item_call_type :
  unified_search_response_item_call_type -> Yojson.Safe.t

type nonrec unified_search_response_item_calendar_event_type =
  | Calendar_event
  | Unknown of string  (** A value this SDK version does not know. *)

val unified_search_response_item_calendar_event_type_of_yojson :
  Yojson.Safe.t -> unified_search_response_item_calendar_event_type

val yojson_of_unified_search_response_item_calendar_event_type :
  unified_search_response_item_calendar_event_type -> Yojson.Safe.t

val unified_search :
  page_size:int64 ->
  match_type:match_type ->
  query:string ->
  ?cursor:string ->
  ?calendar_event_scope:calendar_event_search_scope ->
  ?collapse:bool ->
  ?filters:entity_filters ->
  ?include_crm:bool ->
  ?search_on:search_on ->
  ?term_matching:term_matching ->
  unit ->
  (unified_search_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /search]

Perform a search through all items *)

val simple_unified_search :
  page_size:int64 ->
  match_type:match_type ->
  query:string ->
  ?cursor:string ->
  ?calendar_event_scope:calendar_event_search_scope ->
  ?collapse:bool ->
  ?filters:entity_filters ->
  ?include_crm:bool ->
  ?search_on:search_on ->
  ?term_matching:term_matching ->
  unit ->
  (simple_search_response, error_response) Macro_sdk_runtime.Request.t
(** [POST /search/simple]

Perform a search through all items.
This is a simple search where we do not group your results by entity id. *)
