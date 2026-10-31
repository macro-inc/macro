//! ListCalendarEvents tool for reading a bounded window of calendar events.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use std::collections::{BTreeSet, HashMap, HashSet};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    CalendarLabels, CalendarToolContext, ToolEventAttendee, ToolEventRole, description_preview,
    time_fields,
};
use crate::domain::{
    models::{
        CalendarEvent, CalendarOccurrence, CalendarOccurrenceCursor, CalendarSyncStatus,
        OccurrenceRange, ViewerCapabilities,
    },
    ports::{CalendarMutationService, CalendarOccurrenceService, MeetingLinkProvider},
    service::CalendarValidationError,
};

/// The most occurrences one call returns; wider windows report truncation.
pub(super) const OCCURRENCES_MAX: u16 = 200;

/// Bound on cursor pages fetched while filling the cap with non-cancelled
/// occurrences; stopping early reports the window as truncated.
const PAGES_MAX: usize = 10;

/// One calendar event occurrence in the requested window.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventListItem {
    /// Macro calendar event id, used by UpdateCalendarEvent and
    /// DeleteCalendarEvent. Recurring events repeat it across occurrences.
    pub event_id: uuid::Uuid,
    /// Display title.
    pub title: String,
    /// Occurrence start: RFC 3339 UTC instant, or YYYY-MM-DD for all-day
    /// events.
    pub start: String,
    /// Exclusive occurrence end: RFC 3339 UTC instant, or YYYY-MM-DD for
    /// all-day events.
    pub end: String,
    /// Whether the event covers whole days.
    pub is_all_day: bool,
    /// IANA time zone the event was scheduled in, when known.
    pub time_zone: Option<String>,
    /// Location label, when set.
    pub location: Option<String>,
    /// Event body, truncated for brevity.
    pub description: Option<String>,
    /// Event status: confirmed or tentative.
    pub status: String,
    /// Provider event type for status-style events (out_of_office,
    /// focus_time, working_location, birthday, from_gmail); absent for
    /// regular events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
    /// Whether this occurrence belongs to a recurring series.
    pub is_recurring: bool,
    /// Occurrence key identifying this instance within its recurring series;
    /// pass as `recurrenceId` for occurrence-scoped updates and deletions.
    pub recurrence_id: Option<String>,
    /// Attendees, capped at 20; `attendee_count` has the full number.
    pub attendees: Vec<ToolEventAttendee>,
    /// Total number of attendees.
    pub attendee_count: usize,
    /// The user's own RSVP on this event, when they are an attendee.
    pub my_response: Option<String>,
    /// Organizer email address, when known.
    pub organizer_email: Option<String>,
    /// Conference join URL, when a conference is attached.
    pub conference_url: Option<String>,
    /// Whether the user's calendar prohibits modifying this event.
    pub is_read_only: bool,
    /// What the user may do with this event under the organizer's guest
    /// permissions: change its details, add or remove guests, change those
    /// permissions, or answer the invitation.
    pub viewer_can: ViewerCapabilities,
    /// Calendar the event belongs to, when known.
    pub calendar_id: Option<uuid::Uuid>,
    /// Display name of that calendar, when known. It often says whose
    /// calendar it is: Google names a person's primary calendar after them or
    /// their address.
    pub calendar_name: Option<String>,
    /// Whether a calendar holding this event counts toward the user's busy
    /// time, when known. Only these and meetings they attend are the user's
    /// schedule; false does not say whose calendar it is, as their own other
    /// calendars are false too.
    pub contributes_to_availability: Option<bool>,
    /// Connected inbox address syncing this copy of the event. It stays the
    /// user's own address on a colleague's calendar, so it never says whose
    /// calendar it is. A meeting on several of the user's inboxes is listed
    /// once per inbox, each with its own `eventId`.
    pub inbox: Option<String>,
    /// Whether the user organizes this event or is a guest on it, through
    /// `inbox`; absent when they are neither, or can only write that
    /// calendar.
    pub my_role: Option<ToolEventRole>,
    /// Every calendar carrying a copy of this event when there is more than
    /// one, primary first. Pass a copy's `calendarId` to UpdateCalendarEvent
    /// or DeleteCalendarEvent to address that copy instead of the primary.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub copies: Vec<CalendarEventCopyItem>,
}

