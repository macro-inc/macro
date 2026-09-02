//! Webhook event ingestion: broker events in, matching queue messages out.
//!
//! `WebhookEventIngestionService` is the inbound port driven by broker
//! consumers (see `crate::inbound::kafka_consumer`). It is intentionally
//! separate from `WebhookService`, which is the CRUD surface for webhook
//! creation and edits.

#[cfg(feature = "stream")]
pub(crate) mod stream;
#[cfg(test)]
mod test;

use crate::domain::{
    events::WebhookTopicEvent,
    models::{NormalizedWebhookEvent, WebhookEventQueueMessage},
    ports::{WebhookEventEnqueuer, WebhookRepo, WebhookWorkspaceResolver},
};
use agent_trigger::domain::broker_events::AgentTriggerTopicEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use chrono::Utc;
use documents::domain::events::DocumentTopicEvent;
use entity_access::domain::models::{AccessError, EntityType};
use entity_access::domain::ports::EntityAccessService;
use futures::future::join_all;
use macro_event_broker::Event;
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use std::sync::Arc;
use tracing::Instrument as _;
use uuid::Uuid;

const DOCUMENT_ENTITY_TYPE: &str = "document";
const CHANNEL_ENTITY_TYPE: &str = "channel";
const WEBHOOK_ENTITY_TYPE: &str = "webhook";

/// Webhook event ingestion error.
#[derive(Debug, thiserror::Error)]
pub enum WebhookEventIngestionError {
    /// Failed to resolve the users with access to the event's entity.
    #[error(transparent)]
    EntityAccess(#[from] AccessError),
    /// The event's entity identifier violates the broker contract.
    #[error("invalid {entity_type} entity id: {entity_id}")]
    InvalidEntityId {
        /// Contract entity type.
        entity_type: &'static str,
        /// Invalid entity identifier.
        entity_id: String,
    },
    /// The broker envelope could not be represented by the queue contract.
    #[error("failed to serialize broker envelope: {0}")]
    Serialization(#[from] serde_json::Error),
    /// Failed to resolve personal and team webhook workspaces.
    #[error("failed to resolve webhook workspaces: {0}")]
    WorkspaceResolution(#[source] anyhow::Error),
    /// Failed to find active webhooks matching the event.
    #[error("failed to match active webhooks: {0}")]
    Repository(#[source] anyhow::Error),
    /// Failed to enqueue at least one matched webhook event.
    #[error("failed to enqueue webhook event: {0}")]
    Enqueue(#[source] anyhow::Error),
}

impl WebhookEventIngestionError {
    /// Whether retrying the same event could plausibly succeed.
    ///
    /// Access resolution classifies failures at the database boundary:
    /// [`AccessError::Unavailable`] is a connection-level or retryable
    /// Postgres failure, while [`AccessError::Internal`] is a bug or bad
    /// data that retrying cannot fix. Invalid broker contracts are
    /// permanent and can be safely skipped.
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            Self::EntityAccess(AccessError::Unavailable(_))
                | Self::WorkspaceResolution(_)
                | Self::Repository(_)
                | Self::Enqueue(_)
        )
    }
}

/// Inbound port for ingesting broker events for webhook delivery.
///
/// One method per subscribed topic; each takes the decoded event envelope so
/// implementations retain the `event_id` and complete original payload.
pub trait WebhookEventIngestionService: Clone + Send + Sync + 'static {
    /// Ingest one `macro.documents` event envelope.
    fn ingest_document_event(
        &self,
        event: Event<DocumentTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.channels` event envelope.
    fn ingest_channel_event(
        &self,
        event: Event<ChannelTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.webhooks` event envelope.
    fn ingest_webhook_event(
        &self,
        event: Event<WebhookTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;

    /// Ingest one `macro.agent_sessions` event envelope.
    fn ingest_agent_trigger_event(
        &self,
        event: Event<AgentTriggerTopicEvent>,
    ) -> impl Future<Output = Result<(), WebhookEventIngestionError>> + Send;
}

/// Webhook event ingestion service implementation.
#[derive(Clone)]
pub struct WebhookEventIngestionServiceImpl<A, R, Q> {
    entity_access_service: Arc<A>,
    repository: R,
    enqueuer: Q,
}

impl<A, R, Q> WebhookEventIngestionServiceImpl<A, R, Q> {
    /// Create a webhook event ingestion service.
    pub fn new(entity_access_service: Arc<A>, repository: R, enqueuer: Q) -> Self {
        Self {
            entity_access_service,
            repository,
            enqueuer,
        }
    }
}

impl<A, R, Q> WebhookEventIngestionServiceImpl<A, R, Q>
where
    A: EntityAccessService,
    R: WebhookRepo + WebhookWorkspaceResolver,
    Q: WebhookEventEnqueuer,
{
    /// Resolve the users that currently have access to an entity.
    #[tracing::instrument(skip(self), err)]
    pub async fn users_with_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, WebhookEventIngestionError> {
        self.entity_access_service
            .get_users_by_entity(entity_id, entity_type)
            .await
            .map_err(WebhookEventIngestionError::EntityAccess)
    }

    #[tracing::instrument(
        skip_all,
        fields(
            event_id = %event.event_id,
            event_name = %event.event_name,
            entity_type = %event.entity_type,
            entity_id = %event.entity_id,
            accessor_count = tracing::field::Empty,
            workspace_count = tracing::field::Empty,
        ),
        err
    )]
    async fn resolve_entity_access_and_enqueue(
        &self,
        event: NormalizedWebhookEvent,
        entity_type: EntityType,
    ) -> Result<(), WebhookEventIngestionError> {
        let accessors = self
            .users_with_access(&event.entity_id, entity_type)
            .await?;
        tracing::Span::current().record("accessor_count", accessors.len());

        let workspace_ids = self
            .repository
            .resolve_workspace_ids(accessors)
            .await
            .map_err(|error| WebhookEventIngestionError::WorkspaceResolution(error.into()))?;
        tracing::Span::current().record("workspace_count", workspace_ids.len());

        self.match_and_enqueue(event, workspace_ids).await
    }

    #[tracing::instrument(
        skip_all,
        fields(
            event_id = %event.event_id,
            event_name = %event.event_name,
            entity_type = %event.entity_type,
            entity_id = %event.entity_id,
            workspace_count = workspace_ids.len(),
            match_count = tracing::field::Empty,
        ),
        err
    )]
    async fn match_and_enqueue(
        &self,
        event: NormalizedWebhookEvent,
        workspace_ids: Vec<String>,
    ) -> Result<(), WebhookEventIngestionError> {
        let webhooks = self
            .repository
            .list_active_webhooks_matching_event(
                workspace_ids,
                event.event_name.clone(),
                event.entity_id.clone(),
            )
            .await
            .map_err(|error| WebhookEventIngestionError::Repository(error.into()))?;
        tracing::Span::current().record("match_count", webhooks.len());
        self.enqueue_all(webhooks, event).await
    }

