(* Generated from packages/sdk/specs/calendar.json by packages/sdk-ocaml/gen. Do not edit. *)

module Json = Macro_sdk_runtime.Json
module Request = Macro_sdk_runtime.Request

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

type nonrec availability_calendar = {
  calendar_id : string;  (** Visible source calendar. *)
  contributes_to_availability : bool;
      (** Whether its events normally block the user's time. *)
  is_primary : bool;
      (** Whether this is the connected account's primary calendar. *)
  name : string;  (** Source name. *)
}
(** Per-user inclusion of a source calendar in personal availability. *)

let availability_calendar_of_yojson : Yojson.Safe.t -> availability_calendar =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_id = Json.required fields "calendarId" Json.string;
    contributes_to_availability =
      Json.required fields "contributesToAvailability" Json.bool;
    is_primary = Json.required fields "isPrimary" Json.bool;
    name = Json.required fields "name" Json.string;
  }

and yojson_of_availability_calendar : availability_calendar -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("calendarId", Some (Json.of_string value.calendar_id));
      ( "contributesToAvailability",
        Some (Json.of_bool value.contributes_to_availability) );
      ("isPrimary", Some (Json.of_bool value.is_primary));
      ("name", Some (Json.of_string value.name));
    ]

let make_availability_calendar ~(calendar_id : string)
    ~(contributes_to_availability : bool) ~(is_primary : bool) ~(name : string)
    () =
  ({ calendar_id; contributes_to_availability; is_primary; name }
    : availability_calendar)

type nonrec availability_calendar_body = {
  contributes_to_availability : bool;
      (** Whether this calendar contributes to personal availability. *)
}
(** Own-user source inclusion preference. *)

let availability_calendar_body_of_yojson :
    Yojson.Safe.t -> availability_calendar_body =
 fun json ->
  let fields = Json.obj json in
  {
    contributes_to_availability =
      Json.required fields "contributesToAvailability" Json.bool;
  }

and yojson_of_availability_calendar_body :
    availability_calendar_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "contributesToAvailability",
        Some (Json.of_bool value.contributes_to_availability) );
    ]

let make_availability_calendar_body ~(contributes_to_availability : bool) () =
  ({ contributes_to_availability } : availability_calendar_body)

type nonrec availability_calendars_response = {
  calendars : availability_calendar list;
      (** Directly visible source calendars. *)
}
(** Source calendar settings returned to their viewer. *)

let availability_calendars_response_of_yojson :
    Yojson.Safe.t -> availability_calendars_response =
 fun json ->
  let fields = Json.obj json in
  {
    calendars =
      Json.required fields "calendars"
        (Json.list availability_calendar_of_yojson);
  }

and yojson_of_availability_calendars_response :
    availability_calendars_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "calendars",
        Some ((Json.of_list yojson_of_availability_calendar) value.calendars) );
    ]

let make_availability_calendars_response
    ~(calendars : availability_calendar list) () =
  ({ calendars } : availability_calendars_response)

(** Attendance recorded by an assigned host or profile administrator after a meeting. *)
type nonrec booking_attendance =
  | Unknown_
  | Attended
  | Guest_no_show
  | Host_no_show
  | Unknown of string  (** A value this SDK version does not know. *)

let booking_attendance_of_yojson : Yojson.Safe.t -> booking_attendance =
 fun json ->
  match Json.string json with
  | "unknown" -> Unknown_
  | "attended" -> Attended
  | "guestNoShow" -> Guest_no_show
  | "hostNoShow" -> Host_no_show
  | other -> Json.unknown "booking_attendance" json (Unknown other)

