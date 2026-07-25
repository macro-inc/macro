use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::{
    UserNotificationRow,
    request::{NotificationEntityRef, NotificationItemType},
};
use rootcause::markers::{Cloneable, Dynamic};

/// Tests for notification entity mapping and batching.
#[cfg(test)]
mod test;

/// Map a shared entity type to the notification domain's item type.
///
/// Some Soup entities, such as CRM companies, do not have a corresponding
/// notification type. Those entities have an empty notification edge rather
/// than failing the whole DataLoader batch.
fn notification_item_type(entity_type: model_entity::EntityType) -> Option<NotificationItemType> {
    use model_entity::EntityType;
    match entity_type {
        EntityType::EmailThread => Some(NotificationItemType::Email),
        EntityType::ChannelMessage => Some(NotificationItemType::Message),
        EntityType::Channel => Some(NotificationItemType::Channel),
        EntityType::Document => Some(NotificationItemType::Document),
        EntityType::Project => Some(NotificationItemType::Project),
        EntityType::Chat => Some(NotificationItemType::Chat),
        EntityType::Call => Some(NotificationItemType::Call),
        EntityType::ForeignEntity => Some(NotificationItemType::Github),
        EntityType::User
        | EntityType::Team
        | EntityType::StaticFile
        | EntityType::CrmCompany
        | EntityType::CrmContact => None,
    }
}

/// Build notification-service references for the subset of entities that can
/// own notifications.
fn notification_refs(
    keys: &[model_entity::Entity<'static>],
) -> Vec<(model_entity::Entity<'static>, NotificationEntityRef)> {
    keys.iter()
        .filter_map(|key| {
            let entity_type = notification_item_type(key.entity_type)?;
            Some((
                key.clone(),
                NotificationEntityRef {
                    entity_type,
                    id: key.entity_id.to_string(),
                },
            ))
        })
        .collect()
}

/// Reader used by GraphQL notification edges.
pub trait SoupNotificationEdgeReader: Send + Sync + 'static {
    /// Load notifications for the requested entity keys.
    fn get_notifications<'a>(
        &'a self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<model_entity::Entity<'static>>,
    ) -> impl Future<
        Output = Result<
            HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>,
            rootcause::Report,
        >,
    > + Send
    + 'a;
}

impl<T> SoupNotificationEdgeReader for Arc<T>
where
    T: notification::domain::service::NotificationReader,
{
    async fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<model_entity::Entity<'static>>,
    ) -> Result<
        HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    > {
        let mut result = keys
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect::<HashMap<_, _>>();

        let requested_refs = notification_refs(&keys);
        if requested_refs.is_empty() {
            return Ok(result);
        }

        let entity_refs = requested_refs
            .iter()
            .map(|(_, entity_ref)| entity_ref.clone())
            .collect();

        let notifications_by_entity = self
            .get_entity_notifications_batch(user_id, entity_refs)
            .await
            .map_err(|err| rootcause::report!(err))?;

        for (original_key, entity_ref) in requested_refs {
            if let Some(notifications) = notifications_by_entity.get(&entity_ref) {
                result.insert(original_key, notifications.clone());
            }
        }

        Ok(result)
    }
}

/// Notification reader used by schema-only GraphQL construction.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpSoupNotificationEdgeReader;

impl SoupNotificationEdgeReader for NoOpSoupNotificationEdgeReader {
    async fn get_notifications(
        &self,
        _user_id: MacroUserIdStr<'static>,
        keys: Vec<model_entity::Entity<'static>>,
    ) -> Result<
        HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    > {
        Ok(keys.iter().map(|key| (key.clone(), Vec::new())).collect())
    }
}

/// DataLoader for entity notification edges.
pub struct EntityNotificationsLoader<R> {
    /// User whose notifications are loaded.
    user_id: MacroUserIdStr<'static>,
    /// Notification reader used to fulfill batches.
    reader: R,
}

impl<R> EntityNotificationsLoader<R> {
    /// Create a new entity notifications DataLoader.
    pub fn new(user_id: MacroUserIdStr<'static>, reader: R) -> Self {
        Self { user_id, reader }
    }
}

impl<R> Loader<model_entity::OwnedEntity> for EntityNotificationsLoader<R>
where
    R: SoupNotificationEdgeReader,
{
    type Value = Vec<UserNotificationRow<serde_json::Value>>;
    type Error = rootcause::Report<Dynamic, Cloneable>;

    async fn load(
        &self,
        keys: &[model_entity::OwnedEntity],
    ) -> Result<HashMap<model_entity::OwnedEntity, Self::Value>, Self::Error> {
        let entities = keys
            .iter()
            .map(|key| key.as_entity().clone())
            .collect::<Vec<_>>();
        let loaded = self
            .reader
            .get_notifications(self.user_id.clone(), entities)
            .await
            .map_err(|error| error.into_cloneable())?;

        Ok(keys
            .iter()
            .cloned()
            .map(|key| {
                let notifications = loaded.get(key.as_entity()).cloned().unwrap_or_default();
                (key, notifications)
            })
            .collect())
    }
}

/// Build a DataLoader for entity notification edges.
pub fn entity_notifications_loader<R>(
    user_id: MacroUserIdStr<'static>,
    reader: R,
) -> DataLoader<EntityNotificationsLoader<R>>
where
    R: SoupNotificationEdgeReader,
{
    DataLoader::new(
        EntityNotificationsLoader::new(user_id, reader),
        tokio::spawn,
    )
}
