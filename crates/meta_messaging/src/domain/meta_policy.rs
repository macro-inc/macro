//! WhatsApp and Instagram domain rules, independent of transport credentials.

use super::{
    connection::Connection,
    events::{Direction, IncomingMessage},
    models::{MessagingError, Provenance, Provider},
    policy::{ReplyMode, SendAuthority},
};
use chrono::{DateTime, Duration, Utc};

/// Current standard reply duration for both implemented Meta products.
pub(super) const STANDARD_REPLY_WINDOW: Duration = Duration::hours(24);
/// Instagram's explicitly approved human-support extension.
pub(super) const HUMAN_SUPPORT_WINDOW: Duration = Duration::days(7);

pub mod media;
#[cfg(test)]
mod test;

/// Server-observed reply-window facts. Echoes and history never update this.
#[derive(Debug, Clone)]
pub struct ReplyWindow {
    /// Official API of the sending account.
    pub provider: Provider,
    /// Whether access and the account subscription are currently usable.
    pub connected: bool,
    /// Latest eligible customer message, taking max across reordered arrivals.
    pub last_customer_message_at: Option<DateTime<Utc>>,
    /// Instagram HUMAN_AGENT permission was verified for this connection.
    pub human_agent_approved: bool,
}

/// Verify policy again immediately before dispatch, including queued sends that
/// cross the boundary. Template status/parameters are verified by the provider
/// port; user permission and account binding are verified by the service.
pub fn authorize_send(
    window: &ReplyWindow,
    authority: SendAuthority,
    mode: ReplyMode,
    now: DateTime<Utc>,
) -> Result<(), MessagingError> {
    if authority == SendAuthority::DraftOnly {
        return Err(MessagingError::Forbidden);
    }
    if !window.connected {
        return Err(MessagingError::Disconnected);
    }
    let age = window.last_customer_message_at.map(|t| now - t);
    // Future timestamps are not evidence of an open window.
    let within = |limit| age.is_some_and(|age| age >= Duration::zero() && age < limit);
    match (window.provider, mode) {
        (Provider::Whatsapp, ReplyMode::ApprovedTemplate) => Ok(()),
        (Provider::Whatsapp, ReplyMode::FreeForm) if within(STANDARD_REPLY_WINDOW) => Ok(()),
        (Provider::Whatsapp, ReplyMode::FreeForm) => Err(MessagingError::TemplateRequired),
        (Provider::Whatsapp, ReplyMode::HumanSupport) => Err(MessagingError::Invalid(
            "human support tags are available only for Instagram",
        )),
        (Provider::Instagram, ReplyMode::FreeForm) if within(STANDARD_REPLY_WINDOW) => Ok(()),
        (Provider::Instagram, ReplyMode::FreeForm) => Err(MessagingError::ReplyWindowClosed),
        (Provider::Instagram, ReplyMode::HumanSupport) => {
            if authority != SendAuthority::Human || !window.human_agent_approved {
                return Err(MessagingError::HumanSupportRequired);
            }
            if !within(HUMAN_SUPPORT_WINDOW) {
                return Err(MessagingError::ReplyWindowClosed);
            }
            Ok(())
        }
        (Provider::Instagram, ReplyMode::ApprovedTemplate) => Err(MessagingError::Invalid(
            "WhatsApp templates cannot be sent through Instagram",
        )),
    }
}

/// A live customer fact may only advance the current authorization generation's window.
pub fn customer_window_until(
    connection: &Connection,
    message: &IncomingMessage,
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    (message.provenance == Provenance::Customer
        && message.direction == Direction::Inbound
        && message.message_type != "deleted"
        && connection
            .connected_at
            .is_some_and(|at| message.timestamp.timestamp() >= at.timestamp())
        && message.timestamp <= now + Duration::minutes(1))
    .then(|| message.timestamp + STANDARD_REPLY_WINDOW)
}
