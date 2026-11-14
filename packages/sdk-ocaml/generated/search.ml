(* Generated from packages/sdk/specs/search.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

(** Side of a folded conversation. *)
type nonrec agent_session_author =
  | User
  | Agent
  | Unknown of string  (** A value this SDK version does not know. *)

let agent_session_author_of_yojson : Yojson.Safe.t -> agent_session_author =
 fun json ->
  match Json.string json with
  | "user" -> User
  | "agent" -> Agent
  | other -> Unknown other

and yojson_of_agent_session_author : agent_session_author -> Yojson.Safe.t =
 fun value ->
  match value with
  | User -> `String "user"
  | Agent -> `String "agent"
  | Unknown other -> `String other

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

let agent_session_filters_of_yojson : Yojson.Safe.t -> agent_session_filters =
 fun json ->
  let fields = Json.obj json in
  {
    ids = Json.optional fields "ids" (Json.list Json.string);
    include_ = Json.optional fields "include" Json.bool;
    owners = Json.optional fields "owners" (Json.list Json.string);
  }

and yojson_of_agent_session_filters : agent_session_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("ids", Option.map (Json.of_list Json.of_string) value.ids);
      ("include", Option.map Json.of_bool value.include_);
      ("owners", Option.map (Json.of_list Json.of_string) value.owners);
    ]

let make_agent_session_filters ?ids ?include_ ?owners () =
  ({ ids; include_; owners } : agent_session_filters)

type nonrec search_goto_agent_session = {
  author : agent_session_author;  (** Author within the turn. *)
  message_turn : int;  (** Fold-assigned turn. *)
}
(** Stable navigation target from the fold, independent of raw ACP log IDs. *)

let search_goto_agent_session_of_yojson :
    Yojson.Safe.t -> search_goto_agent_session =
 fun json ->
  let fields = Json.obj json in
  {
    author = Json.required fields "author" agent_session_author_of_yojson;
    message_turn = Json.required fields "message_turn" Json.int;
  }

and yojson_of_search_goto_agent_session :
    search_goto_agent_session -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("author", Some (yojson_of_agent_session_author value.author));
      ("message_turn", Some (Json.of_int value.message_turn));
    ]

let make_search_goto_agent_session ~(author : agent_session_author)
    ~(message_turn : int) () =
  ({ author; message_turn } : search_goto_agent_session)

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

let search_highlight_of_yojson : Yojson.Safe.t -> search_highlight =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.optional fields "bcc" (Json.list Json.string);
    cc = Json.optional fields "cc" (Json.list Json.string);
    content = Json.optional fields "content" (Json.list Json.string);
    name = Json.optional fields "name" Json.string;
    recipients = Json.optional fields "recipients" (Json.list Json.string);
    sender = Json.optional fields "sender" Json.string;
    user_id = Json.optional fields "user_id" Json.string;
  }

and yojson_of_search_highlight : search_highlight -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Option.map (Json.of_list Json.of_string) value.bcc);
      ("cc", Option.map (Json.of_list Json.of_string) value.cc);
      ("content", Option.map (Json.of_list Json.of_string) value.content);
      ("name", Option.map Json.of_string value.name);
      ("recipients", Option.map (Json.of_list Json.of_string) value.recipients);
      ("sender", Option.map Json.of_string value.sender);
      ("user_id", Option.map Json.of_string value.user_id);
    ]

let make_search_highlight ?bcc ?cc ?content ?name ?recipients ?sender ?user_id
    () =
  ({ bcc; cc; content; name; recipients; sender; user_id } : search_highlight)

type nonrec agent_session_search_result = {
  goto : search_goto_agent_session option;
  highlight : search_highlight;  (** Matched name/content fragments. *)
  score : float option;  (** Search score. *)
}
(** A name match or one matching folded message. *)

let agent_session_search_result_of_yojson :
    Yojson.Safe.t -> agent_session_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    goto = Json.optional fields "goto" search_goto_agent_session_of_yojson;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    score = Json.optional fields "score" Json.float;
  }

and yojson_of_agent_session_search_result :
    agent_session_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("goto", Option.map yojson_of_search_goto_agent_session value.goto);
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("score", Option.map Json.of_float value.score);
    ]

let make_agent_session_search_result ?goto ~(highlight : search_highlight)
    ?score () =
  ({ goto; highlight; score } : agent_session_search_result)

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

let agent_session_search_response_item_of_yojson :
    Yojson.Safe.t -> agent_session_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    agent_session_search_results =
      Json.required fields "agent_session_search_results"
        (Json.list agent_session_search_result_of_yojson);
    bot_id = Json.required fields "bot_id" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_agent_session_search_response_item :
    agent_session_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "agent_session_search_results",
        Some
          ((Json.of_list yojson_of_agent_session_search_result)
             value.agent_session_search_results) );
      ("bot_id", Some (Json.of_string value.bot_id));
      ("created_at", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_agent_session_search_response_item
    ~(agent_session_search_results : agent_session_search_result list)
    ~(bot_id : string) ~(created_at : string) ~(id : string) ~(name : string)
    ~(owner_id : string) ~(updated_at : string) () =
  ({
     agent_session_search_results;
     bot_id;
     created_at;
     id;
     name;
     owner_id;
     updated_at;
   }
    : agent_session_search_response_item)

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

let calendar_event_filters_of_yojson : Yojson.Safe.t -> calendar_event_filters =
 fun json ->
  let fields = Json.obj json in
  {
    attendees = Json.optional fields "attendees" (Json.list Json.string);
    calendar_event_ids =
      Json.optional fields "calendar_event_ids" (Json.list Json.string);
    ends_after = Json.optional fields "ends_after" Json.string;
    organizers = Json.optional fields "organizers" (Json.list Json.string);
    starts_before = Json.optional fields "starts_before" Json.string;
    statuses = Json.optional fields "statuses" (Json.list Json.string);
  }

and yojson_of_calendar_event_filters : calendar_event_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attendees", Option.map (Json.of_list Json.of_string) value.attendees);
      ( "calendar_event_ids",
        Option.map (Json.of_list Json.of_string) value.calendar_event_ids );
      ("ends_after", Option.map Json.of_string value.ends_after);
      ("organizers", Option.map (Json.of_list Json.of_string) value.organizers);
      ("starts_before", Option.map Json.of_string value.starts_before);
      ("statuses", Option.map (Json.of_list Json.of_string) value.statuses);
    ]

let make_calendar_event_filters ?attendees ?calendar_event_ids ?ends_after
    ?organizers ?starts_before ?statuses () =
  ({
     attendees;
     calendar_event_ids;
     ends_after;
     organizers;
     starts_before;
     statuses;
   }
    : calendar_event_filters)

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

let calendar_event_search_time_of_yojson :
    Yojson.Safe.t -> calendar_event_search_time =
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
  | _ -> Unknown json

and yojson_of_calendar_event_search_time :
    calendar_event_search_time -> Yojson.Safe.t =
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

let make_calendar_event_search_time_timed ~(ends_at : string)
    ~(starts_at : string) ?time_zone () =
  (Timed { ends_at; starts_at; time_zone } : calendar_event_search_time)

let make_calendar_event_search_time_all_day ~(end_date : string)
    ~(start_date : string) () =
  (All_day { end_date; start_date } : calendar_event_search_time)

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

let calendar_event_search_occurrence_of_yojson :
    Yojson.Safe.t -> calendar_event_search_occurrence =
 fun json ->
  let fields = Json.obj json in
  {
    occurrence_key = Json.required fields "occurrenceKey" Json.string;
    time = Json.required fields "time" calendar_event_search_time_of_yojson;
  }

and yojson_of_calendar_event_search_occurrence :
    calendar_event_search_occurrence -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("occurrenceKey", Some (Json.of_string value.occurrence_key));
      ("time", Some (yojson_of_calendar_event_search_time value.time));
    ]

let make_calendar_event_search_occurrence ~(occurrence_key : string)
    ~(time : calendar_event_search_time) () =
  ({ occurrence_key; time } : calendar_event_search_occurrence)

type nonrec calendar_event_organizer = {
  email : string option;  (** Organizer email address, when known. *)
  name : string option;  (** Display name, when the source provided one. *)
}
(** The organizer the provider names on the event. Either field can be absent
when the source does not name it. On a read-only Outlook calendar, such as
its holidays, Microsoft names the mailbox owner on every event, so this
does not say the user organized anything: [role] does. *)

let calendar_event_organizer_of_yojson :
    Yojson.Safe.t -> calendar_event_organizer =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.optional fields "email" Json.string;
    name = Json.optional fields "name" Json.string;
  }

and yojson_of_calendar_event_organizer :
    calendar_event_organizer -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Option.map Json.of_string value.email);
      ("name", Option.map Json.of_string value.name);
    ]

let make_calendar_event_organizer ?email ?name () =
  ({ email; name } : calendar_event_organizer)

(** What the user is on one copy of an event, through the inbox holding it. *)
type nonrec calendar_event_search_role =
  | Organizer
  | Guest
  | Unknown of string  (** A value this SDK version does not know. *)

let calendar_event_search_role_of_yojson :
    Yojson.Safe.t -> calendar_event_search_role =
 fun json ->
  match Json.string json with
  | "organizer" -> Organizer
  | "guest" -> Guest
  | other -> Unknown other

and yojson_of_calendar_event_search_role :
    calendar_event_search_role -> Yojson.Safe.t =
 fun value ->
  match value with
  | Organizer -> `String "organizer"
  | Guest -> `String "guest"
  | Unknown other -> `String other

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

let calendar_event_metadata_of_yojson : Yojson.Safe.t -> calendar_event_metadata
    =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_name = Json.optional fields "calendarName" Json.string;
    conference_url = Json.optional fields "conferenceUrl" Json.string;
    contributes_to_availability =
      Json.optional fields "contributesToAvailability" Json.bool;
    created_at = Json.required fields "createdAt" Json.string;
    description = Json.optional fields "description" Json.string;
    inbox = Json.optional fields "inbox" Json.string;
    is_read_only = Json.required fields "isReadOnly" Json.bool;
    is_recurring = Json.required fields "isRecurring" Json.bool;
    occurrence =
      Json.optional fields "occurrence"
        calendar_event_search_occurrence_of_yojson;
    organizer =
      Json.optional fields "organizer" calendar_event_organizer_of_yojson;
    role = Json.optional fields "role" calendar_event_search_role_of_yojson;
    status = Json.required fields "status" Json.string;
    time = Json.required fields "time" calendar_event_search_time_of_yojson;
    updated_at = Json.required fields "updatedAt" Json.string;
  }

and yojson_of_calendar_event_metadata : calendar_event_metadata -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("calendarName", Option.map Json.of_string value.calendar_name);
      ("conferenceUrl", Option.map Json.of_string value.conference_url);
      ( "contributesToAvailability",
        Option.map Json.of_bool value.contributes_to_availability );
      ("createdAt", Some (Json.of_string value.created_at));
      ("description", Option.map Json.of_string value.description);
      ("inbox", Option.map Json.of_string value.inbox);
      ("isReadOnly", Some (Json.of_bool value.is_read_only));
      ("isRecurring", Some (Json.of_bool value.is_recurring));
      ( "occurrence",
        Option.map yojson_of_calendar_event_search_occurrence value.occurrence
      );
      ( "organizer",
        Option.map yojson_of_calendar_event_organizer value.organizer );
      ("role", Option.map yojson_of_calendar_event_search_role value.role);
      ("status", Some (Json.of_string value.status));
      ("time", Some (yojson_of_calendar_event_search_time value.time));
      ("updatedAt", Some (Json.of_string value.updated_at));
    ]

let make_calendar_event_metadata ?calendar_name ?conference_url
    ?contributes_to_availability ~(created_at : string) ?description ?inbox
    ~(is_read_only : bool) ~(is_recurring : bool) ?occurrence ?organizer ?role
    ~(status : string) ~(time : calendar_event_search_time)
    ~(updated_at : string) () =
  ({
     calendar_name;
     conference_url;
     contributes_to_availability;
     created_at;
     description;
     inbox;
     is_read_only;
     is_recurring;
     occurrence;
     organizer;
     role;
     status;
     time;
     updated_at;
   }
    : calendar_event_metadata)

type nonrec calendar_event_search_result = {
  highlight : search_highlight;
  score : float option;  (** The score of the result *)
}

let calendar_event_search_result_of_yojson :
    Yojson.Safe.t -> calendar_event_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    score = Json.optional fields "score" Json.float;
  }

and yojson_of_calendar_event_search_result :
    calendar_event_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("score", Option.map Json.of_float value.score);
    ]

let make_calendar_event_search_result ~(highlight : search_highlight) ?score ()
    =
  ({ highlight; score } : calendar_event_search_result)

type nonrec calendar_event_search_response_item = {
  calendar_event_search_results : calendar_event_search_result list;
  created_at : string;
  id : string;  (** Standardized fields that all item types will share. *)
  name : string;
  owner_id : string;
  updated_at : string;
}
(** A single response item, part of the CalendarEventSearchResponse object *)

let calendar_event_search_response_item_of_yojson :
    Yojson.Safe.t -> calendar_event_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_event_search_results =
      Json.required fields "calendar_event_search_results"
        (Json.list calendar_event_search_result_of_yojson);
    created_at = Json.required fields "created_at" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_calendar_event_search_response_item :
    calendar_event_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "calendar_event_search_results",
        Some
          ((Json.of_list yojson_of_calendar_event_search_result)
             value.calendar_event_search_results) );
      ("created_at", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_calendar_event_search_response_item
    ~(calendar_event_search_results : calendar_event_search_result list)
    ~(created_at : string) ~(id : string) ~(name : string) ~(owner_id : string)
    ~(updated_at : string) () =
  ({ calendar_event_search_results; created_at; id; name; owner_id; updated_at }
    : calendar_event_search_response_item)

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

type nonrec soup_property = {
  definition : property_definition;  (** The property definition *)
  id : string;
      (** Globally unique id of the assignment attaching this property to an entity. *)
  value : property_value option;
}
(** A property attached to a Soup item.

This is a simplified representation that includes only the definition and value,
omitting the entity property assignment metadata and options. *)

let soup_property_of_yojson : Yojson.Safe.t -> soup_property =
 fun json ->
  let fields = Json.obj json in
  {
    definition = Json.required fields "definition" property_definition_of_yojson;
    id = Json.required fields "id" Json.string;
    value = Json.optional fields "value" property_value_of_yojson;
  }

and yojson_of_soup_property : soup_property -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("definition", Some (yojson_of_property_definition value.definition));
      ("id", Some (Json.of_string value.id));
      ("value", Option.map yojson_of_property_value value.value);
    ]

let make_soup_property ~(definition : property_definition) ~(id : string) ?value
    () =
  ({ definition; id; value } : soup_property)

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

let calendar_event_search_response_item_with_metadata_of_yojson :
    Yojson.Safe.t -> calendar_event_search_response_item_with_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_event_search_results =
      Json.required fields "calendar_event_search_results"
        (Json.list calendar_event_search_result_of_yojson);
    created_at = Json.required fields "created_at" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    metadata = Json.optional fields "metadata" calendar_event_metadata_of_yojson;
    properties =
      Json.optional fields "properties" (Json.list soup_property_of_yojson);
  }

and yojson_of_calendar_event_search_response_item_with_metadata :
    calendar_event_search_response_item_with_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "calendar_event_search_results",
        Some
          ((Json.of_list yojson_of_calendar_event_search_result)
             value.calendar_event_search_results) );
      ("created_at", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("metadata", Option.map yojson_of_calendar_event_metadata value.metadata);
      ( "properties",
        Option.map (Json.of_list yojson_of_soup_property) value.properties );
    ]

let make_calendar_event_search_response_item_with_metadata
    ~(calendar_event_search_results : calendar_event_search_result list)
    ~(created_at : string) ~(id : string) ~(name : string) ~(owner_id : string)
    ~(updated_at : string) ?metadata ?properties () =
  ({
     calendar_event_search_results;
     created_at;
     id;
     name;
     owner_id;
     updated_at;
     metadata;
     properties;
   }
    : calendar_event_search_response_item_with_metadata)

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

let calendar_event_search_scope_of_yojson :
    Yojson.Safe.t -> calendar_event_search_scope =
 fun json ->
  match Json.string json with
  | "own" -> Own
  | "shared_with_you" -> Shared_with_you
  | other -> Unknown other