and yojson_of_booking_attendance : booking_attendance -> Yojson.Safe.t =
 fun value ->
  match value with
  | Unknown_ -> `String "unknown"
  | Attended -> `String "attended"
  | Guest_no_show -> `String "guestNoShow"
  | Host_no_show -> `String "hostNoShow"
  | Unknown other -> `String other

(** Booking lifecycle state. *)
type nonrec booking_status =
  | Pending
  | Confirmed
  | Cancelled
  | Processing
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

let booking_status_of_yojson : Yojson.Safe.t -> booking_status =
 fun json ->
  match Json.string json with
  | "pending" -> Pending
  | "confirmed" -> Confirmed
  | "cancelled" -> Cancelled
  | "processing" -> Processing
  | "failed" -> Failed
  | other -> Json.unknown "booking_status" json (Unknown other)

and yojson_of_booking_status : booking_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pending -> `String "pending"
  | Confirmed -> `String "confirmed"
  | Cancelled -> `String "cancelled"
  | Processing -> `String "processing"
  | Failed -> `String "failed"
  | Unknown other -> `String other

type nonrec booking = {
  answers : (string * string) list;  (** Answers keyed by question identity. *)
  attendance : booking_attendance option;
      (** Explicit attendance outcome; existing booking records default to unknown. *)
  email : string;  (** Booker's email. *)
  ends_at : string;  (** Absolute meeting end. *)
  event_type_id : string;  (** Booking link identity. *)
  hosts : string list;  (** Assigned hosts. *)
  id : string;  (** Booking identity. *)
  location : string;  (** Final location or conference URL. *)
  name : string;  (** Booker's name. *)
  question_labels : (string * string) list option;
      (** Original labels for answers, independent of later event-type edits. *)
  reschedule_count : int option;
      (** Number of successfully completed moves to a different start time. *)
  rescheduled_at : string option;
      (** When the most recent successful reschedule completed. *)
  starts_at : string;  (** Absolute meeting start. *)
  status : booking_status;  (** Current lifecycle state. *)
  time_zone : string;  (** Booker's display time zone. *)
  title : string;  (** Snapshot of the meeting title. *)
}
(** Public booking details, also visible to authorized profile members. *)

let booking_of_yojson : Yojson.Safe.t -> booking =
 fun json ->
  let fields = Json.obj json in
  {
    answers = Json.required fields "answers" (Json.map Json.string);
    attendance = Json.optional fields "attendance" booking_attendance_of_yojson;
    email = Json.required fields "email" Json.string;
    ends_at = Json.required fields "endsAt" Json.string;
    event_type_id = Json.required fields "eventTypeId" Json.string;
    hosts = Json.required fields "hosts" (Json.list Json.string);
    id = Json.required fields "id" Json.string;
    location = Json.required fields "location" Json.string;
    name = Json.required fields "name" Json.string;
    question_labels =
      Json.optional fields "questionLabels" (Json.map Json.string);
    reschedule_count = Json.optional fields "rescheduleCount" Json.int;
    rescheduled_at = Json.optional fields "rescheduledAt" Json.string;
    starts_at = Json.required fields "startsAt" Json.string;
    status = Json.required fields "status" booking_status_of_yojson;
    time_zone = Json.required fields "timeZone" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_booking : booking -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("answers", Some ((Json.of_map Json.of_string) value.answers));
      ("attendance", Option.map yojson_of_booking_attendance value.attendance);
      ("email", Some (Json.of_string value.email));
      ("endsAt", Some (Json.of_string value.ends_at));
      ("eventTypeId", Some (Json.of_string value.event_type_id));
      ("hosts", Some ((Json.of_list Json.of_string) value.hosts));
      ("id", Some (Json.of_string value.id));
      ("location", Some (Json.of_string value.location));
      ("name", Some (Json.of_string value.name));
      ( "questionLabels",
        Option.map (Json.of_map Json.of_string) value.question_labels );
      ("rescheduleCount", Option.map Json.of_int value.reschedule_count);
      ("rescheduledAt", Option.map Json.of_string value.rescheduled_at);
      ("startsAt", Some (Json.of_string value.starts_at));
      ("status", Some (yojson_of_booking_status value.status));
      ("timeZone", Some (Json.of_string value.time_zone));
      ("title", Some (Json.of_string value.title));
    ]

let make_booking ~(answers : (string * string) list) ?attendance
    ~(email : string) ~(ends_at : string) ~(event_type_id : string)
    ~(hosts : string list) ~(id : string) ~(location : string) ~(name : string)
    ?question_labels ?reschedule_count ?rescheduled_at ~(starts_at : string)
    ~(status : booking_status) ~(time_zone : string) ~(title : string) () =
  ({
     answers;
     attendance;
     email;
     ends_at;
     event_type_id;
     hosts;
     id;
     location;
     name;
     question_labels;
     reschedule_count;
     rescheduled_at;
     starts_at;
     status;
     time_zone;
     title;
   }
    : booking)

(** A host's requested change to a booked meeting. *)
type nonrec booking_change =
  | Approve
      (** Approve a legacy pending booking and send its calendar invitations. *)
  | Cancel  (** Cancel a booking and notify its attendees. *)
  | Attendance of { attendance : booking_attendance  (** Recorded outcome. *) }
      (** Record or clear attendance after the meeting ends. *)
  | Reschedule of {
      starts_at : string;
          (** Absolute start chosen from available replacement slots. *)
    }  (** Move the existing meeting to an available time; notify attendees. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let booking_change_of_yojson : Yojson.Safe.t -> booking_change =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "action" with
  | "approve" -> Approve
  | "cancel" -> Cancel
  | "attendance" ->
      Attendance
        {
          attendance =
            Json.required fields "attendance" booking_attendance_of_yojson;
        }
  | "reschedule" ->
      Reschedule { starts_at = Json.required fields "startsAt" Json.string }
  | _ -> Json.unknown "booking_change" json (Unknown json)

and yojson_of_booking_change : booking_change -> Yojson.Safe.t =
 fun value ->
  match value with
  | Approve -> Json.record [ ("action", Some (`String "approve")) ]
  | Cancel -> Json.record [ ("action", Some (`String "cancel")) ]
  | Attendance case ->
      Json.record
        [
          ("action", Some (`String "attendance"));
          ("attendance", Some (yojson_of_booking_attendance case.attendance));
        ]
  | Reschedule case ->
      Json.record
        [
          ("action", Some (`String "reschedule"));
          ("startsAt", Some (Json.of_string case.starts_at));
        ]
  | Unknown json -> json

let make_booking_change_attendance ~(attendance : booking_attendance) () =
  (Attendance { attendance } : booking_change)

let make_booking_change_reschedule ~(starts_at : string) () =
  (Reschedule { starts_at } : booking_change)

type nonrec booking_time_window = {
  end_ : string;  (** Exclusive HH:MM end. *)
  start : string;  (** Inclusive HH:MM start. *)
}
(** A wall-clock window in an availability schedule. *)

let booking_time_window_of_yojson : Yojson.Safe.t -> booking_time_window =
 fun json ->
  let fields = Json.obj json in
  {
    end_ = Json.required fields "end" Json.string;
    start = Json.required fields "start" Json.string;
  }

and yojson_of_booking_time_window : booking_time_window -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("end", Some (Json.of_string value.end_));
      ("start", Some (Json.of_string value.start));
    ]

let make_booking_time_window ~(end_ : string) ~(start : string) () =
  ({ end_; start } : booking_time_window)

type nonrec booking_date_override = {
  date : string;  (** Local date in the schedule zone. *)
  windows : booking_time_window list;  (** Empty means unavailable all day. *)
}
(** Replacement availability for one date. *)

let booking_date_override_of_yojson : Yojson.Safe.t -> booking_date_override =
 fun json ->
  let fields = Json.obj json in
  {
    date = Json.required fields "date" Json.string;
    windows =
      Json.required fields "windows" (Json.list booking_time_window_of_yojson);
  }

and yojson_of_booking_date_override : booking_date_override -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("date", Some (Json.of_string value.date));
      ( "windows",
        Some ((Json.of_list yojson_of_booking_time_window) value.windows) );
    ]

let make_booking_date_override ~(date : string)
    ~(windows : booking_time_window list) () =
  ({ date; windows } : booking_date_override)

(** Team host assignment policy. *)
type nonrec scheduling_mode =
  | Individual
  | Collective
  | Round_robin
  | Unknown of string  (** A value this SDK version does not know. *)

let scheduling_mode_of_yojson : Yojson.Safe.t -> scheduling_mode =
 fun json ->
  match Json.string json with
  | "individual" -> Individual
  | "collective" -> Collective
  | "roundRobin" -> Round_robin
  | other -> Json.unknown "scheduling_mode" json (Unknown other)

and yojson_of_scheduling_mode : scheduling_mode -> Yojson.Safe.t =
 fun value ->
  match value with
  | Individual -> `String "individual"
  | Collective -> `String "collective"
  | Round_robin -> `String "roundRobin"
  | Unknown other -> `String other

type nonrec booking_question = {
  id : string;  (** Stable identity. *)
  label : string;  (** Public question label. *)
  required : bool;  (** Whether an answer is mandatory. *)
}
(** A question on the booking form. *)

let booking_question_of_yojson : Yojson.Safe.t -> booking_question =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" Json.string;
    label = Json.required fields "label" Json.string;
    required = Json.required fields "required" Json.bool;
  }

and yojson_of_booking_question : booking_question -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (Json.of_string value.id));
      ("label", Some (Json.of_string value.label));
      ("required", Some (Json.of_bool value.required));
    ]

let make_booking_question ~(id : string) ~(label : string) ~(required : bool) ()
    =
  ({ id; label; required } : booking_question)

type nonrec booking_event_type = {
  after_minutes : int;  (** Protected time after a meeting. *)
  before_minutes : int;  (** Protected time before a meeting. *)
  daily_limit : int option;
      (** Maximum bookings for this event on one schedule-local day. *)
  description : string;  (** Public description. *)
  duration_minutes : int;  (** Meeting duration. *)
  enabled : bool;  (** Whether new bookings are accepted. *)
  google_meet : bool;
      (** Generate a Google Meet conference. Mutually exclusive with a Macro call. *)
  horizon_days : int;  (** Maximum days ahead. *)
  hosts : string list;  (** Current Macro user identities selected as hosts. *)
  id : string;  (** Stable identity. *)
  interval_minutes : int;  (** Spacing of offered start times. *)
  location : string;  (** Meeting location. *)
  macro_call : bool option;
      (** Generate a Macro call and attach its join link when someone books.
Mutually exclusive with Google Meet. Omitted on links saved before
Macro calls were a booking option, which keep their previous conference. *)
  mode : scheduling_mode;  (** Host assignment policy. *)
  notice_minutes : int;  (** Minimum notice in minutes. *)
  questions : booking_question list;  (** Additional form fields. *)
  requires_confirmation : bool;  (** Hold bookings for host approval. *)
  schedule_id : string;  (** Referenced availability schedule. *)
  slug : string;  (** Unique link segment within a profile. *)
  title : string;  (** Public title. *)
}
(** A reusable booking link. *)

let booking_event_type_of_yojson : Yojson.Safe.t -> booking_event_type =
 fun json ->
  let fields = Json.obj json in
  {
    after_minutes = Json.required fields "afterMinutes" Json.int;
    before_minutes = Json.required fields "beforeMinutes" Json.int;
    daily_limit = Json.optional fields "dailyLimit" Json.int;
    description = Json.required fields "description" Json.string;
    duration_minutes = Json.required fields "durationMinutes" Json.int;
    enabled = Json.required fields "enabled" Json.bool;
    google_meet = Json.required fields "googleMeet" Json.bool;
    horizon_days = Json.required fields "horizonDays" Json.int;
    hosts = Json.required fields "hosts" (Json.list Json.string);
    id = Json.required fields "id" Json.string;
    interval_minutes = Json.required fields "intervalMinutes" Json.int;
    location = Json.required fields "location" Json.string;
    macro_call = Json.optional fields "macroCall" Json.bool;
    mode = Json.required fields "mode" scheduling_mode_of_yojson;
    notice_minutes = Json.required fields "noticeMinutes" Json.int;
    questions =
      Json.required fields "questions" (Json.list booking_question_of_yojson);
    requires_confirmation =
      Json.required fields "requiresConfirmation" Json.bool;
    schedule_id = Json.required fields "scheduleId" Json.string;
    slug = Json.required fields "slug" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_booking_event_type : booking_event_type -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("afterMinutes", Some (Json.of_int value.after_minutes));
      ("beforeMinutes", Some (Json.of_int value.before_minutes));
      ("dailyLimit", Option.map Json.of_int value.daily_limit);
      ("description", Some (Json.of_string value.description));
      ("durationMinutes", Some (Json.of_int value.duration_minutes));
      ("enabled", Some (Json.of_bool value.enabled));
      ("googleMeet", Some (Json.of_bool value.google_meet));
      ("horizonDays", Some (Json.of_int value.horizon_days));
      ("hosts", Some ((Json.of_list Json.of_string) value.hosts));
      ("id", Some (Json.of_string value.id));
      ("intervalMinutes", Some (Json.of_int value.interval_minutes));
      ("location", Some (Json.of_string value.location));
      ("macroCall", Option.map Json.of_bool value.macro_call);
      ("mode", Some (yojson_of_scheduling_mode value.mode));
      ("noticeMinutes", Some (Json.of_int value.notice_minutes));
      ( "questions",
        Some ((Json.of_list yojson_of_booking_question) value.questions) );
      ("requiresConfirmation", Some (Json.of_bool value.requires_confirmation));
      ("scheduleId", Some (Json.of_string value.schedule_id));
      ("slug", Some (Json.of_string value.slug));
      ("title", Some (Json.of_string value.title));
    ]

let make_booking_event_type ~(after_minutes : int) ~(before_minutes : int)
    ?daily_limit ~(description : string) ~(duration_minutes : int)
    ~(enabled : bool) ~(google_meet : bool) ~(horizon_days : int)
    ~(hosts : string list) ~(id : string) ~(interval_minutes : int)
    ~(location : string) ?macro_call ~(mode : scheduling_mode)
    ~(notice_minutes : int) ~(questions : booking_question list)
    ~(requires_confirmation : bool) ~(schedule_id : string) ~(slug : string)
    ~(title : string) () =
  ({
     after_minutes;
     before_minutes;
     daily_limit;
     description;
     duration_minutes;
     enabled;
     google_meet;
     horizon_days;
     hosts;
     id;
     interval_minutes;
     location;
     macro_call;
     mode;
     notice_minutes;
     questions;
     requires_confirmation;
     schedule_id;
     slug;
     title;
   }
    : booking_event_type)

type nonrec insight_counts = {
  cancelled : int;  (** Cancelled bookings, grouped by their scheduled start. *)
  completed : int;
      (** Confirmed, ended bookings excluding explicit no-shows. *)
  guest_no_show : int;  (** Explicit guest no-shows only. *)
  host_no_show : int;  (** Explicit host no-shows only. *)
  rescheduled : int;
      (** Bookings with at least one completed reschedule, counted once. *)
  total : int;  (** All bookings except failed and processing requests. *)
}
(** Counts can overlap: a rescheduled event can also be completed or cancelled. *)

let insight_counts_of_yojson : Yojson.Safe.t -> insight_counts =
 fun json ->
  let fields = Json.obj json in
  {
    cancelled = Json.required fields "cancelled" Json.int;
    completed = Json.required fields "completed" Json.int;
    guest_no_show = Json.required fields "guestNoShow" Json.int;
    host_no_show = Json.required fields "hostNoShow" Json.int;
    rescheduled = Json.required fields "rescheduled" Json.int;
    total = Json.required fields "total" Json.int;
  }

and yojson_of_insight_counts : insight_counts -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("cancelled", Some (Json.of_int value.cancelled));
      ("completed", Some (Json.of_int value.completed));
      ("guestNoShow", Some (Json.of_int value.guest_no_show));
      ("hostNoShow", Some (Json.of_int value.host_no_show));
      ("rescheduled", Some (Json.of_int value.rescheduled));
      ("total", Some (Json.of_int value.total));
    ]

let make_insight_counts ~(cancelled : int) ~(completed : int)
    ~(guest_no_show : int) ~(host_no_show : int) ~(rescheduled : int)
    ~(total : int) () =
  ({ cancelled; completed; guest_no_show; host_no_show; rescheduled; total }
    : insight_counts)

type nonrec insight_period = {
  average_minutes : float;
      (** Average scheduled duration of all confirmed bookings, including future ones. *)
  counts : insight_counts;  (** Summary event counts. *)
  days : (string * insight_counts) list;
      (** Local-date counts, including dates with zero bookings. *)
  event_counts : (string * int) list;  (** Booking counts by link identity. *)
  host_counts : (string * int) list;
      (** Booking counts by host; collective bookings count once for each host. *)
  hours : int list;  (** Booking counts by local hour, indexed from 0 to 23. *)
  meeting_minutes : float;
      (** Scheduled minutes of completed meetings, not actual call duration. *)
}
(** One complete period of metrics and chart data, with no guest contact information. *)

let insight_period_of_yojson : Yojson.Safe.t -> insight_period =
 fun json ->
  let fields = Json.obj json in
  {
    average_minutes = Json.required fields "averageMinutes" Json.float;
    counts = Json.required fields "counts" insight_counts_of_yojson;
    days = Json.required fields "days" (Json.map insight_counts_of_yojson);
    event_counts = Json.required fields "eventCounts" (Json.map Json.int);
    host_counts = Json.required fields "hostCounts" (Json.map Json.int);
    hours = Json.required fields "hours" (Json.list Json.int);
    meeting_minutes = Json.required fields "meetingMinutes" Json.float;
  }

and yojson_of_insight_period : insight_period -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("averageMinutes", Some (Json.of_float value.average_minutes));
      ("counts", Some (yojson_of_insight_counts value.counts));
      ("days", Some ((Json.of_map yojson_of_insight_counts) value.days));
      ("eventCounts", Some ((Json.of_map Json.of_int) value.event_counts));
      ("hostCounts", Some ((Json.of_map Json.of_int) value.host_counts));
      ("hours", Some ((Json.of_list Json.of_int) value.hours));
      ("meetingMinutes", Some (Json.of_float value.meeting_minutes));
    ]

let make_insight_period ~(average_minutes : float) ~(counts : insight_counts)
    ~(days : (string * insight_counts) list)
    ~(event_counts : (string * int) list) ~(host_counts : (string * int) list)
    ~(hours : int list) ~(meeting_minutes : float) () =
  ({
     average_minutes;
     counts;
     days;
     event_counts;
     host_counts;
     hours;
     meeting_minutes;
   }
    : insight_period)

type nonrec booking_insights = {
  as_of : string;  (** Time at which completion was evaluated. *)
  current : insight_period;  (** Requested period. *)
  previous : insight_period;
      (** Comparison period, using identical filters and definitions. *)
  previous_from : string;  (** Preceding period's first local date. *)
  previous_to : string;  (** Preceding period's last local date. *)
}
(** Current and equally long preceding local-calendar periods. *)

let booking_insights_of_yojson : Yojson.Safe.t -> booking_insights =
 fun json ->
  let fields = Json.obj json in
  {
    as_of = Json.required fields "asOf" Json.string;
    current = Json.required fields "current" insight_period_of_yojson;
    previous = Json.required fields "previous" insight_period_of_yojson;
    previous_from = Json.required fields "previousFrom" Json.string;
    previous_to = Json.required fields "previousTo" Json.string;
  }

and yojson_of_booking_insights : booking_insights -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("asOf", Some (Json.of_string value.as_of));
      ("current", Some (yojson_of_insight_period value.current));
      ("previous", Some (yojson_of_insight_period value.previous));
      ("previousFrom", Some (Json.of_string value.previous_from));
      ("previousTo", Some (Json.of_string value.previous_to));
    ]

let make_booking_insights ~(as_of : string) ~(current : insight_period)
    ~(previous : insight_period) ~(previous_from : string)
    ~(previous_to : string) () =
  ({ as_of; current; previous; previous_from; previous_to } : booking_insights)

type nonrec booking_link_event = {
  after_minutes : int;  (** Protected time after a meeting. *)
  before_minutes : int;  (** Protected time before a meeting. *)
  daily_limit : int option;
      (** Maximum bookings for this event on one schedule-local day. *)
  description : string;  (** Public description. *)
  duration_minutes : int;  (** Meeting duration. *)
  enabled : bool;  (** Whether new bookings are accepted. *)
  google_meet : bool;
      (** Generate a Google Meet conference. Mutually exclusive with [macroCall]. *)
  horizon_days : int;  (** Maximum days ahead. *)
  hosts : string list;  (** Current Macro user identities selected as hosts. *)
  interval_minutes : int;  (** Spacing of offered start times. *)
  location : string;  (** Meeting location. *)
  macro_call : bool option;
      (** Attach a Macro call when someone books. A join link is created for that
booking and written onto the calendar invitation. Mutually exclusive
with [googleMeet]. Prefer this for a Macro booking; omit or false when
the link should use Google Meet or no video. False is omitted so drafts
saved before this field still round-trip unchanged. *)
  mode : scheduling_mode;  (** Host assignment policy. *)
  notice_minutes : int;  (** Minimum notice in minutes. *)
  questions : booking_question list;  (** Additional form fields. *)
  requires_confirmation : bool;  (** Hold bookings for host approval. *)
  slug : string;  (** Unique link segment within a profile. *)
  title : string;  (** Public title. *)
}
(** All editable rules for one link. Personal links must use the authenticated user as host. *)

let booking_link_event_of_yojson : Yojson.Safe.t -> booking_link_event =
 fun json ->
  let fields = Json.obj json in
  {
    after_minutes = Json.required fields "afterMinutes" Json.int;
    before_minutes = Json.required fields "beforeMinutes" Json.int;
    daily_limit = Json.optional fields "dailyLimit" Json.int;
    description = Json.required fields "description" Json.string;
    duration_minutes = Json.required fields "durationMinutes" Json.int;
    enabled = Json.required fields "enabled" Json.bool;
    google_meet = Json.required fields "googleMeet" Json.bool;
    horizon_days = Json.required fields "horizonDays" Json.int;
    hosts = Json.required fields "hosts" (Json.list Json.string);
    interval_minutes = Json.required fields "intervalMinutes" Json.int;
    location = Json.required fields "location" Json.string;
    macro_call = Json.optional fields "macroCall" Json.bool;
    mode = Json.required fields "mode" scheduling_mode_of_yojson;
    notice_minutes = Json.required fields "noticeMinutes" Json.int;
    questions =
      Json.required fields "questions" (Json.list booking_question_of_yojson);
    requires_confirmation =
      Json.required fields "requiresConfirmation" Json.bool;
    slug = Json.required fields "slug" Json.string;
    title = Json.required fields "title" Json.string;
  }

and yojson_of_booking_link_event : booking_link_event -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("afterMinutes", Some (Json.of_int value.after_minutes));
      ("beforeMinutes", Some (Json.of_int value.before_minutes));
      ("dailyLimit", Option.map Json.of_int value.daily_limit);
      ("description", Some (Json.of_string value.description));
      ("durationMinutes", Some (Json.of_int value.duration_minutes));
      ("enabled", Some (Json.of_bool value.enabled));
      ("googleMeet", Some (Json.of_bool value.google_meet));
      ("horizonDays", Some (Json.of_int value.horizon_days));
      ("hosts", Some ((Json.of_list Json.of_string) value.hosts));
      ("intervalMinutes", Some (Json.of_int value.interval_minutes));
      ("location", Some (Json.of_string value.location));
      ("macroCall", Option.map Json.of_bool value.macro_call);
      ("mode", Some (yojson_of_scheduling_mode value.mode));
      ("noticeMinutes", Some (Json.of_int value.notice_minutes));
      ( "questions",
        Some ((Json.of_list yojson_of_booking_question) value.questions) );
      ("requiresConfirmation", Some (Json.of_bool value.requires_confirmation));
      ("slug", Some (Json.of_string value.slug));
      ("title", Some (Json.of_string value.title));
    ]

let make_booking_link_event ~(after_minutes : int) ~(before_minutes : int)
    ?daily_limit ~(description : string) ~(duration_minutes : int)
    ~(enabled : bool) ~(google_meet : bool) ~(horizon_days : int)
    ~(hosts : string list) ~(interval_minutes : int) ~(location : string)
    ?macro_call ~(mode : scheduling_mode) ~(notice_minutes : int)
    ~(questions : booking_question list) ~(requires_confirmation : bool)
    ~(slug : string) ~(title : string) () =
  ({
     after_minutes;
     before_minutes;
     daily_limit;
     description;
     duration_minutes;
     enabled;
     google_meet;
     horizon_days;
     hosts;
     interval_minutes;
     location;
     macro_call;
     mode;
     notice_minutes;
     questions;
     requires_confirmation;
     slug;
     title;
   }
    : booking_link_event)

type nonrec booking_weekly_day = {
  day : int;  (** Sunday is zero. *)
  windows : booking_time_window list;  (** Non-overlapping local windows. *)
}
(** Availability for one weekday. *)

let booking_weekly_day_of_yojson : Yojson.Safe.t -> booking_weekly_day =
 fun json ->
  let fields = Json.obj json in
  {
    day = Json.required fields "day" Json.int;
    windows =
      Json.required fields "windows" (Json.list booking_time_window_of_yojson);
  }

and yojson_of_booking_weekly_day : booking_weekly_day -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("day", Some (Json.of_int value.day));
      ( "windows",
        Some ((Json.of_list yojson_of_booking_time_window) value.windows) );
    ]

let make_booking_weekly_day ~(day : int) ~(windows : booking_time_window list)
    () =
  ({ day; windows } : booking_weekly_day)

type nonrec booking_link_schedule = {
  name : string;  (** Display name. *)
  overrides : booking_date_override list;  (** Date-specific replacements. *)
  time_zone : string;  (** IANA time zone. *)
  weekly : booking_weekly_day list;  (** Weekly windows. *)
}
(** Availability copied into a dedicated schedule when it changes; other links retain their hours. *)

let booking_link_schedule_of_yojson : Yojson.Safe.t -> booking_link_schedule =
 fun json ->
  let fields = Json.obj json in
  {
    name = Json.required fields "name" Json.string;
    overrides =
      Json.required fields "overrides"
        (Json.list booking_date_override_of_yojson);
    time_zone = Json.required fields "timeZone" Json.string;
    weekly =
      Json.required fields "weekly" (Json.list booking_weekly_day_of_yojson);
  }

and yojson_of_booking_link_schedule : booking_link_schedule -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("name", Some (Json.of_string value.name));
      ( "overrides",
        Some ((Json.of_list yojson_of_booking_date_override) value.overrides) );
      ("timeZone", Some (Json.of_string value.time_zone));
      ("weekly", Some ((Json.of_list yojson_of_booking_weekly_day) value.weekly));
    ]

let make_booking_link_schedule ~(name : string)
    ~(overrides : booking_date_override list) ~(time_zone : string)
    ~(weekly : booking_weekly_day list) () =
  ({ name; overrides; time_zone; weekly } : booking_link_schedule)

type nonrec booking_link_draft = {
  event : booking_link_event;
      (** Public details, hosts, booking rules and questions. *)
  schedule : booking_link_schedule;
      (** Weekly hours, IANA time zone, and date overrides for this link. *)
}
(** Complete proposal reviewed and validated before saving. *)

let booking_link_draft_of_yojson : Yojson.Safe.t -> booking_link_draft =
 fun json ->
  let fields = Json.obj json in
  {
    event = Json.required fields "event" booking_link_event_of_yojson;
    schedule = Json.required fields "schedule" booking_link_schedule_of_yojson;
  }

and yojson_of_booking_link_draft : booking_link_draft -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("event", Some (yojson_of_booking_link_event value.event));
      ("schedule", Some (yojson_of_booking_link_schedule value.schedule));
    ]

let make_booking_link_draft ~(event : booking_link_event)
    ~(schedule : booking_link_schedule) () =
  ({ event; schedule } : booking_link_draft)

type nonrec booking_link = {
  draft : booking_link_draft;  (** Full editable configuration. *)
  event_type_id : string;  (** Stable link identity. *)
  profile_id : string;  (** Owning profile. *)
  revision : int64;  (** Profile revision to supply when editing. *)
}
(** Saved link with actual identities and revision for subsequent edits. *)

let booking_link_of_yojson : Yojson.Safe.t -> booking_link =
 fun json ->
  let fields = Json.obj json in
  {
    draft = Json.required fields "draft" booking_link_draft_of_yojson;
    event_type_id = Json.required fields "eventTypeId" Json.string;
    profile_id = Json.required fields "profileId" Json.string;
    revision = Json.required fields "revision" Json.int64;
  }

and yojson_of_booking_link : booking_link -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("draft", Some (yojson_of_booking_link_draft value.draft));
      ("eventTypeId", Some (Json.of_string value.event_type_id));
      ("profileId", Some (Json.of_string value.profile_id));
      ("revision", Some (Json.of_int64 value.revision));
    ]

let make_booking_link ~(draft : booking_link_draft) ~(event_type_id : string)
    ~(profile_id : string) ~(revision : int64) () =
  ({ draft; event_type_id; profile_id; revision } : booking_link)

type nonrec booking_schedule = {
  id : string;  (** Stable schedule identity. *)
  name : string;  (** Display name. *)
  overrides : booking_date_override list;  (** Date-specific replacements. *)
  time_zone : string;  (** IANA time zone. *)
  weekly : booking_weekly_day list;  (** Weekly windows. *)
}
(** Reusable hours, with DST interpreted in an IANA zone. *)

let booking_schedule_of_yojson : Yojson.Safe.t -> booking_schedule =
 fun json ->
  let fields = Json.obj json in
  {
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    overrides =
      Json.required fields "overrides"
        (Json.list booking_date_override_of_yojson);
    time_zone = Json.required fields "timeZone" Json.string;
    weekly =
      Json.required fields "weekly" (Json.list booking_weekly_day_of_yojson);
  }

and yojson_of_booking_schedule : booking_schedule -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ( "overrides",
        Some ((Json.of_list yojson_of_booking_date_override) value.overrides) );
      ("timeZone", Some (Json.of_string value.time_zone));
      ("weekly", Some ((Json.of_list yojson_of_booking_weekly_day) value.weekly));
    ]

let make_booking_schedule ~(id : string) ~(name : string)
    ~(overrides : booking_date_override list) ~(time_zone : string)
    ~(weekly : booking_weekly_day list) () =
  ({ id; name; overrides; time_zone; weekly } : booking_schedule)

type nonrec booking_link_listing = {
  links : booking_link list;
      (** Links whose title, slug or description matches the search, including paused links. *)
  profile_id : string;
      (** Owning profile identity, including unsaved new profiles. *)
  revision : int64;  (** Current revision. *)
  schedules : booking_schedule list;
      (** Reusable schedules, even when no links match. *)
  team_ids : string list;
      (** Current team identities that can be used to discover team links. *)
  user_id : string;
      (** Current authenticated host identity for personal drafts. *)
}
(** Authorized discovery results including reusable availability. *)

let booking_link_listing_of_yojson : Yojson.Safe.t -> booking_link_listing =
 fun json ->
  let fields = Json.obj json in
  {
    links = Json.required fields "links" (Json.list booking_link_of_yojson);
    profile_id = Json.required fields "profileId" Json.string;
    revision = Json.required fields "revision" Json.int64;
    schedules =
      Json.required fields "schedules" (Json.list booking_schedule_of_yojson);
    team_ids = Json.required fields "teamIds" (Json.list Json.string);
    user_id = Json.required fields "userId" Json.string;
  }

and yojson_of_booking_link_listing : booking_link_listing -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("links", Some ((Json.of_list yojson_of_booking_link) value.links));
      ("profileId", Some (Json.of_string value.profile_id));
      ("revision", Some (Json.of_int64 value.revision));
      ( "schedules",
        Some ((Json.of_list yojson_of_booking_schedule) value.schedules) );
      ("teamIds", Some ((Json.of_list Json.of_string) value.team_ids));
      ("userId", Some (Json.of_string value.user_id));
    ]

let make_booking_link_listing ~(links : booking_link list)
    ~(profile_id : string) ~(revision : int64)
    ~(schedules : booking_schedule list) ~(team_ids : string list)
    ~(user_id : string) () =
  ({ links; profile_id; revision; schedules; team_ids; user_id }
    : booking_link_listing)

type nonrec booking_profile = {
  default_schedule_id : string option;
      (** Personal hours used by team events; absent legacy profiles use their first schedule. *)
  description : string;  (** Public introduction. *)
  event_types : booking_event_type list;  (** Booking links. *)
  id : string;  (** Public, opaque profile identity. *)
  name : string;  (** Display name on the public page. *)
  revision : int64;  (** Optimistic concurrency version. *)
  schedules : booking_schedule list;  (** Reusable schedules. *)
}
(** Editable configuration for a person or team. *)

let booking_profile_of_yojson : Yojson.Safe.t -> booking_profile =
 fun json ->
  let fields = Json.obj json in
  {
    default_schedule_id = Json.optional fields "defaultScheduleId" Json.string;
    description = Json.required fields "description" Json.string;
    event_types =
      Json.required fields "eventTypes" (Json.list booking_event_type_of_yojson);
    id = Json.required fields "id" Json.string;
    name = Json.required fields "name" Json.string;
    revision = Json.required fields "revision" Json.int64;
    schedules =
      Json.required fields "schedules" (Json.list booking_schedule_of_yojson);
  }

and yojson_of_booking_profile : booking_profile -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("defaultScheduleId", Option.map Json.of_string value.default_schedule_id);
      ("description", Some (Json.of_string value.description));
      ( "eventTypes",
        Some ((Json.of_list yojson_of_booking_event_type) value.event_types) );
      ("id", Some (Json.of_string value.id));
      ("name", Some (Json.of_string value.name));
      ("revision", Some (Json.of_int64 value.revision));
      ( "schedules",
        Some ((Json.of_list yojson_of_booking_schedule) value.schedules) );
    ]

let make_booking_profile ?default_schedule_id ~(description : string)
    ~(event_types : booking_event_type list) ~(id : string) ~(name : string)
    ~(revision : int64) ~(schedules : booking_schedule list) () =
  ({
     default_schedule_id;
     description;
     event_types;
     id;
     name;
     revision;
     schedules;
   }
    : booking_profile)

type nonrec booking_response = { booking : booking  (** The saved booking. *) }
(** One booking after a change. *)

let booking_response_of_yojson : Yojson.Safe.t -> booking_response =
 fun json ->
  let fields = Json.obj json in
  { booking = Json.required fields "booking" booking_of_yojson }

and yojson_of_booking_response : booking_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("booking", Some (yojson_of_booking value.booking)) ]

let make_booking_response ~(booking : booking) () =
  ({ booking } : booking_response)

type nonrec booking_slot = {
  ends_at : string;  (** Absolute end. *)
  starts_at : string;  (** Absolute start. *)
}
(** Available slot and the hosts who can satisfy it. *)

let booking_slot_of_yojson : Yojson.Safe.t -> booking_slot =
 fun json ->
  let fields = Json.obj json in
  {
    ends_at = Json.required fields "endsAt" Json.string;
    starts_at = Json.required fields "startsAt" Json.string;
  }

and yojson_of_booking_slot : booking_slot -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("endsAt", Some (Json.of_string value.ends_at));
      ("startsAt", Some (Json.of_string value.starts_at));
    ]

let make_booking_slot ~(ends_at : string) ~(starts_at : string) () =
  ({ ends_at; starts_at } : booking_slot)

type nonrec bookings_response = {
  bookings : booking list;  (** Every matching booking. *)
}
(** Bookings of one profile. *)

let bookings_response_of_yojson : Yojson.Safe.t -> bookings_response =
 fun json ->
  let fields = Json.obj json in
  { bookings = Json.required fields "bookings" (Json.list booking_of_yojson) }

and yojson_of_bookings_response : bookings_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("bookings", Some ((Json.of_list yojson_of_booking) value.bookings)) ]

let make_bookings_response ~(bookings : booking list) () =
  ({ bookings } : bookings_response)

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

type nonrec calendar_attendee_input_body = {
  email : string;  (** Attendee email address. *)
  is_optional : bool option;  (** Whether attendance is optional. *)
}
(** An attendee supplied to a calendar mutation. *)

let calendar_attendee_input_body_of_yojson :
    Yojson.Safe.t -> calendar_attendee_input_body =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    is_optional = Json.optional fields "isOptional" Json.bool;
  }

and yojson_of_calendar_attendee_input_body :
    calendar_attendee_input_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("isOptional", Option.map Json.of_bool value.is_optional);
    ]

let make_calendar_attendee_input_body ~(email : string) ?is_optional () =
  ({ email; is_optional } : calendar_attendee_input_body)

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

type nonrec calendar_capabilities = {
  auto_decline : bool;
      (** Whether event-level automatic invitation declines are supported. *)
  conference_provider : conference_provider option;
  custom_recurrence : bool;
      (** Whether arbitrary RFC 5545 recurrence properties can be written. *)
  email_reminders : bool;
      (** Whether email reminders are delivered by the provider or Macro. *)
  guest_policy : bool;  (** Whether the organizer can set what guests may do. *)
  remove_conference : bool;
      (** Whether an existing conference can be detached. *)
  reset_rsvp : bool;
      (** Whether an attendee can reset their RSVP to unanswered. *)
}
(** Actual provider capabilities used by calendar editors. *)

let calendar_capabilities_of_yojson : Yojson.Safe.t -> calendar_capabilities =
 fun json ->
  let fields = Json.obj json in
  {
    auto_decline = Json.required fields "autoDecline" Json.bool;
    conference_provider =
      Json.optional fields "conferenceProvider" conference_provider_of_yojson;
    custom_recurrence = Json.required fields "customRecurrence" Json.bool;
    email_reminders = Json.required fields "emailReminders" Json.bool;
    guest_policy = Json.required fields "guestPolicy" Json.bool;
    remove_conference = Json.required fields "removeConference" Json.bool;
    reset_rsvp = Json.required fields "resetRsvp" Json.bool;
  }

and yojson_of_calendar_capabilities : calendar_capabilities -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("autoDecline", Some (Json.of_bool value.auto_decline));
      ( "conferenceProvider",
        Option.map yojson_of_conference_provider value.conference_provider );
      ("customRecurrence", Some (Json.of_bool value.custom_recurrence));
      ("emailReminders", Some (Json.of_bool value.email_reminders));
      ("guestPolicy", Some (Json.of_bool value.guest_policy));
      ("removeConference", Some (Json.of_bool value.remove_conference));
      ("resetRsvp", Some (Json.of_bool value.reset_rsvp));
    ]

let make_calendar_capabilities ~(auto_decline : bool) ?conference_provider
    ~(custom_recurrence : bool) ~(email_reminders : bool) ~(guest_policy : bool)
    ~(remove_conference : bool) ~(reset_rsvp : bool) () =
  ({
     auto_decline;
     conference_provider;
     custom_recurrence;
     email_reminders;
     guest_policy;
     remove_conference;
     reset_rsvp;
   }
    : calendar_capabilities)

(** How much of a recurring series a deletion removes. *)
type nonrec calendar_deletion_scope_param =
  | All
  | This_event
  | This_and_following
  | Unknown of string  (** A value this SDK version does not know. *)

let calendar_deletion_scope_param_of_yojson :
    Yojson.Safe.t -> calendar_deletion_scope_param =
 fun json ->
  match Json.string json with
  | "all" -> All
  | "this_event" -> This_event
  | "this_and_following" -> This_and_following
  | other -> Json.unknown "calendar_deletion_scope_param" json (Unknown other)

and yojson_of_calendar_deletion_scope_param :
    calendar_deletion_scope_param -> Yojson.Safe.t =
 fun value ->
  match value with
  | All -> `String "all"
  | This_event -> `String "this_event"
  | This_and_following -> `String "this_and_following"
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

type nonrec calendar_event_provider_url = {
  url : string option;
      (** None when the event no longer exists at its provider. *)
}
(** Provider-validated external event link. *)

let calendar_event_provider_url_of_yojson :
    Yojson.Safe.t -> calendar_event_provider_url =
 fun json ->
  let fields = Json.obj json in
  { url = Json.optional fields "url" Json.string }

and yojson_of_calendar_event_provider_url :
    calendar_event_provider_url -> Yojson.Safe.t =
 fun value -> Json.record [ ("url", Option.map Json.of_string value.url) ]

let make_calendar_event_provider_url ?url () =
  ({ url } : calendar_event_provider_url)

type nonrec calendar_guest_input_body = {
  email : string;  (** Guest email address. *)
  optional : bool option;  (** Whether attendance is optional. *)
}
(** A guest added to an event. *)

let calendar_guest_input_body_of_yojson :
    Yojson.Safe.t -> calendar_guest_input_body =
 fun json ->
  let fields = Json.obj json in
  {
    email = Json.required fields "email" Json.string;
    optional = Json.optional fields "optional" Json.bool;
  }

and yojson_of_calendar_guest_input_body :
    calendar_guest_input_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("email", Some (Json.of_string value.email));
      ("optional", Option.map Json.of_bool value.optional);
    ]

let make_calendar_guest_input_body ~(email : string) ?optional () =
  ({ email; optional } : calendar_guest_input_body)

(** Lifecycle of a request to be added as a guest of a shared event. *)
type nonrec calendar_join_request_status =
  | Pending
  | Accepted
  | Declined
  | Unknown of string  (** A value this SDK version does not know. *)

let calendar_join_request_status_of_yojson :
    Yojson.Safe.t -> calendar_join_request_status =
 fun json ->
  match Json.string json with
  | "pending" -> Pending
  | "accepted" -> Accepted
  | "declined" -> Declined
  | other -> Json.unknown "calendar_join_request_status" json (Unknown other)

and yojson_of_calendar_join_request_status :
    calendar_join_request_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Pending -> `String "pending"
  | Accepted -> `String "accepted"
  | Declined -> `String "declined"
  | Unknown other -> `String other

type nonrec calendar_join_request = {
  created_at : string;  (** When the request was made. *)
  event_id : string;
      (** The sharer's event entity that was shared with the channel. *)
  id : string;  (** Request identifier. *)
  requester_email : string;  (** Address the sharer invites when accepting. *)
  requester_id : string;  (** Macro user asking to join. *)
  status : calendar_join_request_status;  (** Where the request stands. *)
}
(** A channel member's request to be added as a guest of an event they see
only through a channel share. *)

let calendar_join_request_of_yojson : Yojson.Safe.t -> calendar_join_request =
 fun json ->
  let fields = Json.obj json in
  {
    created_at = Json.required fields "createdAt" Json.string;
    event_id = Json.required fields "eventId" Json.string;
    id = Json.required fields "id" Json.string;
    requester_email = Json.required fields "requesterEmail" Json.string;
    requester_id = Json.required fields "requesterId" Json.string;
    status =
      Json.required fields "status" calendar_join_request_status_of_yojson;
  }

and yojson_of_calendar_join_request : calendar_join_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("createdAt", Some (Json.of_string value.created_at));
      ("eventId", Some (Json.of_string value.event_id));
      ("id", Some (Json.of_string value.id));
      ("requesterEmail", Some (Json.of_string value.requester_email));
      ("requesterId", Some (Json.of_string value.requester_id));
      ("status", Some (yojson_of_calendar_join_request_status value.status));
    ]

let make_calendar_join_request ~(created_at : string) ~(event_id : string)
    ~(id : string) ~(requester_email : string) ~(requester_id : string)
    ~(status : calendar_join_request_status) () =
  ({ created_at; event_id; id; requester_email; requester_id; status }
    : calendar_join_request)

(** How a sharer answers a request to join their event. *)
type nonrec calendar_join_request_decision =
  | Accept
  | Decline
  | Unknown of string  (** A value this SDK version does not know. *)

let calendar_join_request_decision_of_yojson :
    Yojson.Safe.t -> calendar_join_request_decision =
 fun json ->
  match Json.string json with
  | "accept" -> Accept
  | "decline" -> Decline
  | other -> Json.unknown "calendar_join_request_decision" json (Unknown other)

and yojson_of_calendar_join_request_decision :
    calendar_join_request_decision -> Yojson.Safe.t =
 fun value ->
  match value with
  | Accept -> `String "accept"
  | Decline -> `String "decline"
  | Unknown other -> `String other

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

(** Provider selected from the persisted calendar account and email binding. *)
type nonrec calendar_provider =
  | Google
  | Outlook
  | Unknown of string  (** A value this SDK version does not know. *)

let calendar_provider_of_yojson : Yojson.Safe.t -> calendar_provider =
 fun json ->
  match Json.string json with
  | "google" -> Google
  | "outlook" -> Outlook
  | other -> Json.unknown "calendar_provider" json (Unknown other)

and yojson_of_calendar_provider : calendar_provider -> Yojson.Safe.t =
 fun value ->
  match value with
  | Google -> `String "google"
  | Outlook -> `String "outlook"
  | Unknown other -> `String other

(** User-visible workflow state. *)
type nonrec replacement_status =
  | Needs_confirmation
  | In_progress
  | Complete
  | Unknown of string  (** A value this SDK version does not know. *)

let replacement_status_of_yojson : Yojson.Safe.t -> replacement_status =
 fun json ->
  match Json.string json with
  | "needs_confirmation" -> Needs_confirmation
  | "in_progress" -> In_progress
  | "complete" -> Complete
  | other -> Json.unknown "replacement_status" json (Unknown other)

and yojson_of_replacement_status : replacement_status -> Yojson.Safe.t =
 fun value ->
  match value with
  | Needs_confirmation -> `String "needs_confirmation"
  | In_progress -> `String "in_progress"
  | Complete -> `String "complete"
  | Unknown other -> `String other

type nonrec calendar_replacement_view = {
  attendee_count : int;
      (** Guest count for cancellation and reinvitation confirmation. *)
  completed_steps : int;  (** Number of completed provider steps. *)
  event : calendar_event option;
  is_series : bool;
      (** Entire recurring series, including exceptions, is replaced. *)
  operation_id : string;
      (** Use this identity when confirming or checking progress. *)
  provider_url : string option;  (** Original event for manual review. *)
  remove_conference : bool;  (** The provider conference is removed. *)
  replacement_url : string option;
      (** New provider event, when creation was confirmed. *)
  status : replacement_status;  (** Current durable state. *)
  time : event_time;  (** Frozen time. *)
  title : string;  (** Frozen title. *)
  total_steps : int;  (** Number of provider steps in this operation. *)
}
(** Safe preview and recovery response; never exposes the opaque provider snapshot. *)

let calendar_replacement_view_of_yojson :
    Yojson.Safe.t -> calendar_replacement_view =
 fun json ->
  let fields = Json.obj json in
  {
    attendee_count = Json.required fields "attendeeCount" Json.int;
    completed_steps = Json.required fields "completedSteps" Json.int;
    event = Json.optional fields "event" calendar_event_of_yojson;
    is_series = Json.required fields "isSeries" Json.bool;
    operation_id = Json.required fields "operationId" Json.string;
    provider_url = Json.optional fields "providerUrl" Json.string;
    remove_conference = Json.required fields "removeConference" Json.bool;
    replacement_url = Json.optional fields "replacementUrl" Json.string;
    status = Json.required fields "status" replacement_status_of_yojson;
    time = Json.required fields "time" event_time_of_yojson;
    title = Json.required fields "title" Json.string;
    total_steps = Json.required fields "totalSteps" Json.int;
  }

and yojson_of_calendar_replacement_view :
    calendar_replacement_view -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("attendeeCount", Some (Json.of_int value.attendee_count));
      ("completedSteps", Some (Json.of_int value.completed_steps));
      ("event", Option.map yojson_of_calendar_event value.event);
      ("isSeries", Some (Json.of_bool value.is_series));
      ("operationId", Some (Json.of_string value.operation_id));
      ("providerUrl", Option.map Json.of_string value.provider_url);
      ("removeConference", Some (Json.of_bool value.remove_conference));
      ("replacementUrl", Option.map Json.of_string value.replacement_url);
      ("status", Some (yojson_of_replacement_status value.status));
      ("time", Some (yojson_of_event_time value.time));
      ("title", Some (Json.of_string value.title));
      ("totalSteps", Some (Json.of_int value.total_steps));
    ]

let make_calendar_replacement_view ~(attendee_count : int)
    ~(completed_steps : int) ?event ~(is_series : bool) ~(operation_id : string)
    ?provider_url ~(remove_conference : bool) ?replacement_url
    ~(status : replacement_status) ~(time : event_time) ~(title : string)
    ~(total_steps : int) () =
  ({
     attendee_count;
     completed_steps;
     event;
     is_series;
     operation_id;
     provider_url;
     remove_conference;
     replacement_url;
     status;
     time;
     title;
     total_steps;
   }
    : calendar_replacement_view)

(** How much of a recurring series an RSVP applies to.

Unlike deletion there is no this-and-following variant: the provider
cannot express a forward-scoped response, so offering one would be a
promise sync could not keep. *)
type nonrec calendar_rsvp_scope_param =
  | All
  | This_event
  | Unknown of string  (** A value this SDK version does not know. *)

let calendar_rsvp_scope_param_of_yojson :
    Yojson.Safe.t -> calendar_rsvp_scope_param =
 fun json ->
  match Json.string json with
  | "all" -> All
  | "this_event" -> This_event
  | other -> Json.unknown "calendar_rsvp_scope_param" json (Unknown other)

and yojson_of_calendar_rsvp_scope_param :
    calendar_rsvp_scope_param -> Yojson.Safe.t =
 fun value ->
  match value with
  | All -> `String "all"
  | This_event -> `String "this_event"
  | Unknown other -> `String other

(** How much of a recurring series an update applies to.

Like RSVPs there is no this-and-following variant: the provider cannot
express a forward-scoped edit as one write, and emulating it (truncate
the series, insert an edited clone) is non-atomic and re-invites the
attendees of the clone. Compose it from a this-and-following deletion
and a create when that shape is wanted. *)
type nonrec calendar_update_scope_param =
  | All
  | This_event
  | Unknown of string  (** A value this SDK version does not know. *)

let calendar_update_scope_param_of_yojson :
    Yojson.Safe.t -> calendar_update_scope_param =
 fun json ->
  match Json.string json with
  | "all" -> All
  | "this_event" -> This_event
  | other -> Json.unknown "calendar_update_scope_param" json (Unknown other)

and yojson_of_calendar_update_scope_param :
    calendar_update_scope_param -> Yojson.Safe.t =
 fun value ->
  match value with
  | All -> `String "all"
  | This_event -> `String "this_event"
  | Unknown other -> `String other

(** A requested change to an event's conferencing. Omitting the field leaves
the existing conference untouched; only these values change it. *)
type nonrec conference_change =
  | Provider_default
  | Microsoft_teams
  | Google_meet
  | None_
  | Unknown of string  (** A value this SDK version does not know. *)

let conference_change_of_yojson : Yojson.Safe.t -> conference_change =
 fun json ->
  match Json.string json with
  | "provider_default" -> Provider_default
  | "microsoft_teams" -> Microsoft_teams
  | "google_meet" -> Google_meet
  | "none" -> None_
  | other -> Json.unknown "conference_change" json (Unknown other)

and yojson_of_conference_change : conference_change -> Yojson.Safe.t =
 fun value ->
  match value with
  | Provider_default -> `String "provider_default"
  | Microsoft_teams -> `String "microsoft_teams"
  | Google_meet -> `String "google_meet"
  | None_ -> `String "none"
  | Unknown other -> `String other

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

type nonrec create_booking_link_request = {
  draft : booking_link_draft;
      (** Full booking rules and availability the user approved. *)
  user_confirmation : string;
      (** The user's reply approving this proposal, quoted verbatim. *)
}
(** A new booking link, saved after the user approved it. *)

let create_booking_link_request_of_yojson :
    Yojson.Safe.t -> create_booking_link_request =
 fun json ->
  let fields = Json.obj json in
  {
    draft = Json.required fields "draft" booking_link_draft_of_yojson;
    user_confirmation = Json.required fields "userConfirmation" Json.string;
  }

and yojson_of_create_booking_link_request :
    create_booking_link_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("draft", Some (yojson_of_booking_link_draft value.draft));
      ("userConfirmation", Some (Json.of_string value.user_confirmation));
    ]

let make_create_booking_link_request ~(draft : booking_link_draft)
    ~(user_confirmation : string) () =
  ({ draft; user_confirmation } : create_booking_link_request)

(** How an out-of-office event responds to conflicting invitations, mirroring
Google's [autoDeclineMode]. *)
type nonrec out_of_office_auto_decline_mode =
  | Decline_none
  | Decline_all_conflicting_invitations
  | Decline_only_new_conflicting_invitations
  | Unknown of string  (** A value this SDK version does not know. *)

let out_of_office_auto_decline_mode_of_yojson :
    Yojson.Safe.t -> out_of_office_auto_decline_mode =
 fun json ->
  match Json.string json with
  | "decline_none" -> Decline_none
  | "decline_all_conflicting_invitations" -> Decline_all_conflicting_invitations
  | "decline_only_new_conflicting_invitations" ->
      Decline_only_new_conflicting_invitations
  | other -> Json.unknown "out_of_office_auto_decline_mode" json (Unknown other)

and yojson_of_out_of_office_auto_decline_mode :
    out_of_office_auto_decline_mode -> Yojson.Safe.t =
 fun value ->
  match value with
  | Decline_none -> `String "decline_none"
  | Decline_all_conflicting_invitations ->
      `String "decline_all_conflicting_invitations"
  | Decline_only_new_conflicting_invitations ->
      `String "decline_only_new_conflicting_invitations"
  | Unknown other -> `String other

type nonrec out_of_office_properties = {
  auto_decline_mode : out_of_office_auto_decline_mode option;
      (** How conflicting invitations are handled while the user is out. *)
  decline_message : string option;
      (** Message returned to organizers whose invitations are auto-declined. *)
}
(** The extra properties Google requires on an out-of-office event, mirroring
its [outOfOfficeProperties] block. Their presence on a draft or patch is
what marks the mutation as out-of-office. *)

let out_of_office_properties_of_yojson :
    Yojson.Safe.t -> out_of_office_properties =
 fun json ->
  let fields = Json.obj json in
  {
    auto_decline_mode =
      Json.optional fields "autoDeclineMode"
        out_of_office_auto_decline_mode_of_yojson;
    decline_message = Json.optional fields "declineMessage" Json.string;
  }

and yojson_of_out_of_office_properties :
    out_of_office_properties -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "autoDeclineMode",
        Option.map yojson_of_out_of_office_auto_decline_mode
          value.auto_decline_mode );
      ("declineMessage", Option.map Json.of_string value.decline_message);
    ]

let make_out_of_office_properties ?auto_decline_mode ?decline_message () =
  ({ auto_decline_mode; decline_message } : out_of_office_properties)

type nonrec create_calendar_event_request = {
  attendees : calendar_attendee_input_body list option;
      (** Invited attendees. *)
  calendar_id : string option;
      (** Exact calendar to create the event on; takes precedence over the
inbox default. *)
  conference : conference_change option;
  description : string option;  (** Optional event body. *)
  email_link_id : string option;
      (** Connected inbox whose primary calendar receives the event; defaults
to the requester's primary inbox. *)
  guest_policy : guest_policy option;
  idempotency_key : string option;
      (** Stable retry identity, scoped to the authenticated organizer. *)
  location : string option;  (** Optional location label. *)
  macro_call : bool option;
      (** Mint a Macro call and write its join link into the description and
location before creating the event, so the invitation carries it.
Cannot be combined with [conference]. *)
  out_of_office : out_of_office_properties option;
  recurrence_lines : string list option;
      (** Raw RFC 5545 recurrence properties ([RRULE], [RDATE], [EXDATE]). *)
  reminders : event_reminders option;
  time : event_time;  (** Timed or all-day shape. *)
  title : string;  (** Display title. *)
  transparency : event_transparency option;
  visibility : event_visibility option;
}
(** Request body creating a calendar event on the requester's calendar. *)

let create_calendar_event_request_of_yojson :
    Yojson.Safe.t -> create_calendar_event_request =
 fun json ->
  let fields = Json.obj json in
  {
    attendees =
      Json.optional fields "attendees"
        (Json.list calendar_attendee_input_body_of_yojson);
    calendar_id = Json.optional fields "calendarId" Json.string;
    conference = Json.optional fields "conference" conference_change_of_yojson;
    description = Json.optional fields "description" Json.string;
    email_link_id = Json.optional fields "emailLinkId" Json.string;
    guest_policy = Json.optional fields "guestPolicy" guest_policy_of_yojson;
    idempotency_key = Json.optional fields "idempotencyKey" Json.string;
    location = Json.optional fields "location" Json.string;
    macro_call = Json.optional fields "macroCall" Json.bool;
    out_of_office =
      Json.optional fields "outOfOffice" out_of_office_properties_of_yojson;
    recurrence_lines =
      Json.optional fields "recurrenceLines" (Json.list Json.string);
    reminders = Json.optional fields "reminders" event_reminders_of_yojson;
    time = Json.required fields "time" event_time_of_yojson;
    title = Json.required fields "title" Json.string;
    transparency =
      Json.optional fields "transparency" event_transparency_of_yojson;
    visibility = Json.optional fields "visibility" event_visibility_of_yojson;
  }

and yojson_of_create_calendar_event_request :
    create_calendar_event_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attendees",
        Option.map
          (Json.of_list yojson_of_calendar_attendee_input_body)
          value.attendees );
      ("calendarId", Option.map Json.of_string value.calendar_id);
      ("conference", Option.map yojson_of_conference_change value.conference);
      ("description", Option.map Json.of_string value.description);
      ("emailLinkId", Option.map Json.of_string value.email_link_id);
      ("guestPolicy", Option.map yojson_of_guest_policy value.guest_policy);
      ("idempotencyKey", Option.map Json.of_string value.idempotency_key);
      ("location", Option.map Json.of_string value.location);
      ("macroCall", Option.map Json.of_bool value.macro_call);
      ( "outOfOffice",
        Option.map yojson_of_out_of_office_properties value.out_of_office );
      ( "recurrenceLines",
        Option.map (Json.of_list Json.of_string) value.recurrence_lines );
      ("reminders", Option.map yojson_of_event_reminders value.reminders);
      ("time", Some (yojson_of_event_time value.time));
      ("title", Some (Json.of_string value.title));
      ( "transparency",
        Option.map yojson_of_event_transparency value.transparency );
      ("visibility", Option.map yojson_of_event_visibility value.visibility);
    ]

let make_create_calendar_event_request ?attendees ?calendar_id ?conference
    ?description ?email_link_id ?guest_policy ?idempotency_key ?location
    ?macro_call ?out_of_office ?recurrence_lines ?reminders ~(time : event_time)
    ~(title : string) ?transparency ?visibility () =
  ({
     attendees;
     calendar_id;
     conference;
     description;
     email_link_id;
     guest_policy;
     idempotency_key;
     location;
     macro_call;
     out_of_office;
     recurrence_lines;
     reminders;
     time;
     title;
     transparency;
     visibility;
   }
    : create_calendar_event_request)

type nonrec edit_booking_link_request = {
  draft : booking_link_draft;
      (** Full edited booking rules and availability the user approved. *)
  expected_revision : int64;
      (** Profile revision the edit was prepared from; a newer revision conflicts. *)
  user_confirmation : string;
      (** The user's reply approving this proposal, quoted verbatim. *)
}
(** Replacement configuration for one booking link, saved after the user approved it. *)

let edit_booking_link_request_of_yojson :
    Yojson.Safe.t -> edit_booking_link_request =
 fun json ->
  let fields = Json.obj json in
  {
    draft = Json.required fields "draft" booking_link_draft_of_yojson;
    expected_revision = Json.required fields "expectedRevision" Json.int64;
    user_confirmation = Json.required fields "userConfirmation" Json.string;
  }

and yojson_of_edit_booking_link_request :
    edit_booking_link_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("draft", Some (yojson_of_booking_link_draft value.draft));
      ("expectedRevision", Some (Json.of_int64 value.expected_revision));
      ("userConfirmation", Some (Json.of_string value.user_confirmation));
    ]

let make_edit_booking_link_request ~(draft : booking_link_draft)
    ~(expected_revision : int64) ~(user_confirmation : string) () =
  ({ draft; expected_revision; user_confirmation } : edit_booking_link_request)

type nonrec insight_query = {
  event_type_id : string option;
      (** Restrict to one booking link; omit for all links. *)
  from : string;  (** First local date, inclusive. *)
  host_id : string option;
      (** Restrict to one assigned host; omit for all hosts. *)
  time_zone : string;  (** IANA zone used for dates and hour-of-day grouping. *)
  to_ : string;  (** Last local date, inclusive; maximum 366 days. *)
}
(** Inclusive local dates and optional booking/host filters. *)

let insight_query_of_yojson : Yojson.Safe.t -> insight_query =
 fun json ->
  let fields = Json.obj json in
  {
    event_type_id = Json.optional fields "eventTypeId" Json.string;
    from = Json.required fields "from" Json.string;
    host_id = Json.optional fields "hostId" Json.string;
    time_zone = Json.required fields "timeZone" Json.string;
    to_ = Json.required fields "to" Json.string;
  }

and yojson_of_insight_query : insight_query -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("eventTypeId", Option.map Json.of_string value.event_type_id);
      ("from", Some (Json.of_string value.from));
      ("hostId", Option.map Json.of_string value.host_id);
      ("timeZone", Some (Json.of_string value.time_zone));
      ("to", Some (Json.of_string value.to_));
    ]

let make_insight_query ?event_type_id ~(from : string) ?host_id
    ~(time_zone : string) ~(to_ : string) () =
  ({ event_type_id; from; host_id; time_zone; to_ } : insight_query)

type nonrec invite_calendar_event_guests_request = {
  calendar_id : string option;
      (** Calendar whose copy of the event is written, for an event synced from
more than one calendar. Omit to write the canonical copy. *)
  guests : calendar_guest_input_body list;
      (** Guests to add; anyone already on the event is skipped. *)
  inbox : string option;
      (** Inbox address holding the copy this request changes. An agent run
must name it when the meeting is on more than one of the requester's
inboxes, and it must be the inbox holding the addressed copy; a
mismatch is refused whoever sends it. *)
  recurrence_id : string option;
      (** Original-start key of the occurrence the guests are added to. *)
  scope : calendar_update_scope_param option;
}
(** Request body adding guests to an event without touching anyone already
invited. *)

let invite_calendar_event_guests_request_of_yojson :
    Yojson.Safe.t -> invite_calendar_event_guests_request =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_id = Json.optional fields "calendarId" Json.string;
    guests =
      Json.required fields "guests"
        (Json.list calendar_guest_input_body_of_yojson);
    inbox = Json.optional fields "inbox" Json.string;
    recurrence_id = Json.optional fields "recurrenceId" Json.string;
    scope = Json.optional fields "scope" calendar_update_scope_param_of_yojson;
  }

and yojson_of_invite_calendar_event_guests_request :
    invite_calendar_event_guests_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("calendarId", Option.map Json.of_string value.calendar_id);
      ( "guests",
        Some ((Json.of_list yojson_of_calendar_guest_input_body) value.guests)
      );
      ("inbox", Option.map Json.of_string value.inbox);
      ("recurrenceId", Option.map Json.of_string value.recurrence_id);
      ("scope", Option.map yojson_of_calendar_update_scope_param value.scope);
    ]

let make_invite_calendar_event_guests_request ?calendar_id
    ~(guests : calendar_guest_input_body list) ?inbox ?recurrence_id ?scope () =
  ({ calendar_id; guests; inbox; recurrence_id; scope }
    : invite_calendar_event_guests_request)

type nonrec visible_calendar = {
  capabilities : calendar_capabilities;
      (** Provider features available on this actual calendar. *)
  color : string option;  (** Provider color. *)
  contributes_to_availability : bool option;
      (** Whether this calendar counts toward the requester's busy time: their
setting in Settings → Calendar, on by default for every calendar.
The nearest thing to "this is the requester's own": a provider's
access role only says what they may do, on a colleague's calendar too. *)
  default_reminders : event_reminder_override list;
      (** Default reminders applied to events that keep [useDefault]. *)
  email_address : string;
      (** Connected inbox address, for grouping in multi-inbox pickers. *)
  email_link_id : string;  (** Connected inbox that syncs this calendar. *)
  id : string;  (** Persisted Macro calendar identifier. *)
  is_primary : bool;  (** Whether this is its account's primary calendar. *)
  is_subscription : bool;
      (** Whether this is one of Google's shared system calendars (holidays,
birthdays) the account subscribes to rather than one a person maintains. *)
  is_writable : bool;
      (** Whether the grant can create and modify events on this calendar. *)
  name : string;  (** Provider display name. *)
  provider : calendar_provider;
      (** Calendar provider, for display and reconnect routing. *)
  sync_error : string option;
      (** A persistent sync failure isolated to this calendar, surfaced so the
settings row can badge it. [None] while the calendar is syncing
normally or a failure has not yet crossed the persistence threshold. *)
}
(** A calendar visible to a requester, listed for pickers and filters. *)

let visible_calendar_of_yojson : Yojson.Safe.t -> visible_calendar =
 fun json ->
  let fields = Json.obj json in
  {
    capabilities =
      Json.required fields "capabilities" calendar_capabilities_of_yojson;
    color = Json.optional fields "color" Json.string;
    contributes_to_availability =
      Json.optional fields "contributesToAvailability" Json.bool;
    default_reminders =
      Json.required fields "defaultReminders"
        (Json.list event_reminder_override_of_yojson);
    email_address = Json.required fields "emailAddress" Json.string;
    email_link_id = Json.required fields "emailLinkId" Json.string;
    id = Json.required fields "id" Json.string;
    is_primary = Json.required fields "isPrimary" Json.bool;
    is_subscription = Json.required fields "isSubscription" Json.bool;
    is_writable = Json.required fields "isWritable" Json.bool;
    name = Json.required fields "name" Json.string;
    provider = Json.required fields "provider" calendar_provider_of_yojson;
    sync_error = Json.optional fields "syncError" Json.string;
  }

and yojson_of_visible_calendar : visible_calendar -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("capabilities", Some (yojson_of_calendar_capabilities value.capabilities));
      ("color", Option.map Json.of_string value.color);
      ( "contributesToAvailability",
        Option.map Json.of_bool value.contributes_to_availability );
      ( "defaultReminders",
        Some
          ((Json.of_list yojson_of_event_reminder_override)
             value.default_reminders) );
      ("emailAddress", Some (Json.of_string value.email_address));
      ("emailLinkId", Some (Json.of_string value.email_link_id));
      ("id", Some (Json.of_string value.id));
      ("isPrimary", Some (Json.of_bool value.is_primary));
      ("isSubscription", Some (Json.of_bool value.is_subscription));
      ("isWritable", Some (Json.of_bool value.is_writable));
      ("name", Some (Json.of_string value.name));
      ("provider", Some (yojson_of_calendar_provider value.provider));
      ("syncError", Option.map Json.of_string value.sync_error);
    ]

let make_visible_calendar ~(capabilities : calendar_capabilities) ?color
    ?contributes_to_availability
    ~(default_reminders : event_reminder_override list)
    ~(email_address : string) ~(email_link_id : string) ~(id : string)
    ~(is_primary : bool) ~(is_subscription : bool) ~(is_writable : bool)
    ~(name : string) ~(provider : calendar_provider) ?sync_error () =
  ({
     capabilities;
     color;
     contributes_to_availability;
     default_reminders;
     email_address;
     email_link_id;
     id;
     is_primary;
     is_subscription;
     is_writable;
     name;
     provider;
     sync_error;
   }
    : visible_calendar)

type nonrec list_calendars_response = {
  calendars : visible_calendar list;
      (** Primaries and writable calendars first. *)
}
(** Calendars visible to the requester across connected and delegated inboxes. *)

let list_calendars_response_of_yojson : Yojson.Safe.t -> list_calendars_response
    =
 fun json ->
  let fields = Json.obj json in
  {
    calendars =
      Json.required fields "calendars" (Json.list visible_calendar_of_yojson);
  }

and yojson_of_list_calendars_response : list_calendars_response -> Yojson.Safe.t
    =
 fun value ->
  Json.record
    [
      ( "calendars",
        Some ((Json.of_list yojson_of_visible_calendar) value.calendars) );
    ]

let make_list_calendars_response ~(calendars : visible_calendar list) () =
  ({ calendars } : list_calendars_response)

type nonrec prepare_calendar_replacement_request = {
  calendar_id : string option;
      (** Exact calendar copy; defaults to canonical. *)
  recurrence_id : string option;
      (** Original-start key; omitted to replace the entire series. *)
  remove_conference : bool;
      (** Omit the provider conference in the replacement. *)
}
(** A read-only preview request. Confirmation uses the returned operation identity. *)

let prepare_calendar_replacement_request_of_yojson :
    Yojson.Safe.t -> prepare_calendar_replacement_request =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_id = Json.optional fields "calendarId" Json.string;
    recurrence_id = Json.optional fields "recurrenceId" Json.string;
    remove_conference = Json.required fields "removeConference" Json.bool;
  }

and yojson_of_prepare_calendar_replacement_request :
    prepare_calendar_replacement_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("calendarId", Option.map Json.of_string value.calendar_id);
      ("recurrenceId", Option.map Json.of_string value.recurrence_id);
      ("removeConference", Some (Json.of_bool value.remove_conference));
    ]

let make_prepare_calendar_replacement_request ?calendar_id ?recurrence_id
    ~(remove_conference : bool) () =
  ({ calendar_id; recurrence_id; remove_conference }
    : prepare_calendar_replacement_request)

type nonrec profile_response = {
  profile : booking_profile;
      (** Full settings, including the revision to save against. *)
}
(** Booking settings of one profile. *)

let profile_response_of_yojson : Yojson.Safe.t -> profile_response =
 fun json ->
  let fields = Json.obj json in
  { profile = Json.required fields "profile" booking_profile_of_yojson }

and yojson_of_profile_response : profile_response -> Yojson.Safe.t =
 fun value ->
  Json.record [ ("profile", Some (yojson_of_booking_profile value.profile)) ]

let make_profile_response ~(profile : booking_profile) () =
  ({ profile } : profile_response)

type nonrec receipt_response = {
  booking : booking;  (** The booking. *)
  schedule_time_zone : string;
      (** IANA time zone of the booking's availability schedule. *)
  token : string;
      (** Bearer capability for the booker's receipt, reschedule and cancel pages. *)
}
(** A booking with its booker management capability. *)

let receipt_response_of_yojson : Yojson.Safe.t -> receipt_response =
 fun json ->
  let fields = Json.obj json in
  {
    booking = Json.required fields "booking" booking_of_yojson;
    schedule_time_zone = Json.required fields "scheduleTimeZone" Json.string;
    token = Json.required fields "token" Json.string;
  }

and yojson_of_receipt_response : receipt_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("booking", Some (yojson_of_booking value.booking));
      ("scheduleTimeZone", Some (Json.of_string value.schedule_time_zone));
      ("token", Some (Json.of_string value.token));
    ]

let make_receipt_response ~(booking : booking) ~(schedule_time_zone : string)
    ~(token : string) () =
  ({ booking; schedule_time_zone; token } : receipt_response)

(** Realtime signal that a connected inbox's calendar projection changed. *)
type nonrec refresh_calendar_event =
  | Synced of {
      link_id : string;  (** Connected inbox whose calendars changed. *)
      team_ooo_changed : bool;
          (** False only when the run excludes changes to teammate OOO projections. *)
    }
      (** A sync run committed changes for [link_id]; viewers should refetch. *)
  | Team_sharing_changed of {
      team_ooo_changed : bool;
          (** True for sharing changes and any possibly affected OOO projection. *)
    }
      (** Team projections need refreshing after a sync or entitlement change. *)
  | Join_request_answered of {
      event_id : string;  (** The shared event they asked to join. *)
    }  (** The viewer's request to join a shared event was answered. *)
  | Unknown of Yojson.Safe.t
      (** A case this SDK version does not know, as received. *)

let refresh_calendar_event_of_yojson : Yojson.Safe.t -> refresh_calendar_event =
 fun json ->
  let fields = Json.obj json in
  match Json.tag fields "event" with
  | "synced" ->
      Synced
        {
          link_id = Json.required fields "link_id" Json.string;
          team_ooo_changed = Json.required fields "team_ooo_changed" Json.bool;
        }
  | "team_sharing_changed" ->
      Team_sharing_changed
        { team_ooo_changed = Json.required fields "team_ooo_changed" Json.bool }
  | "join_request_answered" ->
      Join_request_answered
        { event_id = Json.required fields "event_id" Json.string }
  | _ -> Json.unknown "refresh_calendar_event" json (Unknown json)

and yojson_of_refresh_calendar_event : refresh_calendar_event -> Yojson.Safe.t =
 fun value ->
  match value with
  | Synced case ->
      Json.record
        [
          ("event", Some (`String "synced"));
          ("link_id", Some (Json.of_string case.link_id));
          ("team_ooo_changed", Some (Json.of_bool case.team_ooo_changed));
        ]
  | Team_sharing_changed case ->
      Json.record
        [
          ("event", Some (`String "team_sharing_changed"));
          ("team_ooo_changed", Some (Json.of_bool case.team_ooo_changed));
        ]
  | Join_request_answered case ->
      Json.record
        [
          ("event", Some (`String "join_request_answered"));
          ("event_id", Some (Json.of_string case.event_id));
        ]
  | Unknown json -> json

