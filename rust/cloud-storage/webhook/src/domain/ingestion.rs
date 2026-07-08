//! Webhook event ingestion: broker events in, matching webhooks out.
//!
//! [`WebhookEventIngestionService`] is the inbound port driven by broker
//! consumers (see `crate::inbound::kafka_consumer`). It is intentionally
//! separate from [`WebhookService`](super::ports::WebhookService), which is
//! the CRUD surface for webhook creation and edits.
//!
//! Event handling is not implemented yet: every handler below is a stub that
//! only logs the event. The planned flow for each event is:
//! 1. resolve the users that can see the event's entity via
//!    [`EntityAccessService::get_users_by_entity`] (see
//!    [`WebhookEventIngestionServiceImpl::users_with_access`]);
//! 2. load those users' active webhooks and match each webhook's `rule`
//!    against the event;
//! 3. enqueue a delivery for every match.

#[cfg(test)]
mod test;

use channels::domain::broker_events::{
    ChannelCreatedMetadata, ChannelDeletedMetadata, ChannelMessageAttachmentCreatedMetadata,
    ChannelMessageAttachmentRemovedMetadata, ChannelMessageDeletedMetadata,
    ChannelMessagePatchedMetadata, ChannelMessagePostedMetadata, ChannelParticipantAddedMetadata,
    ChannelParticipantRemovedMetadata, ChannelTopicEvent, ChannelUpdatedMetadata,
};
use documents::domain::events::{
    DocumentCopiedMetadata, DocumentCreatedMetadata, DocumentDeletedMetadata, DocumentTopicEvent,
    DocumentUpdatedMetadata,
};
use entity_access::domain::models::{AccessError, EntityType};
use entity_access::domain::ports::EntityAccessService;
use macro_event_broker::Event;
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use std::sync::Arc;
use uuid::Uuid;

/// Webhook event ingestion error.
#[derive(Debug, thiserror::Error)]
pub enum WebhookEventIngestionError {
    /// Failed to resolve the users with access to the event's entity.
    #[error(transparent)]
    EntityAccess(#[from] AccessError),
    /// Repository or adapter error.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl WebhookEventIngestionError {
    /// Whether retrying the same event could plausibly succeed.
    ///
    /// Database errors from access resolution are transient: the lookup can be
    /// retried once the database recovers, and the consumer holds off on
    /// committing the event's offset until it does. Everything else — invalid
    /// entity ids, unauthorized lookups, adapter bugs — is permanent, and
    /// retrying would only repeat the failure.
    pub fn is_transient(&self) -> bool {
        match self {
            Self::EntityAccess(AccessError::DatabaseError(_)) => true,
            Self::EntityAccess(_) | Self::Internal(_) => false,
        }
    }
}

/// Inbound port for ingesting broker events for webhook delivery.
///
/// One method per subscribed topic; each takes the decoded event envelope so
/// implementations keep the `event_id` for delivery idempotency.
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
pub struct WebhookEventIngestionServiceImpl<A> {
    entity_access_service: Arc<A>,
}

impl<A> WebhookEventIngestionServiceImpl<A> {
    /// Create a webhook event ingestion service.
    pub fn new(entity_access_service: Arc<A>) -> Self {
        Self {
            entity_access_service,
        }
    }
}

impl<A: EntityAccessService> WebhookEventIngestionServiceImpl<A> {
    /// Resolve the users that currently have access to an entity.
    ///
    /// This is the first step of webhook fan-out: the handlers below will use
    /// it to find the users whose webhooks should be matched against an event.
    #[tracing::instrument(skip(self), err)]
    pub async fn users_with_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, WebhookEventIngestionError> {
        tracing::trace!(entity_id, ?entity_type, "resolving users with access");
        let users = self
            .entity_access_service
            .get_users_by_entity(entity_id, entity_type)
            .await?;
        tracing::trace!(
            entity_id,
            user_count = users.len(),
            "resolved users with access"
        );
        Ok(users)
    }