and yojson_of_calendar_event_search_scope :
    calendar_event_search_scope -> Yojson.Safe.t =
 fun value ->
  match value with
  | Own -> `String "own"
  | Shared_with_you -> `String "shared_with_you"
  | Unknown other -> `String other

(** Viewer-relative attendance status for a call record.
Serializes as [ATTENDED], [MISSED], or [UNATTENDED]. *)
type nonrec call_status =
  | Attended
  | Missed
  | Unattended
  | Unknown of string  (** A value this SDK version does not know. *)

let call_status_of_yojson : Yojson.Safe.t -> call_status =
 fun json ->
  match Json.string json with
  | "ATTENDED" -> Attended
  | "MISSED" -> Missed
  | "UNATTENDED" -> Unattended
  | other -> Unknown other

and yojson_of_call_status : call_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Attended -> `String "ATTENDED"
  | Missed -> `String "MISSED"
  | Unattended -> `String "UNATTENDED"
  | Unknown other -> `String other

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

let call_filters_of_yojson : Yojson.Safe.t -> call_filters =
 fun json ->
  let fields = Json.obj json in
  {
    attended = Json.optional fields "attended" Json.bool;
    call_ids = Json.optional fields "call_ids" (Json.list Json.string);
    channel_ids = Json.optional fields "channel_ids" (Json.list Json.string);
    speaker_ids = Json.optional fields "speaker_ids" (Json.list Json.string);
    status = Json.optional fields "status" call_status_of_yojson;
  }

and yojson_of_call_filters : call_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attended", Option.map Json.of_bool value.attended);
      ("call_ids", Option.map (Json.of_list Json.of_string) value.call_ids);
      ("channel_ids", Option.map (Json.of_list Json.of_string) value.channel_ids);
      ("speaker_ids", Option.map (Json.of_list Json.of_string) value.speaker_ids);
      ("status", Option.map yojson_of_call_status value.status);
    ]

let make_call_filters ?attended ?call_ids ?channel_ids ?speaker_ids ?status () =
  ({ attended; call_ids; channel_ids; speaker_ids; status } : call_filters)

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

let call_record_metadata_of_yojson : Yojson.Safe.t -> call_record_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    attended = Json.required fields "attended" Json.bool;
    channel_name = Json.optional fields "channel_name" Json.string;
    created_by = Json.required fields "created_by" Json.string;
    duration_ms = Json.required fields "duration_ms" Json.int64;
    ended_at = Json.required fields "ended_at" Json.string;
    started_at = Json.required fields "started_at" Json.string;
    status = Json.required fields "status" call_status_of_yojson;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_call_record_metadata : call_record_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attended", Some (Json.of_bool value.attended));
      ("channel_name", Option.map Json.of_string value.channel_name);
      ("created_by", Some (Json.of_string value.created_by));
      ("duration_ms", Some (Json.of_int64 value.duration_ms));
      ("ended_at", Some (Json.of_string value.ended_at));
      ("started_at", Some (Json.of_string value.started_at));
      ("status", Some (yojson_of_call_status value.status));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_call_record_metadata ~(attended : bool) ?channel_name
    ~(created_by : string) ~(duration_ms : int64) ~(ended_at : string)
    ~(started_at : string) ~(status : call_status) ~(updated_at : string) () =
  ({
     attended;
     channel_name;
     created_by;
     duration_ms;
     ended_at;
     started_at;
     status;
     updated_at;
   }
    : call_record_metadata)

type nonrec call_record_search_result = {
  ended_at : string option;
  highlight : search_highlight;
  score : float option;
  sequence_num : int option;
  speaker_id : string option;
  started_at : string option;
  transcript_id : string option;
}

let call_record_search_result_of_yojson :
    Yojson.Safe.t -> call_record_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    ended_at = Json.optional fields "ended_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    score = Json.optional fields "score" Json.float;
    sequence_num = Json.optional fields "sequence_num" Json.int;
    speaker_id = Json.optional fields "speaker_id" Json.string;
    started_at = Json.optional fields "started_at" Json.string;
    transcript_id = Json.optional fields "transcript_id" Json.string;
  }

and yojson_of_call_record_search_result :
    call_record_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("ended_at", Option.map Json.of_string value.ended_at);
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("score", Option.map Json.of_float value.score);
      ("sequence_num", Option.map Json.of_int value.sequence_num);
      ("speaker_id", Option.map Json.of_string value.speaker_id);
      ("started_at", Option.map Json.of_string value.started_at);
      ("transcript_id", Option.map Json.of_string value.transcript_id);
    ]

let make_call_record_search_result ?ended_at ~(highlight : search_highlight)
    ?score ?sequence_num ?speaker_id ?started_at ?transcript_id () =
  ({
     ended_at;
     highlight;
     score;
     sequence_num;
     speaker_id;
     started_at;
     transcript_id;
   }
    : call_record_search_result)

type nonrec call_record_search_response_item = {
  call_id : string;
  call_search_results : call_record_search_result list;
  channel_id : string option;
  id : string;
  name : string option;
  owner_id : string;
  participant_ids : string list;
}

let call_record_search_response_item_of_yojson :
    Yojson.Safe.t -> call_record_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    call_id = Json.required fields "call_id" Json.string;
    call_search_results =
      Json.required fields "call_search_results"
        (Json.list call_record_search_result_of_yojson);
    channel_id = Json.optional fields "channel_id" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.optional fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    participant_ids =
      Json.required fields "participant_ids" (Json.list Json.string);
  }

and yojson_of_call_record_search_response_item :
    call_record_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("call_id", Some (Json.of_string value.call_id));
      ( "call_search_results",
        Some
          ((Json.of_list yojson_of_call_record_search_result)
             value.call_search_results) );
      ("channel_id", Option.map Json.of_string value.channel_id);
      ("id", Some (Json.of_string value.id));
      ("name", Option.map Json.of_string value.name);
      ("owner_id", Some (Json.of_string value.owner_id));
      ( "participant_ids",
        Some ((Json.of_list Json.of_string) value.participant_ids) );
    ]

let make_call_record_search_response_item ~(call_id : string)
    ~(call_search_results : call_record_search_result list) ?channel_id
    ~(id : string) ?name ~(owner_id : string) ~(participant_ids : string list)
    () =
  ({
     call_id;
     call_search_results;
     channel_id;
     id;
     name;
     owner_id;
     participant_ids;
   }
    : call_record_search_response_item)

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

let call_record_search_response_item_with_metadata_of_yojson :
    Yojson.Safe.t -> call_record_search_response_item_with_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    call_id = Json.required fields "call_id" Json.string;
    call_search_results =
      Json.required fields "call_search_results"
        (Json.list call_record_search_result_of_yojson);
    channel_id = Json.optional fields "channel_id" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.optional fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    participant_ids =
      Json.required fields "participant_ids" (Json.list Json.string);
    metadata = Json.optional fields "metadata" call_record_metadata_of_yojson;
    properties =
      Json.optional fields "properties" (Json.list soup_property_of_yojson);
  }

and yojson_of_call_record_search_response_item_with_metadata :
    call_record_search_response_item_with_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("call_id", Some (Json.of_string value.call_id));
      ( "call_search_results",
        Some
          ((Json.of_list yojson_of_call_record_search_result)
             value.call_search_results) );
      ("channel_id", Option.map Json.of_string value.channel_id);
      ("id", Some (Json.of_string value.id));
      ("name", Option.map Json.of_string value.name);
      ("owner_id", Some (Json.of_string value.owner_id));
      ( "participant_ids",
        Some ((Json.of_list Json.of_string) value.participant_ids) );
      ("metadata", Option.map yojson_of_call_record_metadata value.metadata);
      ( "properties",
        Option.map (Json.of_list yojson_of_soup_property) value.properties );
    ]

let make_call_record_search_response_item_with_metadata ~(call_id : string)
    ~(call_search_results : call_record_search_result list) ?channel_id
    ~(id : string) ?name ~(owner_id : string) ~(participant_ids : string list)
    ?metadata ?properties () =
  ({
     call_id;
     call_search_results;
     channel_id;
     id;
     name;
     owner_id;
     participant_ids;
     metadata;
     properties;
   }
    : call_record_search_response_item_with_metadata)

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

type nonrec notification_filters = {
  states : notification_state list option;
      (** Include entities with a non-deleted notification in any of these exact states.
Empty means no notification restriction. Active means `\[unseen, seen\]`. *)
}
(** Notification-level filters that apply to an entity type. *)

let notification_filters_of_yojson : Yojson.Safe.t -> notification_filters =
 fun json ->
  let fields = Json.obj json in
  {
    states =
      Json.optional fields "states" (Json.list notification_state_of_yojson);
  }

and yojson_of_notification_filters : notification_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "states",
        Option.map (Json.of_list yojson_of_notification_state) value.states );
    ]

let make_notification_filters ?states () = ({ states } : notification_filters)

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

let channel_filters_of_yojson : Yojson.Safe.t -> channel_filters =
 fun json ->
  let fields = Json.obj json in
  {
    channel_ids = Json.optional fields "channel_ids" (Json.list Json.string);
    channel_types = Json.optional fields "channel_types" (Json.list Json.string);
    importance = Json.optional fields "importance" Json.bool;
    is_participant = Json.optional fields "is_participant" Json.bool;
    mentions = Json.optional fields "mentions" (Json.list Json.string);
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    org_id = Json.optional fields "org_id" Json.int64;
    sender_ids = Json.optional fields "sender_ids" (Json.list Json.string);
    team_id = Json.optional fields "team_id" Json.string;
    thread_ids = Json.optional fields "thread_ids" (Json.list Json.string);
  }

and yojson_of_channel_filters : channel_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_ids", Option.map (Json.of_list Json.of_string) value.channel_ids);
      ( "channel_types",
        Option.map (Json.of_list Json.of_string) value.channel_types );
      ("importance", Option.map Json.of_bool value.importance);
      ("is_participant", Option.map Json.of_bool value.is_participant);
      ("mentions", Option.map (Json.of_list Json.of_string) value.mentions);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("org_id", Option.map Json.of_int64 value.org_id);
      ("sender_ids", Option.map (Json.of_list Json.of_string) value.sender_ids);
      ("team_id", Option.map Json.of_string value.team_id);
      ("thread_ids", Option.map (Json.of_list Json.of_string) value.thread_ids);
    ]

let make_channel_filters ?channel_ids ?channel_types ?importance ?is_participant
    ?mentions ?notification_filters ?org_id ?sender_ids ?team_id ?thread_ids ()
    =
  ({
     channel_ids;
     channel_types;
     importance;
     is_participant;
     mentions;
     notification_filters;
     org_id;
     sender_ids;
     team_id;
     thread_ids;
   }
    : channel_filters)

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

let channel_message_search_response_item_of_yojson :
    Yojson.Safe.t -> channel_message_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    channel_id = Json.required fields "channel_id" Json.string;
    channel_type = Json.required fields "channel_type" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    deleted_at = Json.optional fields "deleted_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    id = Json.required fields "id" Json.string;
    message_id = Json.required fields "message_id" Json.string;
    owner_id = Json.optional fields "owner_id" Json.string;
    score = Json.optional fields "score" Json.float;
    sender_id = Json.required fields "sender_id" Json.string;
    thread_id = Json.optional fields "thread_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_channel_message_search_response_item :
    channel_message_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_id", Some (Json.of_string value.channel_id));
      ("channel_type", Some (Json.of_string value.channel_type));
      ("created_at", Some (Json.of_string value.created_at));
      ("deleted_at", Option.map Json.of_string value.deleted_at);
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("id", Some (Json.of_string value.id));
      ("message_id", Some (Json.of_string value.message_id));
      ("owner_id", Option.map Json.of_string value.owner_id);
      ("score", Option.map Json.of_float value.score);
      ("sender_id", Some (Json.of_string value.sender_id));
      ("thread_id", Option.map Json.of_string value.thread_id);
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_channel_message_search_response_item ~(channel_id : string)
    ~(channel_type : string) ~(created_at : string) ?deleted_at
    ~(highlight : search_highlight) ~(id : string) ~(message_id : string)
    ?owner_id ?score ~(sender_id : string) ?thread_id ~(updated_at : string) ()
    =
  ({
     channel_id;
     channel_type;
     created_at;
     deleted_at;
     highlight;
     id;
     message_id;
     owner_id;
     score;
     sender_id;
     thread_id;
     updated_at;
   }
    : channel_message_search_response_item)

type nonrec channel_metadata = {
  created_at : string;
  interacted_at : string option;
  updated_at : string;
  viewed_at : string option;
}
(** Metadata for a channel fetched from the database *)

let channel_metadata_of_yojson : Yojson.Safe.t -> channel_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    interacted_at = Json.optional fields "interacted_at" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    viewed_at = Json.optional fields "viewed_at" Json.string;
  }

and yojson_of_channel_metadata : channel_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("interacted_at", Option.map Json.of_string value.interacted_at);
      ("updated_at", Some (Json.of_string value.updated_at));
      ("viewed_at", Option.map Json.of_string value.viewed_at);
    ]

let make_channel_metadata ~(created_at : string) ?interacted_at
    ~(updated_at : string) ?viewed_at () =
  ({ created_at; interacted_at; updated_at; viewed_at } : channel_metadata)

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

let channel_name_search_response_item_of_yojson :
    Yojson.Safe.t -> channel_name_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    channel_id = Json.required fields "channel_id" Json.string;
    channel_type = Json.required fields "channel_type" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    id = Json.required fields "id" Json.string;
    metadata = Json.optional fields "metadata" channel_metadata_of_yojson;
    owner_id = Json.optional fields "owner_id" Json.string;
    score = Json.optional fields "score" Json.float;
  }

and yojson_of_channel_name_search_response_item :
    channel_name_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_id", Some (Json.of_string value.channel_id));
      ("channel_type", Some (Json.of_string value.channel_type));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("id", Some (Json.of_string value.id));
      ("metadata", Option.map yojson_of_channel_metadata value.metadata);
      ("owner_id", Option.map Json.of_string value.owner_id);
      ("score", Option.map Json.of_float value.score);
    ]

let make_channel_name_search_response_item ~(channel_id : string)
    ~(channel_type : string) ~(highlight : search_highlight) ~(id : string)
    ?metadata ?owner_id ?score () =
  ({ channel_id; channel_type; highlight; id; metadata; owner_id; score }
    : channel_name_search_response_item)

type nonrec match_type =
  | Exact
  | Partial
  | Regexp
  | Query
  | Unknown of string  (** A value this SDK version does not know. *)

let match_type_of_yojson : Yojson.Safe.t -> match_type =
 fun json ->
  match Json.string json with
  | "exact" -> Exact
  | "partial" -> Partial
  | "regexp" -> Regexp
  | "query" -> Query
  | other -> Unknown other

and yojson_of_match_type : match_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Exact -> `String "exact"
  | Partial -> `String "partial"
  | Regexp -> `String "regexp"
  | Query -> `String "query"
  | Unknown other -> `String other

type nonrec search_on =
  | Name
  | Content
  | Name_content
  | Unknown of string  (** A value this SDK version does not know. *)

let search_on_of_yojson : Yojson.Safe.t -> search_on =
 fun json ->
  match Json.string json with
  | "name" -> Name
  | "content" -> Content
  | "name_content" -> Name_content
  | other -> Unknown other

and yojson_of_search_on : search_on -> Yojson.Safe.t =
 fun value ->
  match value with
  | Name -> `String "name"
  | Content -> `String "content"
  | Name_content -> `String "name_content"
  | Unknown other -> `String other

(** Sort key for channel content search results. *)
type nonrec channel_sort_timestamp =
  | Message
  | Thread
  | Unknown of string  (** A value this SDK version does not know. *)

let channel_sort_timestamp_of_yojson : Yojson.Safe.t -> channel_sort_timestamp =
 fun json ->
  match Json.string json with
  | "message" -> Message
  | "thread" -> Thread
  | other -> Unknown other

and yojson_of_channel_sort_timestamp : channel_sort_timestamp -> Yojson.Safe.t =
 fun value ->
  match value with
  | Message -> `String "message"
  | Thread -> `String "thread"
  | Unknown other -> `String other

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

let channel_search_request_of_yojson : Yojson.Safe.t -> channel_search_request =
 fun json ->
  let fields = Json.obj json in
  {
    channel_ids = Json.optional fields "channel_ids" (Json.list Json.string);
    channel_types = Json.optional fields "channel_types" (Json.list Json.string);
    importance = Json.optional fields "importance" Json.bool;
    is_participant = Json.optional fields "is_participant" Json.bool;
    mentions = Json.optional fields "mentions" (Json.list Json.string);
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    org_id = Json.optional fields "org_id" Json.int64;
    sender_ids = Json.optional fields "sender_ids" (Json.list Json.string);
    team_id = Json.optional fields "team_id" Json.string;
    thread_ids = Json.optional fields "thread_ids" (Json.list Json.string);
    collapse = Json.optional fields "collapse" Json.bool;
    match_type = Json.required fields "match_type" match_type_of_yojson;
    query = Json.optional fields "query" Json.string;
    search_on = Json.optional fields "search_on" search_on_of_yojson;
    sort = Json.optional fields "sort" channel_sort_timestamp_of_yojson;
    terms = Json.optional fields "terms" (Json.list Json.string);
  }

and yojson_of_channel_search_request : channel_search_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_ids", Option.map (Json.of_list Json.of_string) value.channel_ids);
      ( "channel_types",
        Option.map (Json.of_list Json.of_string) value.channel_types );
      ("importance", Option.map Json.of_bool value.importance);
      ("is_participant", Option.map Json.of_bool value.is_participant);
      ("mentions", Option.map (Json.of_list Json.of_string) value.mentions);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("org_id", Option.map Json.of_int64 value.org_id);
      ("sender_ids", Option.map (Json.of_list Json.of_string) value.sender_ids);
      ("team_id", Option.map Json.of_string value.team_id);
      ("thread_ids", Option.map (Json.of_list Json.of_string) value.thread_ids);
      ("collapse", Option.map Json.of_bool value.collapse);
      ("match_type", Some (yojson_of_match_type value.match_type));
      ("query", Option.map Json.of_string value.query);
      ("search_on", Option.map yojson_of_search_on value.search_on);
      ("sort", Option.map yojson_of_channel_sort_timestamp value.sort);
      ("terms", Option.map (Json.of_list Json.of_string) value.terms);
    ]

let make_channel_search_request ?channel_ids ?channel_types ?importance
    ?is_participant ?mentions ?notification_filters ?org_id ?sender_ids ?team_id
    ?thread_ids ?collapse ~(match_type : match_type) ?query ?search_on ?sort
    ?terms () =
  ({
     channel_ids;
     channel_types;
     importance;
     is_participant;
     mentions;
     notification_filters;
     org_id;
     sender_ids;
     team_id;
     thread_ids;
     collapse;
     match_type;
     query;
     search_on;
     sort;
     terms;
   }
    : channel_search_request)

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

let channel_search_result_of_yojson : Yojson.Safe.t -> channel_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.optional fields "created_at" Json.string;
    deleted_at = Json.optional fields "deleted_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    message_id = Json.optional fields "message_id" Json.string;
    score = Json.optional fields "score" Json.float;
    sender_id = Json.optional fields "sender_id" Json.string;
    thread_id = Json.optional fields "thread_id" Json.string;
    updated_at = Json.optional fields "updated_at" Json.string;
  }

and yojson_of_channel_search_result : channel_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Option.map Json.of_string value.created_at);
      ("deleted_at", Option.map Json.of_string value.deleted_at);
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("message_id", Option.map Json.of_string value.message_id);
      ("score", Option.map Json.of_float value.score);
      ("sender_id", Option.map Json.of_string value.sender_id);
      ("thread_id", Option.map Json.of_string value.thread_id);
      ("updated_at", Option.map Json.of_string value.updated_at);
    ]

let make_channel_search_result ?created_at ?deleted_at
    ~(highlight : search_highlight) ?message_id ?score ?sender_id ?thread_id
    ?updated_at () =
  ({
     created_at;
     deleted_at;
     highlight;
     message_id;
     score;
     sender_id;
     thread_id;
     updated_at;
   }
    : channel_search_result)

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

let channel_search_response_item_with_metadata_of_yojson :
    Yojson.Safe.t -> channel_search_response_item_with_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    channel_id = Json.required fields "channel_id" Json.string;
    channel_message_search_results =
      Json.required fields "channel_message_search_results"
        (Json.list channel_search_result_of_yojson);
    channel_type = Json.required fields "channel_type" Json.string;
    id = Json.required fields "id" Json.string;
    owner_id = Json.optional fields "owner_id" Json.string;
    metadata = Json.optional fields "metadata" channel_metadata_of_yojson;
  }

and yojson_of_channel_search_response_item_with_metadata :
    channel_search_response_item_with_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_id", Some (Json.of_string value.channel_id));
      ( "channel_message_search_results",
        Some
          ((Json.of_list yojson_of_channel_search_result)
             value.channel_message_search_results) );
      ("channel_type", Some (Json.of_string value.channel_type));
      ("id", Some (Json.of_string value.id));
      ("owner_id", Option.map Json.of_string value.owner_id);
      ("metadata", Option.map yojson_of_channel_metadata value.metadata);
    ]

let make_channel_search_response_item_with_metadata ~(channel_id : string)
    ~(channel_message_search_results : channel_search_result list)
    ~(channel_type : string) ~(id : string) ?owner_id ?metadata () =
  ({
     channel_id;
     channel_message_search_results;
     channel_type;
     id;
     owner_id;
     metadata;
   }
    : channel_search_response_item_with_metadata)

type nonrec channel_search_response = {
  next_cursor : string option;
      (** Base64-encoded cursor for the next page; [None] when exhausted. *)
  results : channel_search_response_item_with_metadata list;
      (** List containing results from email threads *)
  total_count : int64;
      (** Total number of matching channel messages across all pages. *)
}
(** The document search response object *)

let channel_search_response_of_yojson : Yojson.Safe.t -> channel_search_response
    =
 fun json ->
  let fields = Json.obj json in
  {
    next_cursor = Json.optional fields "next_cursor" Json.string;
    results =
      Json.required fields "results"
        (Json.list channel_search_response_item_with_metadata_of_yojson);
    total_count = Json.required fields "total_count" Json.int64;
  }

and yojson_of_channel_search_response : channel_search_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("next_cursor", Option.map Json.of_string value.next_cursor);
      ( "results",
        Some
          ((Json.of_list yojson_of_channel_search_response_item_with_metadata)
             value.results) );
      ("total_count", Some (Json.of_int64 value.total_count));
    ]

let make_channel_search_response ?next_cursor
    ~(results : channel_search_response_item_with_metadata list)
    ~(total_count : int64) () =
  ({ next_cursor; results; total_count } : channel_search_response)

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

let channel_search_response_item_of_yojson :
    Yojson.Safe.t -> channel_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    channel_id = Json.required fields "channel_id" Json.string;
    channel_message_search_results =
      Json.required fields "channel_message_search_results"
        (Json.list channel_search_result_of_yojson);
    channel_type = Json.required fields "channel_type" Json.string;
    id = Json.required fields "id" Json.string;
    owner_id = Json.optional fields "owner_id" Json.string;
  }

and yojson_of_channel_search_response_item :
    channel_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_id", Some (Json.of_string value.channel_id));
      ( "channel_message_search_results",
        Some
          ((Json.of_list yojson_of_channel_search_result)
             value.channel_message_search_results) );
      ("channel_type", Some (Json.of_string value.channel_type));
      ("id", Some (Json.of_string value.id));
      ("owner_id", Option.map Json.of_string value.owner_id);
    ]

let make_channel_search_response_item ~(channel_id : string)
    ~(channel_message_search_results : channel_search_result list)
    ~(channel_type : string) ~(id : string) ?owner_id () =
  ({ channel_id; channel_message_search_results; channel_type; id; owner_id }
    : channel_search_response_item)

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

let channel_thread_filters_of_yojson : Yojson.Safe.t -> channel_thread_filters =
 fun json ->
  let fields = Json.obj json in
  {
    channel_ids = Json.optional fields "channel_ids" (Json.list Json.string);
    participant_ids =
      Json.optional fields "participant_ids" (Json.list Json.string);
    root_sender_ids =
      Json.optional fields "root_sender_ids" (Json.list Json.string);
    thread_ids = Json.optional fields "thread_ids" (Json.list Json.string);
  }

and yojson_of_channel_thread_filters : channel_thread_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_ids", Option.map (Json.of_list Json.of_string) value.channel_ids);
      ( "participant_ids",
        Option.map (Json.of_list Json.of_string) value.participant_ids );
      ( "root_sender_ids",
        Option.map (Json.of_list Json.of_string) value.root_sender_ids );
      ("thread_ids", Option.map (Json.of_list Json.of_string) value.thread_ids);
    ]

let make_channel_thread_filters ?channel_ids ?participant_ids ?root_sender_ids
    ?thread_ids () =
  ({ channel_ids; participant_ids; root_sender_ids; thread_ids }
    : channel_thread_filters)

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

let chat_filters_of_yojson : Yojson.Safe.t -> chat_filters =
 fun json ->
  let fields = Json.obj json in
  {
    chat_ids = Json.optional fields "chat_ids" (Json.list Json.string);
    importance = Json.optional fields "importance" Json.bool;
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    owners = Json.optional fields "owners" (Json.list Json.string);
    project_ids = Json.optional fields "project_ids" (Json.list Json.string);
    role = Json.optional fields "role" (Json.list Json.string);
  }

and yojson_of_chat_filters : chat_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_ids", Option.map (Json.of_list Json.of_string) value.chat_ids);
      ("importance", Option.map Json.of_bool value.importance);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("owners", Option.map (Json.of_list Json.of_string) value.owners);
      ("project_ids", Option.map (Json.of_list Json.of_string) value.project_ids);
      ("role", Option.map (Json.of_list Json.of_string) value.role);
    ]

let make_chat_filters ?chat_ids ?importance ?notification_filters ?owners
    ?project_ids ?role () =
  ({ chat_ids; importance; notification_filters; owners; project_ids; role }
    : chat_filters)

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

let chat_message_search_result_of_yojson :
    Yojson.Safe.t -> chat_message_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    chat_message_id = Json.optional fields "chat_message_id" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    role = Json.optional fields "role" Json.string;
    score = Json.optional fields "score" Json.float;
  }

and yojson_of_chat_message_search_result :
    chat_message_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_message_id", Option.map Json.of_string value.chat_message_id);
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("role", Option.map Json.of_string value.role);
      ("score", Option.map Json.of_float value.score);
    ]

let make_chat_message_search_result ?chat_message_id
    ~(highlight : search_highlight) ?role ?score () =
  ({ chat_message_id; highlight; role; score } : chat_message_search_result)

type nonrec chat_metadata = {
  created_at : string;
  deleted_at : string option;
  project_id : string option;
  updated_at : string;
  viewed_at : string option;
}
(** Metadata for a chat fetched from the database *)

let chat_metadata_of_yojson : Yojson.Safe.t -> chat_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    deleted_at = Json.optional fields "deleted_at" Json.string;
    project_id = Json.optional fields "project_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    viewed_at = Json.optional fields "viewed_at" Json.string;
  }

and yojson_of_chat_metadata : chat_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("deleted_at", Option.map Json.of_string value.deleted_at);
      ("project_id", Option.map Json.of_string value.project_id);
      ("updated_at", Some (Json.of_string value.updated_at));
      ("viewed_at", Option.map Json.of_string value.viewed_at);
    ]

let make_chat_metadata ~(created_at : string) ?deleted_at ?project_id
    ~(updated_at : string) ?viewed_at () =
  ({ created_at; deleted_at; project_id; updated_at; viewed_at }
    : chat_metadata)

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

let chat_search_request_of_yojson : Yojson.Safe.t -> chat_search_request =
 fun json ->
  let fields = Json.obj json in
  {
    chat_ids = Json.optional fields "chat_ids" (Json.list Json.string);
    importance = Json.optional fields "importance" Json.bool;
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    owners = Json.optional fields "owners" (Json.list Json.string);
    project_ids = Json.optional fields "project_ids" (Json.list Json.string);
    role = Json.optional fields "role" (Json.list Json.string);
    collapse = Json.optional fields "collapse" Json.bool;
    match_type = Json.required fields "match_type" match_type_of_yojson;
    query = Json.optional fields "query" Json.string;
    search_on = Json.optional fields "search_on" search_on_of_yojson;
    terms = Json.optional fields "terms" (Json.list Json.string);
  }

and yojson_of_chat_search_request : chat_search_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_ids", Option.map (Json.of_list Json.of_string) value.chat_ids);
      ("importance", Option.map Json.of_bool value.importance);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("owners", Option.map (Json.of_list Json.of_string) value.owners);
      ("project_ids", Option.map (Json.of_list Json.of_string) value.project_ids);
      ("role", Option.map (Json.of_list Json.of_string) value.role);
      ("collapse", Option.map Json.of_bool value.collapse);
      ("match_type", Some (yojson_of_match_type value.match_type));
      ("query", Option.map Json.of_string value.query);
      ("search_on", Option.map yojson_of_search_on value.search_on);
      ("terms", Option.map (Json.of_list Json.of_string) value.terms);
    ]

let make_chat_search_request ?chat_ids ?importance ?notification_filters ?owners
    ?project_ids ?role ?collapse ~(match_type : match_type) ?query ?search_on
    ?terms () =
  ({
     chat_ids;
     importance;
     notification_filters;
     owners;
     project_ids;
     role;
     collapse;
     match_type;
     query;
     search_on;
     terms;
   }
    : chat_search_request)

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

let chat_search_response_item_with_metadata_of_yojson :
    Yojson.Safe.t -> chat_search_response_item_with_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    chat_id = Json.required fields "chat_id" Json.string;
    chat_search_results =
      Json.required fields "chat_search_results"
        (Json.list chat_message_search_result_of_yojson);
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    user_id = Json.required fields "user_id" Json.string;
    metadata = Json.optional fields "metadata" chat_metadata_of_yojson;
    properties =
      Json.optional fields "properties" (Json.list soup_property_of_yojson);
  }

and yojson_of_chat_search_response_item_with_metadata :
    chat_search_response_item_with_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_id", Some (Json.of_string value.chat_id));
      ( "chat_search_results",
        Some
          ((Json.of_list yojson_of_chat_message_search_result)
             value.chat_search_results) );
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("user_id", Some (Json.of_string value.user_id));
      ("metadata", Option.map yojson_of_chat_metadata value.metadata);
      ( "properties",
        Option.map (Json.of_list yojson_of_soup_property) value.properties );
    ]

let make_chat_search_response_item_with_metadata ~(chat_id : string)
    ~(chat_search_results : chat_message_search_result list) ~(id : string)
    ~(name : string) ~(owner_id : string) ~(user_id : string) ?metadata
    ?properties () =
  ({
     chat_id;
     chat_search_results;
     id;
     name;
     owner_id;
     user_id;
     metadata;
     properties;
   }
    : chat_search_response_item_with_metadata)

type nonrec chat_search_response = {
  results : chat_search_response_item_with_metadata list;
      (** List containing results from chats *)
}
(** The chat search response object *)

let chat_search_response_of_yojson : Yojson.Safe.t -> chat_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list chat_search_response_item_with_metadata_of_yojson);
  }

and yojson_of_chat_search_response : chat_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_chat_search_response_item_with_metadata)
             value.results) );
    ]

let make_chat_search_response
    ~(results : chat_search_response_item_with_metadata list) () =
  ({ results } : chat_search_response)

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

let chat_search_response_item_of_yojson :
    Yojson.Safe.t -> chat_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    chat_id = Json.required fields "chat_id" Json.string;
    chat_search_results =
      Json.required fields "chat_search_results"
        (Json.list chat_message_search_result_of_yojson);
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_chat_search_response_item :
    chat_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_id", Some (Json.of_string value.chat_id));
      ( "chat_search_results",
        Some
          ((Json.of_list yojson_of_chat_message_search_result)
             value.chat_search_results) );
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_chat_search_response_item ~(chat_id : string)
    ~(chat_search_results : chat_message_search_result list) ~(id : string)
    ~(name : string) ~(owner_id : string) ~(user_id : string) () =
  ({ chat_id; chat_search_results; id; name; owner_id; user_id }
    : chat_search_response_item)

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

let crm_company_filters_of_yojson : Yojson.Safe.t -> crm_company_filters =
 fun json ->
  let fields = Json.obj json in
  {
    company_ids = Json.optional fields "company_ids" (Json.list Json.string);
    hidden = Json.optional fields "hidden" Json.bool;
  }

and yojson_of_crm_company_filters : crm_company_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("company_ids", Option.map (Json.of_list Json.of_string) value.company_ids);
      ("hidden", Option.map Json.of_bool value.hidden);
    ]

let make_crm_company_filters ?company_ids ?hidden () =
  ({ company_ids; hidden } : crm_company_filters)

type nonrec crm_company_search_domain = {
  company_id : string;  (** The id of the company the domain belongs to. *)
  created_at : string;  (** When the domain record was created. *)
  domain : string;  (** The domain (lowercased, e.g. "acme.com"). *)
  id : string;  (** The id of the domain record. *)
}
(** A CRM domain attached to a company in search results. *)

let crm_company_search_domain_of_yojson :
    Yojson.Safe.t -> crm_company_search_domain =
 fun json ->
  let fields = Json.obj json in
  {
    company_id = Json.required fields "companyId" Json.string;
    created_at = Json.required fields "createdAt" Json.string;
    domain = Json.required fields "domain" Json.string;
    id = Json.required fields "id" Json.string;
  }

and yojson_of_crm_company_search_domain :
    crm_company_search_domain -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("companyId", Some (Json.of_string value.company_id));
      ("createdAt", Some (Json.of_string value.created_at));
      ("domain", Some (Json.of_string value.domain));
      ("id", Some (Json.of_string value.id));
    ]

let make_crm_company_search_domain ~(company_id : string) ~(created_at : string)
    ~(domain : string) ~(id : string) () =
  ({ company_id; created_at; domain; id } : crm_company_search_domain)

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

let crm_company_search_response_item_of_yojson :
    Yojson.Safe.t -> crm_company_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "createdAt" Json.string;
    description = Json.optional fields "description" Json.string;
    domains =
      Json.required fields "domains"
        (Json.list crm_company_search_domain_of_yojson);
    hidden = Json.required fields "hidden" Json.bool;
    id = Json.required fields "id" Json.string;
    name = Json.optional fields "name" Json.string;
    name_highlighted = Json.optional fields "nameHighlighted" Json.string;
    team_id = Json.required fields "teamId" Json.string;
    updated_at = Json.required fields "updatedAt" Json.string;
  }

and yojson_of_crm_company_search_response_item :
    crm_company_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Some (Json.of_string value.created_at));
      ("description", Option.map Json.of_string value.description);
      ( "domains",
        Some ((Json.of_list yojson_of_crm_company_search_domain) value.domains)
      );
      ("hidden", Some (Json.of_bool value.hidden));
      ("id", Some (Json.of_string value.id));
      ("name", Option.map Json.of_string value.name);
      ("nameHighlighted", Option.map Json.of_string value.name_highlighted);
      ("teamId", Some (Json.of_string value.team_id));
      ("updatedAt", Some (Json.of_string value.updated_at));
    ]

let make_crm_company_search_response_item ~(created_at : string) ?description
    ~(domains : crm_company_search_domain list) ~(hidden : bool) ~(id : string)
    ?name ?name_highlighted ~(team_id : string) ~(updated_at : string) () =
  ({
     created_at;
     description;
     domains;
     hidden;
     id;
     name;
     name_highlighted;
     team_id;
     updated_at;
   }
    : crm_company_search_response_item)

type nonrec task_filters = {
  include_cbm_atm_nc : bool option;
      (** Include tasks that are created by me, assigned to me, and not completed,
even when they do not match other document filters. *)
}
(** Task-only filters nested under document filters. *)

let task_filters_of_yojson : Yojson.Safe.t -> task_filters =
 fun json ->
  let fields = Json.obj json in
  { include_cbm_atm_nc = Json.optional fields "include_cbm_atm_nc" Json.bool }

and yojson_of_task_filters : task_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("include_cbm_atm_nc", Option.map Json.of_bool value.include_cbm_atm_nc) ]

let make_task_filters ?include_cbm_atm_nc () =
  ({ include_cbm_atm_nc } : task_filters)

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

let document_filters_of_yojson : Yojson.Safe.t -> document_filters =
 fun json ->
  let fields = Json.obj json in
  {
    document_ids = Json.optional fields "document_ids" (Json.list Json.string);
    file_types = Json.optional fields "file_types" (Json.list Json.string);
    importance = Json.optional fields "importance" Json.bool;
    is_email_attachment = Json.optional fields "is_email_attachment" Json.bool;
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    owners = Json.optional fields "owners" (Json.list Json.string);
    project_ids = Json.optional fields "project_ids" (Json.list Json.string);
    sub_types = Json.optional fields "sub_types" (Json.list Json.string);
    task_filters = Json.optional fields "task_filters" task_filters_of_yojson;
  }

and yojson_of_document_filters : document_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "document_ids",
        Option.map (Json.of_list Json.of_string) value.document_ids );
      ("file_types", Option.map (Json.of_list Json.of_string) value.file_types);
      ("importance", Option.map Json.of_bool value.importance);
      ("is_email_attachment", Option.map Json.of_bool value.is_email_attachment);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("owners", Option.map (Json.of_list Json.of_string) value.owners);
      ("project_ids", Option.map (Json.of_list Json.of_string) value.project_ids);
      ("sub_types", Option.map (Json.of_list Json.of_string) value.sub_types);
      ("task_filters", Option.map yojson_of_task_filters value.task_filters);
    ]

let make_document_filters ?document_ids ?file_types ?importance
    ?is_email_attachment ?notification_filters ?owners ?project_ids ?sub_types
    ?task_filters () =
  ({
     document_ids;
     file_types;
     importance;
     is_email_attachment;
     notification_filters;
     owners;
     project_ids;
     sub_types;
     task_filters;
   }
    : document_filters)

type nonrec document_metadata = {
  created_at : string;
  deleted_at : string option;
  project_id : string option;
  updated_at : string;
  viewed_at : string option;
}
(** Metadata for a document fetched from the database *)

let document_metadata_of_yojson : Yojson.Safe.t -> document_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    deleted_at = Json.optional fields "deleted_at" Json.string;
    project_id = Json.optional fields "project_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    viewed_at = Json.optional fields "viewed_at" Json.string;
  }

and yojson_of_document_metadata : document_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("deleted_at", Option.map Json.of_string value.deleted_at);
      ("project_id", Option.map Json.of_string value.project_id);
      ("updated_at", Some (Json.of_string value.updated_at));
      ("viewed_at", Option.map Json.of_string value.viewed_at);
    ]

let make_document_metadata ~(created_at : string) ?deleted_at ?project_id
    ~(updated_at : string) ?viewed_at () =
  ({ created_at; deleted_at; project_id; updated_at; viewed_at }
    : document_metadata)

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

let document_search_request_of_yojson : Yojson.Safe.t -> document_search_request
    =
 fun json ->
  let fields = Json.obj json in
  {
    document_ids = Json.optional fields "document_ids" (Json.list Json.string);
    file_types = Json.optional fields "file_types" (Json.list Json.string);
    importance = Json.optional fields "importance" Json.bool;
    is_email_attachment = Json.optional fields "is_email_attachment" Json.bool;
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    owners = Json.optional fields "owners" (Json.list Json.string);
    project_ids = Json.optional fields "project_ids" (Json.list Json.string);
    sub_types = Json.optional fields "sub_types" (Json.list Json.string);
    task_filters = Json.optional fields "task_filters" task_filters_of_yojson;
    collapse = Json.optional fields "collapse" Json.bool;
    match_type = Json.required fields "match_type" match_type_of_yojson;
    query = Json.optional fields "query" Json.string;
    search_on = Json.optional fields "search_on" search_on_of_yojson;
    terms = Json.optional fields "terms" (Json.list Json.string);
  }

and yojson_of_document_search_request : document_search_request -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ( "document_ids",
        Option.map (Json.of_list Json.of_string) value.document_ids );
      ("file_types", Option.map (Json.of_list Json.of_string) value.file_types);
      ("importance", Option.map Json.of_bool value.importance);
      ("is_email_attachment", Option.map Json.of_bool value.is_email_attachment);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("owners", Option.map (Json.of_list Json.of_string) value.owners);
      ("project_ids", Option.map (Json.of_list Json.of_string) value.project_ids);
      ("sub_types", Option.map (Json.of_list Json.of_string) value.sub_types);
      ("task_filters", Option.map yojson_of_task_filters value.task_filters);
      ("collapse", Option.map Json.of_bool value.collapse);
      ("match_type", Some (yojson_of_match_type value.match_type));
      ("query", Option.map Json.of_string value.query);
      ("search_on", Option.map yojson_of_search_on value.search_on);
      ("terms", Option.map (Json.of_list Json.of_string) value.terms);
    ]

let make_document_search_request ?document_ids ?file_types ?importance
    ?is_email_attachment ?notification_filters ?owners ?project_ids ?sub_types
    ?task_filters ?collapse ~(match_type : match_type) ?query ?search_on ?terms
    () =
  ({
     document_ids;
     file_types;
     importance;
     is_email_attachment;
     notification_filters;
     owners;
     project_ids;
     sub_types;
     task_filters;
     collapse;
     match_type;
     query;
     search_on;
     terms;
   }
    : document_search_request)

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

let document_search_result_of_yojson : Yojson.Safe.t -> document_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    node_id = Json.optional fields "node_id" Json.string;
    raw_content = Json.optional fields "raw_content" Json.string;
    score = Json.optional fields "score" Json.float;
  }

and yojson_of_document_search_result : document_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("node_id", Option.map Json.of_string value.node_id);
      ("raw_content", Option.map Json.of_string value.raw_content);
      ("score", Option.map Json.of_float value.score);
    ]

let make_document_search_result ~(highlight : search_highlight) ?node_id
    ?raw_content ?score () =
  ({ highlight; node_id; raw_content; score } : document_search_result)

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

let document_sub_type_of_yojson : Yojson.Safe.t -> document_sub_type =
 fun json ->
  match Json.string json with
  | "task" -> Task
  | "snippet" -> Snippet
  | "skill" -> Skill
  | "initiative_description" -> Initiative_description
  | other -> Unknown other

and yojson_of_document_sub_type : document_sub_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Task -> `String "task"
  | Snippet -> `String "snippet"
  | Skill -> `String "skill"
  | Initiative_description -> `String "initiative_description"
  | Unknown other -> `String other

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