/// One calendar's copy of an event synced from several calendars.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventCopyItem {
    /// Calendar holding this copy.
    pub calendar_id: uuid::Uuid,
    /// Display name of that calendar, when known.
    pub calendar_name: Option<String>,
    /// Connected inbox address syncing the calendar, when known.
    pub inbox: Option<String>,
    /// The copy's own title.
    pub title: String,
    /// Whether that calendar prohibits modifying the copy.
    pub is_read_only: bool,
}

/// Response from the ListCalendarEvents tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListCalendarEventsResponse {
    /// Occurrences in the window, soonest first.
    pub events: Vec<CalendarEventListItem>,
    /// Whether the window held more occurrences than were returned; narrow
    /// the window to see the rest.
    pub truncated: bool,
    /// `syncing` while any connected calendar is still ingesting — results
    /// may be incomplete — or `ready`.
    pub sync_status: String,
    /// A human-readable summary of the result.
    pub summary: String,
}

/// List calendar events in a time window.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListCalendarEvents",
    description = "\
List the user's calendar events between two instants, across every calendar they have \
connected. Returns one entry per occurrence (a recurring event appears once per instance in \
the window), soonest first, with the `eventId` needed by UpdateCalendarEvent and \
DeleteCalendarEvent.\n\
\n\
Use this to answer questions about the user's schedule (\"what's on my calendar \
tomorrow?\"), to find an event the user wants changed or removed, and to check for conflicts \
before creating an event. Keep the window as narrow as the request allows — a day or a week \
— since wide windows truncate at 200 occurrences. The window must be at most 370 days and \
within one year past to two years future. If `syncStatus` is `syncing`, tell the user \
results may still be incomplete.\n\
\n\
The user can see calendars that are not theirs, such as a colleague's or a team's. `inbox` is \
the account syncing a calendar, so it stays the user's own address on all of them, and neither \
it, `isReadOnly` nor `myRole` says whose calendar it is. Their schedule is the calendars with \
`contributesToAvailability`, plus meetings they attend: only those are \"your calendar\", and \
only those count as conflicts or busy time, as in GetTeamAvailability. Anything else is what \
that calendar shows, not where the user is or what they are doing. Call it by `calendarName`, \
say whose it is when the name shows that, and otherwise say you cannot tell rather than guess. \
When one overlaps a time you suggest, mention it so the user can decide, since their own other \
calendars read the same way.\n\
\n\
Each entry names the calendar (`calendarName`) and connected inbox (`inbox`) holding that \
copy of the event, and `myRole` says whether the user organizes it or is a guest there. A \
meeting on several of the user's inboxes appears once per inbox, each with its own \
`eventId`, and what the user may do can differ between them. When asking which one the user \
means, describe each by its inbox and role, never by id; when the user names an inbox, act \
on the entry whose `inbox` matches.\n\
\n\
When the user does not name an inbox, choose the copy by what the change does. Reminders \
belong to one copy only, so set them on one copy without asking and say which inbox you used. \
Answer an invitation on the copy where the user is a guest; when they are a guest through \
more than one inbox, ask which inbox answers, since each answers only for itself. Any other \
change reaches the meeting differently from each copy: the title, time, description, \
location, recurrence or conference, adding or removing guests, guest permissions, and \
deleting. UpdateCalendarEvent and DeleteCalendarEvent refuse such a change on a meeting held \
by several of the user's inboxes until `inbox` names the inbox of the copy being changed, and \
the refusal lists each copy. If only one copy allows the change (`viewerCan`, or for deleting, \
`isReadOnly` false), use that copy with its `inbox` and say why (for example, only the copy \
the user organizes can move the meeting). If more than one can, ask which inbox, saying what \
the change would do from each, and never choose between the user's inboxes yourself, whatever \
they look like. Add guests from the copy the user organizes when there is one: \
it invites them directly, while a guest's copy invites only as far as the organizer allows. \
Deleting the organizer's copy cancels the meeting for everyone, while deleting a guest's copy \
takes the meeting off that inbox's calendar and, on Google, also declines the invitation and \
tells the organizer."
)]
pub struct ListCalendarEvents {
    /// Inclusive window start.
    #[schemars(description = "Inclusive window start, RFC 3339 UTC (e.g. 2026-08-20T00:00:00Z).")]
    pub start: DateTime<Utc>,
    /// Exclusive window end.
    #[schemars(description = "Exclusive window end, RFC 3339 UTC. Must be after start.")]
    pub end: DateTime<Utc>,
}

