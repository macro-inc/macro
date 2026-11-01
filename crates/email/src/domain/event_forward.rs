//! Forward one of the viewer's calendar events by email, as a guest whose
//! organizer does not let them add guests forwards the invitation instead,
//! sent from the inbox that holds their copy. Both kinds carry the copy's
//! join link, since a forward deliberately invites the people it goes to.
//!
//! The calendar decides the kind from the copy
//! ([`CalendarEventForwardKind`]):
//!
//! - An organizer outside Google: Google keeps such an invitation as a
//!   private copy and offers its own Add guests there as a forward, so this
//!   sends what that does: a real invitation (`METHOD:REQUEST`) naming the
//!   recipients as attendees, as the message's calendar body, addressed to
//!   them and to the organizer, as Google addresses its own. Recipients
//!   answer it to the organizer with Yes, Maybe or No; the forwarder's own
//!   copy and answer are untouched.
//! - Anything else, notably a Google organizer who turned inviting off: the
//!   shared-event file (`METHOD:PUBLISH`) naming no attendees, so a
//!   recipient can add the event to their own calendar but has nothing to
//!   answer, nothing reaches the organizer, and the guest list stays as the
//!   organizer keeps it. A Macro recipient sees it as a shared event with
//!   Add to calendar ([`super::invitation_import`]).

#[cfg(test)]
mod test;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use calendar_events::domain::{
    ics::{CalendarEventForwardKind, IcsParticipant},
    ports::CalendarEventForwardSource,
};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use uuid::Uuid;

use super::{
    models::{
        ContactInfo, CreateDraftInput, CreatedDraft, EmailErr, SendingInboxRequest,
        SourcedAttachment,
    },
    ports::{EmailFileSendService, SendingInboxResolver},
};

/// The most people one forward goes to.
pub const MAX_FORWARD_RECIPIENTS: usize = 50;

/// The type the event file is attached with, as Forward by email attaches it.
const ICS_CONTENT_TYPE: &str = "text/calendar";

/// The type of an invitation's calendar body, which makes it answerable.
const INVITATION_BODY_CONTENT_TYPE: &str = "text/calendar; method=REQUEST";

/// The type and name of the copy of the invitation attached for clients
/// that read only attachments, as Google's own invitations attach it.
const INVITATION_FILE_CONTENT_TYPE: &str = "application/ics";
const INVITATION_FILE_NAME: &str = "invite.ics";

/// Ends a forwarded event file's body: what the recipient can do with it.
const EVENT_FILE_NOTE: &str = "This invitation was forwarded to you. Add the event to your \
                               calendar from the attached file. You won't be on the \
                               organizer's guest list.";

/// Ends a forwarded invitation's body: who hears the recipient's answer.
const INVITATION_NOTE: &str =
    "This invitation was forwarded to you. Your answer goes to the organizer.";

/// What a forward sends besides the event.
#[derive(Debug, Clone)]
pub struct EventForwardRequest {
    /// The people it goes to.
    pub to: Vec<ContactInfo>,
    /// The plain-text summary of the event the body opens with; the title
    /// when absent. A note saying what the recipient can do follows it.
    pub body_text: Option<String>,
}

/// Why a forward was not sent.
#[derive(Debug, thiserror::Error)]
pub enum EventForwardError {
    /// The event is unknown, cancelled, or not held through one of the
    /// requester's own inboxes.
    #[error("event not found")]
    NotFound,
    /// The recipients are missing, too many, or not email addresses.
    #[error("{0}")]
    InvalidRecipients(&'static str),
    /// The inbox holding the copy cannot send for the requester.
    #[error("the inbox holding this event cannot send email")]
    InboxUnavailable,
    /// The send failed.
    #[error(transparent)]
    Email(EmailErr),
    /// Reading the event failed.
    #[error("failed to read the event")]
    Internal(rootcause::Report),
}

impl EventForwardError {
    fn outcome(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::InvalidRecipients(_) => "invalid_recipients",
            Self::InboxUnavailable => "inbox_unavailable",
            Self::Email(_) | Self::Internal(_) => "failed",
        }
    }
}

/// Send `event_id` to the requested people from the inbox holding the
/// actor's copy of it, as an invitation or the shared-event file, whichever
/// the copy allows. The send is queued like any other, so it leaves after
/// the usual undo delay.
#[tracing::instrument(
    name = "email.forward_calendar_event",
    skip(calendar, email, sender, actor, request),
    fields(%event_id, recipient_count = request.to.len(), link_id, kind, outcome),
    err
)]
pub async fn forward_event<C, E, F>(
    calendar: &C,
    email: &E,
    sender: &F,
    actor: MacroUserIdStr<'static>,
    event_id: Uuid,
    request: EventForwardRequest,
) -> Result<CreatedDraft, EventForwardError>
where
    C: CalendarEventForwardSource,
    E: SendingInboxResolver,
    F: EmailFileSendService,
{
    let result = send_forward(calendar, email, sender, actor, event_id, request).await;
    let span = tracing::Span::current();
    match &result {
        Ok(sent) => {
            span.record("link_id", tracing::field::display(sent.link_id));
            span.record("outcome", "sent");
        }
        Err(error) => {
            span.record("outcome", error.outcome());
        }
    }
    result
}