    async fn handle_document_created(
        &self,
        event_id: Uuid,
        metadata: DocumentCreatedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            document_id = %metadata.document_id,
            "document.created: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_document_updated(
        &self,
        event_id: Uuid,
        metadata: DocumentUpdatedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            document_id = %metadata.document_id,
            "document.updated: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_document_deleted(
        &self,
        event_id: Uuid,
        metadata: DocumentDeletedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            document_id = %metadata.document_id,
            "document.deleted: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_document_copied(
        &self,
        event_id: Uuid,
        metadata: DocumentCopiedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            document_id = %metadata.document_id,
            source_document_id = %metadata.source_document_id,
            "document.copied: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_created(
        &self,
        event_id: Uuid,
        metadata: ChannelCreatedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            "channel.created: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_updated(
        &self,
        event_id: Uuid,
        metadata: ChannelUpdatedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            "channel.updated: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_deleted(
        &self,
        event_id: Uuid,
        metadata: ChannelDeletedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            "channel.deleted: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_message_posted(
        &self,
        event_id: Uuid,
        metadata: ChannelMessagePostedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            message_id = %metadata.message_id,
            "channel.message_posted: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_message_patched(
        &self,
        event_id: Uuid,
        metadata: ChannelMessagePatchedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            message_id = %metadata.message_id,
            "channel.message_patched: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_message_deleted(
        &self,
        event_id: Uuid,
        metadata: ChannelMessageDeletedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            message_id = %metadata.message_id,
            "channel.message_deleted: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_message_attachment_created(
        &self,
        event_id: Uuid,
        metadata: ChannelMessageAttachmentCreatedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            message_id = %metadata.message_id,
            "channel.message_attachment_created: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_message_attachment_removed(
        &self,
        event_id: Uuid,
        metadata: ChannelMessageAttachmentRemovedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            message_id = %metadata.message_id,
            "channel.message_attachment_removed: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_participant_added(
        &self,
        event_id: Uuid,
        metadata: ChannelParticipantAddedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            "channel.participant_added: webhook ingestion not implemented yet"
        );
        Ok(())
    }

    async fn handle_channel_participant_removed(
        &self,
        event_id: Uuid,
        metadata: ChannelParticipantRemovedMetadata,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::debug!(
            %event_id,
            channel_id = %metadata.channel_id,
            "channel.participant_removed: webhook ingestion not implemented yet"
        );
        Ok(())
    }
}

impl<A: EntityAccessService> WebhookEventIngestionService for WebhookEventIngestionServiceImpl<A> {
    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_document_event(
        &self,
        event: Event<DocumentTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::trace!(?event, "ingesting document event");
        let event_id = event.event_id;
        match event.event {
            DocumentTopicEvent::Created(metadata) => {
                self.handle_document_created(event_id, metadata).await
            }
            DocumentTopicEvent::Updated(metadata) => {
                self.handle_document_updated(event_id, metadata).await
            }
            DocumentTopicEvent::Deleted(metadata) => {
                self.handle_document_deleted(event_id, metadata).await
            }
            DocumentTopicEvent::Copied(metadata) => {
                self.handle_document_copied(event_id, metadata).await
            }
        }
    }

    #[tracing::instrument(skip(self, event), fields(event_id = %event.event_id), err)]
    async fn ingest_channel_event(
        &self,
        event: Event<ChannelTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        tracing::trace!(?event, "ingesting channel event");
        let event_id = event.event_id;
        match event.event {
            ChannelTopicEvent::Created(metadata) => {
                self.handle_channel_created(event_id, metadata).await
            }
            ChannelTopicEvent::Updated(metadata) => {
                self.handle_channel_updated(event_id, metadata).await
            }
            ChannelTopicEvent::Deleted(metadata) => {
                self.handle_channel_deleted(event_id, metadata).await
            }
            ChannelTopicEvent::MessagePosted(metadata) => {
                self.handle_channel_message_posted(event_id, metadata).await
            }
            ChannelTopicEvent::MessagePatched(metadata) => {
                self.handle_channel_message_patched(event_id, metadata)
                    .await
            }
            ChannelTopicEvent::MessageDeleted(metadata) => {
                self.handle_channel_message_deleted(event_id, metadata)
                    .await
            }
            ChannelTopicEvent::MessageAttachmentCreated(metadata) => {
                self.handle_channel_message_attachment_created(event_id, metadata)
                    .await
            }
            ChannelTopicEvent::MessageAttachmentRemoved(metadata) => {
                self.handle_channel_message_attachment_removed(event_id, metadata)
                    .await
            }
            ChannelTopicEvent::ParticipantAdded(metadata) => {
                self.handle_channel_participant_added(event_id, metadata)
                    .await
            }
            ChannelTopicEvent::ParticipantRemoved(metadata) => {
                self.handle_channel_participant_removed(event_id, metadata)
                    .await
            }
        }
    }
}