let make_refresh_calendar_event_synced ~(link_id : string)
    ~(team_ooo_changed : bool) () =
  (Synced { link_id; team_ooo_changed } : refresh_calendar_event)

let make_refresh_calendar_event_team_sharing_changed ~(team_ooo_changed : bool)
    () =
  (Team_sharing_changed { team_ooo_changed } : refresh_calendar_event)

let make_refresh_calendar_event_join_request_answered ~(event_id : string) () =
  (Join_request_answered { event_id } : refresh_calendar_event)

type nonrec respond_to_join_request_request = {
  decision : calendar_join_request_decision;  (** The sharer's answer. *)
}
(** Request body answering a join request. *)

let respond_to_join_request_request_of_yojson :
    Yojson.Safe.t -> respond_to_join_request_request =
 fun json ->
  let fields = Json.obj json in
  {
    decision =
      Json.required fields "decision" calendar_join_request_decision_of_yojson;
  }

and yojson_of_respond_to_join_request_request :
    respond_to_join_request_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "decision",
        Some (yojson_of_calendar_join_request_decision value.decision) );
    ]

let make_respond_to_join_request_request
    ~(decision : calendar_join_request_decision) () =
  ({ decision } : respond_to_join_request_request)

type nonrec rsvp_calendar_event_request = {
  calendar_id : string option;
      (** Calendar whose copy of the event is answered, for an event synced
from more than one calendar. Omit to answer on the canonical copy. *)
  recurrence_id : string option;
      (** Original-start key of the occurrence the response targets. *)
  responding_email : string option;
      (** The owned connected address whose attendance is changed. Validated by the domain.
Omit to answer as the inbox the addressed copy syncs through. *)
  response : attendee_response_status;
      (** The response to record for the connected account. *)
  scope : calendar_rsvp_scope_param option;
}
(** Request body setting the requester's RSVP on an event. *)

let rsvp_calendar_event_request_of_yojson :
    Yojson.Safe.t -> rsvp_calendar_event_request =
 fun json ->
  let fields = Json.obj json in
  {
    calendar_id = Json.optional fields "calendarId" Json.string;
    recurrence_id = Json.optional fields "recurrenceId" Json.string;
    responding_email = Json.optional fields "respondingEmail" Json.string;
    response =
      Json.required fields "response" attendee_response_status_of_yojson;
    scope = Json.optional fields "scope" calendar_rsvp_scope_param_of_yojson;
  }

and yojson_of_rsvp_calendar_event_request :
    rsvp_calendar_event_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ("calendarId", Option.map Json.of_string value.calendar_id);
      ("recurrenceId", Option.map Json.of_string value.recurrence_id);
      ("respondingEmail", Option.map Json.of_string value.responding_email);
      ("response", Some (yojson_of_attendee_response_status value.response));
      ("scope", Option.map yojson_of_calendar_rsvp_scope_param value.scope);
    ]