async fn send_forward<C, E, F>(
    calendar: &C,
    email: &E,
    sender: &F,
    actor: MacroUserIdStr<'static>,
    event_id: Uuid,
    request: EventForwardRequest,
) -> Result<CreatedDraft, EventForwardError>
where
    C: CalendarEventForwardSource,
    E: SendingInboxResolver,
    F: EmailFileSendService,
{
    let to = recipients(request.to)?;
    let invitees: Vec<IcsParticipant> = to
        .iter()
        .map(|contact| IcsParticipant {
            email: contact.email.clone(),
            name: contact.name.clone().filter(|name| !name.trim().is_empty()),
        })
        .collect();
    let forward = calendar
        .event_forward(&actor.to_string(), event_id, &invitees)
        .await
        .map_err(EventForwardError::Internal)?
        .ok_or(EventForwardError::NotFound)?;
    tracing::Span::current().record("kind", forward.kind.as_str());
    let inbox = email
        .resolve_sending_inbox(
            actor.clone(),
            SendingInboxRequest {
                requested_address: Some(&forward.inbox),
                replying_to_id: None,
            },
        )
        .await
        .map_err(|error| match error {
            EmailErr::InboxNotFound | EmailErr::UnknownSendingInbox { .. } => {
                EventForwardError::InboxUnavailable
            }
            other => EventForwardError::Email(other),
        })?;

    let title = match forward.ics.title.trim() {
        "" => "Untitled event",
        title => title,
    };
    let document = forward.ics.document.into_bytes();
    let (note, to, files) = match forward.kind {
        CalendarEventForwardKind::EventFile => (
            EVENT_FILE_NOTE,
            to,
            vec![SourcedAttachment {
                file_name: format!("{}.ics", file_stem(title)),
                content_type: ICS_CONTENT_TYPE.to_owned(),
                bytes: document,
                is_inline: false,
            }],
        ),
        CalendarEventForwardKind::Invitation { organizer } => (
            INVITATION_NOTE,
            with_organizer(to, organizer),
            vec![
                SourcedAttachment {
                    file_name: INVITATION_FILE_NAME.to_owned(),
                    content_type: INVITATION_BODY_CONTENT_TYPE.to_owned(),
                    bytes: document.clone(),
                    is_inline: true,
                },
                SourcedAttachment {
                    file_name: INVITATION_FILE_NAME.to_owned(),
                    content_type: INVITATION_FILE_CONTENT_TYPE.to_owned(),
                    bytes: document,
                    is_inline: false,
                },
            ],
        ),
    };
    let summary = request
        .body_text
        .filter(|body| !body.trim().is_empty())
        .unwrap_or_else(|| title.to_owned());
    let body_text = format!("{}\n\n{note}", summary.trim_end());
    let input = CreateDraftInput {
        frozen_signature_html: None,
        draft_generation: 0,
        sender_email: None,
        db_id: None,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: None,
        subject: title.to_owned(),
        to,
        cc: Vec::new(),
        bcc: Vec::new(),
        body_html: Some(URL_SAFE_NO_PAD.encode(text_html(&body_text))),
        body_text: Some(body_text),
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: None,
        actor: Some(actor),
        draft_client_binding: None,
        thread_client_binding: None,
    };
    sender
        .send_message_with_files(&inbox.link, &inbox.accessible_inboxes, input, files)
        .await
        .map_err(EventForwardError::Email)
}

/// The recipients followed by the organizer, who gets the answers, as
/// Google addresses its own forward; an organizer already among the
/// recipients is not added twice.
fn with_organizer(mut to: Vec<ContactInfo>, organizer: IcsParticipant) -> Vec<ContactInfo> {
    if !to
        .iter()
        .any(|contact| contact.email.eq_ignore_ascii_case(&organizer.email))
    {
        to.push(ContactInfo {
            email: organizer.email,
            name: organizer.name,
            photo_url: None,
        });
    }
    to
}

/// The requested recipients as valid, distinct addresses, in the order given.
fn recipients(requested: Vec<ContactInfo>) -> Result<Vec<ContactInfo>, EventForwardError> {
    let mut seen = std::collections::HashSet::new();
    let mut to = Vec::with_capacity(requested.len());
    for contact in requested {
        let email = contact.email.trim().to_owned();
        EmailStr::parse_from_str(&email).map_err(|_| {
            EventForwardError::InvalidRecipients("a recipient is not an email address")
        })?;
        if seen.insert(email.to_lowercase()) {
            to.push(ContactInfo { email, ..contact });
        }
    }
    if to.is_empty() {
        return Err(EventForwardError::InvalidRecipients(
            "choose at least one person to forward the invitation to",
        ));
    }
    if to.len() > MAX_FORWARD_RECIPIENTS {
        return Err(EventForwardError::InvalidRecipients(
            "an invitation can be forwarded to at most 50 people at once",
        ));
    }
    Ok(to)
}

/// The plain body as HTML: escaped, one line per line.
fn text_html(text: &str) -> String {
    let mut html = String::with_capacity(text.len() + 16);
    html.push_str("<div>");
    for character in text.chars() {
        match character {
            '&' => html.push_str("&amp;"),
            '<' => html.push_str("&lt;"),
            '>' => html.push_str("&gt;"),
            '"' => html.push_str("&quot;"),
            '\n' => html.push_str("<br>"),
            '\r' => {}
            other => html.push(other),
        }
    }
    html.push_str("</div>");
    html
}

/// The title as a file name: no path separators or control characters.
fn file_stem(title: &str) -> String {
    title
        .chars()
        .map(|character| match character {
            '/' | '\\' => '-',
            character if character.is_control() => ' ',
            character => character,
        })
        .collect()
}
