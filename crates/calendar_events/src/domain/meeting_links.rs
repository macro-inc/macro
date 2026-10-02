//! Macro meeting links carried by calendar events.
//!
//! A Macro call is not provider conferencing: Google knows nothing about it,
//! so the link travels in the event's ordinary location and description
//! fields, in the exact shape the calendar UI recognizes and can later
//! strip or replace. This module owns that shape and the create flow that
//! mints a meeting and writes the event carrying it.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{
    models::{CalendarEvent, CalendarEventDraft, EventTime},
    ports::{CalendarMutationError, CalendarMutationService, MeetingLinkProvider},
};

/// Inputs for minting a Macro meeting to accompany a calendar event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeetingLinkRequest {
    /// Display title, normally the event title. Adapters trim it to the
    /// meeting provider's limits and fall back to its default when blank.
    pub title: String,
    /// Scheduled start, or `None` for an event without clock times.
    pub scheduled_start: Option<DateTime<Utc>>,
    /// Scheduled end, or `None` for an event without clock times.
    pub scheduled_end: Option<DateTime<Utc>>,
}

impl MeetingLinkRequest {
    /// The meeting a draft event should carry: same title, and the same
    /// clock times when the event has them. All-day events leave the
    /// meeting unscheduled, exactly as the calendar UI does.
    pub fn for_draft(draft: &CalendarEventDraft) -> Self {
        let (scheduled_start, scheduled_end) = match &draft.time {
            EventTime::Timed {
                starts_at, ends_at, ..
            } => (Some(*starts_at), Some(*ends_at)),
            EventTime::AllDay { .. } => (None, None),
        };
        Self {
            title: draft.title.clone(),
            scheduled_start,
            scheduled_end,
        }
    }
}

/// A minted Macro meeting invitation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeetingLink {
    /// Persistent meeting identifier, used to cancel the meeting again.
    pub id: Uuid,
    /// Browser URL anyone invited can open to join the call.
    pub url: String,
}

/// Failures minting or cancelling a Macro meeting link.
#[derive(Debug, thiserror::Error)]
pub enum MeetingLinkError {
    /// The meeting provider rejected the request as malformed.
    #[error("invalid meeting link request: {0}")]
    InvalidInput(String),
    /// The host cannot mint meeting links at all.
    #[error("Macro meeting links are not available in this host")]
    Unavailable,
    /// The meeting provider failed; the calendar event was not written.
    #[error("meeting link provider failed: {0}")]
    Failed(String),
}

/// Failures creating an event that carries a Macro call.
#[derive(Debug, thiserror::Error)]
pub enum CreateEventWithMacroCallError {
    /// The calendar write failed. Any meeting minted for it was cancelled
    /// on a best-effort basis.
    #[error(transparent)]
    Calendar(#[from] CalendarMutationError),
    /// The meeting link could not be minted; nothing was written to the
    /// calendar.
    #[error("could not create the Macro call for the event: {0}")]
    MeetingLink(#[from] MeetingLinkError),
}

/// Text prefixing the generated join line. The calendar UI matches on it
/// to recognize the paragraph as generated rather than user-written.
const JOIN_LINE_LABEL: &str = "Join Macro call";

/// Write a meeting link into an event's location and description.
///
/// The description gains a trailing paragraph naming the call; the location
/// becomes the link only when the user supplied no physical location, so a
/// room is never overwritten. Both mirror the calendar UI's own attachment,
/// which is what lets it later find, strip, or replace the link.
pub fn attach_macro_call(
    description: Option<&str>,
    location: Option<&str>,
    url: &str,
) -> (String, String) {
    let description = description.unwrap_or_default();
    let separator = if description.is_empty() { "" } else { "\n" };
    let description =
        format!("{description}{separator}<p>{JOIN_LINE_LABEL}: <a href=\"{url}\">{url}</a></p>");
    let location = match location.map(str::trim) {
        Some(location) if !location.is_empty() => location.to_string(),
        _ => url.to_string(),
    };
    (description, location)
}

/// Create an event that carries a Macro call.
///
/// The meeting is minted first so the single invitation attendees receive
/// already names the call, instead of an invitation followed by an update.
/// A failed calendar write cancels the fresh meeting on a best-effort basis
/// so it does not linger in the user's meeting list.
#[tracing::instrument(skip_all, err)]
pub async fn create_event_with_macro_call<M, L>(
    mutations: &M,
    meeting_links: &L,
    requester_id: &str,
    email_link_id: Option<Uuid>,
    calendar_id: Option<Uuid>,
    mut draft: CalendarEventDraft,
) -> Result<CalendarEvent, CreateEventWithMacroCallError>
where
    M: CalendarMutationService,
    L: MeetingLinkProvider,
{
    if draft.out_of_office.is_some() {
        return Err(CalendarMutationError::InvalidInput(
            "out-of-office events cannot have a Macro call".to_string(),
        )
        .into());
    }
    if draft.conference.is_some() {
        return Err(CalendarMutationError::InvalidInput(
            "an event carries either a Macro call or provider conferencing, not both".to_string(),
        )
        .into());
    }

    let link = meeting_links
        .create_meeting_link(requester_id, MeetingLinkRequest::for_draft(&draft))
        .await?;
    let (description, location) = attach_macro_call(
        draft.description.as_deref(),
        draft.location.as_deref(),
        &link.url,
    );
    draft.description = Some(description);
    draft.location = Some(location);

    match mutations
        .create_event(requester_id, email_link_id, calendar_id, draft)
        .await
    {
        Ok(event) => Ok(event),
        Err(error) => {
            if let Err(cancel_error) = meeting_links
                .cancel_meeting_link(requester_id, link.id)
                .await
            {
                tracing::warn!(
                    error = ?cancel_error,
                    meeting_id = %link.id,
                    "failed to cancel the meeting minted for an event that was not created"
                );
            }
            Err(error.into())
        }
    }
}

#[cfg(test)]
mod test;
