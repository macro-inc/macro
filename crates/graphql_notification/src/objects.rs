use async_graphql::{Context, ID, Json, Object, dataloader::DataLoader};
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
pub struct GraphqlSoupNotification(UserNotificationRow<serde_json::Value>);

impl From<UserNotificationRow<serde_json::Value>> for GraphqlSoupNotification {
    fn from(value: UserNotificationRow<serde_json::Value>) -> Self {
        Self(value)
    }
}

impl GraphqlSoupNotification {
    /// Converts a recipient-scoped realtime payload into the shared notification GraphQL type.
    pub(crate) fn from_realtime(
        owner_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        value: notification::domain::models::queue_message::RealtimeNotif<NotifEvent>,
    ) -> Self {
        let notification::domain::models::queue_message::RealtimeNotif {
            notification_id,
            notification_event_type,
            entity,
            sent,
            done,
            created_at,
            viewed_at,
            updated_at,
            deleted_at,
            notification_metadata,
            sender_id,
        } = value;
        let mut tagged = serde_json::to_value(notification_metadata).unwrap_or_else(|error| {
            tracing::error!(
                error = ?error,
                "failed to serialize realtime notification metadata"
            );
            serde_json::Value::Null
        });
        let notification_metadata = tagged
            .get_mut("content")
            .map(serde_json::Value::take)
            .unwrap_or(serde_json::Value::Null);

        Self(UserNotificationRow {
            owner_id,
            notification_id,
            notification_event_type,
            entity,
            sent,
            done,
            created_at,
            viewed_at,
            updated_at,
            deleted_at,
            notification_metadata,
            sender_id,
        })
    }
}

/// A notification associated with a Soup entity.
#[Object]
impl GraphqlSoupNotification {
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

    /// Raw event-specific notification metadata.
    #[graphql(deprecation = "Use typedMetadata with union inline fragments")]
    async fn metadata(&self) -> Json<&serde_json::Value> {
        Json(&self.0.notification_metadata)
    }

    /// Typed event-specific notification metadata.
    async fn typed_metadata(&self) -> async_graphql::Result<Option<GraphqlNotifEvent>> {
        self.0
            .deserialize_metadata_ref::<NotifEvent>()
            .map(|metadata| Some(metadata.into()))
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    "failed to deserialize notification metadata"
                );
                async_graphql::Error::new("notification metadata is unavailable")
            })
    }
}

/// Load the notifications attached to the given entity via the
/// [`EntityNotificationsLoader`] stored in the GraphQL context.
pub async fn load_entity_notifications<'a, R>(
    ctx: &'a Context<'a>,
    entity: model_entity::Entity<'static>,
) -> async_graphql::Result<Vec<GraphqlSoupNotification>>
where
    R: SoupNotificationEdgeReader,
{
    let loader = ctx.data::<DataLoader<EntityNotificationsLoader<R>>>()?;
    let notifications = loader
        .load_one(model_entity::OwnedEntity::from(entity))
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))?
        .unwrap_or_default();
    Ok(notifications
        .into_iter()
        .map(GraphqlSoupNotification)
        .collect())
}
