//! UpdateCalendarEvent tool for editing existing calendar events.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{
    AttendeeInput, CalendarToolContext, EventRemindersInput, EventTimeInput, OutOfOfficeInput,
    ToolCalendarEvent, mutation_tool_error,
};
use crate::domain::{
    models::{AttendeeResponseStatus, CalendarEventPatch, ConferenceChange},
    ports::{
        CalendarMutationService, CalendarOccurrenceService, CalendarRsvpScope, CalendarUpdateScope,
    },
};

/// A requested change to an event's video conference.
#[derive(Debug, Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConferenceChangeInput {
    /// Generate a new Google Meet conference and attach it.
    GoogleMeet,
    /// Detach whatever conference is currently attached.
    Remove,
}

impl From<ConferenceChangeInput> for ConferenceChange {
    fn from(input: ConferenceChangeInput) -> Self {
        match input {
            ConferenceChangeInput::GoogleMeet => Self::GoogleMeet,
            ConferenceChangeInput::Remove => Self::Removed,
        }
    }
}

/// The requester's own RSVP on an event they were invited to.
#[derive(Debug, Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RsvpResponseInput {
    /// Attending.
    Accepted,
    /// Not attending.
    Declined,
    /// Might attend.
    Tentative,
}

impl From<RsvpResponseInput> for AttendeeResponseStatus {
    fn from(input: RsvpResponseInput) -> Self {
        match input {
            RsvpResponseInput::Accepted => Self::Accepted,
            RsvpResponseInput::Declined => Self::Declined,
            RsvpResponseInput::Tentative => Self::Tentative,
        }
    }
}

/// How much of a recurring series an update applies to.
#[derive(Debug, Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateScopeInput {
    /// The entire event or series.
    All,
    /// One occurrence of a recurring series.
    ThisEvent,
}

/// Update fields of a calendar event.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdateCalendarEvent",
    description = "\
Update an existing calendar event. Only the supplied fields change; omitted fields keep \
their current values. The change is written to Google immediately and attendees are \
notified of it, so confirm details with the user first. Get the `eventId` from \
ListCalendarEvents.\n\
\n\
`scope` picks how much of a recurring series changes and is always required: \
\"this_event\" edits one occurrence (pass the occurrence's `recurrenceId` from \
ListCalendarEvents) and leaves the rest of the series alone; \"all\" edits the series \
itself — with `time` that MOVES EVERY OCCURRENCE, so never use \"all\" to reschedule a \
single occurrence. Non-recurring events use \"all\". There is no this-and-following \
update: end the series with DeleteCalendarEvent's \"this_and_following\" and create a new \
event instead.\n\
\n\
Passing `attendees` replaces the full attendee list — include everyone who should remain, \
not just additions. An empty string for `description` or `location` clears it. Fails on \
events from calendars the user cannot edit.\n\
\n\
`rsvp` sets the user's own response to an invitation and is independent of the field \
edits — it can be the only thing this call changes. It applies at the same `scope` as \
the rest of the call, and only works on events the user is actually an attendee of."
)]
pub struct UpdateCalendarEvent {
    /// Event to update.
    #[schemars(description = "The event's id, from ListCalendarEvents or CreateCalendarEvent.")]
    pub event_id: uuid::Uuid,

    /// Update scope.
    #[schemars(
        description = "How much of a recurring series to change: \"this_event\" edits one \
                       occurrence (requires `recurrenceId`), \"all\" edits the whole event or \
                       series. Non-recurring events use \"all\"."
    )]
    pub scope: UpdateScopeInput,

    /// Occurrence key for occurrence-scoped updates.
    #[schemars(
        description = "The `recurrenceId` of the targeted occurrence, from its \
                       ListCalendarEvents entry. Required for \"this_event\"; omit for \
                       \"all\"."
    )]
    #[serde(default)]
    pub recurrence_id: Option<String>,

    /// Replacement title.
    #[schemars(description = "Replacement title. Omit to keep the current title.")]
    #[serde(default)]
    pub title: Option<String>,

    /// Replacement description.
    #[schemars(
        description = "Replacement event body/description. An empty string clears it; omit to \
                       keep the current one."
    )]
    #[serde(default)]
    pub description: Option<String>,

    /// Replacement location.
    #[schemars(
        description = "Replacement location label. An empty string clears it; omit to keep \
                       the current one."
    )]
    #[serde(default)]
    pub location: Option<String>,

    /// Replacement time.
    #[schemars(
        description = "Replacement time: a timed span with `kind` \"timed\" (startsAt, endsAt, \
                       optional timeZone) or whole days with `kind` \"allDay\" (startDate, \
                       exclusive endDate). Omit to keep the current time."
    )]
    #[serde(default)]
    pub time: Option<EventTimeInput>,

    /// Replacement attendee list.
    #[schemars(
        description = "Replacement attendee list — replaces all current attendees, so include \
                       everyone who should remain. Omit to leave attendees unchanged."
    )]
    #[serde(default)]
    pub attendees: Option<Vec<AttendeeInput>>,

    /// Replacement recurrence properties.
    #[schemars(
        description = "Replacement RFC 5545 recurrence lines. An empty list makes the event \
                       one-off; omit to keep the current recurrence. Only valid with scope \
                       \"all\"."
    )]
    #[serde(default)]
    pub recurrence_lines: Option<Vec<String>>,

    /// Conference change.
    #[schemars(
        description = "Change the event's video conference: \"google_meet\" attaches a fresh \
                       Google Meet, \"remove\" detaches the current conference. Omit to leave \
                       it untouched."
    )]
    #[serde(default)]
    pub conference: Option<ConferenceChangeInput>,

    /// Replacement reminder configuration.
    #[schemars(
        description = "Replacement notification reminders. `useDefault: true` follows the \
                       calendar's own defaults; otherwise `overrides` replaces the whole list \
                       with entries of `method` \"popup\" (a Macro notification) or \"email\" \
                       and `minutes` before the start — an empty list silences the event. \
                       Omit to keep the current reminders."
    )]
    #[serde(default)]
    pub reminders: Option<EventRemindersInput>,

    /// The requester's own RSVP.
    #[schemars(
        description = "Set the user's own response to the invitation: \"accepted\", \
                       \"declined\", or \"tentative\". Omit to leave their response alone."
    )]
    #[serde(default)]
    pub rsvp: Option<RsvpResponseInput>,

    /// Replacement out-of-office decline behavior.
    #[schemars(
        description = "Adjust out-of-office decline behavior; only valid on an event that is \
                       already out of office (its event type cannot be changed). Replaces the \
                       whole block: set `autoDeclineMode` (\"decline_none\", \"decline_all\", \
                       or \"decline_new_only\") and optionally `declineMessage`. Omit to leave \
                       it untouched."
    )]
    #[serde(default)]
    pub out_of_office: Option<OutOfOfficeInput>,
}

