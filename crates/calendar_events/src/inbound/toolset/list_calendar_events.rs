//! ListCalendarEvents tool for reading a bounded window of calendar events.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{CalendarToolContext, ToolEventAttendee, description_preview, time_fields};
use crate::domain::{
    models::{CalendarOccurrenceCursor, CalendarSyncStatus, OccurrenceRange},
    ports::{CalendarMutationService, CalendarOccurrenceService},
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
    /// Calendar the event belongs to, when known.
    pub calendar_id: Option<uuid::Uuid>,
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
results may still be incomplete."
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
impl<M, O> AsyncTool<CalendarToolContext<M, O>> for ListCalendarEvents
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    type Output = ListCalendarEventsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O>>,
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
                .map(|(_, occurrence)| CalendarOccurrenceCursor::from_occurrence(occurrence));
            occurrences.extend(
                rows.into_iter()
                    .filter(|(_, occurrence)| !occurrence.is_cancelled),
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

        let events: Vec<CalendarEventListItem> = occurrences
            .into_iter()
            .map(|(event, occurrence)| {
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
                    calendar_id: event.calendar_id,
                }
            })
            .collect();

        let sync_status = match sync_status {
            CalendarSyncStatus::Syncing => "syncing",
            CalendarSyncStatus::Ready => "ready",
        }
        .to_string();
        let summary = build_summary(events.len(), truncated, &sync_status);

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

fn build_summary(count: usize, truncated: bool, sync_status: &str) -> String {
    let mut summary = match count {
        0 => "No calendar events in this window.".to_string(),
        1 => "Found 1 calendar event.".to_string(),
        count => format!("Found {count} calendar events."),
    };
    if truncated {
        summary.push_str(" More exist — narrow the window to see the rest.");
    }
    if sync_status == "syncing" {
        summary.push_str(" Calendars are still syncing; results may be incomplete.");
    }
    summary
}
