use async_graphql::{Context, ID, Json, Object, dataloader::DataLoader};
use graphql_common::GraphqlSoupEntityType;
use notification::domain::models::UserNotificationRow;
use serde_json::Value;

use crate::loaders::{EntityNotificationsKey, EntityNotificationsLoader};

/// GraphQL notification attached to a Soup entity.
pub struct GraphqlSoupNotification(UserNotificationRow<serde_json::Value>);

#[Object]
impl GraphqlSoupNotification {
    async fn id(&self) -> ID {
        ID(self.0.notification_id.to_string())
    }

    async fn event_type(&self) -> &str {
        &self.0.notification_event_type
    }

    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::from(self.0.entity.entity_type)
    }

    async fn entity_id(&self) -> &str {
        &self.0.entity.entity_id
    }

    async fn sent(&self) -> bool {
        self.0.sent
    }

    async fn done(&self) -> bool {
        self.0.done
    }

    async fn seen(&self) -> bool {
        self.0.viewed_at.is_some()
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    async fn sender_id(&self) -> Option<String> {
        self.0.sender_id.as_ref().map(|sender| sender.to_string())
    }

    async fn metadata(&self) -> Json<Value> {
        Json(self.0.notification_metadata.clone())
    }
}

/// Load the notifications attached to the given entity via the
/// [`EntityNotificationsLoader`] stored in the GraphQL context.
pub async fn load_entity_notifications(
    ctx: &Context<'_>,
    key: EntityNotificationsKey,
) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
    let loader = ctx.data::<DataLoader<EntityNotificationsLoader>>()?;
    let notifications = loader
        .load_one(key)
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))?
        .unwrap_or_default();
    Ok(notifications
        .into_iter()
        .map(GraphqlSoupNotification)
        .collect())
}