impl ToolAnnotated for ListCalendarEvents {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List calendar events");
}

#[async_trait]
impl<M, O, L> AsyncTool<CalendarToolContext<M, O, L>> for ListCalendarEvents
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    type Output = ListCalendarEventsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O, L>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "List calendar events");

        let requester_id = request_context.user_id.to_string();
        let range = OccurrenceRange {
            starts_at: self.start,
            ends_at: self.end,
            start_date: self.start.date_naive(),
            end_date: end_date_bound(self.end),
        };

        // Cancelled occurrences never reach the response, so they must not
        // count toward the cap or its truncation flag: keep paging until the
        // cap is exceeded by active occurrences alone or the window is
        // exhausted, up to a bounded number of pages.
        let mut occurrences = Vec::new();
        let mut cursor = None;
        let mut exhausted = false;
        for _ in 0..PAGES_MAX {
            let rows = service_context
                .occurrences
                .list_occurrences(
                    &requester_id,
                    range.clone(),
                    cursor.take(),
                    OCCURRENCES_MAX + 1,
                )
                .await
                .map_err(list_error)?;
            let full_page = rows.len() > usize::from(OCCURRENCES_MAX);
            cursor = rows
                .last()
                .map(|listing| CalendarOccurrenceCursor::from_occurrence(&listing.occurrence));
            occurrences.extend(
                rows.into_iter()
                    .filter(|listing| !listing.occurrence.is_cancelled)
                    .map(|listing| {
                        let link_id = listing.link_id;
                        let (event, occurrence) = listing.into_occurrence_event();
                        (event, occurrence, link_id)
                    }),
            );
            if !full_page {
                exhausted = true;
                break;
            }
            if occurrences.len() > usize::from(OCCURRENCES_MAX) {
                break;
            }
        }
        let truncated = occurrences.len() > usize::from(OCCURRENCES_MAX) || !exhausted;
        occurrences.truncate(usize::from(OCCURRENCES_MAX));

        let sync_status = service_context
            .occurrences
            .sync_status(&requester_id)
            .await
            .map_err(|error| ToolCallError {
                description: "Failed to query calendar sync status. Try again shortly.".to_string(),
                internal_error: anyhow::Error::from_boxed(error.into_boxed_error()),
            })?;

        let multi_inbox_meetings = multi_inbox_meetings(&occurrences);
        let labels = CalendarLabels::load(&*service_context.mutations, &requester_id).await;
        let events: Vec<CalendarEventListItem> = occurrences
            .into_iter()
            .map(|(event, occurrence, link_id)| {
                let (start, end, is_all_day, time_zone) = time_fields(&occurrence.time);
                let is_recurring = !event.recurrence_lines.is_empty();
                CalendarEventListItem {
                    event_id: event.id,
                    title: event.title.clone(),
                    start,
                    end,
                    is_all_day,
                    time_zone,
                    location: event.location.clone(),
                    description: description_preview(event.description.as_deref()),
                    status: event.status.as_str().to_string(),
                    event_type: (!event.event_type.is_default())
                        .then(|| event.event_type.as_str().to_string()),
                    is_recurring,
                    recurrence_id: is_recurring.then(|| occurrence.occurrence_key.clone()),
                    attendees: event
                        .attendees
                        .iter()
                        .take(super::ATTENDEES_SHOWN_MAX)
                        .map(|attendee| ToolEventAttendee {
                            email: attendee.email.clone(),
                            response_status: attendee.response_status.as_str().to_string(),
                            is_organizer: attendee.is_organizer,
                            is_optional: attendee.is_optional,
                        })
                        .collect(),
                    attendee_count: event.attendees.len(),
                    my_response: event
                        .attendees
                        .iter()
                        .find(|attendee| attendee.is_self)
                        .map(|attendee| attendee.response_status.as_str().to_string()),
                    organizer_email: event.organizer_email.clone(),
                    conference_url: event.conference_url.clone(),
                    is_read_only: event.is_read_only,
                    viewer_can: event.viewer_can,
                    calendar_id: event.calendar_id,
                    calendar_name: labels.calendar_name(event.calendar_id),
                    contributes_to_availability: labels.event_on_schedule(&event),
                    inbox: labels.inbox(event.calendar_id, Some(link_id)),
                    my_role: ToolEventRole::of(&event, &labels),
                    copies: if event.sources.len() > 1 {
                        event
                            .sources
                            .iter()
                            .map(|copy| CalendarEventCopyItem {
                                calendar_id: copy.calendar_id,
                                calendar_name: labels.calendar_name(Some(copy.calendar_id)),
                                inbox: labels.inbox(Some(copy.calendar_id), None),
                                title: copy.title.clone(),
                                is_read_only: copy.is_read_only,
                            })
                            .collect()
                    } else {
                        Vec::new()
                    },
                }
            })
            .collect();

        let sync_status = match sync_status {
            CalendarSyncStatus::Syncing => "syncing",
            CalendarSyncStatus::Ready => "ready",
        }
        .to_string();
        let summary = build_summary(
            events.len(),
            truncated,
            &sync_status,
            multi_inbox_meetings,
            &calendars_outside_schedule(&events),
        );

        Ok(ListCalendarEventsResponse {
            events,
            truncated,
            sync_status,
            summary,
        })
    }
}