let make_rsvp_calendar_event_request ?calendar_id ?recurrence_id
    ?responding_email ~(response : attendee_response_status) ?scope () =
  ({ calendar_id; recurrence_id; responding_email; response; scope }
    : rsvp_calendar_event_request)

type nonrec slots_response = {
  slots : booking_slot list;  (** Every available slot. *)
}
(** Available start times. *)

let slots_response_of_yojson : Yojson.Safe.t -> slots_response =
 fun json ->
  let fields = Json.obj json in
  { slots = Json.required fields "slots" (Json.list booking_slot_of_yojson) }

and yojson_of_slots_response : slots_response -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("slots", Some ((Json.of_list yojson_of_booking_slot) value.slots)) ]

let make_slots_response ~(slots : booking_slot list) () =
  ({ slots } : slots_response)

(** What a user exposes through their team membership. *)
type nonrec team_calendar_sharing =
  | All
  | Busy_only
  | None_
  | Unknown of string  (** A value this SDK version does not know. *)

let team_calendar_sharing_of_yojson : Yojson.Safe.t -> team_calendar_sharing =
 fun json ->
  match Json.string json with
  | "all" -> All
  | "busy_only" -> Busy_only
  | "none" -> None_
  | other -> Json.unknown "team_calendar_sharing" json (Unknown other)