let document_search_response_item_with_metadata_of_yojson :
    Yojson.Safe.t -> document_search_response_item_with_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    document_id = Json.required fields "document_id" Json.string;
    document_name = Json.required fields "document_name" Json.string;
    document_search_results =
      Json.required fields "document_search_results"
        (Json.list document_search_result_of_yojson);
    file_type = Json.optional fields "file_type" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    sub_type = Json.optional fields "sub_type" document_sub_type_of_yojson;
    metadata = Json.optional fields "metadata" document_metadata_of_yojson;
    properties =
      Json.optional fields "properties" (Json.list soup_property_of_yojson);
  }

and yojson_of_document_search_response_item_with_metadata :
    document_search_response_item_with_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("document_id", Some (Json.of_string value.document_id));
      ("document_name", Some (Json.of_string value.document_name));
      ( "document_search_results",
        Some
          ((Json.of_list yojson_of_document_search_result)
             value.document_search_results) );
      ("file_type", Option.map Json.of_string value.file_type);
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("sub_type", Option.map yojson_of_document_sub_type value.sub_type);
      ("metadata", Option.map yojson_of_document_metadata value.metadata);
      ( "properties",
        Option.map (Json.of_list yojson_of_soup_property) value.properties );
    ]

let make_document_search_response_item_with_metadata ~(document_id : string)
    ~(document_name : string)
    ~(document_search_results : document_search_result list) ?file_type
    ~(id : string) ~(name : string) ~(owner_id : string) ?sub_type ?metadata
    ?properties () =
  ({
     document_id;
     document_name;
     document_search_results;
     file_type;
     id;
     name;
     owner_id;
     sub_type;
     metadata;
     properties;
   }
    : document_search_response_item_with_metadata)

type nonrec document_search_response = {
  results : document_search_response_item_with_metadata list;
      (** List containing results from documents *)
}
(** The document search response object *)

let document_search_response_of_yojson :
    Yojson.Safe.t -> document_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list document_search_response_item_with_metadata_of_yojson);
  }

and yojson_of_document_search_response :
    document_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_document_search_response_item_with_metadata)
             value.results) );
    ]

let make_document_search_response
    ~(results : document_search_response_item_with_metadata list) () =
  ({ results } : document_search_response)

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

let document_search_response_item_of_yojson :
    Yojson.Safe.t -> document_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    document_id = Json.required fields "document_id" Json.string;
    document_name = Json.required fields "document_name" Json.string;
    document_search_results =
      Json.required fields "document_search_results"
        (Json.list document_search_result_of_yojson);
    file_type = Json.optional fields "file_type" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    sub_type = Json.optional fields "sub_type" document_sub_type_of_yojson;
  }

and yojson_of_document_search_response_item :
    document_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("document_id", Some (Json.of_string value.document_id));
      ("document_name", Some (Json.of_string value.document_name));
      ( "document_search_results",
        Some
          ((Json.of_list yojson_of_document_search_result)
             value.document_search_results) );
      ("file_type", Option.map Json.of_string value.file_type);
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("sub_type", Option.map yojson_of_document_sub_type value.sub_type);
    ]

let make_document_search_response_item ~(document_id : string)
    ~(document_name : string)
    ~(document_search_results : document_search_result list) ?file_type
    ~(id : string) ~(name : string) ~(owner_id : string) ?sub_type () =
  ({
     document_id;
     document_name;
     document_search_results;
     file_type;
     id;
     name;
     owner_id;
     sub_type;
   }
    : document_search_response_item)

(** Controls whether shared email threads are included in results. *)
type nonrec shared_email_filter =
  | Exclude
  | Include
  | Only
  | Unknown of string  (** A value this SDK version does not know. *)

let shared_email_filter_of_yojson : Yojson.Safe.t -> shared_email_filter =
 fun json ->
  match Json.string json with
  | "exclude" -> Exclude
  | "include" -> Include
  | "only" -> Only
  | other -> Unknown other

and yojson_of_shared_email_filter : shared_email_filter -> Yojson.Safe.t =
 fun value ->
  match value with
  | Exclude -> `String "exclude"
  | Include -> `String "include"
  | Only -> `String "only"
  | Unknown other -> `String other

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

let email_filters_of_yojson : Yojson.Safe.t -> email_filters =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.optional fields "bcc" (Json.list Json.string);
    calendar_only = Json.optional fields "calendar_only" Json.bool;
    cc = Json.optional fields "cc" (Json.list Json.string);
    crm_addresses = Json.optional fields "crm_addresses" (Json.list Json.string);
    crm_domains = Json.optional fields "crm_domains" (Json.list Json.string);
    email_thread_ids =
      Json.optional fields "email_thread_ids" (Json.list Json.string);
    exclude_labels =
      Json.optional fields "exclude_labels" (Json.list Json.string);
    importance = Json.optional fields "importance" Json.bool;
    include_labels =
      Json.optional fields "include_labels" (Json.list Json.string);
    is_read = Json.optional fields "is_read" Json.bool;
    link_ids = Json.optional fields "link_ids" (Json.list Json.string);
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    project_ids = Json.optional fields "project_ids" (Json.list Json.string);
    recipients = Json.optional fields "recipients" (Json.list Json.string);
    senders = Json.optional fields "senders" (Json.list Json.string);
    shared = Json.optional fields "shared" shared_email_filter_of_yojson;
  }

and yojson_of_email_filters : email_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Option.map (Json.of_list Json.of_string) value.bcc);
      ("calendar_only", Option.map Json.of_bool value.calendar_only);
      ("cc", Option.map (Json.of_list Json.of_string) value.cc);
      ( "crm_addresses",
        Option.map (Json.of_list Json.of_string) value.crm_addresses );
      ("crm_domains", Option.map (Json.of_list Json.of_string) value.crm_domains);
      ( "email_thread_ids",
        Option.map (Json.of_list Json.of_string) value.email_thread_ids );
      ( "exclude_labels",
        Option.map (Json.of_list Json.of_string) value.exclude_labels );
      ("importance", Option.map Json.of_bool value.importance);
      ( "include_labels",
        Option.map (Json.of_list Json.of_string) value.include_labels );
      ("is_read", Option.map Json.of_bool value.is_read);
      ("link_ids", Option.map (Json.of_list Json.of_string) value.link_ids);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("project_ids", Option.map (Json.of_list Json.of_string) value.project_ids);
      ("recipients", Option.map (Json.of_list Json.of_string) value.recipients);
      ("senders", Option.map (Json.of_list Json.of_string) value.senders);
      ("shared", Option.map yojson_of_shared_email_filter value.shared);
    ]

let make_email_filters ?bcc ?calendar_only ?cc ?crm_addresses ?crm_domains
    ?email_thread_ids ?exclude_labels ?importance ?include_labels ?is_read
    ?link_ids ?notification_filters ?project_ids ?recipients ?senders ?shared ()
    =
  ({
     bcc;
     calendar_only;
     cc;
     crm_addresses;
     crm_domains;
     email_thread_ids;
     exclude_labels;
     importance;
     include_labels;
     is_read;
     link_ids;
     notification_filters;
     project_ids;
     recipients;
     senders;
     shared;
   }
    : email_filters)

type nonrec email_search_participant = { email : string; name : string option }
(** A participant (sender) in an email thread *)

let email_search_participant_of_yojson :
    Yojson.Safe.t -> email_search_participant =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    name = Json.optional fields "name" Json.string;
  }

and yojson_of_email_search_participant :
    email_search_participant -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("name", Option.map Json.of_string value.name);
    ]

let make_email_search_participant ~(email : string) ?name () =
  ({ email; name } : email_search_participant)

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

let email_search_request_of_yojson : Yojson.Safe.t -> email_search_request =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.optional fields "bcc" (Json.list Json.string);
    calendar_only = Json.optional fields "calendar_only" Json.bool;
    cc = Json.optional fields "cc" (Json.list Json.string);
    crm_addresses = Json.optional fields "crm_addresses" (Json.list Json.string);
    crm_domains = Json.optional fields "crm_domains" (Json.list Json.string);
    email_thread_ids =
      Json.optional fields "email_thread_ids" (Json.list Json.string);
    exclude_labels =
      Json.optional fields "exclude_labels" (Json.list Json.string);
    importance = Json.optional fields "importance" Json.bool;
    include_labels =
      Json.optional fields "include_labels" (Json.list Json.string);
    is_read = Json.optional fields "is_read" Json.bool;
    link_ids = Json.optional fields "link_ids" (Json.list Json.string);
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    project_ids = Json.optional fields "project_ids" (Json.list Json.string);
    recipients = Json.optional fields "recipients" (Json.list Json.string);
    senders = Json.optional fields "senders" (Json.list Json.string);
    shared = Json.optional fields "shared" shared_email_filter_of_yojson;
    collapse = Json.optional fields "collapse" Json.bool;
    match_type = Json.required fields "match_type" match_type_of_yojson;
    query = Json.optional fields "query" Json.string;
    search_on = Json.optional fields "search_on" search_on_of_yojson;
    terms = Json.optional fields "terms" (Json.list Json.string);
  }

