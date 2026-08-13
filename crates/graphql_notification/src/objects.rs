use std::sync::Arc;

use async_graphql::{Context, ID, Object, dataloader::DataLoader};
use graphql_common::GraphqlSoupEntityType;
use model_notifications::NotifEvent;
use notification::domain::models::UserNotificationRow;

#[cfg(test)]
mod test;

use crate::{
    GraphqlNotifEvent,
    loaders::{EntityNotificationsLoader, SoupNotificationEdgeReader},
};

/// GraphQL notification attached to a Soup entity.
pub struct GraphqlNotification(Arc<UserNotificationRow<NotifEvent>>);

impl From<UserNotificationRow<NotifEvent>> for GraphqlNotification {
    fn from(value: UserNotificationRow<NotifEvent>) -> Self {
        Self(Arc::new(value))
    }
}

impl From<Arc<UserNotificationRow<NotifEvent>>> for GraphqlNotification {
    fn from(value: Arc<UserNotificationRow<NotifEvent>>) -> Self {
        Self(value)
    }
}

impl TryFrom<UserNotificationRow<serde_json::Value>> for GraphqlNotification {
    type Error = serde_json::Error;

    fn try_from(value: UserNotificationRow<serde_json::Value>) -> Result<Self, Self::Error> {
        value
            .into_tagged()
            .deserialize_metadata()
            .map(GraphqlNotification::from)
    }
}

/// A notification associated with a Soup entity.
#[Object]
impl GraphqlNotification {
    /// The notification identifier.
    async fn id(&self) -> ID {
        ID(self.0.notification_id.to_string())
    }

    /// The event that produced the notification.
    async fn event_type(&self) -> &str {
        &self.0.notification_event_type
    }

    /// The type of the associated entity.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::new(self.0.entity.entity_type)
    }

    /// The identifier of the associated entity.
    async fn entity_id(&self) -> &str {
        &self.0.entity.entity_id
    }

    /// Whether the notification has been sent.
    async fn sent(&self) -> bool {
        self.0.sent
    }

    /// Whether notification processing is complete.
    async fn done(&self) -> bool {
        self.0.done
    }

    /// Whether the recipient has seen the notification.
    async fn seen(&self) -> bool {
        self.0.viewed_at.is_some()
    }

    /// The notification creation time in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The time the notification was viewed, in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    /// The notification's last update time in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// The identifier of the user who triggered the notification.
    async fn sender_id(&self) -> Option<String> {
        self.0.sender_id.as_ref().map(|sender| sender.to_string())
    }

    /// Typed event-specific notification metadata.
    async fn metadata(&self) -> GraphqlNotifEvent {
        self.0.notification_metadata.clone().into()
    }
}

/// Load the notifications attached to the given entity via the
/// [`EntityNotificationsLoader`] stored in the GraphQL context.
pub async fn load_entity_notifications<'a, R>(
    ctx: &'a Context<'a>,
    entity: model_entity::Entity<'static>,
) -> async_graphql::Result<Vec<GraphqlNotification>>
where
    R: SoupNotificationEdgeReader,
{
    let loader = ctx.data::<DataLoader<EntityNotificationsLoader<R>>>()?;
    let notifications = loader
        .load_one(model_entity::OwnedEntity::from(entity))
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to load entity notifications");
            async_graphql::Error::new("notifications are unavailable")
        })?
        .unwrap_or_default();
    Ok(notifications
        .into_iter()
        .map(GraphqlNotification::from)
        .collect())
}
