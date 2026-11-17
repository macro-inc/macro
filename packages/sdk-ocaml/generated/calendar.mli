(* Generated from packages/sdk/specs/calendar.json by packages/sdk-ocaml/gen. Do not edit. *)

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

type nonrec availability_calendar = {
  calendar_id : string;  (** Visible source calendar. *)
  contributes_to_availability : bool;
      (** Whether its events normally block the user's time. *)
  is_primary : bool;
      (** Whether this is the connected account's primary calendar. *)
  name : string;  (** Source name. *)
}
(** Per-user inclusion of a source calendar in personal availability. *)

val availability_calendar_of_yojson : Yojson.Safe.t -> availability_calendar
val yojson_of_availability_calendar : availability_calendar -> Yojson.Safe.t

val make_availability_calendar :
  calendar_id:string ->
  contributes_to_availability:bool ->
  is_primary:bool ->
  name:string ->
  unit ->
  availability_calendar
(** Per-user inclusion of a source calendar in personal availability. *)

type nonrec availability_calendar_body = {
  contributes_to_availability : bool;
      (** Whether this calendar contributes to personal availability. *)
}
(** Own-user source inclusion preference. *)

val availability_calendar_body_of_yojson :
  Yojson.Safe.t -> availability_calendar_body

val yojson_of_availability_calendar_body :
  availability_calendar_body -> Yojson.Safe.t

val make_availability_calendar_body :
  contributes_to_availability:bool -> unit -> availability_calendar_body
(** Own-user source inclusion preference. *)

type nonrec availability_calendars_response = {
  calendars : availability_calendar list;
      (** Directly visible source calendars. *)
}
(** Source calendar settings returned to their viewer. *)

val availability_calendars_response_of_yojson :
  Yojson.Safe.t -> availability_calendars_response

val yojson_of_availability_calendars_response :
  availability_calendars_response -> Yojson.Safe.t

val make_availability_calendars_response :
  calendars:availability_calendar list ->
  unit ->
  availability_calendars_response
(** Source calendar settings returned to their viewer. *)

(** Attendance recorded by an assigned host or profile administrator after a meeting. *)
type nonrec booking_attendance =
  | Unknown_
  | Attended
  | Guest_no_show
  | Host_no_show
  | Unknown of string  (** A value this SDK version does not know. *)

val booking_attendance_of_yojson : Yojson.Safe.t -> booking_attendance
val yojson_of_booking_attendance : booking_attendance -> Yojson.Safe.t

(** Booking lifecycle state. *)
type nonrec booking_status =
  | Pending
  | Confirmed
  | Cancelled
  | Processing
  | Failed
  | Unknown of string  (** A value this SDK version does not know. *)

val booking_status_of_yojson : Yojson.Safe.t -> booking_status
val yojson_of_booking_status : booking_status -> Yojson.Safe.t

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

val booking_of_yojson : Yojson.Safe.t -> booking
val yojson_of_booking : booking -> Yojson.Safe.t

val make_booking :
  answers:(string * string) list ->
  ?attendance:booking_attendance ->
  email:string ->
  ends_at:string ->
  event_type_id:string ->
  hosts:string list ->
  id:string ->
  location:string ->
  name:string ->
  ?question_labels:(string * string) list ->
  ?reschedule_count:int ->
  ?rescheduled_at:string ->
  starts_at:string ->
  status:booking_status ->
  time_zone:string ->
  title:string ->
  unit ->
  booking
(** Public booking details, also visible to authorized profile members. *)

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

val booking_change_of_yojson : Yojson.Safe.t -> booking_change
val yojson_of_booking_change : booking_change -> Yojson.Safe.t

val make_booking_change_attendance :
  attendance:booking_attendance -> unit -> booking_change
(** Record or clear attendance after the meeting ends. *)

val make_booking_change_reschedule : starts_at:string -> unit -> booking_change
(** Move the existing meeting to an available time; notify attendees. *)

type nonrec booking_time_window = {
  end_ : string;  (** Exclusive HH:MM end. *)
  start : string;  (** Inclusive HH:MM start. *)
}
(** A wall-clock window in an availability schedule. *)

val booking_time_window_of_yojson : Yojson.Safe.t -> booking_time_window
val yojson_of_booking_time_window : booking_time_window -> Yojson.Safe.t

val make_booking_time_window :
  end_:string -> start:string -> unit -> booking_time_window
(** A wall-clock window in an availability schedule. *)

type nonrec booking_date_override = {
  date : string;  (** Local date in the schedule zone. *)
  windows : booking_time_window list;  (** Empty means unavailable all day. *)
}
(** Replacement availability for one date. *)

val booking_date_override_of_yojson : Yojson.Safe.t -> booking_date_override
val yojson_of_booking_date_override : booking_date_override -> Yojson.Safe.t

val make_booking_date_override :
  date:string ->
  windows:booking_time_window list ->
  unit ->
  booking_date_override
(** Replacement availability for one date. *)

(** Team host assignment policy. *)
type nonrec scheduling_mode =
  | Individual
  | Collective
  | Round_robin
  | Unknown of string  (** A value this SDK version does not know. *)

val scheduling_mode_of_yojson : Yojson.Safe.t -> scheduling_mode
val yojson_of_scheduling_mode : scheduling_mode -> Yojson.Safe.t

type nonrec booking_question = {
  id : string;  (** Stable identity. *)
  label : string;  (** Public question label. *)
  required : bool;  (** Whether an answer is mandatory. *)
}
(** A question on the booking form. *)

val booking_question_of_yojson : Yojson.Safe.t -> booking_question
val yojson_of_booking_question : booking_question -> Yojson.Safe.t

val make_booking_question :
  id:string -> label:string -> required:bool -> unit -> booking_question
(** A question on the booking form. *)

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

val booking_event_type_of_yojson : Yojson.Safe.t -> booking_event_type
val yojson_of_booking_event_type : booking_event_type -> Yojson.Safe.t

val make_booking_event_type :
  after_minutes:int ->
  before_minutes:int ->
  ?daily_limit:int ->
  description:string ->
  duration_minutes:int ->
  enabled:bool ->
  google_meet:bool ->
  horizon_days:int ->
  hosts:string list ->
  id:string ->
  interval_minutes:int ->
  location:string ->
  ?macro_call:bool ->
  mode:scheduling_mode ->
  notice_minutes:int ->
  questions:booking_question list ->
  requires_confirmation:bool ->
  schedule_id:string ->
  slug:string ->
  title:string ->
  unit ->
  booking_event_type
(** A reusable booking link. *)

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

val insight_counts_of_yojson : Yojson.Safe.t -> insight_counts
val yojson_of_insight_counts : insight_counts -> Yojson.Safe.t

val make_insight_counts :
  cancelled:int ->
  completed:int ->
  guest_no_show:int ->
  host_no_show:int ->
  rescheduled:int ->
  total:int ->
  unit ->
  insight_counts
(** Counts can overlap: a rescheduled event can also be completed or cancelled. *)

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

val insight_period_of_yojson : Yojson.Safe.t -> insight_period
val yojson_of_insight_period : insight_period -> Yojson.Safe.t

val make_insight_period :
  average_minutes:float ->
  counts:insight_counts ->
  days:(string * insight_counts) list ->
  event_counts:(string * int) list ->
  host_counts:(string * int) list ->
  hours:int list ->
  meeting_minutes:float ->
  unit ->
  insight_period
(** One complete period of metrics and chart data, with no guest contact information. *)

type nonrec booking_insights = {
  as_of : string;  (** Time at which completion was evaluated. *)
  current : insight_period;  (** Requested period. *)
  previous : insight_period;
      (** Comparison period, using identical filters and definitions. *)
  previous_from : string;  (** Preceding period's first local date. *)
  previous_to : string;  (** Preceding period's last local date. *)
}
(** Current and equally long preceding local-calendar periods. *)

val booking_insights_of_yojson : Yojson.Safe.t -> booking_insights
val yojson_of_booking_insights : booking_insights -> Yojson.Safe.t

val make_booking_insights :
  as_of:string ->
  current:insight_period ->
  previous:insight_period ->
  previous_from:string ->
  previous_to:string ->
  unit ->
  booking_insights
(** Current and equally long preceding local-calendar periods. *)

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

val booking_link_event_of_yojson : Yojson.Safe.t -> booking_link_event
val yojson_of_booking_link_event : booking_link_event -> Yojson.Safe.t

val make_booking_link_event :
  after_minutes:int ->
  before_minutes:int ->
  ?daily_limit:int ->
  description:string ->
  duration_minutes:int ->
  enabled:bool ->
  google_meet:bool ->
  horizon_days:int ->
  hosts:string list ->
  interval_minutes:int ->
  location:string ->
  ?macro_call:bool ->
  mode:scheduling_mode ->
  notice_minutes:int ->
  questions:booking_question list ->
  requires_confirmation:bool ->
  slug:string ->
  title:string ->
  unit ->
  booking_link_event
(** All editable rules for one link. Personal links must use the authenticated user as host. *)

type nonrec booking_weekly_day = {
  day : int;  (** Sunday is zero. *)
  windows : booking_time_window list;  (** Non-overlapping local windows. *)
}
(** Availability for one weekday. *)

val booking_weekly_day_of_yojson : Yojson.Safe.t -> booking_weekly_day
val yojson_of_booking_weekly_day : booking_weekly_day -> Yojson.Safe.t

val make_booking_weekly_day :
  day:int -> windows:booking_time_window list -> unit -> booking_weekly_day
(** Availability for one weekday. *)

type nonrec booking_link_schedule = {
  name : string;  (** Display name. *)
  overrides : booking_date_override list;  (** Date-specific replacements. *)
  time_zone : string;  (** IANA time zone. *)
  weekly : booking_weekly_day list;  (** Weekly windows. *)
}
(** Availability copied into a dedicated schedule when it changes; other links retain their hours. *)

val booking_link_schedule_of_yojson : Yojson.Safe.t -> booking_link_schedule
val yojson_of_booking_link_schedule : booking_link_schedule -> Yojson.Safe.t

val make_booking_link_schedule :
  name:string ->
  overrides:booking_date_override list ->
  time_zone:string ->
  weekly:booking_weekly_day list ->
  unit ->
  booking_link_schedule
(** Availability copied into a dedicated schedule when it changes; other links retain their hours. *)

type nonrec booking_link_draft = {
  event : booking_link_event;
      (** Public details, hosts, booking rules and questions. *)
  schedule : booking_link_schedule;
      (** Weekly hours, IANA time zone, and date overrides for this link. *)
}
(** Complete proposal reviewed and validated before saving. *)

val booking_link_draft_of_yojson : Yojson.Safe.t -> booking_link_draft
val yojson_of_booking_link_draft : booking_link_draft -> Yojson.Safe.t

val make_booking_link_draft :
  event:booking_link_event ->
  schedule:booking_link_schedule ->
  unit ->
  booking_link_draft
(** Complete proposal reviewed and validated before saving. *)

type nonrec booking_link = {
  draft : booking_link_draft;  (** Full editable configuration. *)
  event_type_id : string;  (** Stable link identity. *)
  profile_id : string;  (** Owning profile. *)
  revision : int64;  (** Profile revision to supply when editing. *)
}
(** Saved link with actual identities and revision for subsequent edits. *)

val booking_link_of_yojson : Yojson.Safe.t -> booking_link
val yojson_of_booking_link : booking_link -> Yojson.Safe.t

val make_booking_link :
  draft:booking_link_draft ->
  event_type_id:string ->
  profile_id:string ->
  revision:int64 ->
  unit ->
  booking_link
(** Saved link with actual identities and revision for subsequent edits. *)

type nonrec booking_schedule = {
  id : string;  (** Stable schedule identity. *)
  name : string;  (** Display name. *)
  overrides : booking_date_override list;  (** Date-specific replacements. *)
  time_zone : string;  (** IANA time zone. *)
  weekly : booking_weekly_day list;  (** Weekly windows. *)
}
(** Reusable hours, with DST interpreted in an IANA zone. *)

val booking_schedule_of_yojson : Yojson.Safe.t -> booking_schedule
val yojson_of_booking_schedule : booking_schedule -> Yojson.Safe.t

val make_booking_schedule :
  id:string ->
  name:string ->
  overrides:booking_date_override list ->
  time_zone:string ->
  weekly:booking_weekly_day list ->
  unit ->
  booking_schedule
(** Reusable hours, with DST interpreted in an IANA zone. *)

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

val booking_link_listing_of_yojson : Yojson.Safe.t -> booking_link_listing
val yojson_of_booking_link_listing : booking_link_listing -> Yojson.Safe.t

val make_booking_link_listing :
  links:booking_link list ->
  profile_id:string ->
  revision:int64 ->
  schedules:booking_schedule list ->
  team_ids:string list ->
  user_id:string ->
  unit ->
  booking_link_listing
(** Authorized discovery results including reusable availability. *)

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

val booking_profile_of_yojson : Yojson.Safe.t -> booking_profile
val yojson_of_booking_profile : booking_profile -> Yojson.Safe.t

val make_booking_profile :
  ?default_schedule_id:string ->
  description:string ->
  event_types:booking_event_type list ->
  id:string ->
  name:string ->
  revision:int64 ->
  schedules:booking_schedule list ->
  unit ->
  booking_profile
(** Editable configuration for a person or team. *)

type nonrec booking_response = { booking : booking  (** The saved booking. *) }
(** One booking after a change. *)

val booking_response_of_yojson : Yojson.Safe.t -> booking_response
val yojson_of_booking_response : booking_response -> Yojson.Safe.t

val make_booking_response : booking:booking -> unit -> booking_response
(** One booking after a change. *)

type nonrec booking_slot = {
  ends_at : string;  (** Absolute end. *)
  starts_at : string;  (** Absolute start. *)
}
(** Available slot and the hosts who can satisfy it. *)

val booking_slot_of_yojson : Yojson.Safe.t -> booking_slot
val yojson_of_booking_slot : booking_slot -> Yojson.Safe.t

val make_booking_slot :
  ends_at:string -> starts_at:string -> unit -> booking_slot
(** Available slot and the hosts who can satisfy it. *)

type nonrec bookings_response = {
  bookings : booking list;  (** Every matching booking. *)
}
(** Bookings of one profile. *)

val bookings_response_of_yojson : Yojson.Safe.t -> bookings_response
val yojson_of_bookings_response : bookings_response -> Yojson.Safe.t

val make_bookings_response : bookings:booking list -> unit -> bookings_response
(** Bookings of one profile. *)

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

type nonrec calendar_attendee_input_body = {
  email : string;  (** Attendee email address. *)
  is_optional : bool option;  (** Whether attendance is optional. *)
}
(** An attendee supplied to a calendar mutation. *)

val calendar_attendee_input_body_of_yojson :
  Yojson.Safe.t -> calendar_attendee_input_body

val yojson_of_calendar_attendee_input_body :
  calendar_attendee_input_body -> Yojson.Safe.t

val make_calendar_attendee_input_body :
  email:string -> ?is_optional:bool -> unit -> calendar_attendee_input_body
(** An attendee supplied to a calendar mutation. *)

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

val calendar_capabilities_of_yojson : Yojson.Safe.t -> calendar_capabilities
val yojson_of_calendar_capabilities : calendar_capabilities -> Yojson.Safe.t

val make_calendar_capabilities :
  auto_decline:bool ->
  ?conference_provider:conference_provider ->
  custom_recurrence:bool ->
  email_reminders:bool ->
  guest_policy:bool ->
  remove_conference:bool ->
  reset_rsvp:bool ->
  unit ->
  calendar_capabilities
(** Actual provider capabilities used by calendar editors. *)

(** How much of a recurring series a deletion removes. *)
type nonrec calendar_deletion_scope_param =
  | All
  | This_event
  | This_and_following
  | Unknown of string  (** A value this SDK version does not know. *)

val calendar_deletion_scope_param_of_yojson :
  Yojson.Safe.t -> calendar_deletion_scope_param

val yojson_of_calendar_deletion_scope_param :
  calendar_deletion_scope_param -> Yojson.Safe.t

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

type nonrec calendar_event_provider_url = {
  url : string option;
      (** None when the event no longer exists at its provider. *)
}
(** Provider-validated external event link. *)

val calendar_event_provider_url_of_yojson :
  Yojson.Safe.t -> calendar_event_provider_url

val yojson_of_calendar_event_provider_url :
  calendar_event_provider_url -> Yojson.Safe.t

val make_calendar_event_provider_url :
  ?url:string -> unit -> calendar_event_provider_url
(** Provider-validated external event link. *)

type nonrec calendar_guest_input_body = {
  email : string;  (** Guest email address. *)
  optional : bool option;  (** Whether attendance is optional. *)
}
(** A guest added to an event. *)

val calendar_guest_input_body_of_yojson :
  Yojson.Safe.t -> calendar_guest_input_body

val yojson_of_calendar_guest_input_body :
  calendar_guest_input_body -> Yojson.Safe.t

val make_calendar_guest_input_body :
  email:string -> ?optional:bool -> unit -> calendar_guest_input_body
(** A guest added to an event. *)

(** Lifecycle of a request to be added as a guest of a shared event. *)
type nonrec calendar_join_request_status =
  | Pending
  | Accepted
  | Declined
  | Unknown of string  (** A value this SDK version does not know. *)

val calendar_join_request_status_of_yojson :
  Yojson.Safe.t -> calendar_join_request_status

val yojson_of_calendar_join_request_status :
  calendar_join_request_status -> Yojson.Safe.t

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

val calendar_join_request_of_yojson : Yojson.Safe.t -> calendar_join_request
val yojson_of_calendar_join_request : calendar_join_request -> Yojson.Safe.t

val make_calendar_join_request :
  created_at:string ->
  event_id:string ->
  id:string ->
  requester_email:string ->
  requester_id:string ->
  status:calendar_join_request_status ->
  unit ->
  calendar_join_request
(** A channel member's request to be added as a guest of an event they see
only through a channel share. *)

(** How a sharer answers a request to join their event. *)
type nonrec calendar_join_request_decision =
  | Accept
  | Decline
  | Unknown of string  (** A value this SDK version does not know. *)

val calendar_join_request_decision_of_yojson :
  Yojson.Safe.t -> calendar_join_request_decision

val yojson_of_calendar_join_request_decision :
  calendar_join_request_decision -> Yojson.Safe.t

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

(** Provider selected from the persisted calendar account and email binding. *)
type nonrec calendar_provider =
  | Google
  | Outlook
  | Unknown of string  (** A value this SDK version does not know. *)

val calendar_provider_of_yojson : Yojson.Safe.t -> calendar_provider
val yojson_of_calendar_provider : calendar_provider -> Yojson.Safe.t

(** User-visible workflow state. *)
type nonrec replacement_status =
  | Needs_confirmation
  | In_progress
  | Complete
  | Unknown of string  (** A value this SDK version does not know. *)

val replacement_status_of_yojson : Yojson.Safe.t -> replacement_status
val yojson_of_replacement_status : replacement_status -> Yojson.Safe.t

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

val calendar_replacement_view_of_yojson :
  Yojson.Safe.t -> calendar_replacement_view

val yojson_of_calendar_replacement_view :
  calendar_replacement_view -> Yojson.Safe.t

val make_calendar_replacement_view :
  attendee_count:int ->
  completed_steps:int ->
  ?event:calendar_event ->
  is_series:bool ->
  operation_id:string ->
  ?provider_url:string ->
  remove_conference:bool ->
  ?replacement_url:string ->
  status:replacement_status ->
  time:event_time ->
  title:string ->
  total_steps:int ->
  unit ->
  calendar_replacement_view
(** Safe preview and recovery response; never exposes the opaque provider snapshot. *)

(** How much of a recurring series an RSVP applies to.

Unlike deletion there is no this-and-following variant: the provider
cannot express a forward-scoped response, so offering one would be a
promise sync could not keep. *)
type nonrec calendar_rsvp_scope_param =
  | All
  | This_event
  | Unknown of string  (** A value this SDK version does not know. *)

val calendar_rsvp_scope_param_of_yojson :
  Yojson.Safe.t -> calendar_rsvp_scope_param

val yojson_of_calendar_rsvp_scope_param :
  calendar_rsvp_scope_param -> Yojson.Safe.t

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

val calendar_update_scope_param_of_yojson :
  Yojson.Safe.t -> calendar_update_scope_param

val yojson_of_calendar_update_scope_param :
  calendar_update_scope_param -> Yojson.Safe.t

(** A requested change to an event's conferencing. Omitting the field leaves
the existing conference untouched; only these values change it. *)
type nonrec conference_change =
  | Provider_default
  | Microsoft_teams
  | Google_meet
  | None_
  | Unknown of string  (** A value this SDK version does not know. *)

val conference_change_of_yojson : Yojson.Safe.t -> conference_change
val yojson_of_conference_change : conference_change -> Yojson.Safe.t

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

type nonrec create_booking_link_request = {
  draft : booking_link_draft;
      (** Full booking rules and availability the user approved. *)
  user_confirmation : string;
      (** The user's reply approving this proposal, quoted verbatim. *)
}
(** A new booking link, saved after the user approved it. *)

val create_booking_link_request_of_yojson :
  Yojson.Safe.t -> create_booking_link_request

val yojson_of_create_booking_link_request :
  create_booking_link_request -> Yojson.Safe.t

val make_create_booking_link_request :
  draft:booking_link_draft ->
  user_confirmation:string ->
  unit ->
  create_booking_link_request
(** A new booking link, saved after the user approved it. *)

(** How an out-of-office event responds to conflicting invitations, mirroring
Google's [autoDeclineMode]. *)
type nonrec out_of_office_auto_decline_mode =
  | Decline_none
  | Decline_all_conflicting_invitations
  | Decline_only_new_conflicting_invitations
  | Unknown of string  (** A value this SDK version does not know. *)

val out_of_office_auto_decline_mode_of_yojson :
  Yojson.Safe.t -> out_of_office_auto_decline_mode

val yojson_of_out_of_office_auto_decline_mode :
  out_of_office_auto_decline_mode -> Yojson.Safe.t

type nonrec out_of_office_properties = {
  auto_decline_mode : out_of_office_auto_decline_mode option;
      (** How conflicting invitations are handled while the user is out. *)
  decline_message : string option;
      (** Message returned to organizers whose invitations are auto-declined. *)
}
(** The extra properties Google requires on an out-of-office event, mirroring
its [outOfOfficeProperties] block. Their presence on a draft or patch is
what marks the mutation as out-of-office. *)

val out_of_office_properties_of_yojson :
  Yojson.Safe.t -> out_of_office_properties

val yojson_of_out_of_office_properties :
  out_of_office_properties -> Yojson.Safe.t

val make_out_of_office_properties :
  ?auto_decline_mode:out_of_office_auto_decline_mode ->
  ?decline_message:string ->
  unit ->
  out_of_office_properties
(** The extra properties Google requires on an out-of-office event, mirroring
its [outOfOfficeProperties] block. Their presence on a draft or patch is
what marks the mutation as out-of-office. *)

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

val create_calendar_event_request_of_yojson :
  Yojson.Safe.t -> create_calendar_event_request

val yojson_of_create_calendar_event_request :
  create_calendar_event_request -> Yojson.Safe.t

val make_create_calendar_event_request :
  ?attendees:calendar_attendee_input_body list ->
  ?calendar_id:string ->
  ?conference:conference_change ->
  ?description:string ->
  ?email_link_id:string ->
  ?guest_policy:guest_policy ->
  ?idempotency_key:string ->
  ?location:string ->
  ?macro_call:bool ->
  ?out_of_office:out_of_office_properties ->
  ?recurrence_lines:string list ->
  ?reminders:event_reminders ->
  time:event_time ->
  title:string ->
  ?transparency:event_transparency ->
  ?visibility:event_visibility ->
  unit ->
  create_calendar_event_request
(** Request body creating a calendar event on the requester's calendar. *)

type nonrec edit_booking_link_request = {
  draft : booking_link_draft;
      (** Full edited booking rules and availability the user approved. *)
  expected_revision : int64;
      (** Profile revision the edit was prepared from; a newer revision conflicts. *)
  user_confirmation : string;
      (** The user's reply approving this proposal, quoted verbatim. *)
}
(** Replacement configuration for one booking link, saved after the user approved it. *)

val edit_booking_link_request_of_yojson :
  Yojson.Safe.t -> edit_booking_link_request

val yojson_of_edit_booking_link_request :
  edit_booking_link_request -> Yojson.Safe.t

val make_edit_booking_link_request :
  draft:booking_link_draft ->
  expected_revision:int64 ->
  user_confirmation:string ->
  unit ->
  edit_booking_link_request
(** Replacement configuration for one booking link, saved after the user approved it. *)

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

val insight_query_of_yojson : Yojson.Safe.t -> insight_query
val yojson_of_insight_query : insight_query -> Yojson.Safe.t

val make_insight_query :
  ?event_type_id:string ->
  from:string ->
  ?host_id:string ->
  time_zone:string ->
  to_:string ->
  unit ->
  insight_query
(** Inclusive local dates and optional booking/host filters. *)

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

val invite_calendar_event_guests_request_of_yojson :
  Yojson.Safe.t -> invite_calendar_event_guests_request

val yojson_of_invite_calendar_event_guests_request :
  invite_calendar_event_guests_request -> Yojson.Safe.t

val make_invite_calendar_event_guests_request :
  ?calendar_id:string ->
  guests:calendar_guest_input_body list ->
  ?inbox:string ->
  ?recurrence_id:string ->
  ?scope:calendar_update_scope_param ->
  unit ->
  invite_calendar_event_guests_request
(** Request body adding guests to an event without touching anyone already
invited. *)

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

val visible_calendar_of_yojson : Yojson.Safe.t -> visible_calendar
val yojson_of_visible_calendar : visible_calendar -> Yojson.Safe.t

val make_visible_calendar :
  capabilities:calendar_capabilities ->
  ?color:string ->
  ?contributes_to_availability:bool ->
  default_reminders:event_reminder_override list ->
  email_address:string ->
  email_link_id:string ->
  id:string ->
  is_primary:bool ->
  is_subscription:bool ->
  is_writable:bool ->
  name:string ->
  provider:calendar_provider ->
  ?sync_error:string ->
  unit ->
  visible_calendar
(** A calendar visible to a requester, listed for pickers and filters. *)

type nonrec list_calendars_response = {
  calendars : visible_calendar list;
      (** Primaries and writable calendars first. *)
}
(** Calendars visible to the requester across connected and delegated inboxes. *)

val list_calendars_response_of_yojson : Yojson.Safe.t -> list_calendars_response
val yojson_of_list_calendars_response : list_calendars_response -> Yojson.Safe.t

val make_list_calendars_response :
  calendars:visible_calendar list -> unit -> list_calendars_response
(** Calendars visible to the requester across connected and delegated inboxes. *)

type nonrec prepare_calendar_replacement_request = {
  calendar_id : string option;
      (** Exact calendar copy; defaults to canonical. *)
  recurrence_id : string option;
      (** Original-start key; omitted to replace the entire series. *)
  remove_conference : bool;
      (** Omit the provider conference in the replacement. *)
}
(** A read-only preview request. Confirmation uses the returned operation identity. *)

val prepare_calendar_replacement_request_of_yojson :
  Yojson.Safe.t -> prepare_calendar_replacement_request

val yojson_of_prepare_calendar_replacement_request :
  prepare_calendar_replacement_request -> Yojson.Safe.t

val make_prepare_calendar_replacement_request :
  ?calendar_id:string ->
  ?recurrence_id:string ->
  remove_conference:bool ->
  unit ->
  prepare_calendar_replacement_request
(** A read-only preview request. Confirmation uses the returned operation identity. *)

type nonrec profile_response = {
  profile : booking_profile;
      (** Full settings, including the revision to save against. *)
}
(** Booking settings of one profile. *)

val profile_response_of_yojson : Yojson.Safe.t -> profile_response
val yojson_of_profile_response : profile_response -> Yojson.Safe.t

val make_profile_response : profile:booking_profile -> unit -> profile_response
(** Booking settings of one profile. *)

type nonrec receipt_response = {
  booking : booking;  (** The booking. *)
  schedule_time_zone : string;
      (** IANA time zone of the booking's availability schedule. *)
  token : string;
      (** Bearer capability for the booker's receipt, reschedule and cancel pages. *)
}
(** A booking with its booker management capability. *)

val receipt_response_of_yojson : Yojson.Safe.t -> receipt_response
val yojson_of_receipt_response : receipt_response -> Yojson.Safe.t

val make_receipt_response :
  booking:booking ->
  schedule_time_zone:string ->
  token:string ->
  unit ->
  receipt_response
(** A booking with its booker management capability. *)

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

val refresh_calendar_event_of_yojson : Yojson.Safe.t -> refresh_calendar_event
val yojson_of_refresh_calendar_event : refresh_calendar_event -> Yojson.Safe.t

val make_refresh_calendar_event_synced :
  link_id:string -> team_ooo_changed:bool -> unit -> refresh_calendar_event
(** A sync run committed changes for [link_id]; viewers should refetch. *)

val make_refresh_calendar_event_team_sharing_changed :
  team_ooo_changed:bool -> unit -> refresh_calendar_event
(** Team projections need refreshing after a sync or entitlement change. *)

val make_refresh_calendar_event_join_request_answered :
  event_id:string -> unit -> refresh_calendar_event
(** The viewer's request to join a shared event was answered. *)

type nonrec respond_to_join_request_request = {
  decision : calendar_join_request_decision;  (** The sharer's answer. *)
}
(** Request body answering a join request. *)

val respond_to_join_request_request_of_yojson :
  Yojson.Safe.t -> respond_to_join_request_request

val yojson_of_respond_to_join_request_request :
  respond_to_join_request_request -> Yojson.Safe.t

val make_respond_to_join_request_request :
  decision:calendar_join_request_decision ->
  unit ->
  respond_to_join_request_request
(** Request body answering a join request. *)

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

val rsvp_calendar_event_request_of_yojson :
  Yojson.Safe.t -> rsvp_calendar_event_request

val yojson_of_rsvp_calendar_event_request :
  rsvp_calendar_event_request -> Yojson.Safe.t

val make_rsvp_calendar_event_request :
  ?calendar_id:string ->
  ?recurrence_id:string ->
  ?responding_email:string ->
  response:attendee_response_status ->
  ?scope:calendar_rsvp_scope_param ->
  unit ->
  rsvp_calendar_event_request
(** Request body setting the requester's RSVP on an event. *)

type nonrec slots_response = {
  slots : booking_slot list;  (** Every available slot. *)
}
(** Available start times. *)

val slots_response_of_yojson : Yojson.Safe.t -> slots_response
val yojson_of_slots_response : slots_response -> Yojson.Safe.t

val make_slots_response : slots:booking_slot list -> unit -> slots_response
(** Available start times. *)

(** What a user exposes through their team membership. *)
type nonrec team_calendar_sharing =
  | All
  | Busy_only
  | None_
  | Unknown of string  (** A value this SDK version does not know. *)

val team_calendar_sharing_of_yojson : Yojson.Safe.t -> team_calendar_sharing
val yojson_of_team_calendar_sharing : team_calendar_sharing -> Yojson.Safe.t

type nonrec team_calendar_sharing_body = {
  sharing : team_calendar_sharing;
      (** Busy-only is the default, including when no setting has been saved. *)
}
(** Own-user sharing preference. *)

val team_calendar_sharing_body_of_yojson :
  Yojson.Safe.t -> team_calendar_sharing_body

val yojson_of_team_calendar_sharing_body :
  team_calendar_sharing_body -> Yojson.Safe.t

val make_team_calendar_sharing_body :
  sharing:team_calendar_sharing -> unit -> team_calendar_sharing_body
(** Own-user sharing preference. *)

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

val update_calendar_event_request_of_yojson :
  Yojson.Safe.t -> update_calendar_event_request

val yojson_of_update_calendar_event_request :
  update_calendar_event_request -> Yojson.Safe.t

val make_update_calendar_event_request :
  ?attendees:calendar_attendee_input_body list ->
  ?calendar_id:string ->
  ?conference:conference_change ->
  ?description:string ->
  ?guest_policy:guest_policy ->
  ?inbox:string ->
  ?location:string ->
  ?macro_call:bool ->
  ?out_of_office:out_of_office_properties ->
  ?recurrence_id:string ->
  ?recurrence_lines:string list ->
  ?reminders:event_reminders ->
  ?scope:calendar_update_scope_param ->
  ?time:event_time ->
  ?title:string ->
  ?transparency:event_transparency ->
  ?visibility:event_visibility ->
  unit ->
  update_calendar_event_request
(** Request body patching an event; omitted fields are left untouched. *)

val get_availability_calendars :
  unit ->
  ( availability_calendars_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /availability-calendars]

List calendars and their personal-availability inclusion. *)

val set_availability_calendar :
  calendar_id:string ->
  contributes_to_availability:bool ->
  unit ->
  (unit, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PUT /availability-calendars/{calendar_id}]

Change which source calendars normally occupy this user's time. *)

val list_calendars :
  unit ->
  ( list_calendars_response,
    calendar_mutation_api_error )
  Macro_sdk_runtime.Request.t
(** [GET /calendars]

List the requester's visible calendars for pickers and filters. *)

val create_calendar_event :
  time:event_time ->
  title:string ->
  ?attendees:calendar_attendee_input_body list ->
  ?calendar_id:string ->
  ?conference:conference_change ->
  ?description:string ->
  ?email_link_id:string ->
  ?guest_policy:guest_policy ->
  ?idempotency_key:string ->
  ?location:string ->
  ?macro_call:bool ->
  ?out_of_office:out_of_office_properties ->
  ?recurrence_lines:string list ->
  ?reminders:event_reminders ->
  ?transparency:event_transparency ->
  ?visibility:event_visibility ->
  unit ->
  (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t
(** [POST /events]

Create a calendar event and return its synced entity. *)

val delete_calendar_event :
  event_id:string ->
  ?calendar_id:string ->
  ?scope:calendar_deletion_scope_param ->
  ?recurrence_id:string ->
  ?inbox:string ->
  unit ->
  (unit, calendar_mutation_api_error) Macro_sdk_runtime.Request.t
(** [DELETE /events/{event_id}]

Delete a calendar event at its provider. *)

val update_calendar_event :
  event_id:string ->
  ?attendees:calendar_attendee_input_body list ->
  ?calendar_id:string ->
  ?conference:conference_change ->
  ?description:string ->
  ?guest_policy:guest_policy ->
  ?inbox:string ->
  ?location:string ->
  ?macro_call:bool ->
  ?out_of_office:out_of_office_properties ->
  ?recurrence_id:string ->
  ?recurrence_lines:string list ->
  ?reminders:event_reminders ->
  ?scope:calendar_update_scope_param ->
  ?time:event_time ->
  ?title:string ->
  ?transparency:event_transparency ->
  ?visibility:event_visibility ->
  unit ->
  (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t
(** [PATCH /events/{event_id}]

Update fields of a calendar event and return its synced entity. *)

val copy_calendar_event :
  event_id:string ->
  ?calendar_id:string ->
  unit ->
  (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t
(** [POST /events/{event_id}/copy]

Add a snapshot of an event shared with one of the requester's channels to
one of their Google calendars and return the synced snapshot. The
snapshot keeps the meeting's iCalendar UID and organizer, lists only the
requester as a guest, and carries no join link; nobody is notified.
While the requester's request to join the event is pending or accepted,
the copy is refused with [join_request_open]: the meeting reaches their
calendar as the invitation, which a copy would otherwise take in. *)

val invite_calendar_event_guests :
  event_id:string ->
  guests:calendar_guest_input_body list ->
  ?calendar_id:string ->
  ?inbox:string ->
  ?recurrence_id:string ->
  ?scope:calendar_update_scope_param ->
  unit ->
  (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t
(** [POST /events/{event_id}/guests]

Add guests to a calendar event without touching anyone already invited,
and return its synced entity. The organizer, and guests the organizer lets
invite others, may call it; Google emails the new guests. *)

val calendar_event_provider_url :
  event_id:string ->
  ?calendar_id:string ->
  ?recurrence_id:string ->
  unit ->
  ( calendar_event_provider_url,
    calendar_mutation_api_error )
  Macro_sdk_runtime.Request.t
(** [GET /events/{event_id}/provider-url]

Resolve an authorized event's provider link for Outlook-only actions. *)

val prepare_calendar_replacement :
  event_id:string ->
  remove_conference:bool ->
  ?calendar_id:string ->
  ?recurrence_id:string ->
  unit ->
  ( calendar_replacement_view,
    calendar_mutation_api_error )
  Macro_sdk_runtime.Request.t
(** [POST /events/{event_id}/replacement]

Read and persist an organizer-only preview, without sending invitations. *)

val rsvp_calendar_event :
  event_id:string ->
  response:attendee_response_status ->
  ?calendar_id:string ->
  ?recurrence_id:string ->
  ?responding_email:string ->
  ?scope:calendar_rsvp_scope_param ->
  unit ->
  (calendar_event, calendar_mutation_api_error) Macro_sdk_runtime.Request.t
(** [PUT /events/{event_id}/rsvp]

Set the requester's RSVP on a calendar event and return its synced entity. *)

val health_handler :
  unit ->
  (string, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [GET /health]

Health check *)

val respond_to_join_request :
  request_id:string ->
  decision:calendar_join_request_decision ->
  unit ->
  ( calendar_join_request,
    calendar_mutation_api_error )
  Macro_sdk_runtime.Request.t
(** [PUT /join-requests/{request_id}]

Answer a request to join an event the requester can change and return
where it now stands. Accepting adds the guest through the invite path; an
already answered request is returned unchanged. *)

val calendar_replacement_status :
  operation_id:string ->
  unit ->
  ( calendar_replacement_view,
    calendar_mutation_api_error )
  Macro_sdk_runtime.Request.t
(** [GET /replacements/{operation_id}]

Read saved progress without performing a provider mutation. *)

val discard_calendar_replacement :
  operation_id:string ->
  unit ->
  (unit, calendar_mutation_api_error) Macro_sdk_runtime.Request.t
(** [DELETE /replacements/{operation_id}]

Discard a preview only if no confirmation has been recorded. *)

val confirm_calendar_replacement :
  operation_id:string ->
  unit ->
  ( calendar_replacement_view,
    calendar_mutation_api_error )
  Macro_sdk_runtime.Request.t
(** [POST /replacements/{operation_id}/confirm]

Explicitly confirm the saved preview, or resume the same confirmed operation. *)

val list_bookings :
  ?team_id:string ->
  ?from:string ->
  ?to_:string ->
  unit ->
  ( bookings_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduling/bookings]

List the profile's bookings, optionally those starting in a half-open range. *)

val change_booking :
  id:string ->
  body:booking_change ->
  unit ->
  ( booking_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /scheduling/bookings/{id}/change]

Approve, cancel, record attendance for, or reschedule one booking. *)

val get_managed_booking :
  id:string ->
  unit ->
  ( receipt_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduling/bookings/{id}/manage]

Read one booking as its personal owner, a host, or a team administrator. *)

val list_booking_reschedule_slots :
  id:string ->
  date:string ->
  unit ->
  ( slots_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduling/bookings/{id}/slots]

Replacement start times for one booking on a schedule-local date. *)

val get_booking_insights :
  from:string ->
  time_zone:string ->
  to_:string ->
  ?team_id:string ->
  ?event_type_id:string ->
  ?host_id:string ->
  unit ->
  ( booking_insights,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [POST /scheduling/insights]

Booking statistics for a local date range and the equally long period before it. *)

val list_booking_links :
  ?team_id:string ->
  ?query:string ->
  unit ->
  ( booking_link_listing,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduling/links]

List and search booking links with their full drafts and reusable schedules. *)

val create_booking_link :
  draft:booking_link_draft ->
  user_confirmation:string ->
  ?team_id:string ->
  unit ->
  (booking_link, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [POST /scheduling/links]

Create a booking link; an identical replay at the same slug returns the saved link. *)

val edit_booking_link :
  id:string ->
  draft:booking_link_draft ->
  expected_revision:int64 ->
  user_confirmation:string ->
  ?team_id:string ->
  unit ->
  (booking_link, Macro_sdk_runtime.Request.no_error) Macro_sdk_runtime.Request.t
(** [PUT /scheduling/links/{id}]

Replace one booking link's configuration at the profile revision it was read with. *)

val get_booking_settings :
  ?team_id:string ->
  unit ->
  ( profile_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /scheduling/settings]

Read personal or team booking settings without creating them. *)

val save_booking_settings :
  description:string ->
  event_types:booking_event_type list ->
  id:string ->
  name:string ->
  revision:int64 ->
  schedules:booking_schedule list ->
  ?team_id:string ->
  ?default_schedule_id:string ->
  unit ->
  ( profile_response,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /scheduling/settings]

Save booking settings at the revision they were read with. *)

val get_team_sharing :
  unit ->
  ( team_calendar_sharing_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [GET /team-sharing]

Read the authenticated user's sharing choice. *)

val set_team_sharing :
  sharing:team_calendar_sharing ->
  unit ->
  ( team_calendar_sharing_body,
    Macro_sdk_runtime.Request.no_error )
  Macro_sdk_runtime.Request.t
(** [PUT /team-sharing]

Set the authenticated user's sharing choice. *)