and yojson_of_email_search_request : email_search_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Option.map (Json.of_list Json.of_string) value.bcc);
      ("calendar_only", Option.map Json.of_bool value.calendar_only);
      ("cc", Option.map (Json.of_list Json.of_string) value.cc);
      ( "crm_addresses",
        Option.map (Json.of_list Json.of_string) value.crm_addresses );
      ("crm_domains", Option.map (Json.of_list Json.of_string) value.crm_domains);
      ( "email_thread_ids",
        Option.map (Json.of_list Json.of_string) value.email_thread_ids );
      ( "exclude_labels",
        Option.map (Json.of_list Json.of_string) value.exclude_labels );
      ("importance", Option.map Json.of_bool value.importance);
      ( "include_labels",
        Option.map (Json.of_list Json.of_string) value.include_labels );
      ("is_read", Option.map Json.of_bool value.is_read);
      ("link_ids", Option.map (Json.of_list Json.of_string) value.link_ids);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("project_ids", Option.map (Json.of_list Json.of_string) value.project_ids);
      ("recipients", Option.map (Json.of_list Json.of_string) value.recipients);
      ("senders", Option.map (Json.of_list Json.of_string) value.senders);
      ("shared", Option.map yojson_of_shared_email_filter value.shared);
      ("collapse", Option.map Json.of_bool value.collapse);
      ("match_type", Some (yojson_of_match_type value.match_type));
      ("query", Option.map Json.of_string value.query);
      ("search_on", Option.map yojson_of_search_on value.search_on);
      ("terms", Option.map (Json.of_list Json.of_string) value.terms);
    ]

let make_email_search_request ?bcc ?calendar_only ?cc ?crm_addresses
    ?crm_domains ?email_thread_ids ?exclude_labels ?importance ?include_labels
    ?is_read ?link_ids ?notification_filters ?project_ids ?recipients ?senders
    ?shared ?collapse ~(match_type : match_type) ?query ?search_on ?terms () =
  ({
     bcc;
     calendar_only;
     cc;
     crm_addresses;
     crm_domains;
     email_thread_ids;
     exclude_labels;
     importance;
     include_labels;
     is_read;
     link_ids;
     notification_filters;
     project_ids;
     recipients;
     senders;
     shared;
     collapse;
     match_type;
     query;
     search_on;
     terms;
   }
    : email_search_request)

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

let email_search_result_of_yojson : Yojson.Safe.t -> email_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.required fields "bcc" (Json.list Json.string);
    cc = Json.required fields "cc" (Json.list Json.string);
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    labels = Json.required fields "labels" (Json.list Json.string);
    message_id = Json.optional fields "message_id" Json.string;
    pretty_sender = Json.required fields "pretty_sender" Json.string;
    recipients = Json.required fields "recipients" (Json.list Json.string);
    score = Json.optional fields "score" Json.float;
    sender = Json.required fields "sender" Json.string;
    sent_at = Json.optional fields "sent_at" Json.string;
  }

and yojson_of_email_search_result : email_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Some ((Json.of_list Json.of_string) value.bcc));
      ("cc", Some ((Json.of_list Json.of_string) value.cc));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("labels", Some ((Json.of_list Json.of_string) value.labels));
      ("message_id", Option.map Json.of_string value.message_id);
      ("pretty_sender", Some (Json.of_string value.pretty_sender));
      ("recipients", Some ((Json.of_list Json.of_string) value.recipients));
      ("score", Option.map Json.of_float value.score);
      ("sender", Some (Json.of_string value.sender));
      ("sent_at", Option.map Json.of_string value.sent_at);
    ]

let make_email_search_result ~(bcc : string list) ~(cc : string list)
    ~(highlight : search_highlight) ~(labels : string list) ?message_id
    ~(pretty_sender : string) ~(recipients : string list) ?score
    ~(sender : string) ?sent_at () =
  ({
     bcc;
     cc;
     highlight;
     labels;
     message_id;
     pretty_sender;
     recipients;
     score;
     sender;
     sent_at;
   }
    : email_search_result)

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

let email_search_response_item_with_metadata_of_yojson :
    Yojson.Safe.t -> email_search_response_item_with_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    email_message_search_results =
      Json.required fields "email_message_search_results"
        (Json.list email_search_result_of_yojson);
    id = Json.required fields "id" Json.string;
    link_id = Json.required fields "link_id" Json.string;
    name = Json.optional fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    participants =
      Json.required fields "participants"
        (Json.list email_search_participant_of_yojson);
    subject = Json.optional fields "subject" Json.string;
    thread_id = Json.required fields "thread_id" Json.string;
    user_id = Json.required fields "user_id" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    inbox_visible = Json.required fields "inbox_visible" Json.bool;
    is_draft = Json.required fields "is_draft" Json.bool;
    is_important = Json.required fields "is_important" Json.bool;
    is_read = Json.required fields "is_read" Json.bool;
    properties =
      Json.optional fields "properties" (Json.list soup_property_of_yojson);
    snippet = Json.optional fields "snippet" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    viewed_at = Json.optional fields "viewed_at" Json.string;
  }

and yojson_of_email_search_response_item_with_metadata :
    email_search_response_item_with_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "email_message_search_results",
        Some
          ((Json.of_list yojson_of_email_search_result)
             value.email_message_search_results) );
      ("id", Some (Json.of_string value.id));
      ("link_id", Some (Json.of_string value.link_id));
      ("name", Option.map Json.of_string value.name);
      ("owner_id", Some (Json.of_string value.owner_id));
      ( "participants",
        Some
          ((Json.of_list yojson_of_email_search_participant) value.participants)
      );
      ("subject", Option.map Json.of_string value.subject);
      ("thread_id", Some (Json.of_string value.thread_id));
      ("user_id", Some (Json.of_string value.user_id));
      ("created_at", Some (Json.of_string value.created_at));
      ("inbox_visible", Some (Json.of_bool value.inbox_visible));
      ("is_draft", Some (Json.of_bool value.is_draft));
      ("is_important", Some (Json.of_bool value.is_important));
      ("is_read", Some (Json.of_bool value.is_read));
      ( "properties",
        Option.map (Json.of_list yojson_of_soup_property) value.properties );
      ("snippet", Option.map Json.of_string value.snippet);
      ("updated_at", Some (Json.of_string value.updated_at));
      ("viewed_at", Option.map Json.of_string value.viewed_at);
    ]

let make_email_search_response_item_with_metadata
    ~(email_message_search_results : email_search_result list) ~(id : string)
    ~(link_id : string) ?name ~(owner_id : string)
    ~(participants : email_search_participant list) ?subject
    ~(thread_id : string) ~(user_id : string) ~(created_at : string)
    ~(inbox_visible : bool) ~(is_draft : bool) ~(is_important : bool)
    ~(is_read : bool) ?properties ?snippet ~(updated_at : string) ?viewed_at ()
    =
  ({
     email_message_search_results;
     id;
     link_id;
     name;
     owner_id;
     participants;
     subject;
     thread_id;
     user_id;
     created_at;
     inbox_visible;
     is_draft;
     is_important;
     is_read;
     properties;
     snippet;
     updated_at;
     viewed_at;
   }
    : email_search_response_item_with_metadata)

type nonrec email_search_response = {
  results : email_search_response_item_with_metadata list;
      (** List containing results from email threads *)
}
(** The document search response object *)

let email_search_response_of_yojson : Yojson.Safe.t -> email_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list email_search_response_item_with_metadata_of_yojson);
  }

and yojson_of_email_search_response : email_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_email_search_response_item_with_metadata)
             value.results) );
    ]

let make_email_search_response
    ~(results : email_search_response_item_with_metadata list) () =
  ({ results } : email_search_response)

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

let email_search_response_item_of_yojson :
    Yojson.Safe.t -> email_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    email_message_search_results =
      Json.required fields "email_message_search_results"
        (Json.list email_search_result_of_yojson);
    id = Json.required fields "id" Json.string;
    link_id = Json.required fields "link_id" Json.string;
    name = Json.optional fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    participants =
      Json.required fields "participants"
        (Json.list email_search_participant_of_yojson);
    subject = Json.optional fields "subject" Json.string;
    thread_id = Json.required fields "thread_id" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_email_search_response_item :
    email_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "email_message_search_results",
        Some
          ((Json.of_list yojson_of_email_search_result)
             value.email_message_search_results) );
      ("id", Some (Json.of_string value.id));
      ("link_id", Some (Json.of_string value.link_id));
      ("name", Option.map Json.of_string value.name);
      ("owner_id", Some (Json.of_string value.owner_id));
      ( "participants",
        Some
          ((Json.of_list yojson_of_email_search_participant) value.participants)
      );
      ("subject", Option.map Json.of_string value.subject);
      ("thread_id", Some (Json.of_string value.thread_id));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_email_search_response_item
    ~(email_message_search_results : email_search_result list) ~(id : string)
    ~(link_id : string) ?name ~(owner_id : string)
    ~(participants : email_search_participant list) ?subject
    ~(thread_id : string) ~(user_id : string) () =
  ({
     email_message_search_results;
     id;
     link_id;
     name;
     owner_id;
     participants;
     subject;
     thread_id;
     user_id;
   }
    : email_search_response_item)

type nonrec empty_response = Yojson.Safe.t
(** Empty response is required due to custom fetch forcing [response.json()] *)

let empty_response_of_yojson : Yojson.Safe.t -> empty_response =
 fun json -> Json.json json

and yojson_of_empty_response : empty_response -> Yojson.Safe.t =
 fun value -> Json.of_json value

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

let foreign_entity_filters_of_yojson : Yojson.Safe.t -> foreign_entity_filters =
 fun json ->
  let fields = Json.obj json in
  {
    foreign_entity_ids =
      Json.optional fields "foreign_entity_ids" (Json.list Json.string);
    foreign_entity_sources =
      Json.optional fields "foreign_entity_sources" (Json.list Json.string);
    ids = Json.optional fields "ids" (Json.list Json.string);
    includes_me = Json.optional fields "includes_me" Json.bool;
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
  }

and yojson_of_foreign_entity_filters : foreign_entity_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "foreign_entity_ids",
        Option.map (Json.of_list Json.of_string) value.foreign_entity_ids );
      ( "foreign_entity_sources",
        Option.map (Json.of_list Json.of_string) value.foreign_entity_sources );
      ("ids", Option.map (Json.of_list Json.of_string) value.ids);
      ("includes_me", Option.map Json.of_bool value.includes_me);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
    ]

let make_foreign_entity_filters ?foreign_entity_ids ?foreign_entity_sources ?ids
    ?includes_me ?notification_filters () =
  ({
     foreign_entity_ids;
     foreign_entity_sources;
     ids;
     includes_me;
     notification_filters;
   }
    : foreign_entity_filters)

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

let initiative_filters_of_yojson : Yojson.Safe.t -> initiative_filters =
 fun json ->
  let fields = Json.obj json in
  {
    due_after = Json.optional fields "due_after" Json.string;
    due_before = Json.optional fields "due_before" Json.string;
    include_ = Json.optional fields "include" Json.bool;
    initiative_ids =
      Json.optional fields "initiative_ids" (Json.list Json.string);
    name = Json.optional fields "name" Json.string;
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    owners = Json.optional fields "owners" (Json.list Json.string);
  }

and yojson_of_initiative_filters : initiative_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("due_after", Option.map Json.of_string value.due_after);
      ("due_before", Option.map Json.of_string value.due_before);
      ("include", Option.map Json.of_bool value.include_);
      ( "initiative_ids",
        Option.map (Json.of_list Json.of_string) value.initiative_ids );
      ("name", Option.map Json.of_string value.name);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("owners", Option.map (Json.of_list Json.of_string) value.owners);
    ]

let make_initiative_filters ?due_after ?due_before ?include_ ?initiative_ids
    ?name ?notification_filters ?owners () =
  ({
     due_after;
     due_before;
     include_;
     initiative_ids;
     name;
     notification_filters;
     owners;
   }
    : initiative_filters)

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

let project_filters_of_yojson : Yojson.Safe.t -> project_filters =
 fun json ->
  let fields = Json.obj json in
  {
    importance = Json.optional fields "importance" Json.bool;
    include_root = Json.optional fields "include_root" Json.bool;
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    owners = Json.optional fields "owners" (Json.list Json.string);
    project_ids = Json.optional fields "project_ids" (Json.list Json.string);
  }

and yojson_of_project_filters : project_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("importance", Option.map Json.of_bool value.importance);
      ("include_root", Option.map Json.of_bool value.include_root);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("owners", Option.map (Json.of_list Json.of_string) value.owners);
      ("project_ids", Option.map (Json.of_list Json.of_string) value.project_ids);
    ]

let make_project_filters ?importance ?include_root ?notification_filters ?owners
    ?project_ids () =
  ({ importance; include_root; notification_filters; owners; project_ids }
    : project_filters)

type nonrec property_date_filter_range = {
  end_ : string option;
      (** Exclusive UTC upper bound, omitted for an open end. *)
  start : string option;
      (** Inclusive UTC lower bound, omitted for an open start. *)
}
(** UTC timestamp interval. Lower bounds are inclusive; upper bounds are exclusive. *)

let property_date_filter_range_of_yojson :
    Yojson.Safe.t -> property_date_filter_range =
 fun json ->
  let fields = Json.obj json in
  {
    end_ = Json.optional fields "end" Json.string;
    start = Json.optional fields "start" Json.string;
  }

and yojson_of_property_date_filter_range :
    property_date_filter_range -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("end", Option.map Json.of_string value.end_);
      ("start", Option.map Json.of_string value.start);
    ]

let make_property_date_filter_range ?end_ ?start () =
  ({ end_; start } : property_date_filter_range)

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

let property_filter_of_yojson : Yojson.Safe.t -> property_filter =
 fun json ->
  let fields = Json.obj json in
  {
    date_range =
      Json.optional fields "date_range" property_date_filter_range_of_yojson;
    entity_ids = Json.optional fields "entity_ids" (Json.list Json.string);
    entity_type = Json.optional fields "entity_type" Json.string;
    has_date = Json.optional fields "has_date" Json.bool;
    option_ids = Json.optional fields "option_ids" (Json.list Json.string);
    property_definition_id =
      Json.required fields "property_definition_id" Json.string;
  }

and yojson_of_property_filter : property_filter -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "date_range",
        Option.map yojson_of_property_date_filter_range value.date_range );
      ("entity_ids", Option.map (Json.of_list Json.of_string) value.entity_ids);
      ("entity_type", Option.map Json.of_string value.entity_type);
      ("has_date", Option.map Json.of_bool value.has_date);
      ("option_ids", Option.map (Json.of_list Json.of_string) value.option_ids);
      ( "property_definition_id",
        Some (Json.of_string value.property_definition_id) );
    ]

let make_property_filter ?date_range ?entity_ids ?entity_type ?has_date
    ?option_ids ~(property_definition_id : string) () =
  ({
     date_range;
     entity_ids;
     entity_type;
     has_date;
     option_ids;
     property_definition_id;
   }
    : property_filter)

(** How multiple [tag_option_ids] combine when filtering. *)
type nonrec tag_filter_mode =
  | Any
  | All
  | Unknown of string  (** A value this SDK version does not know. *)

let tag_filter_mode_of_yojson : Yojson.Safe.t -> tag_filter_mode =
 fun json ->
  match Json.string json with
  | "any" -> Any
  | "all" -> All
  | other -> Unknown other