and yojson_of_team_calendar_sharing : team_calendar_sharing -> Yojson.Safe.t =
 fun value ->
  match value with
  | All -> `String "all"
  | Busy_only -> `String "busy_only"
  | None_ -> `String "none"
  | Unknown other -> `String other

type nonrec team_calendar_sharing_body = {
  sharing : team_calendar_sharing;
      (** Busy-only is the default, including when no setting has been saved. *)
}
(** Own-user sharing preference. *)

let team_calendar_sharing_body_of_yojson :
    Yojson.Safe.t -> team_calendar_sharing_body =
 fun json ->
  let fields = Json.obj json in
  { sharing = Json.required fields "sharing" team_calendar_sharing_of_yojson }

and yojson_of_team_calendar_sharing_body :
    team_calendar_sharing_body -> Yojson.Safe.t =
 fun value ->
  Json.record
    [ ("sharing", Some (yojson_of_team_calendar_sharing value.sharing)) ]

let make_team_calendar_sharing_body ~(sharing : team_calendar_sharing) () =
  ({ sharing } : team_calendar_sharing_body)

type nonrec update_calendar_event_request = {
  attendees : calendar_attendee_input_body list option;
      (** Replacement attendee list. *)
  calendar_id : string option;
      (** Calendar whose copy of the event is patched, for an event synced from
more than one calendar. Omit to patch the canonical copy. *)
  conference : conference_change option;
  description : string option;
      (** Replacement description; an empty string clears it. *)
  guest_policy : guest_policy option;
  inbox : string option;
      (** Inbox address holding the copy this request changes. An agent run
must name it when the meeting is on more than one of the requester's
inboxes, and it must be the inbox holding the addressed copy; a
mismatch is refused whoever sends it. *)
  location : string option;
      (** Replacement location; an empty string clears it. *)
  macro_call : bool option;
      (** Switch the event to a Macro call in this write: mint one, write its
join link into the description and location, and detach any provider
conference. An event already holding a Macro call keeps it. Cannot be
combined with [conference]. *)
  out_of_office : out_of_office_properties option;
  recurrence_id : string option;
      (** Original-start key of the occurrence the update targets. *)
  recurrence_lines : string list option;
      (** Replacement recurrence properties; an empty list clears them. *)
  reminders : event_reminders option;
  scope : calendar_update_scope_param option;
  time : event_time option;
  title : string option;  (** Replacement title; an empty string clears it. *)
  transparency : event_transparency option;
  visibility : event_visibility option;
}
(** Request body patching an event; omitted fields are left untouched. *)

