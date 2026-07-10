use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::{
    UserNotificationRow,
    request::{NotificationEntityRef, NotificationItemType},
};

/// Key for loading notifications attached to an entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityNotificationsKey {
    /// Entity type key used by the notification service.
    pub entity_type: String,
    /// Entity ID used by the notification service.
    pub entity_id: String,
}

impl EntityNotificationsKey {
    fn notification_item_type(&self) -> Result<NotificationItemType, rootcause::Report> {
        match self.entity_type.as_str() {
            "email" | "email_thread" => Ok(NotificationItemType::Email),
            "message" | "channel_message" => Ok(NotificationItemType::Message),
            "channel" => Ok(NotificationItemType::Channel),
            "document" => Ok(NotificationItemType::Document),
            "project" => Ok(NotificationItemType::Project),
            "chat" => Ok(NotificationItemType::Chat),
            "call" => Ok(NotificationItemType::Call),
            "task" => Ok(NotificationItemType::Task),
            "github" | "foreign_entity" => Ok(NotificationItemType::Github),
            other => Err(rootcause::report!(
                "unsupported notification entity type {other}"
            )),
        }
    }
}

/// Reader used by GraphQL notification edges.
pub trait SoupNotificationEdgeReader: Send + Sync + 'static {
    /// Load notifications for the requested entity keys.
    fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<EntityNotificationsKey>,
    ) -> impl Future<
        Output = Result<
            HashMap<EntityNotificationsKey, Vec<UserNotificationRow<serde_json::Value>>>,
            rootcause::Report,
        >,
    > + Send;
}

impl<T> SoupNotificationEdgeReader for Arc<T>
where
    T: notification::domain::service::NotificationReader,
{
    async fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<EntityNotificationsKey>,
    ) -> Result<
        HashMap<EntityNotificationsKey, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    > {
        let mut result = keys
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect::<HashMap<_, _>>();

        let requested_refs = keys
            .iter()
            .map(|key| {
                Ok((
                    key.clone(),
                    NotificationEntityRef {
                        entity_type: key.notification_item_type()?,
                        id: key.entity_id.clone(),
                    },
                ))
            })
            .collect::<Result<Vec<_>, rootcause::Report>>()?;

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
        keys: Vec<EntityNotificationsKey>,
    ) -> Result<
        HashMap<EntityNotificationsKey, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    > {
        Ok(keys.into_iter().map(|key| (key, Vec::new())).collect())
    }
}

/// DataLoader for entity notification edges.
pub struct EntityNotificationsLoader<R> {
    user_id: MacroUserIdStr<'static>,
    reader: R,
}

impl<R> EntityNotificationsLoader<R> {
    /// Create a new entity notifications DataLoader.
    pub fn new(user_id: MacroUserIdStr<'static>, reader: R) -> Self {
        Self { user_id, reader }
    }
}

impl<R> Loader<EntityNotificationsKey> for EntityNotificationsLoader<R>
where
    R: SoupNotificationEdgeReader,
{
    type Value = Vec<UserNotificationRow<serde_json::Value>>;
    type Error = Arc<rootcause::Report>;

    async fn load(
        &self,
        keys: &[EntityNotificationsKey],
    ) -> Result<HashMap<EntityNotificationsKey, Self::Value>, Self::Error> {
        self.reader
            .get_notifications(self.user_id.clone(), keys.to_vec())
            .await
            .map_err(Arc::new)
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