and yojson_of_tag_filter_mode : tag_filter_mode -> Yojson.Safe.t =
 fun value ->
  match value with
  | Any -> `String "any"
  | All -> `String "all"
  | Unknown other -> `String other

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

let entity_filters_of_yojson : Yojson.Safe.t -> entity_filters =
 fun json ->
  let fields = Json.obj json in
  {
    agent_session_filters =
      Json.optional fields "agent_session_filters"
        agent_session_filters_of_yojson;
    calendar_event_filters =
      Json.optional fields "calendar_event_filters"
        calendar_event_filters_of_yojson;
    call_filters = Json.optional fields "call_filters" call_filters_of_yojson;
    channel_filters =
      Json.optional fields "channel_filters" channel_filters_of_yojson;
    channel_thread_filters =
      Json.optional fields "channel_thread_filters"
        channel_thread_filters_of_yojson;
    chat_filters = Json.optional fields "chat_filters" chat_filters_of_yojson;
    crm_company_filters =
      Json.optional fields "crm_company_filters" crm_company_filters_of_yojson;
    document_filters =
      Json.optional fields "document_filters" document_filters_of_yojson;
    email_filters = Json.optional fields "email_filters" email_filters_of_yojson;
    favorites_only = Json.optional fields "favorites_only" Json.bool;
    foreign_entity_filters =
      Json.optional fields "foreign_entity_filters"
        foreign_entity_filters_of_yojson;
    initiative_filters =
      Json.optional fields "initiative_filters" initiative_filters_of_yojson;
    project_filters =
      Json.optional fields "project_filters" project_filters_of_yojson;
    property_filters =
      Json.optional fields "property_filters"
        (Json.list property_filter_of_yojson);
    tag_filter_mode =
      Json.optional fields "tag_filter_mode" tag_filter_mode_of_yojson;
    tag_option_ids =
      Json.optional fields "tag_option_ids" (Json.list Json.string);
  }

and yojson_of_entity_filters : entity_filters -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "agent_session_filters",
        Option.map yojson_of_agent_session_filters value.agent_session_filters
      );
      ( "calendar_event_filters",
        Option.map yojson_of_calendar_event_filters value.calendar_event_filters
      );
      ("call_filters", Option.map yojson_of_call_filters value.call_filters);
      ( "channel_filters",
        Option.map yojson_of_channel_filters value.channel_filters );
      ( "channel_thread_filters",
        Option.map yojson_of_channel_thread_filters value.channel_thread_filters
      );
      ("chat_filters", Option.map yojson_of_chat_filters value.chat_filters);
      ( "crm_company_filters",
        Option.map yojson_of_crm_company_filters value.crm_company_filters );
      ( "document_filters",
        Option.map yojson_of_document_filters value.document_filters );
      ("email_filters", Option.map yojson_of_email_filters value.email_filters);
      ("favorites_only", Option.map Json.of_bool value.favorites_only);
      ( "foreign_entity_filters",
        Option.map yojson_of_foreign_entity_filters value.foreign_entity_filters
      );
      ( "initiative_filters",
        Option.map yojson_of_initiative_filters value.initiative_filters );
      ( "project_filters",
        Option.map yojson_of_project_filters value.project_filters );
      ( "property_filters",
        Option.map
          (Json.of_list yojson_of_property_filter)
          value.property_filters );
      ( "tag_filter_mode",
        Option.map yojson_of_tag_filter_mode value.tag_filter_mode );
      ( "tag_option_ids",
        Option.map (Json.of_list Json.of_string) value.tag_option_ids );
    ]

let make_entity_filters ?agent_session_filters ?calendar_event_filters
    ?call_filters ?channel_filters ?channel_thread_filters ?chat_filters
    ?crm_company_filters ?document_filters ?email_filters ?favorites_only
    ?foreign_entity_filters ?initiative_filters ?project_filters
    ?property_filters ?tag_filter_mode ?tag_option_ids () =
  ({
     agent_session_filters;
     calendar_event_filters;
     call_filters;
     channel_filters;
     channel_thread_filters;
     chat_filters;
     crm_company_filters;
     document_filters;
     email_filters;
     favorites_only;
     foreign_entity_filters;
     initiative_filters;
     project_filters;
     property_filters;
     tag_filter_mode;
     tag_option_ids;
   }
    : entity_filters)

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

let file_type_of_yojson : Yojson.Safe.t -> file_type =
 fun json ->
  match Json.string json with
  | "docx" -> Docx
  | "pdf" -> Pdf
  | "md" -> Md
  | "spreadsheet" -> Spreadsheet
  | "canvas" -> Canvas
  | "coffee" -> Coffee
  | "cson" -> Cson
  | "iced" -> Iced
  | "c" -> C
  | "i" -> I
  | "cpp" -> Cpp
  | "cppm" -> Cppm
  | "cc" -> Cc
  | "ccm" -> Ccm
  | "cxx" -> Cxx
  | "cxxm" -> Cxxm
  | "cplusplus" -> Cplusplus
  | "cplusplusm" -> Cplusplusm
  | "hpp" -> Hpp
  | "hh" -> Hh
  | "hxx" -> Hxx
  | "hplusplus" -> Hplusplus
  | "h" -> H
  | "ii" -> Ii
  | "ino" -> Ino
  | "inl" -> Inl
  | "ipp" -> Ipp
  | "ixx" -> Ixx
  | "tpp" -> Tpp
  | "txx" -> Txx
  | "hppin" -> Hppin
  | "hin" -> Hin
  | "cu" -> Cu
  | "cuh" -> Cuh
  | "cs" -> Cs
  | "csx" -> Csx
  | "cake" -> Cake
  | "css" -> Css
  | "dart" -> Dart
  | "diff" -> Diff
  | "patch" -> Patch
  | "rej" -> Rej
  | "dockerfile" -> Dockerfile
  | "containerfile" -> Containerfile
  | "go" -> Go
  | "handlebars" -> Handlebars
  | "hbs" -> Hbs
  | "hjs" -> Hjs
  | "hlsl" -> Hlsl
  | "hlsli" -> Hlsli
  | "fx" -> Fx
  | "fxh" -> Fxh
  | "vsh" -> Vsh
  | "psh" -> Psh
  | "cginc" -> Cginc
  | "compute" -> Compute
  | "html" -> Html
  | "htm" -> Htm
  | "shtml" -> Shtml
  | "xhtml" -> Xhtml
  | "xht" -> Xht
  | "mdoc" -> Mdoc
  | "jsp" -> Jsp
  | "asp" -> Asp
  | "aspx" -> Aspx
  | "jshtm" -> Jshtm
  | "volt" -> Volt
  | "ejs" -> Ejs
  | "rhtml" -> Rhtml
  | "ini" -> Ini
  | "conf" -> Conf
  | "properties" -> Properties
  | "cfg" -> Cfg
  | "directory" -> Directory
  | "gitattributes" -> Gitattributes
  | "gitconfig" -> Gitconfig
  | "gitmodules" -> Gitmodules
  | "editorconfig" -> Editorconfig
  | "repo" -> Repo
  | "java" -> Java
  | "jav" -> Jav
  | "jsx" -> Jsx
  | "js" -> Js
  | "es6" -> Es6
  | "mjs" -> Mjs
  | "cjs" -> Cjs
  | "pac" -> Pac
  | "json" -> Json
  | "bowerrc" -> Bowerrc
  | "jscsrc" -> Jscsrc
  | "webmanifest" -> Webmanifest
  | "jsmap" -> Jsmap
  | "cssmap" -> Cssmap
  | "tsmap" -> Tsmap
  | "har" -> Har
  | "jslintrc" -> Jslintrc
  | "jsonld" -> Jsonld
  | "geojson" -> Geojson
  | "ipynb" -> Ipynb
  | "vuerc" -> Vuerc
  | "jsonc" -> Jsonc
  | "eslintrc" -> Eslintrc
  | "eslintrcjson" -> Eslintrcjson
  | "jsfmtrc" -> Jsfmtrc
  | "jshintrc" -> Jshintrc
  | "swcrc" -> Swcrc
  | "hintrc" -> Hintrc
  | "babelrc" -> Babelrc
  | "jsonl" -> Jsonl
  | "ndjson" -> Ndjson
  | "codesnippets" -> Codesnippets
  | "jl" -> Jl
  | "jmd" -> Jmd
  | "sty" -> Sty
  | "cls" -> Cls
  | "bbx" -> Bbx
  | "cbx" -> Cbx
  | "tex" -> Tex
  | "ltx" -> Ltx
  | "ctx" -> Ctx
  | "bib" -> Bib
  | "less" -> Less
  | "log" -> Log
  | "lua" -> Lua
  | "mak" -> Mak
  | "mk" -> Mk
  | "mkd" -> Mkd
  | "mdwn" -> Mdwn
  | "mdown" -> Mdown
  | "markdown" -> Markdown
  | "markdn" -> Markdn
  | "mdtxt" -> Mdtxt
  | "mdtext" -> Mdtext
  | "workbook" -> Workbook
  | "m" -> M
  | "mm" -> Mm
  | "pl" -> Pl
  | "pm" -> Pm
  | "pod" -> Pod
  | "t" -> T
  | "psgi" -> Psgi
  | "raku" -> Raku
  | "rakumod" -> Rakumod
  | "rakutest" -> Rakutest
  | "rakudoc" -> Rakudoc
  | "nqp" -> Nqp
  | "p6" -> P6
  | "pl6" -> Pl6
  | "pm6" -> Pm6
  | "php" -> Php
  | "php4" -> Php4
  | "php5" -> Php5
  | "phtml" -> Phtml
  | "ctp" -> Ctp
  | "ps1" -> Ps1
  | "psm1" -> Psm1
  | "psd1" -> Psd1
  | "pssc" -> Pssc
  | "psrc" -> Psrc
  | "py" -> Py
  | "rpy" -> Rpy
  | "pyw" -> Pyw
  | "cpy" -> Cpy
  | "gyp" -> Gyp
  | "gypi" -> Gypi
  | "pyi" -> Pyi
  | "ipy" -> Ipy
  | "pyt" -> Pyt
  | "r" -> R
  | "rhistory" -> Rhistory
  | "rprofile" -> Rprofile
  | "rt" -> Rt
  | "cshtml" -> Cshtml
  | "razor" -> Razor
  | "rb" -> Rb
  | "rbx" -> Rbx
  | "rjs" -> Rjs
  | "gemspec" -> Gemspec
  | "rake" -> Rake
  | "ru" -> Ru
  | "erb" -> Erb
  | "podspec" -> Podspec
  | "rbi" -> Rbi
  | "rs" -> Rs
  | "scss" -> Scss
  | "sass" -> Sass
  | "shader" -> Shader
  | "sh" -> Sh
  | "bash" -> Bash
  | "bashrc" -> Bashrc
  | "bashaliases" -> Bashaliases
  | "bashprofile" -> Bashprofile
  | "bashlogin" -> Bashlogin
  | "ebuild" -> Ebuild
  | "eclass" -> Eclass
  | "profile" -> Profile
  | "bashlogout" -> Bashlogout
  | "xprofile" -> Xprofile
  | "xsession" -> Xsession
  | "xsessionrc" -> Xsessionrc
  | "zsh" -> Zsh
  | "zshrc" -> Zshrc
  | "zprofile" -> Zprofile
  | "zlogin" -> Zlogin
  | "zlogout" -> Zlogout
  | "zshenv" -> Zshenv
  | "zshtheme" -> Zshtheme
  | "fish" -> Fish
  | "ksh" -> Ksh
  | "csh" -> Csh
  | "cshrc" -> Cshrc
  | "tcshrc" -> Tcshrc
  | "yashrc" -> Yashrc
  | "yashprofile" -> Yashprofile
  | "sql" -> Sql
  | "dsql" -> Dsql
  | "swift" -> Swift
  | "ts" -> Ts
  | "cts" -> Cts
  | "mts" -> Mts
  | "tsx" -> Tsx
  | "tsbuildinfo" -> Tsbuildinfo
  | "xml" -> Xml
  | "xsd" -> Xsd
  | "ascx" -> Ascx
  | "atom" -> Atom
  | "axml" -> Axml
  | "axaml" -> Axaml
  | "bpmn" -> Bpmn
  | "cpt" -> Cpt
  | "csl" -> Csl
  | "csproj" -> Csproj
  | "csprojuser" -> Csprojuser
  | "dita" -> Dita
  | "ditamap" -> Ditamap
  | "dtd" -> Dtd
  | "ent" -> Ent
  | "mod" -> Mod
  | "dtml" -> Dtml
  | "fsproj" -> Fsproj
  | "fxml" -> Fxml
  | "iml" -> Iml
  | "isml" -> Isml
  | "jmx" -> Jmx
  | "launch" -> Launch
  | "menu" -> Menu
  | "mxml" -> Mxml
  | "nuspec" -> Nuspec
  | "opml" -> Opml
  | "owl" -> Owl
  | "proj" -> Proj
  | "props" -> Props
  | "pt" -> Pt
  | "publishsettings" -> Publishsettings
  | "pubxml" -> Pubxml
  | "pubxmluser" -> Pubxmluser
  | "rbxlx" -> Rbxlx
  | "rbxmx" -> Rbxmx
  | "rdf" -> Rdf
  | "rng" -> Rng
  | "rss" -> Rss
  | "shproj" -> Shproj
  | "storyboard" -> Storyboard
  | "targets" -> Targets
  | "tld" -> Tld
  | "tmx" -> Tmx
  | "vbproj" -> Vbproj
  | "vbprojuser" -> Vbprojuser
  | "vcxproj" -> Vcxproj
  | "vcxprojfilters" -> Vcxprojfilters
  | "wsdl" -> Wsdl
  | "wxi" -> Wxi
  | "wxl" -> Wxl
  | "wxs" -> Wxs
  | "xaml" -> Xaml
  | "xbl" -> Xbl
  | "xib" -> Xib
  | "xlf" -> Xlf
  | "xliff" -> Xliff
  | "xpdl" -> Xpdl
  | "xul" -> Xul
  | "xoml" -> Xoml
  | "xsl" -> Xsl
  | "xslt" -> Xslt
  | "yaml" -> Yaml
  | "yml" -> Yml
  | "eyaml" -> Eyaml
  | "eyml" -> Eyml
  | "cff" -> Cff
  | "yamltmlanguage" -> Yamltmlanguage
  | "yamltmpreferences" -> Yamltmpreferences
  | "yamltmtheme" -> Yamltmtheme
  | "winget" -> Winget
  | "txt" -> Txt
  | "csv" -> Csv
  | "tsv" -> Tsv
  | "jpeg" -> Jpeg
  | "jpg" -> Jpg
  | "png" -> Png
  | "gif" -> Gif
  | "svg" -> Svg
  | "webp" -> Webp
  | "avif" -> Avif
  | "bmp" -> Bmp
  | "ico" -> Ico
  | "tiff" -> Tiff
  | "tif" -> Tif
  | "heic" -> Heic
  | "heif" -> Heif
  | "tar" -> Tar
  | "targz" -> Targz
  | "tgz" -> Tgz
  | "gz" -> Gz
  | "bz2" -> Bz2
  | "tarbz2" -> Tarbz2
  | "tbz2" -> Tbz2
  | "z" -> Z
  | "tarz" -> Tarz
  | "lz" -> Lz
  | "tarlz" -> Tarlz
  | "xz" -> Xz
  | "tarxz" -> Tarxz
  | "txz" -> Txz
  | "lzma" -> Lzma
  | "tarlzma" -> Tarlzma
  | "rar" -> Rar
  | "sevenz" -> Sevenz
  | "zst" -> Zst
  | "tarzst" -> Tarzst
  | "tzst" -> Tzst
  | "zip" -> Zip
  | "exe" -> Exe
  | "msi" -> Msi
  | "dll" -> Dll
  | "bat" -> Bat
  | "cmd" -> Cmd
  | "com" -> Com
  | "appimage" -> Appimage
  | "app" -> App
  | "bin" -> Bin
  | "deb" -> Deb
  | "rpm" -> Rpm
  | "apk" -> Apk
  | "dmg" -> Dmg
  | "pkg" -> Pkg
  | "crx" -> Crx
  | "xpi" -> Xpi
  | "mp3" -> Mp3
  | "wav" -> Wav
  | "ogg" -> Ogg
  | "flac" -> Flac
  | "aac" -> Aac
  | "m4a" -> M4a
  | "wma" -> Wma
  | "mid" -> Mid
  | "midi" -> Midi
  | "mp4" -> Mp4
  | "mkv" -> Mkv
  | "webm" -> Webm
  | "avi" -> Avi
  | "mov" -> Mov
  | "wmv" -> Wmv
  | "mpg" -> Mpg
  | "mpeg" -> Mpeg
  | "m4v" -> M4v
  | "flv" -> Flv
  | "f4v" -> F4v
  | "threegp" -> Threegp
  | "ttf" -> Ttf
  | "otf" -> Otf
  | "woff" -> Woff
  | "woff2" -> Woff2
  | "eot" -> Eot
  | "rtf" -> Rtf
  | "odt" -> Odt
  | "ods" -> Ods
  | "odp" -> Odp
  | "odg" -> Odg
  | "odf" -> Odf
  | "epub" -> Epub
  | "mobi" -> Mobi
  | "azw" -> Azw
  | "azw3" -> Azw3
  | "djvu" -> Djvu
  | "xls" -> Xls
  | "xlsm" -> Xlsm
  | "ppt" -> Ppt
  | "doc" -> Doc
  | "pptx" -> Pptx
  | "xlsx" -> Xlsx
  | "db" -> Db
  | "sqlite" -> Sqlite
  | "sqlite3" -> Sqlite3
  | "mdb" -> Mdb
  | "accdb" -> Accdb
  | "dbf" -> Dbf
  | "plist" -> Plist
  | "toml" -> Toml
  | "env" -> Env
  | "dot" -> Dot
  | "gv" -> Gv
  | "torrent" -> Torrent
  | "ics" -> Ics
  | "vcf" -> Vcf
  | "ai" -> Ai
  | "eps" -> Eps
  | "ps" -> Ps
  | "dxf" -> Dxf
  | "dwg" -> Dwg
  | "fig" -> Fig
  | "psd" -> Psd
  | "psb" -> Psb
  | "stl" -> Stl
  | "obj" -> Obj
  | "fbx" -> Fbx
  | "blend" -> Blend
  | "dae" -> Dae
  | "threeds" -> Threeds
  | "gltf" -> Gltf
  | "glb" -> Glb
  | "vhd" -> Vhd
  | "vhdx" -> Vhdx
  | "vmdk" -> Vmdk
  | "ova" -> Ova
  | "ovf" -> Ovf
  | "iso" -> Iso
  | "img" -> Img
  | "swf" -> Swf
  | other -> Unknown other

and yojson_of_file_type : file_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Docx -> `String "docx"
  | Pdf -> `String "pdf"
  | Md -> `String "md"
  | Spreadsheet -> `String "spreadsheet"
  | Canvas -> `String "canvas"
  | Coffee -> `String "coffee"
  | Cson -> `String "cson"
  | Iced -> `String "iced"
  | C -> `String "c"
  | I -> `String "i"
  | Cpp -> `String "cpp"
  | Cppm -> `String "cppm"
  | Cc -> `String "cc"
  | Ccm -> `String "ccm"
  | Cxx -> `String "cxx"
  | Cxxm -> `String "cxxm"
  | Cplusplus -> `String "cplusplus"
  | Cplusplusm -> `String "cplusplusm"
  | Hpp -> `String "hpp"
  | Hh -> `String "hh"
  | Hxx -> `String "hxx"
  | Hplusplus -> `String "hplusplus"
  | H -> `String "h"
  | Ii -> `String "ii"
  | Ino -> `String "ino"
  | Inl -> `String "inl"
  | Ipp -> `String "ipp"
  | Ixx -> `String "ixx"
  | Tpp -> `String "tpp"
  | Txx -> `String "txx"
  | Hppin -> `String "hppin"
  | Hin -> `String "hin"
  | Cu -> `String "cu"
  | Cuh -> `String "cuh"
  | Cs -> `String "cs"
  | Csx -> `String "csx"
  | Cake -> `String "cake"
  | Css -> `String "css"
  | Dart -> `String "dart"
  | Diff -> `String "diff"
  | Patch -> `String "patch"
  | Rej -> `String "rej"
  | Dockerfile -> `String "dockerfile"
  | Containerfile -> `String "containerfile"
  | Go -> `String "go"
  | Handlebars -> `String "handlebars"
  | Hbs -> `String "hbs"
  | Hjs -> `String "hjs"
  | Hlsl -> `String "hlsl"
  | Hlsli -> `String "hlsli"
  | Fx -> `String "fx"
  | Fxh -> `String "fxh"
  | Vsh -> `String "vsh"
  | Psh -> `String "psh"
  | Cginc -> `String "cginc"
  | Compute -> `String "compute"
  | Html -> `String "html"
  | Htm -> `String "htm"
  | Shtml -> `String "shtml"
  | Xhtml -> `String "xhtml"
  | Xht -> `String "xht"
  | Mdoc -> `String "mdoc"
  | Jsp -> `String "jsp"
  | Asp -> `String "asp"
  | Aspx -> `String "aspx"
  | Jshtm -> `String "jshtm"
  | Volt -> `String "volt"
  | Ejs -> `String "ejs"
  | Rhtml -> `String "rhtml"
  | Ini -> `String "ini"
  | Conf -> `String "conf"
  | Properties -> `String "properties"
  | Cfg -> `String "cfg"
  | Directory -> `String "directory"
  | Gitattributes -> `String "gitattributes"
  | Gitconfig -> `String "gitconfig"
  | Gitmodules -> `String "gitmodules"
  | Editorconfig -> `String "editorconfig"
  | Repo -> `String "repo"
  | Java -> `String "java"
  | Jav -> `String "jav"
  | Jsx -> `String "jsx"
  | Js -> `String "js"
  | Es6 -> `String "es6"
  | Mjs -> `String "mjs"
  | Cjs -> `String "cjs"
  | Pac -> `String "pac"
  | Json -> `String "json"
  | Bowerrc -> `String "bowerrc"
  | Jscsrc -> `String "jscsrc"
  | Webmanifest -> `String "webmanifest"
  | Jsmap -> `String "jsmap"
  | Cssmap -> `String "cssmap"
  | Tsmap -> `String "tsmap"
  | Har -> `String "har"
  | Jslintrc -> `String "jslintrc"
  | Jsonld -> `String "jsonld"
  | Geojson -> `String "geojson"
  | Ipynb -> `String "ipynb"
  | Vuerc -> `String "vuerc"
  | Jsonc -> `String "jsonc"
  | Eslintrc -> `String "eslintrc"
  | Eslintrcjson -> `String "eslintrcjson"
  | Jsfmtrc -> `String "jsfmtrc"
  | Jshintrc -> `String "jshintrc"
  | Swcrc -> `String "swcrc"
  | Hintrc -> `String "hintrc"
  | Babelrc -> `String "babelrc"
  | Jsonl -> `String "jsonl"
  | Ndjson -> `String "ndjson"
  | Codesnippets -> `String "codesnippets"
  | Jl -> `String "jl"
  | Jmd -> `String "jmd"
  | Sty -> `String "sty"
  | Cls -> `String "cls"
  | Bbx -> `String "bbx"
  | Cbx -> `String "cbx"
  | Tex -> `String "tex"
  | Ltx -> `String "ltx"
  | Ctx -> `String "ctx"
  | Bib -> `String "bib"
  | Less -> `String "less"
  | Log -> `String "log"
  | Lua -> `String "lua"
  | Mak -> `String "mak"
  | Mk -> `String "mk"
  | Mkd -> `String "mkd"
  | Mdwn -> `String "mdwn"
  | Mdown -> `String "mdown"
  | Markdown -> `String "markdown"
  | Markdn -> `String "markdn"
  | Mdtxt -> `String "mdtxt"
  | Mdtext -> `String "mdtext"
  | Workbook -> `String "workbook"
  | M -> `String "m"
  | Mm -> `String "mm"
  | Pl -> `String "pl"
  | Pm -> `String "pm"
  | Pod -> `String "pod"
  | T -> `String "t"
  | Psgi -> `String "psgi"
  | Raku -> `String "raku"
  | Rakumod -> `String "rakumod"
  | Rakutest -> `String "rakutest"
  | Rakudoc -> `String "rakudoc"
  | Nqp -> `String "nqp"
  | P6 -> `String "p6"
  | Pl6 -> `String "pl6"
  | Pm6 -> `String "pm6"
  | Php -> `String "php"
  | Php4 -> `String "php4"
  | Php5 -> `String "php5"
  | Phtml -> `String "phtml"
  | Ctp -> `String "ctp"
  | Ps1 -> `String "ps1"
  | Psm1 -> `String "psm1"
  | Psd1 -> `String "psd1"
  | Pssc -> `String "pssc"
  | Psrc -> `String "psrc"
  | Py -> `String "py"
  | Rpy -> `String "rpy"
  | Pyw -> `String "pyw"
  | Cpy -> `String "cpy"
  | Gyp -> `String "gyp"
  | Gypi -> `String "gypi"
  | Pyi -> `String "pyi"
  | Ipy -> `String "ipy"
  | Pyt -> `String "pyt"
  | R -> `String "r"
  | Rhistory -> `String "rhistory"
  | Rprofile -> `String "rprofile"
  | Rt -> `String "rt"
  | Cshtml -> `String "cshtml"
  | Razor -> `String "razor"
  | Rb -> `String "rb"
  | Rbx -> `String "rbx"
  | Rjs -> `String "rjs"
  | Gemspec -> `String "gemspec"
  | Rake -> `String "rake"
  | Ru -> `String "ru"
  | Erb -> `String "erb"
  | Podspec -> `String "podspec"
  | Rbi -> `String "rbi"
  | Rs -> `String "rs"
  | Scss -> `String "scss"
  | Sass -> `String "sass"
  | Shader -> `String "shader"
  | Sh -> `String "sh"
  | Bash -> `String "bash"
  | Bashrc -> `String "bashrc"
  | Bashaliases -> `String "bashaliases"
  | Bashprofile -> `String "bashprofile"
  | Bashlogin -> `String "bashlogin"
  | Ebuild -> `String "ebuild"
  | Eclass -> `String "eclass"
  | Profile -> `String "profile"
  | Bashlogout -> `String "bashlogout"
  | Xprofile -> `String "xprofile"
  | Xsession -> `String "xsession"
  | Xsessionrc -> `String "xsessionrc"
  | Zsh -> `String "zsh"
  | Zshrc -> `String "zshrc"
  | Zprofile -> `String "zprofile"
  | Zlogin -> `String "zlogin"
  | Zlogout -> `String "zlogout"
  | Zshenv -> `String "zshenv"
  | Zshtheme -> `String "zshtheme"
  | Fish -> `String "fish"
  | Ksh -> `String "ksh"
  | Csh -> `String "csh"
  | Cshrc -> `String "cshrc"
  | Tcshrc -> `String "tcshrc"
  | Yashrc -> `String "yashrc"
  | Yashprofile -> `String "yashprofile"
  | Sql -> `String "sql"
  | Dsql -> `String "dsql"
  | Swift -> `String "swift"
  | Ts -> `String "ts"
  | Cts -> `String "cts"
  | Mts -> `String "mts"
  | Tsx -> `String "tsx"
  | Tsbuildinfo -> `String "tsbuildinfo"
  | Xml -> `String "xml"
  | Xsd -> `String "xsd"
  | Ascx -> `String "ascx"
  | Atom -> `String "atom"
  | Axml -> `String "axml"
  | Axaml -> `String "axaml"
  | Bpmn -> `String "bpmn"
  | Cpt -> `String "cpt"
  | Csl -> `String "csl"
  | Csproj -> `String "csproj"
  | Csprojuser -> `String "csprojuser"
  | Dita -> `String "dita"
  | Ditamap -> `String "ditamap"
  | Dtd -> `String "dtd"
  | Ent -> `String "ent"
  | Mod -> `String "mod"
  | Dtml -> `String "dtml"
  | Fsproj -> `String "fsproj"
  | Fxml -> `String "fxml"
  | Iml -> `String "iml"
  | Isml -> `String "isml"
  | Jmx -> `String "jmx"
  | Launch -> `String "launch"
  | Menu -> `String "menu"
  | Mxml -> `String "mxml"
  | Nuspec -> `String "nuspec"
  | Opml -> `String "opml"
  | Owl -> `String "owl"
  | Proj -> `String "proj"
  | Props -> `String "props"
  | Pt -> `String "pt"
  | Publishsettings -> `String "publishsettings"
  | Pubxml -> `String "pubxml"
  | Pubxmluser -> `String "pubxmluser"
  | Rbxlx -> `String "rbxlx"
  | Rbxmx -> `String "rbxmx"
  | Rdf -> `String "rdf"
  | Rng -> `String "rng"
  | Rss -> `String "rss"
  | Shproj -> `String "shproj"
  | Storyboard -> `String "storyboard"
  | Targets -> `String "targets"
  | Tld -> `String "tld"
  | Tmx -> `String "tmx"
  | Vbproj -> `String "vbproj"
  | Vbprojuser -> `String "vbprojuser"
  | Vcxproj -> `String "vcxproj"
  | Vcxprojfilters -> `String "vcxprojfilters"
  | Wsdl -> `String "wsdl"
  | Wxi -> `String "wxi"
  | Wxl -> `String "wxl"
  | Wxs -> `String "wxs"
  | Xaml -> `String "xaml"
  | Xbl -> `String "xbl"
  | Xib -> `String "xib"
  | Xlf -> `String "xlf"
  | Xliff -> `String "xliff"
  | Xpdl -> `String "xpdl"
  | Xul -> `String "xul"
  | Xoml -> `String "xoml"
  | Xsl -> `String "xsl"
  | Xslt -> `String "xslt"
  | Yaml -> `String "yaml"
  | Yml -> `String "yml"
  | Eyaml -> `String "eyaml"
  | Eyml -> `String "eyml"
  | Cff -> `String "cff"
  | Yamltmlanguage -> `String "yamltmlanguage"
  | Yamltmpreferences -> `String "yamltmpreferences"
  | Yamltmtheme -> `String "yamltmtheme"
  | Winget -> `String "winget"
  | Txt -> `String "txt"
  | Csv -> `String "csv"
  | Tsv -> `String "tsv"
  | Jpeg -> `String "jpeg"
  | Jpg -> `String "jpg"
  | Png -> `String "png"
  | Gif -> `String "gif"
  | Svg -> `String "svg"
  | Webp -> `String "webp"
  | Avif -> `String "avif"
  | Bmp -> `String "bmp"
  | Ico -> `String "ico"
  | Tiff -> `String "tiff"
  | Tif -> `String "tif"
  | Heic -> `String "heic"
  | Heif -> `String "heif"
  | Tar -> `String "tar"
  | Targz -> `String "targz"
  | Tgz -> `String "tgz"
  | Gz -> `String "gz"
  | Bz2 -> `String "bz2"
  | Tarbz2 -> `String "tarbz2"
  | Tbz2 -> `String "tbz2"
  | Z -> `String "z"
  | Tarz -> `String "tarz"
  | Lz -> `String "lz"
  | Tarlz -> `String "tarlz"
  | Xz -> `String "xz"
  | Tarxz -> `String "tarxz"
  | Txz -> `String "txz"
  | Lzma -> `String "lzma"
  | Tarlzma -> `String "tarlzma"
  | Rar -> `String "rar"
  | Sevenz -> `String "sevenz"
  | Zst -> `String "zst"
  | Tarzst -> `String "tarzst"
  | Tzst -> `String "tzst"
  | Zip -> `String "zip"
  | Exe -> `String "exe"
  | Msi -> `String "msi"
  | Dll -> `String "dll"
  | Bat -> `String "bat"
  | Cmd -> `String "cmd"
  | Com -> `String "com"
  | Appimage -> `String "appimage"
  | App -> `String "app"
  | Bin -> `String "bin"
  | Deb -> `String "deb"
  | Rpm -> `String "rpm"
  | Apk -> `String "apk"
  | Dmg -> `String "dmg"
  | Pkg -> `String "pkg"
  | Crx -> `String "crx"
  | Xpi -> `String "xpi"
  | Mp3 -> `String "mp3"
  | Wav -> `String "wav"
  | Ogg -> `String "ogg"
  | Flac -> `String "flac"
  | Aac -> `String "aac"
  | M4a -> `String "m4a"
  | Wma -> `String "wma"
  | Mid -> `String "mid"
  | Midi -> `String "midi"
  | Mp4 -> `String "mp4"
  | Mkv -> `String "mkv"
  | Webm -> `String "webm"
  | Avi -> `String "avi"
  | Mov -> `String "mov"
  | Wmv -> `String "wmv"
  | Mpg -> `String "mpg"
  | Mpeg -> `String "mpeg"
  | M4v -> `String "m4v"
  | Flv -> `String "flv"
  | F4v -> `String "f4v"
  | Threegp -> `String "threegp"
  | Ttf -> `String "ttf"
  | Otf -> `String "otf"
  | Woff -> `String "woff"
  | Woff2 -> `String "woff2"
  | Eot -> `String "eot"
  | Rtf -> `String "rtf"
  | Odt -> `String "odt"
  | Ods -> `String "ods"
  | Odp -> `String "odp"
  | Odg -> `String "odg"
  | Odf -> `String "odf"
  | Epub -> `String "epub"
  | Mobi -> `String "mobi"
  | Azw -> `String "azw"
  | Azw3 -> `String "azw3"
  | Djvu -> `String "djvu"
  | Xls -> `String "xls"
  | Xlsm -> `String "xlsm"
  | Ppt -> `String "ppt"
  | Doc -> `String "doc"
  | Pptx -> `String "pptx"
  | Xlsx -> `String "xlsx"
  | Db -> `String "db"
  | Sqlite -> `String "sqlite"
  | Sqlite3 -> `String "sqlite3"
  | Mdb -> `String "mdb"
  | Accdb -> `String "accdb"
  | Dbf -> `String "dbf"
  | Plist -> `String "plist"
  | Toml -> `String "toml"
  | Env -> `String "env"
  | Dot -> `String "dot"
  | Gv -> `String "gv"
  | Torrent -> `String "torrent"
  | Ics -> `String "ics"
  | Vcf -> `String "vcf"
  | Ai -> `String "ai"
  | Eps -> `String "eps"
  | Ps -> `String "ps"
  | Dxf -> `String "dxf"
  | Dwg -> `String "dwg"
  | Fig -> `String "fig"
  | Psd -> `String "psd"
  | Psb -> `String "psb"
  | Stl -> `String "stl"
  | Obj -> `String "obj"
  | Fbx -> `String "fbx"
  | Blend -> `String "blend"
  | Dae -> `String "dae"
  | Threeds -> `String "threeds"
  | Gltf -> `String "gltf"
  | Glb -> `String "glb"
  | Vhd -> `String "vhd"
  | Vhdx -> `String "vhdx"
  | Vmdk -> `String "vmdk"
  | Ova -> `String "ova"
  | Ovf -> `String "ovf"
  | Iso -> `String "iso"
  | Img -> `String "img"
  | Swf -> `String "swf"
  | Unknown other -> `String other

