//! Core domain models for cal.com webhook processing.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use thiserror::Error;

/// A validated cal.com webhook event.
///
/// Produced by [`crate::domain::ports::CalWebhookService::validate_webhook_event`]
/// after signature verification and JSON parsing.
#[derive(Debug, Clone)]
pub enum CalWebhookEvent {
    /// A new booking was created.
    BookingCreated(BookingCreated),
}

/// Payload for the `BOOKING_CREATED` cal.com webhook event.
///
/// This mirrors the fields cal.com actually sends; fields we don't yet use are
/// omitted rather than stubbed so they can be added deliberately.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingCreated {
    /// Unique identifier for the booking (uuid-like string from cal.com).
    pub uid: String,
    /// Numeric booking id from cal.com.
    pub booking_id: Option<u64>,
    /// Title of the booking (e.g. "30 Min Meeting between A and B").
    pub title: String,
    /// Start time of the booking.
    pub start_time: DateTime<Utc>,
    /// End time of the booking.
    pub end_time: DateTime<Utc>,
    /// Event type id configured in cal.com (i.e. which meeting template).
    pub event_type_id: Option<u64>,
    /// The organizer of the booking (the cal.com user who owns the event type).
    pub organizer: CalContact,
    /// People invited to the booking.
    #[serde(default)]
    pub attendees: Vec<CalContact>,
    /// Optional location string (zoom link, address, etc.).
    pub location: Option<String>,
    /// Free-form metadata forwarded from the booking URL or embed config.
    ///
    /// We stash browser-side Meta attribution signals here (`fbp`, `fbc`,
    /// `user_agent`) so the server-side Lead event can include them in
    /// `user_data` when it fires.
    ///
    /// Typed as `serde_json::Value` rather than `String` because cal.com
    /// documents this field as a JSON object with provider-specific data
    /// (e.g. `videoCallUrl`) — values aren't guaranteed to be strings.
    /// Downstream consumers narrow per-key with `v.as_str()`.
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// A cal.com contact — used for both organizers and attendees.
#[derive(Debug, Clone, Deserialize)]
pub struct CalContact {
    /// Contact email address.
    pub email: String,
    /// Display name, if cal.com provided one.
    #[serde(default)]
    pub name: Option<String>,
    /// IANA time zone string (e.g. `"America/New_York"`).
    #[serde(default, rename = "timeZone")]
    pub time_zone: Option<String>,
}

/// The raw top-level envelope cal.com posts for every webhook.
///
/// We deserialize into this first, then route on [`CalTriggerEvent`] to
/// produce the strongly-typed [`CalWebhookEvent`].
#[derive(Debug, Clone, Deserialize)]
pub struct CalWebhookEnvelope {
    /// The event type cal.com is notifying us about.
    #[serde(rename = "triggerEvent")]
    pub trigger_event: String,
    /// The event payload. Shape varies per `triggerEvent`.
    pub payload: serde_json::Value,
}

/// Supported cal.com trigger events.
///
/// Unknown events are preserved as-is so callers can log + skip without
/// failing deserialization.
#[derive(Debug, Clone)]
pub enum CalTriggerEvent {
    /// `BOOKING_CREATED`.
    BookingCreated,
    /// Any trigger event this crate does not yet handle.
    Unsupported(String),
}

impl CalTriggerEvent {
    /// Parse the cal.com `triggerEvent` string.
    pub fn parse(raw: &str) -> Self {
        match raw {
            "BOOKING_CREATED" => Self::BookingCreated,
            other => Self::Unsupported(other.to_string()),
        }
    }
}

/// Errors returned by the cal.com domain.
#[derive(Debug, Error)]
pub enum CalError {
    /// The `X-Cal-Signature-256` header was missing, malformed, or did not
    /// match the computed HMAC.
    #[error("invalid webhook signature")]
    InvalidWebhookSignature,
    /// The webhook body was not valid JSON matching the expected shape.
    #[error("invalid webhook payload")]
    InvalidPayload,
    /// The webhook was structurally valid but we do not handle its event type.
    #[error("unsupported cal trigger event: {0}")]
    UnsupportedEvent(String),
    /// An internal error occurred (analytics sink failure, unexpected state).
    #[error("internal cal error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for CalError {
    fn from(report: rootcause::Report) -> Self {
        CalError::Internal(report)
    }
}