    async fn enqueue_all(
        &self,
        webhooks: Vec<crate::domain::models::Webhook>,
        event: NormalizedWebhookEvent,
    ) -> Result<(), WebhookEventIngestionError> {
        let enqueue_results = join_all(webhooks.into_iter().map(|webhook| {
            let enqueuer = self.enqueuer.clone();
            let webhook_id = webhook.id;
            let message = WebhookEventQueueMessage::new(webhook_id.clone(), event.clone());
            async move {
                enqueuer
                    .enqueue(message)
                    .instrument(tracing::info_span!("enqueue_webhook_event", %webhook_id))
                    .await
                    .map_err(Into::into)
            }
        }))
        .await;

        for result in enqueue_results {
            result.map_err(WebhookEventIngestionError::Enqueue)?;
        }

        Ok(())
    }
}

pub(crate) fn normalized_document_event(
    event: &Event<DocumentTopicEvent>,
) -> Result<Option<NormalizedWebhookEvent>, WebhookEventIngestionError> {
    let (event_name, entity_id) = match &event.event {
        DocumentTopicEvent::Created(metadata) => ("document.created", &metadata.document_id),
        DocumentTopicEvent::Updated(metadata) => ("document.updated", &metadata.document_id),
        DocumentTopicEvent::Deleted(metadata) => ("document.deleted", &metadata.document_id),
        DocumentTopicEvent::Copied(metadata) => ("document.copied", &metadata.document_id),
        DocumentTopicEvent::Interaction(metadata) => {
            ("document.interaction", &metadata.document_id)
        }
        DocumentTopicEvent::ContentUploaded(_)
        | DocumentTopicEvent::SyncContentUpdated(_)
        | DocumentTopicEvent::Purged(_) => return Ok(None),
    };

    if Uuid::parse_str(entity_id).is_err() {
        return Err(WebhookEventIngestionError::InvalidEntityId {
            entity_type: DOCUMENT_ENTITY_TYPE,
            entity_id: entity_id.clone(),
        });
    }

    let broker_envelope = serde_json::to_value(event)?;
    Ok(Some(normalized_event(
        event.event_id,
        event.schema_version,
        event_name,
        DOCUMENT_ENTITY_TYPE,
        entity_id,
        broker_envelope,
    )))
}