type nonrec highlight = {
  content : string list option;
      (** If the match was on the entity content, this will provide a list of highlights
for each content match *)
  name : string option;
      (** If the match was on the entity name, this will be present with that highlight *)
}
(** The search service version of a highlight *)

let highlight_of_yojson : Yojson.Safe.t -> highlight =
 fun json ->
  let fields = Json.obj json in
  {
    content = Json.optional fields "content" (Json.list Json.string);
    name = Json.optional fields "name" Json.string;
  }

and yojson_of_highlight : highlight -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("content", Option.map (Json.of_list Json.of_string) value.content);
      ("name", Option.map Json.of_string value.name);
    ]

let make_highlight ?content ?name () = ({ content; name } : highlight)

type nonrec project_metadata = {
  created_at : string;
  deleted_at : string option;
  parent_project_id : string option;
  updated_at : string;
  viewed_at : string option;
}
(** Metadata for a project fetched from the database *)

let project_metadata_of_yojson : Yojson.Safe.t -> project_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    deleted_at = Json.optional fields "deleted_at" Json.string;
    parent_project_id = Json.optional fields "parent_project_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    viewed_at = Json.optional fields "viewed_at" Json.string;
  }

and yojson_of_project_metadata : project_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("deleted_at", Option.map Json.of_string value.deleted_at);
      ("parent_project_id", Option.map Json.of_string value.parent_project_id);
      ("updated_at", Some (Json.of_string value.updated_at));
      ("viewed_at", Option.map Json.of_string value.viewed_at);
    ]

let make_project_metadata ~(created_at : string) ?deleted_at ?parent_project_id
    ~(updated_at : string) ?viewed_at () =
  ({ created_at; deleted_at; parent_project_id; updated_at; viewed_at }
    : project_metadata)

type nonrec project_search_metadata = {
  created_at : string;
  owner_id : string;
  project_id : string;
  project_name : string;
  updated_at : string;
}
(** Metadata associated with Project Search, to be used with SearchResponseItem *)

let project_search_metadata_of_yojson : Yojson.Safe.t -> project_search_metadata
    =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    project_id = Json.required fields "project_id" Json.string;
    project_name = Json.required fields "project_name" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_project_search_metadata : project_search_metadata -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("project_id", Some (Json.of_string value.project_id));
      ("project_name", Some (Json.of_string value.project_name));
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_project_search_metadata ~(created_at : string) ~(owner_id : string)
    ~(project_id : string) ~(project_name : string) ~(updated_at : string) () =
  ({ created_at; owner_id; project_id; project_name; updated_at }
    : project_search_metadata)

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

let project_search_request_of_yojson : Yojson.Safe.t -> project_search_request =
 fun json ->
  let fields = Json.obj json in
  {
    importance = Json.optional fields "importance" Json.bool;
    include_root = Json.optional fields "include_root" Json.bool;
    notification_filters =
      Json.optional fields "notification_filters" notification_filters_of_yojson;
    owners = Json.optional fields "owners" (Json.list Json.string);
    project_ids = Json.optional fields "project_ids" (Json.list Json.string);
    collapse = Json.optional fields "collapse" Json.bool;
    match_type = Json.required fields "match_type" match_type_of_yojson;
    query = Json.optional fields "query" Json.string;
    search_on = Json.optional fields "search_on" search_on_of_yojson;
    terms = Json.optional fields "terms" (Json.list Json.string);
  }

and yojson_of_project_search_request : project_search_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("importance", Option.map Json.of_bool value.importance);
      ("include_root", Option.map Json.of_bool value.include_root);
      ( "notification_filters",
        Option.map yojson_of_notification_filters value.notification_filters );
      ("owners", Option.map (Json.of_list Json.of_string) value.owners);
      ("project_ids", Option.map (Json.of_list Json.of_string) value.project_ids);
      ("collapse", Option.map Json.of_bool value.collapse);
      ("match_type", Some (yojson_of_match_type value.match_type));
      ("query", Option.map Json.of_string value.query);
      ("search_on", Option.map yojson_of_search_on value.search_on);
      ("terms", Option.map (Json.of_list Json.of_string) value.terms);
    ]

let make_project_search_request ?importance ?include_root ?notification_filters
    ?owners ?project_ids ?collapse ~(match_type : match_type) ?query ?search_on
    ?terms () =
  ({
     importance;
     include_root;
     notification_filters;
     owners;
     project_ids;
     collapse;
     match_type;
     query;
     search_on;
     terms;
   }
    : project_search_request)

type nonrec project_search_result = {
  highlight : search_highlight;
  score : float option;  (** The score of the result *)
}

let project_search_result_of_yojson : Yojson.Safe.t -> project_search_result =
 fun json ->
  let fields = Json.obj json in
  {
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    score = Json.optional fields "score" Json.float;
  }

and yojson_of_project_search_result : project_search_result -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("score", Option.map Json.of_float value.score);
    ]

let make_project_search_result ~(highlight : search_highlight) ?score () =
  ({ highlight; score } : project_search_result)

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

let project_search_response_item_of_yojson :
    Yojson.Safe.t -> project_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    project_search_results =
      Json.required fields "project_search_results"
        (Json.list project_search_result_of_yojson);
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_project_search_response_item :
    project_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ( "project_search_results",
        Some
          ((Json.of_list yojson_of_project_search_result)
             value.project_search_results) );
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_project_search_response_item ~(created_at : string) ~(id : string)
    ~(name : string) ~(owner_id : string)
    ~(project_search_results : project_search_result list)
    ~(updated_at : string) () =
  ({ created_at; id; name; owner_id; project_search_results; updated_at }
    : project_search_response_item)

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

let project_search_response_item_with_metadata_of_yojson :
    Yojson.Safe.t -> project_search_response_item_with_metadata =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    project_search_results =
      Json.required fields "project_search_results"
        (Json.list project_search_result_of_yojson);
    updated_at = Json.required fields "updated_at" Json.string;
    metadata = Json.optional fields "metadata" project_metadata_of_yojson;
    properties =
      Json.optional fields "properties" (Json.list soup_property_of_yojson);
  }

and yojson_of_project_search_response_item_with_metadata :
    project_search_response_item_with_metadata -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("owner_id", Some (Json.of_string value.owner_id));
      ( "project_search_results",
        Some
          ((Json.of_list yojson_of_project_search_result)
             value.project_search_results) );
      ("updated_at", Some (Json.of_string value.updated_at));
      ("metadata", Option.map yojson_of_project_metadata value.metadata);
      ( "properties",
        Option.map (Json.of_list yojson_of_soup_property) value.properties );
    ]

let make_project_search_response_item_with_metadata ~(created_at : string)
    ~(id : string) ~(name : string) ~(owner_id : string)
    ~(project_search_results : project_search_result list)
    ~(updated_at : string) ?metadata ?properties () =
  ({
     created_at;
     id;
     name;
     owner_id;
     project_search_results;
     updated_at;
     metadata;
     properties;
   }
    : project_search_response_item_with_metadata)

type nonrec search_goto_call_record = {
  channel_id : string option;
  ended_at : string option;
  participant_ids : string list;
  sequence_num : int;
  speaker_id : string;
  started_at : string;
  transcript_id : string;
}

let search_goto_call_record_of_yojson : Yojson.Safe.t -> search_goto_call_record
    =
 fun json ->
  let fields = Json.obj json in
  {
    channel_id = Json.optional fields "channel_id" Json.string;
    ended_at = Json.optional fields "ended_at" Json.string;
    participant_ids =
      Json.required fields "participant_ids" (Json.list Json.string);
    sequence_num = Json.required fields "sequence_num" Json.int;
    speaker_id = Json.required fields "speaker_id" Json.string;
    started_at = Json.required fields "started_at" Json.string;
    transcript_id = Json.required fields "transcript_id" Json.string;
  }

and yojson_of_search_goto_call_record : search_goto_call_record -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("channel_id", Option.map Json.of_string value.channel_id);
      ("ended_at", Option.map Json.of_string value.ended_at);
      ( "participant_ids",
        Some ((Json.of_list Json.of_string) value.participant_ids) );
      ("sequence_num", Some (Json.of_int value.sequence_num));
      ("speaker_id", Some (Json.of_string value.speaker_id));
      ("started_at", Some (Json.of_string value.started_at));
      ("transcript_id", Some (Json.of_string value.transcript_id));
    ]

let make_search_goto_call_record ?channel_id ?ended_at
    ~(participant_ids : string list) ~(sequence_num : int)
    ~(speaker_id : string) ~(started_at : string) ~(transcript_id : string) () =
  ({
     channel_id;
     ended_at;
     participant_ids;
     sequence_num;
     speaker_id;
     started_at;
     transcript_id;
   }
    : search_goto_call_record)

type nonrec search_goto_channel = {
  channel_message_id : string;  (** The channel message id *)
}

let search_goto_channel_of_yojson : Yojson.Safe.t -> search_goto_channel =
 fun json ->
  let fields = Json.obj json in
  { channel_message_id = Json.required fields "channel_message_id" Json.string }

and yojson_of_search_goto_channel : search_goto_channel -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("channel_message_id", Some (Json.of_string value.channel_message_id)) ]

let make_search_goto_channel ~(channel_message_id : string) () =
  ({ channel_message_id } : search_goto_channel)

type nonrec search_goto_chat = {
  chat_message_id : string;  (** The chat message id *)
  role : string;  (** The role of the chat message *)
}

let search_goto_chat_of_yojson : Yojson.Safe.t -> search_goto_chat =
 fun json ->
  let fields = Json.obj json in
  {
    chat_message_id = Json.required fields "chat_message_id" Json.string;
    role = Json.required fields "role" Json.string;
  }

and yojson_of_search_goto_chat : search_goto_chat -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_message_id", Some (Json.of_string value.chat_message_id));
      ("role", Some (Json.of_string value.role));
    ]

let make_search_goto_chat ~(chat_message_id : string) ~(role : string) () =
  ({ chat_message_id; role } : search_goto_chat)

type nonrec search_goto_document = {
  node_id : string;
      (** The node id of the document
This can be a stringified page number 0-indexed for pdf/docx files,
or it can be a unique id that is used in lexical for markdown files. *)
  raw_content : string option;  (** The raw content of the document *)
}

let search_goto_document_of_yojson : Yojson.Safe.t -> search_goto_document =
 fun json ->
  let fields = Json.obj json in
  {
    node_id = Json.required fields "node_id" Json.string;
    raw_content = Json.optional fields "raw_content" Json.string;
  }

and yojson_of_search_goto_document : search_goto_document -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("node_id", Some (Json.of_string value.node_id));
      ("raw_content", Option.map Json.of_string value.raw_content);
    ]

let make_search_goto_document ~(node_id : string) ?raw_content () =
  ({ node_id; raw_content } : search_goto_document)

type nonrec search_goto_email = {
  bcc : string list;
  cc : string list;
  email_message_id : string;  (** The email message id *)
  labels : string list;
  recipients : string list;
  sender : string;
  sent_at : string option;
}

let search_goto_email_of_yojson : Yojson.Safe.t -> search_goto_email =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.required fields "bcc" (Json.list Json.string);
    cc = Json.required fields "cc" (Json.list Json.string);
    email_message_id = Json.required fields "email_message_id" Json.string;
    labels = Json.required fields "labels" (Json.list Json.string);
    recipients = Json.required fields "recipients" (Json.list Json.string);
    sender = Json.required fields "sender" Json.string;
    sent_at = Json.optional fields "sent_at" Json.string;
  }

and yojson_of_search_goto_email : search_goto_email -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Some ((Json.of_list Json.of_string) value.bcc));
      ("cc", Some ((Json.of_list Json.of_string) value.cc));
      ("email_message_id", Some (Json.of_string value.email_message_id));
      ("labels", Some ((Json.of_list Json.of_string) value.labels));
      ("recipients", Some ((Json.of_list Json.of_string) value.recipients));
      ("sender", Some (Json.of_string value.sender));
      ("sent_at", Option.map Json.of_string value.sent_at);
    ]

let make_search_goto_email ~(bcc : string list) ~(cc : string list)
    ~(email_message_id : string) ~(labels : string list)
    ~(recipients : string list) ~(sender : string) ?sent_at () =
  ({ bcc; cc; email_message_id; labels; recipients; sender; sent_at }
    : search_goto_email)

(** The search service version of a goto *)
type nonrec search_goto_content =
  | Search_goto_agent_session of search_goto_agent_session
  | Search_goto_document of search_goto_document
  | Search_goto_chat of search_goto_chat
  | Search_goto_email of search_goto_email
  | Search_goto_channel of search_goto_channel
  | Search_goto_call_record of search_goto_call_record

let search_goto_content_of_yojson : Yojson.Safe.t -> search_goto_content =
 fun json ->
  Json.first_ok
    [
      (fun json ->
        Search_goto_agent_session (search_goto_agent_session_of_yojson json));
      (fun json -> Search_goto_document (search_goto_document_of_yojson json));
      (fun json -> Search_goto_chat (search_goto_chat_of_yojson json));
      (fun json -> Search_goto_email (search_goto_email_of_yojson json));
      (fun json -> Search_goto_channel (search_goto_channel_of_yojson json));
      (fun json ->
        Search_goto_call_record (search_goto_call_record_of_yojson json));
    ]
    json

and yojson_of_search_goto_content : search_goto_content -> Yojson.Safe.t =
 fun value ->
  match value with
  | Search_goto_agent_session inner -> yojson_of_search_goto_agent_session inner
  | Search_goto_document inner -> yojson_of_search_goto_document inner
  | Search_goto_chat inner -> yojson_of_search_goto_chat inner
  | Search_goto_email inner -> yojson_of_search_goto_email inner
  | Search_goto_channel inner -> yojson_of_search_goto_channel inner
  | Search_goto_call_record inner -> yojson_of_search_goto_call_record inner

type nonrec search_response = {
  results : project_search_response_item_with_metadata list;
      (** List containing results from a request *)
}

let search_response_of_yojson : Yojson.Safe.t -> search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list project_search_response_item_with_metadata_of_yojson);
  }

and yojson_of_search_response : search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_project_search_response_item_with_metadata)
             value.results) );
    ]

let make_search_response
    ~(results : project_search_response_item_with_metadata list) () =
  ({ results } : search_response)

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

let simple_calendar_event_search_response_base_item_human_readable_timestamp_of_yojson
    :
    Yojson.Safe.t ->
    simple_calendar_event_search_response_base_item_human_readable_timestamp =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_event_id = Json.required fields "calendar_event_id" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    is_recurring = Json.required fields "is_recurring" Json.bool;
    occurrence_key = Json.optional fields "occurrence_key" Json.string;
    title = Json.required fields "title" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_simple_calendar_event_search_response_base_item_human_readable_timestamp
    :
    simple_calendar_event_search_response_base_item_human_readable_timestamp ->
    Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("calendar_event_id", Some (Json.of_string value.calendar_event_id));
      ("created_at", Some (Json.of_string value.created_at));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("is_recurring", Some (Json.of_bool value.is_recurring));
      ("occurrence_key", Option.map Json.of_string value.occurrence_key);
      ("title", Some (Json.of_string value.title));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_simple_calendar_event_search_response_base_item_human_readable_timestamp
    ~(calendar_event_id : string) ~(created_at : string)
    ~(highlight : search_highlight) ~(is_recurring : bool) ?occurrence_key
    ~(title : string) ~(updated_at : string) ~(user_id : string) () =
  ({
     calendar_event_id;
     created_at;
     highlight;
     is_recurring;
     occurrence_key;
     title;
     updated_at;
     user_id;
   }
    : simple_calendar_event_search_response_base_item_human_readable_timestamp)

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

