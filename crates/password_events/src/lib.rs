#![deny(missing_docs)]
//! Kafka event models for the `macro.passwords` topic: committed vault facts
//! addressed to one account. Events carry opaque ids only and grant nothing.

#[cfg(test)]
mod test;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroPasswordsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// How an agent's access request was resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum AccessRequestResolution {
    /// Granted with standing approval.
    Approved,
    /// Denied.
    Denied,
    /// Approved, then revoked.
    Revoked,
}

/// Metadata for [`PasswordTopicEvent::AccessRequestResolved`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct AccessRequestResolvedMetadata {
    /// Agent account the event is addressed to; routing only, removed
    /// before delivery.
    pub recipient_user_id: MacroUserIdStr<'static>,
    /// Team owning the item.
    pub team_id: Uuid,
    /// Requested item.
    pub item_id: Uuid,
    /// Resolved request.
    pub request_id: Uuid,
    /// Resolution.
    pub status: AccessRequestResolution,
}

/// Events that can be published to [`MacroPasswordsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum PasswordTopicEvent {
    /// An authorized human resolved, or revoked, an agent's access request.
    #[serde(rename = "passwords.access_request.resolved")]
    AccessRequestResolved(AccessRequestResolvedMetadata),
}

impl TopicEvent for PasswordTopicEvent {
    type Topic = MacroPasswordsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroPasswordsTopic`], keyed by the addressed user.
pub struct PasswordMacroEvent {
    key: String,
    event: Event<PasswordTopicEvent>,
}

impl PasswordMacroEvent {
    /// Build a resolution event with an explicit envelope id, so a redelivered
    /// outbox entry keeps its identity.
    pub fn access_request_resolved(
        event_id: Uuid,
        metadata: AccessRequestResolvedMetadata,
    ) -> Self {
        let mut event = Event::new(PasswordTopicEvent::AccessRequestResolved(metadata.clone()));
        event.event_id = event_id;
        Self::with_event(metadata.recipient_user_id.as_ref().to_string(), event)
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<PasswordTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for PasswordMacroEvent {
    type EventPayload = PasswordTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