pub(crate) fn normalized_channel_event(
    event: &Event<ChannelTopicEvent>,
) -> Result<NormalizedWebhookEvent, WebhookEventIngestionError> {
    let (event_name, channel_id) = match &event.event {
        ChannelTopicEvent::Created(metadata) => ("channel.created", metadata.channel_id),
        ChannelTopicEvent::Updated(metadata) => ("channel.updated", metadata.channel_id),
        ChannelTopicEvent::Deleted(metadata) => ("channel.deleted", metadata.channel_id),
        ChannelTopicEvent::MessagePosted(metadata) => {
            ("channel.message_posted", metadata.channel_id)
        }
        ChannelTopicEvent::Mentioned(metadata) => ("channel.mentioned", metadata.channel_id),
        ChannelTopicEvent::MessagePatched(metadata) => {
            ("channel.message_patched", metadata.channel_id)
        }
        ChannelTopicEvent::MessageDeleted(metadata) => {
            ("channel.message_deleted", metadata.channel_id)
        }
        ChannelTopicEvent::MessageAttachmentCreated(metadata) => {
            ("channel.message_attachment_created", metadata.channel_id)
        }
        ChannelTopicEvent::MessageAttachmentRemoved(metadata) => {
            ("channel.message_attachment_removed", metadata.channel_id)
        }
        ChannelTopicEvent::ParticipantAdded(metadata) => {
            ("channel.participant_added", metadata.channel_id)
        }
        ChannelTopicEvent::ParticipantRemoved(metadata) => {
            ("channel.participant_removed", metadata.channel_id)
        }
    };
    let entity_id = channel_id.to_string();

    let broker_envelope = serde_json::to_value(event)?;
    Ok(normalized_event(
        event.event_id,
        event.schema_version,
        event_name,
        CHANNEL_ENTITY_TYPE,
        &entity_id,
        broker_envelope,
    ))
}

pub(crate) fn normalized_webhook_event(
    event: &Event<WebhookTopicEvent>,
) -> Result<(NormalizedWebhookEvent, String), WebhookEventIngestionError> {
    let (event_name, webhook_id, workspace_id) = match &event.event {
        WebhookTopicEvent::Created(metadata) => (
            "webhook.created",
            &metadata.webhook_id,
            &metadata.workspace_id,
        ),
        WebhookTopicEvent::Updated(metadata) => (
            "webhook.updated",
            &metadata.webhook_id,
            &metadata.workspace_id,
        ),
        WebhookTopicEvent::Deleted(metadata) => (
            "webhook.deleted",
            &metadata.webhook_id,
            &metadata.workspace_id,
        ),
        WebhookTopicEvent::Validated(metadata) => (
            "webhook.validated",
            &metadata.webhook_id,
            &metadata.workspace_id,
        ),
    };

    if webhook_id.is_empty() || !webhook_id.starts_with("wh_") {
        return Err(WebhookEventIngestionError::InvalidEntityId {
            entity_type: WEBHOOK_ENTITY_TYPE,
            entity_id: webhook_id.clone(),
        });
    }

    let broker_envelope = serde_json::to_value(event)?;
    let normalized = normalized_event(
        event.event_id,
        event.schema_version,
        event_name,
        WEBHOOK_ENTITY_TYPE,
        webhook_id,
        broker_envelope,
    );
    Ok((normalized, workspace_id.clone()))
}