let simple_call_record_search_response_base_item_human_readable_timestamp_of_yojson
    :
    Yojson.Safe.t ->
    simple_call_record_search_response_base_item_human_readable_timestamp =
 fun json ->
  let fields = Json.obj json in
  {
    call_id = Json.required fields "call_id" Json.string;
    channel_id = Json.optional fields "channel_id" Json.string;
    channel_name = Json.optional fields "channel_name" Json.string;
    duration_ms = Json.required fields "duration_ms" Json.int64;
    ended_at = Json.required fields "ended_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    participant_ids =
      Json.required fields "participant_ids" (Json.list Json.string);
    started_at = Json.required fields "started_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_simple_call_record_search_response_base_item_human_readable_timestamp
    :
    simple_call_record_search_response_base_item_human_readable_timestamp ->
    Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("call_id", Some (Json.of_string value.call_id));
      ("channel_id", Option.map Json.of_string value.channel_id);
      ("channel_name", Option.map Json.of_string value.channel_name);
      ("duration_ms", Some (Json.of_int64 value.duration_ms));
      ("ended_at", Some (Json.of_string value.ended_at));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ( "participant_ids",
        Some ((Json.of_list Json.of_string) value.participant_ids) );
      ("started_at", Some (Json.of_string value.started_at));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_simple_call_record_search_response_base_item_human_readable_timestamp
    ~(call_id : string) ?channel_id ?channel_name ~(duration_ms : int64)
    ~(ended_at : string) ~(highlight : search_highlight)
    ~(participant_ids : string list) ~(started_at : string) ~(user_id : string)
    () =
  ({
     call_id;
     channel_id;
     channel_name;
     duration_ms;
     ended_at;
     highlight;
     participant_ids;
     started_at;
     user_id;
   }
    : simple_call_record_search_response_base_item_human_readable_timestamp)

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

let simple_channel_search_reponse_base_item_of_yojson :
    Yojson.Safe.t -> simple_channel_search_reponse_base_item =
 fun json ->
  let fields = Json.obj json in
  {
    channel_id = Json.required fields "channel_id" Json.string;
    channel_type = Json.required fields "channel_type" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    mentions = Json.required fields "mentions" (Json.list Json.string);
    message_id = Json.required fields "message_id" Json.string;
    org_id = Json.optional fields "org_id" Json.int64;
    sender_id = Json.required fields "sender_id" Json.string;
    thread_id = Json.optional fields "thread_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_simple_channel_search_reponse_base_item :
    simple_channel_search_reponse_base_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_id", Some (Json.of_string value.channel_id));
      ("channel_type", Some (Json.of_string value.channel_type));
      ("created_at", Some (Json.of_string value.created_at));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("mentions", Some ((Json.of_list Json.of_string) value.mentions));
      ("message_id", Some (Json.of_string value.message_id));
      ("org_id", Option.map Json.of_int64 value.org_id);
      ("sender_id", Some (Json.of_string value.sender_id));
      ("thread_id", Option.map Json.of_string value.thread_id);
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_simple_channel_search_reponse_base_item ~(channel_id : string)
    ~(channel_type : string) ~(created_at : string)
    ~(highlight : search_highlight) ~(mentions : string list)
    ~(message_id : string) ?org_id ~(sender_id : string) ?thread_id
    ~(updated_at : string) () =
  ({
     channel_id;
     channel_type;
     created_at;
     highlight;
     mentions;
     message_id;
     org_id;
     sender_id;
     thread_id;
     updated_at;
   }
    : simple_channel_search_reponse_base_item)

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

let simple_channel_search_reponse_base_item_human_readable_timestamp_of_yojson :
    Yojson.Safe.t ->
    simple_channel_search_reponse_base_item_human_readable_timestamp =
 fun json ->
  let fields = Json.obj json in
  {
    channel_id = Json.required fields "channel_id" Json.string;
    channel_type = Json.required fields "channel_type" Json.string;
    created_at = Json.required fields "created_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    mentions = Json.required fields "mentions" (Json.list Json.string);
    message_id = Json.required fields "message_id" Json.string;
    org_id = Json.optional fields "org_id" Json.int64;
    sender_id = Json.required fields "sender_id" Json.string;
    thread_id = Json.optional fields "thread_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_simple_channel_search_reponse_base_item_human_readable_timestamp :
    simple_channel_search_reponse_base_item_human_readable_timestamp ->
    Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("channel_id", Some (Json.of_string value.channel_id));
      ("channel_type", Some (Json.of_string value.channel_type));
      ("created_at", Some (Json.of_string value.created_at));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("mentions", Some ((Json.of_list Json.of_string) value.mentions));
      ("message_id", Some (Json.of_string value.message_id));
      ("org_id", Option.map Json.of_int64 value.org_id);
      ("sender_id", Some (Json.of_string value.sender_id));
      ("thread_id", Option.map Json.of_string value.thread_id);
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_simple_channel_search_reponse_base_item_human_readable_timestamp
    ~(channel_id : string) ~(channel_type : string) ~(created_at : string)
    ~(highlight : search_highlight) ~(mentions : string list)
    ~(message_id : string) ?org_id ~(sender_id : string) ?thread_id
    ~(updated_at : string) () =
  ({
     channel_id;
     channel_type;
     created_at;
     highlight;
     mentions;
     message_id;
     org_id;
     sender_id;
     thread_id;
     updated_at;
   }
    : simple_channel_search_reponse_base_item_human_readable_timestamp)

type nonrec simple_channel_search_response = {
  results : simple_channel_search_reponse_base_item list;
      (** List containing results from channels.
Each item in the list is for a specific message in a channel. *)
}

let simple_channel_search_response_of_yojson :
    Yojson.Safe.t -> simple_channel_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list simple_channel_search_reponse_base_item_of_yojson);
  }

and yojson_of_simple_channel_search_response :
    simple_channel_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_simple_channel_search_reponse_base_item)
             value.results) );
    ]

let make_simple_channel_search_response
    ~(results : simple_channel_search_reponse_base_item list) () =
  ({ results } : simple_channel_search_response)

type nonrec simple_chat_search_response_base_item = {
  chat_id : string;  (** The chat id *)
  chat_message_id : string;  (** The chat message id *)
  highlight : search_highlight;  (** The highlights on the chat *)
  role : string;  (** The role *)
  title : string;  (** The title *)
  updated_at : string;  (** The time the chat was last updated *)
  user_id : string;  (** The user id *)
}

let simple_chat_search_response_base_item_of_yojson :
    Yojson.Safe.t -> simple_chat_search_response_base_item =
 fun json ->
  let fields = Json.obj json in
  {
    chat_id = Json.required fields "chat_id" Json.string;
    chat_message_id = Json.required fields "chat_message_id" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    role = Json.required fields "role" Json.string;
    title = Json.required fields "title" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_simple_chat_search_response_base_item :
    simple_chat_search_response_base_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_id", Some (Json.of_string value.chat_id));
      ("chat_message_id", Some (Json.of_string value.chat_message_id));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("role", Some (Json.of_string value.role));
      ("title", Some (Json.of_string value.title));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_simple_chat_search_response_base_item ~(chat_id : string)
    ~(chat_message_id : string) ~(highlight : search_highlight) ~(role : string)
    ~(title : string) ~(updated_at : string) ~(user_id : string) () =
  ({ chat_id; chat_message_id; highlight; role; title; updated_at; user_id }
    : simple_chat_search_response_base_item)

type nonrec simple_chat_search_response = {
  results : simple_chat_search_response_base_item list;
      (** List containing results from chats.
Each item in the list is for a specific message in a chat. *)
}

let simple_chat_search_response_of_yojson :
    Yojson.Safe.t -> simple_chat_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list simple_chat_search_response_base_item_of_yojson);
  }

and yojson_of_simple_chat_search_response :
    simple_chat_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_simple_chat_search_response_base_item)
             value.results) );
    ]

let make_simple_chat_search_response
    ~(results : simple_chat_search_response_base_item list) () =
  ({ results } : simple_chat_search_response)

type nonrec simple_chat_search_response_base_item_human_readable_timestamp = {
  chat_id : string;  (** The chat id *)
  chat_message_id : string;  (** The chat message id *)
  highlight : search_highlight;  (** The highlights on the chat *)
  role : string;  (** The role *)
  title : string;  (** The title *)
  updated_at : string;  (** The time the chat was last updated *)
  user_id : string;  (** The user id *)
}

let simple_chat_search_response_base_item_human_readable_timestamp_of_yojson :
    Yojson.Safe.t ->
    simple_chat_search_response_base_item_human_readable_timestamp =
 fun json ->
  let fields = Json.obj json in
  {
    chat_id = Json.required fields "chat_id" Json.string;
    chat_message_id = Json.required fields "chat_message_id" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    role = Json.required fields "role" Json.string;
    title = Json.required fields "title" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_simple_chat_search_response_base_item_human_readable_timestamp :
    simple_chat_search_response_base_item_human_readable_timestamp ->
    Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("chat_id", Some (Json.of_string value.chat_id));
      ("chat_message_id", Some (Json.of_string value.chat_message_id));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("role", Some (Json.of_string value.role));
      ("title", Some (Json.of_string value.title));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_simple_chat_search_response_base_item_human_readable_timestamp
    ~(chat_id : string) ~(chat_message_id : string)
    ~(highlight : search_highlight) ~(role : string) ~(title : string)
    ~(updated_at : string) ~(user_id : string) () =
  ({ chat_id; chat_message_id; highlight; role; title; updated_at; user_id }
    : simple_chat_search_response_base_item_human_readable_timestamp)

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

let simple_document_search_response_base_item_of_yojson :
    Yojson.Safe.t -> simple_document_search_response_base_item =
 fun json ->
  let fields = Json.obj json in
  {
    document_id = Json.required fields "document_id" Json.string;
    document_name = Json.required fields "document_name" Json.string;
    file_type = Json.required fields "file_type" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    node_id = Json.required fields "node_id" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    raw_content = Json.optional fields "raw_content" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_simple_document_search_response_base_item :
    simple_document_search_response_base_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("document_id", Some (Json.of_string value.document_id));
      ("document_name", Some (Json.of_string value.document_name));
      ("file_type", Some (Json.of_string value.file_type));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("node_id", Some (Json.of_string value.node_id));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("raw_content", Option.map Json.of_string value.raw_content);
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_simple_document_search_response_base_item ~(document_id : string)
    ~(document_name : string) ~(file_type : string)
    ~(highlight : search_highlight) ~(node_id : string) ~(owner_id : string)
    ?raw_content ~(updated_at : string) () =
  ({
     document_id;
     document_name;
     file_type;
     highlight;
     node_id;
     owner_id;
     raw_content;
     updated_at;
   }
    : simple_document_search_response_base_item)

type nonrec simple_document_search_response = {
  results : simple_document_search_response_base_item list;
      (** List containing results from documents.
Each item in the list is for a specific page/node of a document. *)
}

let simple_document_search_response_of_yojson :
    Yojson.Safe.t -> simple_document_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list simple_document_search_response_base_item_of_yojson);
  }

and yojson_of_simple_document_search_response :
    simple_document_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_simple_document_search_response_base_item)
             value.results) );
    ]

let make_simple_document_search_response
    ~(results : simple_document_search_response_base_item list) () =
  ({ results } : simple_document_search_response)

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

let simple_document_search_response_base_item_human_readable_timestamp_of_yojson
    :
    Yojson.Safe.t ->
    simple_document_search_response_base_item_human_readable_timestamp =
 fun json ->
  let fields = Json.obj json in
  {
    document_id = Json.required fields "document_id" Json.string;
    document_name = Json.required fields "document_name" Json.string;
    file_type = Json.required fields "file_type" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    node_id = Json.required fields "node_id" Json.string;
    owner_id = Json.required fields "owner_id" Json.string;
    raw_content = Json.optional fields "raw_content" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
  }

and yojson_of_simple_document_search_response_base_item_human_readable_timestamp
    :
    simple_document_search_response_base_item_human_readable_timestamp ->
    Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("document_id", Some (Json.of_string value.document_id));
      ("document_name", Some (Json.of_string value.document_name));
      ("file_type", Some (Json.of_string value.file_type));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("node_id", Some (Json.of_string value.node_id));
      ("owner_id", Some (Json.of_string value.owner_id));
      ("raw_content", Option.map Json.of_string value.raw_content);
      ("updated_at", Some (Json.of_string value.updated_at));
    ]

let make_simple_document_search_response_base_item_human_readable_timestamp
    ~(document_id : string) ~(document_name : string) ~(file_type : string)
    ~(highlight : search_highlight) ~(node_id : string) ~(owner_id : string)
    ?raw_content ~(updated_at : string) () =
  ({
     document_id;
     document_name;
     file_type;
     highlight;
     node_id;
     owner_id;
     raw_content;
     updated_at;
   }
    : simple_document_search_response_base_item_human_readable_timestamp)

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

let simple_email_search_response_base_item_of_yojson :
    Yojson.Safe.t -> simple_email_search_response_base_item =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.required fields "bcc" (Json.list Json.string);
    cc = Json.required fields "cc" (Json.list Json.string);
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    labels = Json.required fields "labels" (Json.list Json.string);
    link_id = Json.required fields "link_id" Json.string;
    message_id = Json.required fields "message_id" Json.string;
    recipients = Json.required fields "recipients" (Json.list Json.string);
    sender = Json.required fields "sender" Json.string;
    sent_at = Json.optional fields "sent_at" Json.string;
    subject = Json.optional fields "subject" Json.string;
    thread_id = Json.required fields "thread_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_simple_email_search_response_base_item :
    simple_email_search_response_base_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Some ((Json.of_list Json.of_string) value.bcc));
      ("cc", Some ((Json.of_list Json.of_string) value.cc));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("labels", Some ((Json.of_list Json.of_string) value.labels));
      ("link_id", Some (Json.of_string value.link_id));
      ("message_id", Some (Json.of_string value.message_id));
      ("recipients", Some ((Json.of_list Json.of_string) value.recipients));
      ("sender", Some (Json.of_string value.sender));
      ("sent_at", Option.map Json.of_string value.sent_at);
      ("subject", Option.map Json.of_string value.subject);
      ("thread_id", Some (Json.of_string value.thread_id));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_simple_email_search_response_base_item ~(bcc : string list)
    ~(cc : string list) ~(highlight : search_highlight) ~(labels : string list)
    ~(link_id : string) ~(message_id : string) ~(recipients : string list)
    ~(sender : string) ?sent_at ?subject ~(thread_id : string)
    ~(updated_at : string) ~(user_id : string) () =
  ({
     bcc;
     cc;
     highlight;
     labels;
     link_id;
     message_id;
     recipients;
     sender;
     sent_at;
     subject;
     thread_id;
     updated_at;
     user_id;
   }
    : simple_email_search_response_base_item)

type nonrec simple_email_search_response = {
  results : simple_email_search_response_base_item list;
      (** List containing results from emails.
Each item in the list is for a specific message in an email thread. *)
}

let simple_email_search_response_of_yojson :
    Yojson.Safe.t -> simple_email_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list simple_email_search_response_base_item_of_yojson);
  }

and yojson_of_simple_email_search_response :
    simple_email_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_simple_email_search_response_base_item)
             value.results) );
    ]

let make_simple_email_search_response
    ~(results : simple_email_search_response_base_item list) () =
  ({ results } : simple_email_search_response)

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

let simple_email_search_response_base_item_human_readable_timestamp_of_yojson :
    Yojson.Safe.t ->
    simple_email_search_response_base_item_human_readable_timestamp =
 fun json ->
  let fields = Json.obj json in
  {
    bcc = Json.required fields "bcc" (Json.list Json.string);
    cc = Json.required fields "cc" (Json.list Json.string);
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    labels = Json.required fields "labels" (Json.list Json.string);
    link_id = Json.required fields "link_id" Json.string;
    message_id = Json.required fields "message_id" Json.string;
    recipients = Json.required fields "recipients" (Json.list Json.string);
    sender = Json.required fields "sender" Json.string;
    sent_at = Json.optional fields "sent_at" Json.string;
    subject = Json.optional fields "subject" Json.string;
    thread_id = Json.required fields "thread_id" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_simple_email_search_response_base_item_human_readable_timestamp :
    simple_email_search_response_base_item_human_readable_timestamp ->
    Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("bcc", Some ((Json.of_list Json.of_string) value.bcc));
      ("cc", Some ((Json.of_list Json.of_string) value.cc));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("labels", Some ((Json.of_list Json.of_string) value.labels));
      ("link_id", Some (Json.of_string value.link_id));
      ("message_id", Some (Json.of_string value.message_id));
      ("recipients", Some ((Json.of_list Json.of_string) value.recipients));
      ("sender", Some (Json.of_string value.sender));
      ("sent_at", Option.map Json.of_string value.sent_at);
      ("subject", Option.map Json.of_string value.subject);
      ("thread_id", Some (Json.of_string value.thread_id));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_simple_email_search_response_base_item_human_readable_timestamp
    ~(bcc : string list) ~(cc : string list) ~(highlight : search_highlight)
    ~(labels : string list) ~(link_id : string) ~(message_id : string)
    ~(recipients : string list) ~(sender : string) ?sent_at ?subject
    ~(thread_id : string) ~(updated_at : string) ~(user_id : string) () =
  ({
     bcc;
     cc;
     highlight;
     labels;
     link_id;
     message_id;
     recipients;
     sender;
     sent_at;
     subject;
     thread_id;
     updated_at;
     user_id;
   }
    : simple_email_search_response_base_item_human_readable_timestamp)

type nonrec simple_project_search_response_base_item = {
  created_at : string;  (** The time the project was created *)
  highlight : search_highlight;  (** The highlights on the project *)
  project_id : string;  (** The project id *)
  project_name : string;  (** The project name *)
  updated_at : string;  (** The time the project was last updated *)
  user_id : string;  (** The id of the user who created the project *)
}

let simple_project_search_response_base_item_of_yojson :
    Yojson.Safe.t -> simple_project_search_response_base_item =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    project_id = Json.required fields "project_id" Json.string;
    project_name = Json.required fields "project_name" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_simple_project_search_response_base_item :
    simple_project_search_response_base_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("project_id", Some (Json.of_string value.project_id));
      ("project_name", Some (Json.of_string value.project_name));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_simple_project_search_response_base_item ~(created_at : string)
    ~(highlight : search_highlight) ~(project_id : string)
    ~(project_name : string) ~(updated_at : string) ~(user_id : string) () =
  ({ created_at; highlight; project_id; project_name; updated_at; user_id }
    : simple_project_search_response_base_item)

type nonrec simple_project_search_response = {
  results : simple_project_search_response_base_item list;
      (** List containing results from projects.
Each item in the list is for a specific project. *)
}

let simple_project_search_response_of_yojson :
    Yojson.Safe.t -> simple_project_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list simple_project_search_response_base_item_of_yojson);
  }

and yojson_of_simple_project_search_response :
    simple_project_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_simple_project_search_response_base_item)
             value.results) );
    ]

let make_simple_project_search_response
    ~(results : simple_project_search_response_base_item list) () =
  ({ results } : simple_project_search_response)

type nonrec simple_project_search_response_base_item_human_readable_timestamp = {
  created_at : string;  (** The time the project was created *)
  highlight : search_highlight;  (** The highlights on the project *)
  project_id : string;  (** The project id *)
  project_name : string;  (** The project name *)
  updated_at : string;  (** The time the project was last updated *)
  user_id : string;  (** The id of the user who created the project *)
}

let simple_project_search_response_base_item_human_readable_timestamp_of_yojson
    :
    Yojson.Safe.t ->
    simple_project_search_response_base_item_human_readable_timestamp =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "created_at" Json.string;
    highlight = Json.required fields "highlight" search_highlight_of_yojson;
    project_id = Json.required fields "project_id" Json.string;
    project_name = Json.required fields "project_name" Json.string;
    updated_at = Json.required fields "updated_at" Json.string;
    user_id = Json.required fields "user_id" Json.string;
  }

and yojson_of_simple_project_search_response_base_item_human_readable_timestamp
    :
    simple_project_search_response_base_item_human_readable_timestamp ->
    Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("created_at", Some (Json.of_string value.created_at));
      ("highlight", Some (yojson_of_search_highlight value.highlight));
      ("project_id", Some (Json.of_string value.project_id));
      ("project_name", Some (Json.of_string value.project_name));
      ("updated_at", Some (Json.of_string value.updated_at));
      ("user_id", Some (Json.of_string value.user_id));
    ]

let make_simple_project_search_response_base_item_human_readable_timestamp
    ~(created_at : string) ~(highlight : search_highlight)
    ~(project_id : string) ~(project_name : string) ~(updated_at : string)
    ~(user_id : string) () =
  ({ created_at; highlight; project_id; project_name; updated_at; user_id }
    : simple_project_search_response_base_item_human_readable_timestamp)

type nonrec simple_search_response_item = {
  entity_id : string;  (** ID of the chat, channel, email, or document *)
  entity_type : string;
  goto : search_goto_content option;
  highlight : highlight;
  score : float option;
}
(** Simple response item to mimic what we get back from opensearch *)

let simple_search_response_item_of_yojson :
    Yojson.Safe.t -> simple_search_response_item =
 fun json ->
  let fields = Json.obj json in
  {
    entity_id = Json.required fields "entity_id" Json.string;
    entity_type = Json.required fields "entity_type" Json.string;
    goto = Json.optional fields "goto" search_goto_content_of_yojson;
    highlight = Json.required fields "highlight" highlight_of_yojson;
    score = Json.optional fields "score" Json.float;
  }

and yojson_of_simple_search_response_item :
    simple_search_response_item -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("entity_id", Some (Json.of_string value.entity_id));
      ("entity_type", Some (Json.of_string value.entity_type));
      ("goto", Option.map yojson_of_search_goto_content value.goto);
      ("highlight", Some (yojson_of_highlight value.highlight));
      ("score", Option.map Json.of_float value.score);
    ]

let make_simple_search_response_item ~(entity_id : string)
    ~(entity_type : string) ?goto ~(highlight : highlight) ?score () =
  ({ entity_id; entity_type; goto; highlight; score }
    : simple_search_response_item)

type nonrec simple_search_response = {
  results : simple_search_response_item list;
}
(** The response for simple search *)

let simple_search_response_of_yojson : Yojson.Safe.t -> simple_search_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list simple_search_response_item_of_yojson);
  }

and yojson_of_simple_search_response : simple_search_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list yojson_of_simple_search_response_item) value.results)
      );
    ]

let make_simple_search_response ~(results : simple_search_response_item list) ()
    =
  ({ results } : simple_search_response)

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