let update_calendar_event_request_of_yojson :
    Yojson.Safe.t -> update_calendar_event_request =
 fun json ->
  let fields = Json.obj json in
  {
    attendees =
      Json.optional fields "attendees"
        (Json.list calendar_attendee_input_body_of_yojson);
    calendar_id = Json.optional fields "calendarId" Json.string;
    conference = Json.optional fields "conference" conference_change_of_yojson;
    description = Json.optional fields "description" Json.string;
    guest_policy = Json.optional fields "guestPolicy" guest_policy_of_yojson;
    inbox = Json.optional fields "inbox" Json.string;
    location = Json.optional fields "location" Json.string;
    macro_call = Json.optional fields "macroCall" Json.bool;
    out_of_office =
      Json.optional fields "outOfOffice" out_of_office_properties_of_yojson;
    recurrence_id = Json.optional fields "recurrenceId" Json.string;
    recurrence_lines =
      Json.optional fields "recurrenceLines" (Json.list Json.string);
    reminders = Json.optional fields "reminders" event_reminders_of_yojson;
    scope = Json.optional fields "scope" calendar_update_scope_param_of_yojson;
    time = Json.optional fields "time" event_time_of_yojson;
    title = Json.optional fields "title" Json.string;
    transparency =
      Json.optional fields "transparency" event_transparency_of_yojson;
    visibility = Json.optional fields "visibility" event_visibility_of_yojson;
  }

