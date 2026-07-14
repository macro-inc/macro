//! Webhook event ingestion: broker events in, matching queue messages out.
//!
//! `WebhookEventIngestionService` is the inbound port driven by broker
//! consumers (see `crate::inbound::kafka_consumer`). It is intentionally
//! separate from `WebhookService`, which is the CRUD surface for webhook
//! creation and edits.

#[cfg(test)]
mod test;

use crate::domain::{
    models::{NormalizedWebhookEvent, WebhookEventQueueMessage},
    ports::{WebhookEventEnqueuer, WebhookRepo, WebhookWorkspaceResolver},
};
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
    /// Access resolution currently maps some PostgreSQL failures to
    /// [`AccessError::Internal`], so that variant remains retryable alongside
    /// explicit database, repository, workspace-resolution, and queue errors.
    /// Invalid broker contracts are permanent and can be safely skipped.
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            Self::EntityAccess(AccessError::DatabaseError(_) | AccessError::Internal)
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
            match_count = tracing::field::Empty,
        ),
        err
    )]
    async fn ingest_normalized_event(
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

fn normalized_document_event(
    event: &Event<DocumentTopicEvent>,
) -> Result<NormalizedWebhookEvent, WebhookEventIngestionError> {
    let (event_name, entity_id) = match &event.event {
        DocumentTopicEvent::Created(metadata) => ("document.created", &metadata.document_id),
        DocumentTopicEvent::Updated(metadata) => ("document.updated", &metadata.document_id),
        DocumentTopicEvent::Deleted(metadata) => ("document.deleted", &metadata.document_id),
        DocumentTopicEvent::Copied(metadata) => ("document.copied", &metadata.document_id),
    };

    if Uuid::parse_str(entity_id).is_err() {
        return Err(WebhookEventIngestionError::InvalidEntityId {
            entity_type: DOCUMENT_ENTITY_TYPE,
            entity_id: entity_id.clone(),
        });
    }

    let broker_envelope = serde_json::to_value(event)?;
    Ok(normalized_event(
        event.event_id,
        event.schema_version,
        event_name,
        DOCUMENT_ENTITY_TYPE,
        entity_id,
        broker_envelope,
    ))
}

fn normalized_channel_event(
    event: &Event<ChannelTopicEvent>,
) -> Result<NormalizedWebhookEvent, WebhookEventIngestionError> {
    let (event_name, channel_id) = match &event.event {
        ChannelTopicEvent::Created(metadata) => ("channel.created", metadata.channel_id),
        ChannelTopicEvent::Updated(metadata) => ("channel.updated", metadata.channel_id),
        ChannelTopicEvent::Deleted(metadata) => ("channel.deleted", metadata.channel_id),
        ChannelTopicEvent::MessagePosted(metadata) => {
            ("channel.message_posted", metadata.channel_id)
        }
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
        let event = normalized_document_event(&event)?;
        self.ingest_normalized_event(event, EntityType::Document)
            .await
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_channel_event(
        &self,
        event: Event<ChannelTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        let event = normalized_channel_event(&event)?;
        self.ingest_normalized_event(event, EntityType::Channel)
            .await
    }
}
