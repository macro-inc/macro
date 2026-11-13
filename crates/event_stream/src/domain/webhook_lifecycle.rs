//! Kafka event models for the `macro.webhooks` topic.
//!
//! Published by the webhook crate; defined here because the public event
//! log and webhook ingestion both decode every public topic, and this crate
//! sits below the webhook crate.
//!
//! Lifecycle events contain sanitized webhook configuration metadata. Signing
//! secrets and custom-header values are deliberately excluded from every
//! payload.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroWebhooksTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::filters::WebhookFilters;

/// Prefix every webhook id carries.
const WEBHOOK_ID_PREFIX: &str = "wh_";

/// Metadata for [`WebhookTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebhookCreatedMetadata {
    /// Identifier of the created webhook.
    pub webhook_id: String,
    /// Identifier of the workspace that owns the webhook.
    pub workspace_id: String,
    /// Caller-chosen namespace, unique among the workspace's webhooks.
    ///
    /// Defaults to an empty string when decoding schema-version-1 payloads
    /// persisted before namespaces existed; serialized payloads always
    /// include it.
    #[serde(default)]
    pub namespace: String,
    /// Authenticated user who created the webhook.
    pub created_by_user_id: MacroUserIdStr<'static>,
    /// Display name of the webhook.
    pub name: String,
    /// URL that receives webhook deliveries.
    pub endpoint_url: String,
    /// Lifecycle status of the webhook.
    pub status: WebhookStatus,
    /// Whether the endpoint configuration has passed validation.
    pub is_valid: bool,
    /// Event and entity filters configured for the webhook.
    pub filters: WebhookFilters,
    /// Names of configured custom headers, with their values omitted.
    pub header_names: Vec<String>,
    /// Creation timestamp reported by the repository.
    pub created_at: DateTime<Utc>,
}

/// Metadata for [`WebhookTopicEvent::Updated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebhookUpdatedMetadata {
    /// Identifier of the updated webhook.
    pub webhook_id: String,
    /// Identifier of the workspace that owns the webhook.
    pub workspace_id: String,
    /// Authenticated user who updated the webhook.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// Requested display name, or `None` when the PATCH omitted it.
    pub name: Option<String>,
    /// Requested endpoint URL, or `None` when the PATCH omitted it.
    pub endpoint_url: Option<String>,
    /// Requested event filters, or `None` when the PATCH omitted them.
    pub filters: Option<WebhookFilters>,
    /// Whether the PATCH replaced custom headers; names and values are omitted.
    pub headers_updated: bool,
    /// Requested lifecycle status, or `None` when the PATCH omitted it.
    pub status: Option<WebhookStatus>,
    /// Lifecycle status before the update, present when `status` is present.
    pub previous_status: Option<WebhookStatus>,
    /// Whether the final endpoint configuration has passed validation.
    pub is_valid: bool,
    /// Update timestamp reported by the repository after the final mutation.
    pub updated_at: DateTime<Utc>,
}

/// Metadata for [`WebhookTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebhookDeletedMetadata {
    /// Identifier of the deleted webhook.
    pub webhook_id: String,
    /// Identifier of the workspace that owned the webhook.
    pub workspace_id: String,
    /// Authenticated user who deleted the webhook.
    pub actor_user_id: MacroUserIdStr<'static>,
}

/// Metadata for [`WebhookTopicEvent::Validated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebhookValidatedMetadata {
    /// Identifier of the validated webhook.
    pub webhook_id: String,
    /// Identifier of the workspace that owns the webhook.
    pub workspace_id: String,
    /// Authenticated user who requested validation.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// Persisted endpoint validation outcome.
    pub is_valid: bool,
    /// HTTP status returned by the endpoint, when it responded.
    pub response_status: Option<u16>,
    /// Sanitized validation result message, when available.
    pub message: Option<String>,
}

/// Lifecycle events published to [`MacroWebhooksTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum WebhookTopicEvent {
    /// A webhook was created.
    #[serde(rename = "webhook.created")]
    Created(WebhookCreatedMetadata),
    /// A webhook configuration was updated.
    #[serde(rename = "webhook.updated")]
    Updated(WebhookUpdatedMetadata),
    /// A webhook was soft-deleted.
    #[serde(rename = "webhook.deleted")]
    Deleted(WebhookDeletedMetadata),
    /// A webhook endpoint validation completed.
    #[serde(rename = "webhook.validated")]
    Validated(WebhookValidatedMetadata),
}

impl TopicEvent for WebhookTopicEvent {
    type Topic = MacroWebhooksTopic;

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = Self;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, Exposure, ExposureError, PublicEntityType, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        let (name, webhook_id, workspace_id) = match self {
            Self::Created(metadata) => (
                "webhook.created",
                &metadata.webhook_id,
                &metadata.workspace_id,
            ),
            Self::Updated(metadata) => (
                "webhook.updated",
                &metadata.webhook_id,
                &metadata.workspace_id,
            ),
            Self::Deleted(metadata) => (
                "webhook.deleted",
                &metadata.webhook_id,
                &metadata.workspace_id,
            ),
            Self::Validated(metadata) => (
                "webhook.validated",
                &metadata.webhook_id,
                &metadata.workspace_id,
            ),
        };
        if !webhook_id.starts_with(WEBHOOK_ID_PREFIX) {
            return Err(ExposureError::InvalidEntityId {
                entity_type: PublicEntityType::Webhook.as_str(),
                entity_id: webhook_id.clone(),
            });
        }
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(PublicEntityType::Webhook, webhook_id.clone()),
            // Only the owning workspace, never entity accessors.
            audience: Audience::Workspace {
                workspace_id: workspace_id.clone(),
            },
            stage: Stage::Stable,
            payload: Cow::Borrowed(self),
        }))
    }
}

/// Publishable lifecycle event for [`MacroWebhooksTopic`], keyed by webhook id.
pub struct WebhookMacroEvent {
    key: String,
    event: Event<WebhookTopicEvent>,
}

impl WebhookMacroEvent {
    /// Build a created event keyed by the created webhook id.
    pub fn created(key: impl Into<String>, metadata: WebhookCreatedMetadata) -> Self {
        Self::new(key, WebhookTopicEvent::Created(metadata))
    }

    /// Build an updated event keyed by the updated webhook id.
    pub fn updated(key: impl Into<String>, metadata: WebhookUpdatedMetadata) -> Self {
        Self::new(key, WebhookTopicEvent::Updated(metadata))
    }

    /// Build a deleted event keyed by the deleted webhook id.
    pub fn deleted(key: impl Into<String>, metadata: WebhookDeletedMetadata) -> Self {
        Self::new(key, WebhookTopicEvent::Deleted(metadata))
    }

    /// Build a validated event keyed by the validated webhook id.
    pub fn validated(key: impl Into<String>, metadata: WebhookValidatedMetadata) -> Self {
        Self::new(key, WebhookTopicEvent::Validated(metadata))
    }

    /// Build an event from a topic-specific lifecycle event.
    pub fn new(key: impl Into<String>, event: WebhookTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<WebhookTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for WebhookMacroEvent {
    type EventPayload = WebhookTopicEvent;

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

/// Webhook lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum WebhookStatus {
    /// Webhook is active and eligible for delivery once validated.
    Active,
    /// Webhook is paused and should not receive deliveries.
    Paused,
    /// Webhook was disabled by the system.
    Disabled,
}

impl WebhookStatus {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Disabled => "disabled",
        }
    }
}

impl std::str::FromStr for WebhookStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "disabled" => Ok(Self::Disabled),
            other => Err(format!("unknown webhook status: {other}")),
        }
    }
}