and yojson_of_update_calendar_event_request :
    update_calendar_event_request -> Yojson.Safe.t =
 fun value ->
  Json.record
    [
      ( "attendees",
        Option.map
          (Json.of_list yojson_of_calendar_attendee_input_body)
          value.attendees );
      ("calendarId", Option.map Json.of_string value.calendar_id);
      ("conference", Option.map yojson_of_conference_change value.conference);
      ("description", Option.map Json.of_string value.description);
      ("guestPolicy", Option.map yojson_of_guest_policy value.guest_policy);
      ("inbox", Option.map Json.of_string value.inbox);
      ("location", Option.map Json.of_string value.location);
      ("macroCall", Option.map Json.of_bool value.macro_call);
      ( "outOfOffice",
        Option.map yojson_of_out_of_office_properties value.out_of_office );
      ("recurrenceId", Option.map Json.of_string value.recurrence_id);
      ( "recurrenceLines",
        Option.map (Json.of_list Json.of_string) value.recurrence_lines );
      ("reminders", Option.map yojson_of_event_reminders value.reminders);
      ("scope", Option.map yojson_of_calendar_update_scope_param value.scope);
      ("time", Option.map yojson_of_event_time value.time);
      ("title", Option.map Json.of_string value.title);
      ( "transparency",
        Option.map yojson_of_event_transparency value.transparency );
      ("visibility", Option.map yojson_of_event_visibility value.visibility);
    ]

let make_update_calendar_event_request ?attendees ?calendar_id ?conference
    ?description ?guest_policy ?inbox ?location ?macro_call ?out_of_office
    ?recurrence_id ?recurrence_lines ?reminders ?scope ?time ?title
    ?transparency ?visibility () =
  ({
     attendees;
     calendar_id;
     conference;
     description;
     guest_policy;
     inbox;
     location;
     macro_call;
     out_of_office;
     recurrence_id;
     recurrence_lines;
     reminders;
     scope;
     time;
     title;
     transparency;
     visibility;
   }
    : update_calendar_event_request)

(** [GET /availability-calendars]

List calendars and their personal-availability inclusion. *)
let get_availability_calendars () =
  ({
     Request.service = "calendar";
     operation = "get_availability_calendars";
     meth = `GET;
     path = "/availability-calendars";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json availability_calendars_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( availability_calendars_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /availability-calendars/{calendar_id}]

Change which source calendars normally occupy this user's time. *)
let set_availability_calendar ~(calendar_id : string)
    ~(contributes_to_availability : bool) () =
  ({
     Request.service = "calendar";
     operation = "set_availability_calendar";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/availability-calendars/";
           Request.segment ((fun value -> value) calendar_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_availability_calendar_body
               ({ contributes_to_availability } : availability_calendar_body)));
     decode_reply = Request.unit;
     decode_error = Request.no_error;
   }
    : (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t)

(** [GET /calendars]

List the requester's visible calendars for pickers and filters. *)
let list_calendars () =
  ({
     Request.service = "calendar";
     operation = "list_calendars";
     meth = `GET;
     path = "/calendars";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json list_calendars_response_of_yojson;
     decode_error =
       Request.error_json [ 503 ] calendar_mutation_api_error_of_yojson;
   }
    : ( list_calendars_response,
        calendar_mutation_api_error )
      Macro_sdk_runtime.Request.t)

(** [POST /events]

Create a calendar event and return its synced entity. *)
let create_calendar_event ~(time : event_time) ~(title : string) ?attendees
    ?calendar_id ?conference ?description ?email_link_id ?guest_policy
    ?idempotency_key ?location ?macro_call ?out_of_office ?recurrence_lines
    ?reminders ?transparency ?visibility () =
  ({
     Request.service = "calendar";
     operation = "create_calendar_event";
     meth = `POST;
     path = "/events";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_create_calendar_event_request
               ({
                  attendees;
                  calendar_id;
                  conference;
                  description;
                  email_link_id;
                  guest_policy;
                  idempotency_key;
                  location;
                  macro_call;
                  out_of_office;
                  recurrence_lines;
                  reminders;
                  time;
                  title;
                  transparency;
                  visibility;
                }
                 : create_calendar_event_request)));
     decode_reply = Request.json calendar_event_of_yojson;
     decode_error =
       Request.error_json [ 400; 403; 409; 503 ]
         calendar_mutation_api_error_of_yojson;
   }
    : (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t)

(** [DELETE /events/{event_id}]

Delete a calendar event at its provider. *)
let delete_calendar_event ~(event_id : string) ?calendar_id ?scope
    ?recurrence_id ?inbox () =
  ({
     Request.service = "calendar";
     operation = "delete_calendar_event";
     meth = `DELETE;
     path =
       String.concat ""
         [ "/events/"; Request.segment ((fun value -> value) event_id) ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "calendarId",
             match calendar_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "scope",
             match scope with
             | None -> []
             | Some value ->
                 [
                   (fun value ->
                     Json.string (yojson_of_calendar_deletion_scope_param value))
                     value;
                 ] );
           ( "recurrenceId",
             match recurrence_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "inbox",
             match inbox with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 403; 404; 409; 503 ]
         calendar_mutation_api_error_of_yojson;
   }
    : (unit, calendar_mutation_api_error) Macro_sdk_runtime.Request.t)