/// Map an occurrence-query failure to an agent-readable tool error.
fn list_error(error: rootcause::Report) -> ToolCallError {
    let description = if error
        .as_ref()
        .downcast_current_context::<CalendarValidationError>()
        .is_some()
    {
        "The window is invalid: it must be positive, at most 370 days, and within one year past \
         to two years future."
            .to_string()
    } else {
        "Failed to query calendar events. Try again shortly.".to_string()
    };
    ToolCallError {
        description,
        internal_error: anyhow::Error::from_boxed(error.into_boxed_error()),
    }
}

/// Exclusive local date bound covering the instant window, mirroring the
/// occurrence HTTP route's default.
fn end_date_bound(end: DateTime<Utc>) -> chrono::NaiveDate {
    if end.time() == chrono::NaiveTime::MIN {
        end.date_naive()
    } else {
        end.date_naive()
            .succ_opt()
            .unwrap_or_else(|| end.date_naive())
    }
}

/// How many occurrences in the result are one meeting held by more than one
/// of the user's inboxes: the same iCalendar UID at the same time under
/// different event ids.
fn multi_inbox_meetings(occurrences: &[(CalendarEvent, CalendarOccurrence, Uuid)]) -> usize {
    let mut copies: HashMap<(&str, &str), HashSet<Uuid>> = HashMap::new();
    for (event, occurrence, _) in occurrences {
        copies
            .entry((event.ical_uid.as_str(), occurrence.occurrence_key.as_str()))
            .or_default()
            .insert(event.id);
    }
    copies.values().filter(|events| events.len() > 1).count()
}

/// The calendars in the result that are not part of the user's schedule, by
/// name: those events are neither on it nor meetings the user attends.
fn calendars_outside_schedule(events: &[CalendarEventListItem]) -> Vec<&str> {
    events
        .iter()
        .filter(|event| {
            event.contributes_to_availability == Some(false)
                && event.my_role != Some(ToolEventRole::Guest)
        })
        .filter_map(|event| event.calendar_name.as_deref())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn build_summary(
    count: usize,
    truncated: bool,
    sync_status: &str,
    multi_inbox_meetings: usize,
    other_calendars: &[&str],
) -> String {
    let mut summary = match count {
        0 => "No calendar events in this window.".to_string(),
        1 => "Found 1 calendar event.".to_string(),
        count => format!("Found {count} calendar events."),
    };
    match multi_inbox_meetings {
        0 => {}
        1 => summary.push_str(
            " 1 meeting is on more than one of the user's inboxes; tell its entries apart by \
             `inbox` and `myRole`.",
        ),
        meetings => summary.push_str(&format!(
            " {meetings} meetings are on more than one of the user's inboxes; tell their entries \
             apart by `inbox` and `myRole`."
        )),
    }
    if !other_calendars.is_empty() {
        summary.push_str(&format!(
            " Some events are on calendars outside the user's schedule ({}): call them by \
             `calendarName`, not the user's, and do not count them as busy time.",
            other_calendars.join(", ")
        ));
    }
    if truncated {
        summary.push_str(" More exist — narrow the window to see the rest.");
    }
    if sync_status == "syncing" {
        summary.push_str(" Calendars are still syncing; results may be incomplete.");
    }
    summary
}