let simple_unified_search_response_base_item_human_readable_timestamp_of_yojson
    :
    Yojson.Safe.t ->
    simple_unified_search_response_base_item_human_readable_timestamp =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "document" ->
      Document
        (simple_document_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "chat" ->
      Chat
        (simple_chat_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "email" ->
      Email
        (simple_email_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "channel" ->
      Channel
        (simple_channel_search_reponse_base_item_human_readable_timestamp_of_yojson
           json)
  | "project" ->
      Project
        (simple_project_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "call" ->
      Call
        (simple_call_record_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "calendarEvent" ->
      Calendar_event
        (simple_calendar_event_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | _ -> Unknown json

and yojson_of_simple_unified_search_response_base_item_human_readable_timestamp
    :
    simple_unified_search_response_base_item_human_readable_timestamp ->
    Yojson.Safe.t =
 fun value ->
  match value with
  | Document inner ->
      Json.with_tag "type" "document"
        (yojson_of_simple_document_search_response_base_item_human_readable_timestamp
           inner)
  | Chat inner ->
      Json.with_tag "type" "chat"
        (yojson_of_simple_chat_search_response_base_item_human_readable_timestamp
           inner)
  | Email inner ->
      Json.with_tag "type" "email"
        (yojson_of_simple_email_search_response_base_item_human_readable_timestamp
           inner)
  | Channel inner ->
      Json.with_tag "type" "channel"
        (yojson_of_simple_channel_search_reponse_base_item_human_readable_timestamp
           inner)
  | Project inner ->
      Json.with_tag "type" "project"
        (yojson_of_simple_project_search_response_base_item_human_readable_timestamp
           inner)
  | Call inner ->
      Json.with_tag "type" "call"
        (yojson_of_simple_call_record_search_response_base_item_human_readable_timestamp
           inner)
  | Calendar_event inner ->
      Json.with_tag "type" "calendarEvent"
        (yojson_of_simple_calendar_event_search_response_base_item_human_readable_timestamp
           inner)
  | Unknown json -> json

type nonrec simple_unified_search_base_response = {
  results :
    simple_unified_search_response_base_item_human_readable_timestamp list;
}

let simple_unified_search_base_response_of_yojson :
    Yojson.Safe.t -> simple_unified_search_base_response =
 fun json ->
  let fields = Json.obj json in
  {
    results =
      Json.required fields "results"
        (Json.list
           simple_unified_search_response_base_item_human_readable_timestamp_of_yojson);
  }

and yojson_of_simple_unified_search_base_response :
    simple_unified_search_base_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "results",
        Some
          ((Json.of_list
              yojson_of_simple_unified_search_response_base_item_human_readable_timestamp)
             value.results) );
    ]

let make_simple_unified_search_base_response
    ~(results :
       simple_unified_search_response_base_item_human_readable_timestamp list)
    () =
  ({ results } : simple_unified_search_base_response)

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

let simple_unified_search_response_base_item_of_yojson :
    Yojson.Safe.t -> simple_unified_search_response_base_item =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "document" ->
      Document
        (simple_document_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "chat" ->
      Chat
        (simple_chat_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "email" ->
      Email
        (simple_email_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "channel" ->
      Channel
        (simple_channel_search_reponse_base_item_human_readable_timestamp_of_yojson
           json)
  | "project" ->
      Project
        (simple_project_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "call" ->
      Call
        (simple_call_record_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | "calendarEvent" ->
      Calendar_event
        (simple_calendar_event_search_response_base_item_human_readable_timestamp_of_yojson
           json)
  | _ -> Unknown json

and yojson_of_simple_unified_search_response_base_item :
    simple_unified_search_response_base_item -> Yojson.Safe.t =
 fun value ->
  match value with
  | Document inner ->
      Json.with_tag "type" "document"
        (yojson_of_simple_document_search_response_base_item_human_readable_timestamp
           inner)
  | Chat inner ->
      Json.with_tag "type" "chat"
        (yojson_of_simple_chat_search_response_base_item_human_readable_timestamp
           inner)
  | Email inner ->
      Json.with_tag "type" "email"
        (yojson_of_simple_email_search_response_base_item_human_readable_timestamp
           inner)
  | Channel inner ->
      Json.with_tag "type" "channel"
        (yojson_of_simple_channel_search_reponse_base_item_human_readable_timestamp
           inner)
  | Project inner ->
      Json.with_tag "type" "project"
        (yojson_of_simple_project_search_response_base_item_human_readable_timestamp
           inner)
  | Call inner ->
      Json.with_tag "type" "call"
        (yojson_of_simple_call_record_search_response_base_item_human_readable_timestamp
           inner)
  | Calendar_event inner ->
      Json.with_tag "type" "calendarEvent"
        (yojson_of_simple_calendar_event_search_response_base_item_human_readable_timestamp
           inner)
  | Unknown json -> json

(** How a query of several terms matches document content. *)
type nonrec term_matching =
  | All
  | Dynamic
  | Unknown of string  (** A value this SDK version does not know. *)

let term_matching_of_yojson : Yojson.Safe.t -> term_matching =
 fun json ->
  match Json.string json with
  | "all" -> All
  | "dynamic" -> Dynamic
  | other -> Unknown other

and yojson_of_term_matching : term_matching -> Yojson.Safe.t =
 fun value ->
  match value with
  | All -> `String "all"
  | Dynamic -> `String "dynamic"
  | Unknown other -> `String other

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

let unified_search_request_of_yojson : Yojson.Safe.t -> unified_search_request =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_event_scope =
      Json.optional fields "calendar_event_scope"
        calendar_event_search_scope_of_yojson;
    collapse = Json.optional fields "collapse" Json.bool;
    filters = Json.optional fields "filters" entity_filters_of_yojson;
    include_crm = Json.optional fields "include_crm" Json.bool;
    match_type = Json.required fields "match_type" match_type_of_yojson;
    query = Json.required fields "query" Json.string;
    search_on = Json.optional fields "search_on" search_on_of_yojson;
    term_matching = Json.optional fields "term_matching" term_matching_of_yojson;
  }

and yojson_of_unified_search_request : unified_search_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "calendar_event_scope",
        Option.map yojson_of_calendar_event_search_scope
          value.calendar_event_scope );
      ("collapse", Option.map Json.of_bool value.collapse);
      ("filters", Option.map yojson_of_entity_filters value.filters);
      ("include_crm", Option.map Json.of_bool value.include_crm);
      ("match_type", Some (yojson_of_match_type value.match_type));
      ("query", Some (Json.of_string value.query));
      ("search_on", Option.map yojson_of_search_on value.search_on);
      ("term_matching", Option.map yojson_of_term_matching value.term_matching);
    ]

let make_unified_search_request ?calendar_event_scope ?collapse ?filters
    ?include_crm ~(match_type : match_type) ~(query : string) ?search_on
    ?term_matching () =
  ({
     calendar_event_scope;
     collapse;
     filters;
     include_crm;
     match_type;
     query;
     search_on;
     term_matching;
   }
    : unified_search_request)

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

let unified_search_response_item_of_yojson :
    Yojson.Safe.t -> unified_search_response_item =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "type" with
  | "document" ->
      Document
        {
          document_id = Json.required fields "document_id" Json.string;
          document_name = Json.required fields "document_name" Json.string;
          document_search_results =
            Json.required fields "document_search_results"
              (Json.list document_search_result_of_yojson);
          file_type = Json.optional fields "file_type" Json.string;
          id = Json.required fields "id" Json.string;
          name = Json.required fields "name" Json.string;
          owner_id = Json.required fields "owner_id" Json.string;
          sub_type = Json.optional fields "sub_type" document_sub_type_of_yojson;
          metadata = Json.optional fields "metadata" document_metadata_of_yojson;
          properties =
            Json.optional fields "properties"
              (Json.list soup_property_of_yojson);
        }
  | "chat" ->
      Chat
        {
          chat_id = Json.required fields "chat_id" Json.string;
          chat_search_results =
            Json.required fields "chat_search_results"
              (Json.list chat_message_search_result_of_yojson);
          id = Json.required fields "id" Json.string;
          name = Json.required fields "name" Json.string;
          owner_id = Json.required fields "owner_id" Json.string;
          user_id = Json.required fields "user_id" Json.string;
          metadata = Json.optional fields "metadata" chat_metadata_of_yojson;
          properties =
            Json.optional fields "properties"
              (Json.list soup_property_of_yojson);
        }
  | "email" ->
      Email
        {
          email_message_search_results =
            Json.required fields "email_message_search_results"
              (Json.list email_search_result_of_yojson);
          id = Json.required fields "id" Json.string;
          link_id = Json.required fields "link_id" Json.string;
          name = Json.optional fields "name" Json.string;
          owner_id = Json.required fields "owner_id" Json.string;
          participants =
            Json.required fields "participants"
              (Json.list email_search_participant_of_yojson);
          subject = Json.optional fields "subject" Json.string;
          thread_id = Json.required fields "thread_id" Json.string;
          user_id = Json.required fields "user_id" Json.string;
          created_at = Json.required fields "created_at" Json.string;
          inbox_visible = Json.required fields "inbox_visible" Json.bool;
          is_draft = Json.required fields "is_draft" Json.bool;
          is_important = Json.required fields "is_important" Json.bool;
          is_read = Json.required fields "is_read" Json.bool;
          properties =
            Json.optional fields "properties"
              (Json.list soup_property_of_yojson);
          snippet = Json.optional fields "snippet" Json.string;
          updated_at = Json.required fields "updated_at" Json.string;
          viewed_at = Json.optional fields "viewed_at" Json.string;
        }
  | "channelMessage" ->
      Channel_message (channel_message_search_response_item_of_yojson json)
  | "channel" -> Channel (channel_name_search_response_item_of_yojson json)
  | "project" ->
      Project
        {
          created_at = Json.required fields "created_at" Json.string;
          id = Json.required fields "id" Json.string;
          name = Json.required fields "name" Json.string;
          owner_id = Json.required fields "owner_id" Json.string;
          project_search_results =
            Json.required fields "project_search_results"
              (Json.list project_search_result_of_yojson);
          updated_at = Json.required fields "updated_at" Json.string;
          metadata = Json.optional fields "metadata" project_metadata_of_yojson;
          properties =
            Json.optional fields "properties"
              (Json.list soup_property_of_yojson);
        }
  | "call" ->
      Call
        {
          call_id = Json.required fields "call_id" Json.string;
          call_search_results =
            Json.required fields "call_search_results"
              (Json.list call_record_search_result_of_yojson);
          channel_id = Json.optional fields "channel_id" Json.string;
          id = Json.required fields "id" Json.string;
          name = Json.optional fields "name" Json.string;
          owner_id = Json.required fields "owner_id" Json.string;
          participant_ids =
            Json.required fields "participant_ids" (Json.list Json.string);
          metadata =
            Json.optional fields "metadata" call_record_metadata_of_yojson;
          properties =
            Json.optional fields "properties"
              (Json.list soup_property_of_yojson);
        }
  | "company" -> Company (crm_company_search_response_item_of_yojson json)
  | "calendarEvent" ->
      Calendar_event
        {
          calendar_event_search_results =
            Json.required fields "calendar_event_search_results"
              (Json.list calendar_event_search_result_of_yojson);
          created_at = Json.required fields "created_at" Json.string;
          id = Json.required fields "id" Json.string;
          name = Json.required fields "name" Json.string;
          owner_id = Json.required fields "owner_id" Json.string;
          updated_at = Json.required fields "updated_at" Json.string;
          metadata =
            Json.optional fields "metadata" calendar_event_metadata_of_yojson;
          properties =
            Json.optional fields "properties"
              (Json.list soup_property_of_yojson);
        }
  | "agentSession" ->
      Agent_session (agent_session_search_response_item_of_yojson json)
  | _ -> Unknown json

and yojson_of_unified_search_response_item :
    unified_search_response_item -> Yojson.Safe.t =
 fun value ->
  match value with
  | Document case ->
      Json.record
        [
          ("type", Some (`String "document"));
          ("document_id", Some (Json.of_string case.document_id));
          ("document_name", Some (Json.of_string case.document_name));
          ( "document_search_results",
            Some
              ((Json.of_list yojson_of_document_search_result)
                 case.document_search_results) );
          ("file_type", Option.map Json.of_string case.file_type);
          ("id", Some (Json.of_string case.id));
          ("name", Some (Json.of_string case.name));
          ("owner_id", Some (Json.of_string case.owner_id));
          ("sub_type", Option.map yojson_of_document_sub_type case.sub_type);
          ("metadata", Option.map yojson_of_document_metadata case.metadata);
          ( "properties",
            Option.map (Json.of_list yojson_of_soup_property) case.properties );
        ]
  | Chat case ->
      Json.record
        [
          ("type", Some (`String "chat"));
          ("chat_id", Some (Json.of_string case.chat_id));
          ( "chat_search_results",
            Some
              ((Json.of_list yojson_of_chat_message_search_result)
                 case.chat_search_results) );
          ("id", Some (Json.of_string case.id));
          ("name", Some (Json.of_string case.name));
          ("owner_id", Some (Json.of_string case.owner_id));
          ("user_id", Some (Json.of_string case.user_id));
          ("metadata", Option.map yojson_of_chat_metadata case.metadata);
          ( "properties",
            Option.map (Json.of_list yojson_of_soup_property) case.properties );
        ]
  | Email case ->
      Json.record
        [
          ("type", Some (`String "email"));
          ( "email_message_search_results",
            Some
              ((Json.of_list yojson_of_email_search_result)
                 case.email_message_search_results) );
          ("id", Some (Json.of_string case.id));
          ("link_id", Some (Json.of_string case.link_id));
          ("name", Option.map Json.of_string case.name);
          ("owner_id", Some (Json.of_string case.owner_id));
          ( "participants",
            Some
              ((Json.of_list yojson_of_email_search_participant)
                 case.participants) );
          ("subject", Option.map Json.of_string case.subject);
          ("thread_id", Some (Json.of_string case.thread_id));
          ("user_id", Some (Json.of_string case.user_id));
          ("created_at", Some (Json.of_string case.created_at));
          ("inbox_visible", Some (Json.of_bool case.inbox_visible));
          ("is_draft", Some (Json.of_bool case.is_draft));
          ("is_important", Some (Json.of_bool case.is_important));
          ("is_read", Some (Json.of_bool case.is_read));
          ( "properties",
            Option.map (Json.of_list yojson_of_soup_property) case.properties );
          ("snippet", Option.map Json.of_string case.snippet);
          ("updated_at", Some (Json.of_string case.updated_at));
          ("viewed_at", Option.map Json.of_string case.viewed_at);
        ]
  | Channel_message inner ->
      Json.with_tag "type" "channelMessage"
        (yojson_of_channel_message_search_response_item inner)
  | Channel inner ->
      Json.with_tag "type" "channel"
        (yojson_of_channel_name_search_response_item inner)
  | Project case ->
      Json.record
        [
          ("type", Some (`String "project"));
          ("created_at", Some (Json.of_string case.created_at));
          ("id", Some (Json.of_string case.id));
          ("name", Some (Json.of_string case.name));
          ("owner_id", Some (Json.of_string case.owner_id));
          ( "project_search_results",
            Some
              ((Json.of_list yojson_of_project_search_result)
                 case.project_search_results) );
          ("updated_at", Some (Json.of_string case.updated_at));
          ("metadata", Option.map yojson_of_project_metadata case.metadata);
          ( "properties",
            Option.map (Json.of_list yojson_of_soup_property) case.properties );
        ]
  | Call case ->
      Json.record
        [
          ("type", Some (`String "call"));
          ("call_id", Some (Json.of_string case.call_id));
          ( "call_search_results",
            Some
              ((Json.of_list yojson_of_call_record_search_result)
                 case.call_search_results) );
          ("channel_id", Option.map Json.of_string case.channel_id);
          ("id", Some (Json.of_string case.id));
          ("name", Option.map Json.of_string case.name);
          ("owner_id", Some (Json.of_string case.owner_id));
          ( "participant_ids",
            Some ((Json.of_list Json.of_string) case.participant_ids) );
          ("metadata", Option.map yojson_of_call_record_metadata case.metadata);
          ( "properties",
            Option.map (Json.of_list yojson_of_soup_property) case.properties );
        ]
  | Company inner ->
      Json.with_tag "type" "company"
        (yojson_of_crm_company_search_response_item inner)
  | Calendar_event case ->
      Json.record
        [
          ("type", Some (`String "calendarEvent"));
          ( "calendar_event_search_results",
            Some
              ((Json.of_list yojson_of_calendar_event_search_result)
                 case.calendar_event_search_results) );
          ("created_at", Some (Json.of_string case.created_at));
          ("id", Some (Json.of_string case.id));
          ("name", Some (Json.of_string case.name));
          ("owner_id", Some (Json.of_string case.owner_id));
          ("updated_at", Some (Json.of_string case.updated_at));
          ( "metadata",
            Option.map yojson_of_calendar_event_metadata case.metadata );
          ( "properties",
            Option.map (Json.of_list yojson_of_soup_property) case.properties );
        ]
  | Agent_session inner ->
      Json.with_tag "type" "agentSession"
        (yojson_of_agent_session_search_response_item inner)
  | Unknown json -> json

let make_unified_search_response_item_document ~(document_id : string)
    ~(document_name : string)
    ~(document_search_results : document_search_result list) ?file_type
    ~(id : string) ~(name : string) ~(owner_id : string) ?sub_type ?metadata
    ?properties () =
  (Document
     {
       document_id;
       document_name;
       document_search_results;
       file_type;
       id;
       name;
       owner_id;
       sub_type;
       metadata;
       properties;
     }
    : unified_search_response_item)

let make_unified_search_response_item_chat ~(chat_id : string)
    ~(chat_search_results : chat_message_search_result list) ~(id : string)
    ~(name : string) ~(owner_id : string) ~(user_id : string) ?metadata
    ?properties () =
  (Chat
     {
       chat_id;
       chat_search_results;
       id;
       name;
       owner_id;
       user_id;
       metadata;
       properties;
     }
    : unified_search_response_item)

let make_unified_search_response_item_email
    ~(email_message_search_results : email_search_result list) ~(id : string)
    ~(link_id : string) ?name ~(owner_id : string)
    ~(participants : email_search_participant list) ?subject
    ~(thread_id : string) ~(user_id : string) ~(created_at : string)
    ~(inbox_visible : bool) ~(is_draft : bool) ~(is_important : bool)
    ~(is_read : bool) ?properties ?snippet ~(updated_at : string) ?viewed_at ()
    =
  (Email
     {
       email_message_search_results;
       id;
       link_id;
       name;
       owner_id;
       participants;
       subject;
       thread_id;
       user_id;
       created_at;
       inbox_visible;
       is_draft;
       is_important;
       is_read;
       properties;
       snippet;
       updated_at;
       viewed_at;
     }
    : unified_search_response_item)

let make_unified_search_response_item_project ~(created_at : string)
    ~(id : string) ~(name : string) ~(owner_id : string)
    ~(project_search_results : project_search_result list)
    ~(updated_at : string) ?metadata ?properties () =
  (Project
     {
       created_at;
       id;
       name;
       owner_id;
       project_search_results;
       updated_at;
       metadata;
       properties;
     }
    : unified_search_response_item)

let make_unified_search_response_item_call ~(call_id : string)
    ~(call_search_results : call_record_search_result list) ?channel_id
    ~(id : string) ?name ~(owner_id : string) ~(participant_ids : string list)
    ?metadata ?properties () =
  (Call
     {
       call_id;
       call_search_results;
       channel_id;
       id;
       name;
       owner_id;
       participant_ids;
       metadata;
       properties;
     }
    : unified_search_response_item)

let make_unified_search_response_item_calendar_event
    ~(calendar_event_search_results : calendar_event_search_result list)
    ~(created_at : string) ~(id : string) ~(name : string) ~(owner_id : string)
    ~(updated_at : string) ?metadata ?properties () =
  (Calendar_event
     {
       calendar_event_search_results;
       created_at;
       id;
       name;
       owner_id;
       updated_at;
       metadata;
       properties;
     }
    : unified_search_response_item)

type nonrec unified_search_response = {
  next_cursor : string option;
      (** The next cursor to use for paginating results *)
  results : unified_search_response_item list;  (** The search results *)
}

let unified_search_response_of_yojson : Yojson.Safe.t -> unified_search_response
    =
 fun json ->
  let fields = Json.obj json in
  {
    next_cursor = Json.optional fields "next_cursor" Json.string;
    results =
      Json.required fields "results"
        (Json.list unified_search_response_item_of_yojson);
  }

and yojson_of_unified_search_response : unified_search_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ("next_cursor", Option.map Json.of_string value.next_cursor);
      ( "results",
        Some
          ((Json.of_list yojson_of_unified_search_response_item) value.results)
      );
    ]

let make_unified_search_response ?next_cursor
    ~(results : unified_search_response_item list) () =
  ({ next_cursor; results } : unified_search_response)

type nonrec unified_search_response_item_document_type =
  | Document
  | Unknown of string  (** A value this SDK version does not know. *)

let unified_search_response_item_document_type_of_yojson :
    Yojson.Safe.t -> unified_search_response_item_document_type =
 fun json ->
  match Json.string json with "document" -> Document | other -> Unknown other

and yojson_of_unified_search_response_item_document_type :
    unified_search_response_item_document_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Document -> `String "document"
  | Unknown other -> `String other

type nonrec unified_search_response_item_chat_type =
  | Chat
  | Unknown of string  (** A value this SDK version does not know. *)

let unified_search_response_item_chat_type_of_yojson :
    Yojson.Safe.t -> unified_search_response_item_chat_type =
 fun json ->
  match Json.string json with "chat" -> Chat | other -> Unknown other

and yojson_of_unified_search_response_item_chat_type :
    unified_search_response_item_chat_type -> Yojson.Safe.t =
 fun value ->
  match value with Chat -> `String "chat" | Unknown other -> `String other

type nonrec unified_search_response_item_email_type =
  | Email
  | Unknown of string  (** A value this SDK version does not know. *)

let unified_search_response_item_email_type_of_yojson :
    Yojson.Safe.t -> unified_search_response_item_email_type =
 fun json ->
  match Json.string json with "email" -> Email | other -> Unknown other

and yojson_of_unified_search_response_item_email_type :
    unified_search_response_item_email_type -> Yojson.Safe.t =
 fun value ->
  match value with Email -> `String "email" | Unknown other -> `String other

type nonrec unified_search_response_item_project_type =
  | Project
  | Unknown of string  (** A value this SDK version does not know. *)

let unified_search_response_item_project_type_of_yojson :
    Yojson.Safe.t -> unified_search_response_item_project_type =
 fun json ->
  match Json.string json with "project" -> Project | other -> Unknown other

and yojson_of_unified_search_response_item_project_type :
    unified_search_response_item_project_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Project -> `String "project"
  | Unknown other -> `String other

type nonrec unified_search_response_item_call_type =
  | Call
  | Unknown of string  (** A value this SDK version does not know. *)

let unified_search_response_item_call_type_of_yojson :
    Yojson.Safe.t -> unified_search_response_item_call_type =
 fun json ->
  match Json.string json with "call" -> Call | other -> Unknown other

and yojson_of_unified_search_response_item_call_type :
    unified_search_response_item_call_type -> Yojson.Safe.t =
 fun value ->
  match value with Call -> `String "call" | Unknown other -> `String other

type nonrec unified_search_response_item_calendar_event_type =
  | Calendar_event
  | Unknown of string  (** A value this SDK version does not know. *)

let unified_search_response_item_calendar_event_type_of_yojson :
    Yojson.Safe.t -> unified_search_response_item_calendar_event_type =
 fun json ->
  match Json.string json with
  | "calendarEvent" -> Calendar_event
  | other -> Unknown other

and yojson_of_unified_search_response_item_calendar_event_type :
    unified_search_response_item_calendar_event_type -> Yojson.Safe.t =
 fun value ->
  match value with
  | Calendar_event -> `String "calendarEvent"
  | Unknown other -> `String other

(** [POST /search]

Perform a search through all items *)
let unified_search ~(page_size : int64) ~(match_type : match_type)
    ~(query : string) ?cursor ?calendar_event_scope ?collapse ?filters
    ?include_crm ?search_on ?term_matching () =
  ({
     Request.service = "search";
     operation = "unified_search";
     meth = `POST;
     path = "/search";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ("page_size", [ Int64.to_string page_size ]);
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
            (yojson_of_unified_search_request
               ({
                  calendar_event_scope;
                  collapse;
                  filters;
                  include_crm;
                  match_type;
                  query;
                  search_on;
                  term_matching;
                }
                 : unified_search_request)));
     decode_reply = Request.json unified_search_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (unified_search_response, error_response) Macro_sdk_runtime.Request.t)

(** [POST /search/simple]

Perform a search through all items.
This is a simple search where we do not group your results by entity id. *)
let simple_unified_search ~(page_size : int64) ~(match_type : match_type)
    ~(query : string) ?cursor ?calendar_event_scope ?collapse ?filters
    ?include_crm ?search_on ?term_matching () =
  ({
     Request.service = "search";
     operation = "simple_unified_search";
     meth = `POST;
     path = "/search/simple";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ("page_size", [ Int64.to_string page_size ]);
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
            (yojson_of_unified_search_request
               ({
                  calendar_event_scope;
                  collapse;
                  filters;
                  include_crm;
                  match_type;
                  query;
                  search_on;
                  term_matching;
                }
                 : unified_search_request)));
     decode_reply = Request.json simple_search_response_of_yojson;
     decode_error =
       Request.error_json [ 400; 401; 500 ] error_response_of_yojson;
   }
    : (simple_search_response, error_response) Macro_sdk_runtime.Request.t)