(** [PATCH /events/{event_id}]

Update fields of a calendar event and return its synced entity. *)
let update_calendar_event ~(event_id : string) ?attendees ?calendar_id
    ?conference ?description ?guest_policy ?inbox ?location ?macro_call
    ?out_of_office ?recurrence_id ?recurrence_lines ?reminders ?scope ?time
    ?title ?transparency ?visibility () =
  ({
     Request.service = "calendar";
     operation = "update_calendar_event";
     meth = `PATCH;
     path =
       String.concat ""
         [ "/events/"; Request.segment ((fun value -> value) event_id) ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_update_calendar_event_request
               ({
                  attendees;
                  calendar_id;
                  conference;
                  description;
                  guest_policy;
                  inbox;
                  location;
                  macro_call;
                  out_of_office;
                  recurrence_id;
                  recurrence_lines;
                  reminders;
                  scope;
                  time;
                  title;
                  transparency;
                  visibility;
                }
                 : update_calendar_event_request)));
     decode_reply = Request.json calendar_event_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 403; 404; 409; 503 ]
         calendar_mutation_api_error_of_yojson;
   }
    : (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t)

(** [POST /events/{event_id}/copy]

Add a snapshot of an event shared with one of the requester's channels to
one of their Google calendars and return the synced snapshot. The
snapshot keeps the meeting's iCalendar UID and organizer, lists only the
requester as a guest, and carries no join link; nobody is notified.
While the requester's request to join the event is pending or accepted,
the copy is refused with [join_request_open]: the meeting reaches their
calendar as the invitation, which a copy would otherwise take in. *)
let copy_calendar_event ~(event_id : string) ?calendar_id () =
  ({
     Request.service = "calendar";
     operation = "copy_calendar_event";
     meth = `POST;
     path =
       String.concat ""
         [
           "/events/"; Request.segment ((fun value -> value) event_id); "/copy";
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

(** [POST /events/{event_id}/guests]

Add guests to a calendar event without touching anyone already invited,
and return its synced entity. The organizer, and guests the organizer lets
invite others, may call it; Google emails the new guests. *)
let invite_calendar_event_guests ~(event_id : string)
    ~(guests : calendar_guest_input_body list) ?calendar_id ?inbox
    ?recurrence_id ?scope () =
  ({
     Request.service = "calendar";
     operation = "invite_calendar_event_guests";
     meth = `POST;
     path =
       String.concat ""
         [
           "/events/";
           Request.segment ((fun value -> value) event_id);
           "/guests";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_invite_calendar_event_guests_request
               ({ calendar_id; guests; inbox; recurrence_id; scope }
                 : invite_calendar_event_guests_request)));
     decode_reply = Request.json calendar_event_of_yojson;
     decode_error =
       Request.error_json
         [ 400; 403; 404; 409; 503 ]
         calendar_mutation_api_error_of_yojson;
   }
    : (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t)

(** [GET /events/{event_id}/provider-url]

Resolve an authorized event's provider link for Outlook-only actions. *)
let calendar_event_provider_url ~(event_id : string) ?calendar_id ?recurrence_id
    () =
  ({
     Request.service = "calendar";
     operation = "calendar_event_provider_url";
     meth = `GET;
     path =
       String.concat ""
         [
           "/events/";
           Request.segment ((fun value -> value) event_id);
           "/provider-url";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "calendarId",
             match calendar_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "recurrenceId",
             match recurrence_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json calendar_event_provider_url_of_yojson;
     decode_error =
       Request.error_json [ 404 ] calendar_mutation_api_error_of_yojson;
   }
    : ( calendar_event_provider_url,
        calendar_mutation_api_error )
      Macro_sdk_runtime.Request.t)

(** [POST /events/{event_id}/replacement]

Read and persist an organizer-only preview, without sending invitations. *)
let prepare_calendar_replacement ~(event_id : string)
    ~(remove_conference : bool) ?calendar_id ?recurrence_id () =
  ({
     Request.service = "calendar";
     operation = "prepare_calendar_replacement";
     meth = `POST;
     path =
       String.concat ""
         [
           "/events/";
           Request.segment ((fun value -> value) event_id);
           "/replacement";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_prepare_calendar_replacement_request
               ({ calendar_id; recurrence_id; remove_conference }
                 : prepare_calendar_replacement_request)));
     decode_reply = Request.json calendar_replacement_view_of_yojson;
     decode_error =
       Request.error_json [ 409 ] calendar_mutation_api_error_of_yojson;
   }
    : ( calendar_replacement_view,
        calendar_mutation_api_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /events/{event_id}/rsvp]

Set the requester's RSVP on a calendar event and return its synced entity. *)
let rsvp_calendar_event ~(event_id : string)
    ~(response : attendee_response_status) ?calendar_id ?recurrence_id
    ?responding_email ?scope () =
  ({
     Request.service = "calendar";
     operation = "rsvp_calendar_event";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/events/"; Request.segment ((fun value -> value) event_id); "/rsvp";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_rsvp_calendar_event_request
               ({
                  calendar_id;
                  recurrence_id;
                  responding_email;
                  response;
                  scope;
                }
                 : rsvp_calendar_event_request)));
     decode_reply = Request.json calendar_event_of_yojson;
     decode_error =
       Request.error_json [ 403; 404; 409; 503 ]
         calendar_mutation_api_error_of_yojson;
   }
    : (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t)

(** [GET /health]

Health check *)
let health_handler () =
  ({
     Request.service = "calendar";
     operation = "health_handler";
     meth = `GET;
     path = "/health";
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

(** [PUT /join-requests/{request_id}]

Answer a request to join an event the requester can change and return
where it now stands. Accepting adds the guest through the invite path; an
already answered request is returned unchanged. *)
let respond_to_join_request ~(request_id : string)
    ~(decision : calendar_join_request_decision) () =
  ({
     Request.service = "calendar";
     operation = "respond_to_join_request";
     meth = `PUT;
     path =
       String.concat ""
         [
           "/join-requests/"; Request.segment ((fun value -> value) request_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_respond_to_join_request_request
               ({ decision } : respond_to_join_request_request)));
     decode_reply = Request.json calendar_join_request_of_yojson;
     decode_error =
       Request.error_json [ 403; 404; 409; 503 ]
         calendar_mutation_api_error_of_yojson;
   }
    : ( calendar_join_request,
        calendar_mutation_api_error )
      Macro_sdk_runtime.Request.t)

(** [GET /replacements/{operation_id}]

Read saved progress without performing a provider mutation. *)
let calendar_replacement_status ~(operation_id : string) () =
  ({
     Request.service = "calendar";
     operation = "calendar_replacement_status";
     meth = `GET;
     path =
       String.concat ""
         [
           "/replacements/"; Request.segment ((fun value -> value) operation_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json calendar_replacement_view_of_yojson;
     decode_error =
       Request.error_json [ 404 ] calendar_mutation_api_error_of_yojson;
   }
    : ( calendar_replacement_view,
        calendar_mutation_api_error )
      Macro_sdk_runtime.Request.t)

(** [DELETE /replacements/{operation_id}]

Discard a preview only if no confirmation has been recorded. *)
let discard_calendar_replacement ~(operation_id : string) () =
  ({
     Request.service = "calendar";
     operation = "discard_calendar_replacement";
     meth = `DELETE;
     path =
       String.concat ""
         [
           "/replacements/"; Request.segment ((fun value -> value) operation_id);
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.unit;
     decode_error =
       Request.error_json [ 409 ] calendar_mutation_api_error_of_yojson;
   }
    : (unit, calendar_mutation_api_error) Macro_sdk_runtime.Request.t)

(** [POST /replacements/{operation_id}/confirm]

Explicitly confirm the saved preview, or resume the same confirmed operation. *)
let confirm_calendar_replacement ~(operation_id : string) () =
  ({
     Request.service = "calendar";
     operation = "confirm_calendar_replacement";
     meth = `POST;
     path =
       String.concat ""
         [
           "/replacements/";
           Request.segment ((fun value -> value) operation_id);
           "/confirm";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json calendar_replacement_view_of_yojson;
     decode_error =
       Request.error_json [ 409 ] calendar_mutation_api_error_of_yojson;
   }
    : ( calendar_replacement_view,
        calendar_mutation_api_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduling/bookings]

List the profile's bookings, optionally those starting in a half-open range. *)
let list_bookings ?team_id ?from ?to_ () =
  ({
     Request.service = "calendar";
     operation = "list_bookings";
     meth = `GET;
     path = "/scheduling/bookings";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "teamId",
             match team_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "from",
             match from with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "to",
             match to_ with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json bookings_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( bookings_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduling/bookings/{id}/change]

Approve, cancel, record attendance for, or reschedule one booking. *)
let change_booking ~(id : string) ~(body : booking_change) () =
  ({
     Request.service = "calendar";
     operation = "change_booking";
     meth = `POST;
     path =
       String.concat ""
         [
           "/scheduling/bookings/";
           Request.segment ((fun value -> value) id);
           "/change";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = Some (Request.Json (yojson_of_booking_change body));
     decode_reply = Request.json booking_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( booking_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduling/bookings/{id}/manage]

Read one booking as its personal owner, a host, or a team administrator. *)
let get_managed_booking ~(id : string) () =
  ({
     Request.service = "calendar";
     operation = "get_managed_booking";
     meth = `GET;
     path =
       String.concat ""
         [
           "/scheduling/bookings/";
           Request.segment ((fun value -> value) id);
           "/manage";
         ];
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json receipt_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( receipt_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduling/bookings/{id}/slots]

Replacement start times for one booking on a schedule-local date. *)
let list_booking_reschedule_slots ~(id : string) ~(date : string) () =
  ({
     Request.service = "calendar";
     operation = "list_booking_reschedule_slots";
     meth = `GET;
     path =
       String.concat ""
         [
           "/scheduling/bookings/";
           Request.segment ((fun value -> value) id);
           "/slots";
         ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [ ("date", [ (fun value -> value) date ]) ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json slots_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( slots_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduling/insights]

Booking statistics for a local date range and the equally long period before it. *)
let get_booking_insights ~(from : string) ~(time_zone : string) ~(to_ : string)
    ?team_id ?event_type_id ?host_id () =
  ({
     Request.service = "calendar";
     operation = "get_booking_insights";
     meth = `POST;
     path = "/scheduling/insights";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "teamId",
             match team_id with
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
            (yojson_of_insight_query
               ({ event_type_id; from; host_id; time_zone; to_ }
                 : insight_query)));
     decode_reply = Request.json booking_insights_of_yojson;
     decode_error = Request.no_error;
   }
    : ( booking_insights,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduling/links]

List and search booking links with their full drafts and reusable schedules. *)
let list_booking_links ?team_id ?query () =
  ({
     Request.service = "calendar";
     operation = "list_booking_links";
     meth = `GET;
     path = "/scheduling/links";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "teamId",
             match team_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
           ( "query",
             match query with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json booking_link_listing_of_yojson;
     decode_error = Request.no_error;
   }
    : ( booking_link_listing,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [POST /scheduling/links]

Create a booking link; an identical replay at the same slug returns the saved link. *)
let create_booking_link ~(draft : booking_link_draft)
    ~(user_confirmation : string) ?team_id () =
  ({
     Request.service = "calendar";
     operation = "create_booking_link";
     meth = `POST;
     path = "/scheduling/links";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "teamId",
             match team_id with
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
            (yojson_of_create_booking_link_request
               ({ draft; user_confirmation } : create_booking_link_request)));
     decode_reply = Request.json booking_link_of_yojson;
     decode_error = Request.no_error;
   }
    : ( booking_link,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /scheduling/links/{id}]

Replace one booking link's configuration at the profile revision it was read with. *)
let edit_booking_link ~(id : string) ~(draft : booking_link_draft)
    ~(expected_revision : int64) ~(user_confirmation : string) ?team_id () =
  ({
     Request.service = "calendar";
     operation = "edit_booking_link";
     meth = `PUT;
     path =
       String.concat ""
         [ "/scheduling/links/"; Request.segment ((fun value -> value) id) ];
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "teamId",
             match team_id with
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
            (yojson_of_edit_booking_link_request
               ({ draft; expected_revision; user_confirmation }
                 : edit_booking_link_request)));
     decode_reply = Request.json booking_link_of_yojson;
     decode_error = Request.no_error;
   }
    : ( booking_link,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /scheduling/settings]

Read personal or team booking settings without creating them. *)
let get_booking_settings ?team_id () =
  ({
     Request.service = "calendar";
     operation = "get_booking_settings";
     meth = `GET;
     path = "/scheduling/settings";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "teamId",
             match team_id with
             | None -> []
             | Some value -> [ (fun value -> value) value ] );
         ];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json profile_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( profile_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /scheduling/settings]

Save booking settings at the revision they were read with. *)
let save_booking_settings ~(description : string)
    ~(event_types : booking_event_type list) ~(id : string) ~(name : string)
    ~(revision : int64) ~(schedules : booking_schedule list) ?team_id
    ?default_schedule_id () =
  ({
     Request.service = "calendar";
     operation = "save_booking_settings";
     meth = `PUT;
     path = "/scheduling/settings";
     query =
       List.filter
         (fun (_, values) -> values <> [])
         [
           ( "teamId",
             match team_id with
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
            (yojson_of_booking_profile
               ({
                  default_schedule_id;
                  description;
                  event_types;
                  id;
                  name;
                  revision;
                  schedules;
                }
                 : booking_profile)));
     decode_reply = Request.json profile_response_of_yojson;
     decode_error = Request.no_error;
   }
    : ( profile_response,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [GET /team-sharing]

Read the authenticated user's sharing choice. *)
let get_team_sharing () =
  ({
     Request.service = "calendar";
     operation = "get_team_sharing";
     meth = `GET;
     path = "/team-sharing";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body = None;
     decode_reply = Request.json team_calendar_sharing_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( team_calendar_sharing_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)

(** [PUT /team-sharing]

Set the authenticated user's sharing choice. *)
let set_team_sharing ~(sharing : team_calendar_sharing) () =
  ({
     Request.service = "calendar";
     operation = "set_team_sharing";
     meth = `PUT;
     path = "/team-sharing";
     query = List.filter (fun (_, values) -> values <> []) [];
     headers =
       List.concat_map
         (fun (name, values) -> List.map (fun v -> (name, v)) values)
         [];
     body =
       Some
         (Request.Json
            (yojson_of_team_calendar_sharing_body
               ({ sharing } : team_calendar_sharing_body)));
     decode_reply = Request.json team_calendar_sharing_body_of_yojson;
     decode_error = Request.no_error;
   }
    : ( team_calendar_sharing_body,
        Macro_sdk_runtime.Request.no_error )
      Macro_sdk_runtime.Request.t)
