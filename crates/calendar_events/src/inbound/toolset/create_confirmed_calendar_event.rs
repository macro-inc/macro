//! `CreateConfirmedCalendarEvent`: [`CreateCalendarEvent`] without the
//! review, for a host that has nothing to review in.
//!
//! `CreateCalendarEvent` defers: it returns `PendingUserExecution` and a host
//! finishes it - the chat composer after the turn, or a review-card
//! elicitation in an agent-session turn. A prompt read out of a channel or
//! document thread has neither surface, so the agent asks in prose there, the
//! user answers in the thread, and this tool creates on that answer. Every
//! host gets both tools; the prompt, not the toolset, says which to reach for.
//!
//! The event is always floated first. Being told to schedule something is a
//! request to draft the event, not permission to create it, so the agent
//! writes the event into the thread and stops; only the user's reply to that
//! draft authorizes the create. An instruction detailed enough to create from
//! is still only a draft request - the point is that nothing lands on a
//! calendar, or in a guest's inbox, before the user has seen it.
//!
//! The gate is `userConfirmation`: the model must quote that approving reply
//! to call this. That is a cheap first pass, deliberately - it makes the
//! model produce evidence rather than create silently, and the requirement is
//! self-documenting in the schema - but nothing here checks the quote against
//! the thread, so it is not a guarantee. The same trade-off as
//! `SendConfirmedEmail`, and the same place a session-scoped proposal state
//! would tighten it.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

use super::create_calendar_event::CreateCalendarEvent;
use super::{CalendarToolContext, ToolCalendarEvent};
use crate::domain::ports::{CalendarMutationService, CalendarOccurrenceService};

/// Create a calendar event the user has already approved in conversation.
///
/// The fields are [`CreateCalendarEvent`]'s, flattened, plus the
/// confirmation; the creation is [`CreateCalendarEvent`]'s too. The two tools
/// differ in whether a host reviews the call, not in what a create is.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "CreateConfirmedCalendarEvent",
    description = "Create a calendar event immediately, with no review card or composer. Only for a prompt that came from a channel or document thread (the context block says so), where there is nothing to review a draft in. The event is always shown before it is created, even when the user's request already spelled the whole thing out: in one turn write it into the thread - title, date and time with its time zone, duration, guests, location, Google Meet, recurrence - ask whether to create it, and stop there. Call this tool only in a later turn, once the user has replied approving that specific event, quoting that reply verbatim in userConfirmation. Being asked to schedule something is a request to draft the event, never approval to create it, so a userConfirmation quoting the request that asked you to set it up - rather than the reply approving the event you wrote out - is wrong. Never call it in the agent session view or in chat: use CreateCalendarEvent there, whose review card or composer is the confirmation. Takes the same fields as CreateCalendarEvent; the event is written to Google Calendar at once and any attendees receive invitations."
)]
#[serde(rename_all = "camelCase")]
pub struct CreateConfirmedCalendarEvent {
    /// The event, exactly as `CreateCalendarEvent` takes it.
    #[serde(flatten)]
    pub event: CreateCalendarEvent,
    /// The user's own words approving this create.
    #[schemars(
        description = "The user's own message approving this specific event, quoted verbatim - for example their \"yes, go ahead\" in reply to the event you wrote out for them. It is a reply to your draft, never the earlier request that asked you to schedule something: if the user has not yet seen this event, there is nothing to quote here and the tool must not be called. Required: do not paraphrase it, and never supply it yourself."
    )]
    pub user_confirmation: String,
}

impl ToolAnnotated for CreateConfirmedCalendarEvent {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Create confirmed calendar event").with_open_world();
}

#[async_trait]
impl<M, O> AsyncTool<CalendarToolContext<M, O>> for CreateConfirmedCalendarEvent
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
        // The schema makes the field required, so a call gets here with one;
        // a blank one is the model going through the motions, and is refused
        // the same way a missing one would be.
        if self.user_confirmation.trim().is_empty() {
            return Err(ToolCallError {
                description: "CreateConfirmedCalendarEvent requires the user's own message approving this event in userConfirmation. Describe the event in prose, ask whether to create it, and call this tool only after they say yes.".to_owned(),
                internal_error: anyhow::anyhow!(
                    "CreateConfirmedCalendarEvent called without a confirmation"
                ),
            });
        }
        self.event.call(service_context, request_context).await
    }
}
