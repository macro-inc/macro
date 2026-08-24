//! ListCalendars tool for enumerating the calendars a user can see.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{CalendarToolContext, mutation_tool_error};
use crate::domain::ports::{CalendarMutationService, CalendarOccurrenceService};

/// A calendar surfaced to the AI.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolCalendar {
    /// Calendar id; pass as `calendarId` to CreateCalendarEvent to target
    /// this calendar.
    pub calendar_id: uuid::Uuid,
    /// Provider display name.
    pub name: String,
    /// Connected inbox address the calendar belongs to.
    pub email_address: String,
    /// Whether this is its account's primary calendar — the default target
    /// for created events.
    pub is_primary: bool,
    /// Whether events can be created and modified on this calendar.
    pub is_writable: bool,
}

/// Response from the ListCalendars tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListCalendarsToolResponse {
    /// The calendars the user can see, primaries and writables first.
    pub calendars: Vec<ToolCalendar>,
    /// A human-readable summary of the calendars.
    pub summary: String,
}

/// List the calendars the user can access.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[schemars(
    title = "ListCalendars",
    description = "\
List the calendars the user can see across their connected inboxes, with each calendar's \
`calendarId`, display name, owning inbox address, and whether it is primary and writable.\n\
\n\
Use this before CreateCalendarEvent when the user wants an event on a specific non-default \
calendar (e.g. \"add it to my work calendar\") so you can pass the exact `calendarId`. Most \
users have a single primary calendar, in which case CreateCalendarEvent targets it by default \
and you do not need this tool. An empty result means no calendar is connected."
)]
pub struct ListCalendars {}

impl ToolAnnotated for ListCalendars {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List calendars");
}

#[async_trait]
impl<M, O> AsyncTool<CalendarToolContext<M, O>> for ListCalendars
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    type Output = ListCalendarsToolResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("List calendars");

        let requester_id = request_context.user_id.to_string();
        let calendars = service_context
            .mutations
            .list_visible_calendars(&requester_id)
            .await
            .map_err(|error| mutation_tool_error("list calendars", error))?;

        let calendars: Vec<ToolCalendar> = calendars
            .into_iter()
            .map(|calendar| ToolCalendar {
                calendar_id: calendar.id,
                name: calendar.name,
                email_address: calendar.email_address,
                is_primary: calendar.is_primary,
                is_writable: calendar.is_writable,
            })
            .collect();

        let summary = match calendars.len() {
            0 => "No calendars are connected.".to_string(),
            1 => "Found 1 calendar.".to_string(),
            count => format!("Found {count} calendars."),
        };

        Ok(ListCalendarsToolResponse { calendars, summary })
    }
}