impl ToolAnnotated for UpdateCalendarEvent {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Update calendar event");
}

#[async_trait]
impl<M, O> AsyncTool<CalendarToolContext<M, O>> for UpdateCalendarEvent
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    type Output = ToolCalendarEvent;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(
            event_id=%self.event_id,
            scope=?self.scope,
            attendee_count=?self.attendees.as_ref().map(Vec::len),
            rsvp=?self.rsvp,
            "Update calendar event"
        );

        let requester_id = request_context.user_id.to_string();
        let scope = match (self.scope, self.recurrence_id.clone()) {
            (UpdateScopeInput::All, None) => CalendarUpdateScope::All,
            (UpdateScopeInput::ThisEvent, Some(recurrence_id)) => {
                CalendarUpdateScope::ThisEvent { recurrence_id }
            }
            (UpdateScopeInput::ThisEvent, None) => {
                return Err(ToolCallError {
                    description: "A this_event update requires `recurrenceId` — use the \
                                  occurrence's `recurrenceId` from ListCalendarEvents."
                        .to_string(),
                    internal_error: anyhow::Error::from_boxed(
                        rootcause::report!("scoped update without recurrenceId").into_boxed_error(),
                    ),
                });
            }
            // Dropping the key would silently widen a one-occurrence intent
            // to the whole series — exactly the mistake scoping exists to
            // prevent — so make the caller restate what it wants.
            (UpdateScopeInput::All, Some(_)) => {
                return Err(ToolCallError {
                    description: "`recurrenceId` only applies to scope \"this_event\". Pass \
                                  scope \"this_event\" to change that occurrence, or drop \
                                  `recurrenceId` to change the whole series."
                        .to_string(),
                    internal_error: anyhow::Error::from_boxed(
                        rootcause::report!("series update with a recurrenceId").into_boxed_error(),
                    ),
                });
            }
        };
        let patch = CalendarEventPatch {
            title: self.title.clone(),
            description: self.description.clone(),
            location: self.location.clone(),
            time: self.time.clone().map(Into::into),
            attendees: self
                .attendees
                .clone()
                .map(|attendees| attendees.into_iter().map(Into::into).collect()),
            recurrence_lines: self.recurrence_lines.clone(),
            visibility: None,
            transparency: None,
            reminders: self.reminders.clone().map(Into::into),
            conference: self.conference.map(Into::into),
            out_of_office: self.out_of_office.clone().map(Into::into),
        };

        // An RSVP is its own provider call, so a call carrying only one runs
        // only that half. Answering after the patch keeps a replaced attendee
        // list from discarding the response that was just recorded.
        let patched = if patch.is_empty() {
            None
        } else {
            Some(
                service_context
                    .mutations
                    .update_event(&requester_id, self.event_id, patch, scope.clone())
                    .await
                    .map_err(|error| mutation_tool_error("update the calendar event", error))?,
            )
        };

        let event = match self.rsvp {
            Some(rsvp) => {
                let rsvp_scope = match scope {
                    CalendarUpdateScope::All => CalendarRsvpScope::All,
                    CalendarUpdateScope::ThisEvent { recurrence_id } => {
                        CalendarRsvpScope::ThisEvent { recurrence_id }
                    }
                };
                service_context
                    .mutations
                    .respond_to_event(&requester_id, self.event_id, rsvp.into(), rsvp_scope)
                    .await
                    .map_err(|error| {
                        let action = if patched.is_some() {
                            "record the RSVP — the other changes were saved"
                        } else {
                            "record the RSVP"
                        };
                        mutation_tool_error(action, error)
                    })?
            }
            None => patched.ok_or_else(|| ToolCallError {
                description: "This call changes nothing — supply at least one field to update, \
                              or an `rsvp`."
                    .to_string(),
                internal_error: anyhow::Error::from_boxed(
                    rootcause::report!("update without any change").into_boxed_error(),
                ),
            })?,
        };

        Ok(ToolCalendarEvent::from_event(&event))
    }
}
