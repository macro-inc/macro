//! Webhook lifecycle events (`macro.webhooks`) and the public event union.
//!
//! The lifecycle event types live in `event_stream` with every other public
//! topic; they are re-exported here for the webhook service that publishes
//! them.

pub use event_stream::domain::webhook_lifecycle::{
    WebhookCreatedMetadata, WebhookDeletedMetadata, WebhookMacroEvent, WebhookTopicEvent,
    WebhookUpdatedMetadata, WebhookValidatedMetadata,
};

/// The public event union delivered by webhook and stream, generated from
/// the event registry in `event_stream::domain::catalog`.
#[cfg(feature = "inbound")]
pub use event_stream::domain::catalog::WebhookEvent;