fn normalized_event(
    event_id: Uuid,
    schema_version: u8,
    event_name: &str,
    entity_type: &str,
    entity_id: &str,
    broker_envelope: serde_json::Value,
) -> NormalizedWebhookEvent {
    NormalizedWebhookEvent {
        event_id: event_id.to_string(),
        schema_version,
        event_name: event_name.to_string(),
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
        ordering_key: entity_id.to_string(),
        occurred_at: Utc::now(),
        broker_envelope,
    }
}

/// Whose access decides who may see one trigger event.
///
/// Not the bot the event names: that is what a subscriber filters on, and a
/// bot is not an entity anyone holds access to.
pub(crate) struct TriggerAudience {
    pub(crate) entity_id: String,
    pub(crate) entity_type: EntityType,
}

/// Normalize one agent-trigger event.
///
/// The entity - and the ordering key, mirroring the broker's partitioning -
/// is the bot: a subscriber consumes a bot's whole trigger stream, in order.
/// Returned alongside is whose access gates it, which differs by shape.
///
/// A mention that opens a session has no session yet, so the channel it was
/// posted in is the only thing to ask. Once a session exists it carries its
/// own grants - its owner, and the channel it came from - so the session is
/// the authoritative audience, and whatever channel a later message happened
/// to land in is incidental to it.
pub(crate) fn normalized_agent_trigger_event(
    event: &Event<AgentTriggerTopicEvent>,
) -> Result<(NormalizedWebhookEvent, TriggerAudience), WebhookEventIngestionError> {
    use agent_trigger::domain::broker_events::{
        AgentTriggerEventName, ExistingAgentSessionEvent, NewAgentSessionEvent,
    };

    let (bot_id, audience) = match &event.event {
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => (
            mentioned.bot_id,
            TriggerAudience {
                entity_id: mentioned.message.channel_id.to_string(),
                entity_type: EntityType::Channel,
            },
        ),
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(metadata)) => (
            metadata.bot_id,
            TriggerAudience {
                entity_id: metadata.session_id.to_string(),
                entity_type: EntityType::AgentSession,
            },
        ),
        // Both trigger enums are non-exhaustive on purpose; an unknown shape
        // has no bot to route to. Permanent, so the consumer skips it.
        _ => {
            return Err(WebhookEventIngestionError::InvalidEntityId {
                entity_type: "bot",
                entity_id: "unrecognized agent-trigger event shape".to_owned(),
            });
        }
    };
    let event_name: &'static str = AgentTriggerEventName::from(&event.event).into();
    let broker_envelope = serde_json::to_value(event)?;
    let bot_id = bot_id.to_string();
    Ok((
        normalized_event(
            event.event_id,
            event.schema_version,
            event_name,
            "bot",
            &bot_id,
            broker_envelope,
        ),
        audience,
    ))
}

impl<A, R, Q> WebhookEventIngestionService for WebhookEventIngestionServiceImpl<A, R, Q>
where
    A: EntityAccessService,
    R: WebhookRepo + WebhookWorkspaceResolver,
    Q: WebhookEventEnqueuer,
{
    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_document_event(
        &self,
        event: Event<DocumentTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        let Some(event) = normalized_document_event(&event)? else {
            return Ok(());
        };
        self.resolve_entity_access_and_enqueue(event, EntityType::Document)
            .await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_channel_event(
        &self,
        event: Event<ChannelTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        let event = normalized_channel_event(&event)?;
        self.resolve_entity_access_and_enqueue(event, EntityType::Channel)
            .await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_webhook_event(
        &self,
        event: Event<WebhookTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        let (event, workspace_id) = normalized_webhook_event(&event)?;
        self.match_and_enqueue(event, vec![workspace_id]).await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_agent_trigger_event(
        &self,
        event: Event<AgentTriggerTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        let (event, audience) = normalized_agent_trigger_event(&event)?;
        let accessors = self
            .users_with_access(&audience.entity_id, audience.entity_type)
            .await?;
        let workspace_ids = self
            .repository
            .resolve_workspace_ids(accessors)
            .await
            .map_err(|error| WebhookEventIngestionError::WorkspaceResolution(error.into()))?;
        self.match_and_enqueue(event, workspace_ids).await
    }
}
