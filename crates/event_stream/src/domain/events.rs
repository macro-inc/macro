//! Who receives the events this crate publishes outside Macro, and in what
//! shape: the access of webhook lifecycle events ([`WebhookTopicEvent`]).

use crate::domain::webhook_lifecycle::WebhookTopicEvent;
use macro_event_broker::access::EventAccess;

impl EventAccess for WebhookTopicEvent {
    type PublicPayload = Self;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{
            Access, AccessError, Audience, EntityRef, PublicEntityType, PublicEvent, Stage,
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
            return Err(AccessError::InvalidEntityId {
                entity_type: PublicEntityType::Webhook.as_str(),
                entity_id: webhook_id.clone(),
            });
        }
        Ok(Access::Public(PublicEvent {
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

/// Prefix every webhook id carries.
const WEBHOOK_ID_PREFIX: &str = "wh_";
