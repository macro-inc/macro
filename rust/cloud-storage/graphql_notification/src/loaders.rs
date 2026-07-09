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

    fn entity_type_key(item_type: NotificationItemType) -> &'static str {
        match item_type {
            NotificationItemType::Email => "email",
            NotificationItemType::Message => "message",
            NotificationItemType::Channel => "channel",
            NotificationItemType::Document => "document",
            NotificationItemType::Project => "project",
            NotificationItemType::Chat => "chat",
            NotificationItemType::Call => "call",
            NotificationItemType::Task => "task",
            NotificationItemType::Github => "github",
        }
    }
}

/// Object-safe reader used by GraphQL notification edges.
#[async_trait::async_trait]
pub trait SoupNotificationEdgeReader: Send + Sync + 'static {
    /// Load notifications for the requested entity keys.
    async fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<EntityNotificationsKey>,
    ) -> Result<
        HashMap<EntityNotificationsKey, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    >;
}

#[async_trait::async_trait]
impl<T> SoupNotificationEdgeReader for T
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

        let entity_refs = keys
            .iter()
            .map(|key| {
                Ok(NotificationEntityRef {
                    entity_type: key.notification_item_type()?,
                    id: key.entity_id.clone(),
                })
            })
            .collect::<Result<Vec<_>, rootcause::Report>>()?;

        let notifications_by_entity = self
            .get_entity_notifications_batch(user_id, entity_refs)
            .await
            .map_err(|err| rootcause::report!(err))?;

        for (key, notifications) in notifications_by_entity {
            result.insert(
                EntityNotificationsKey {
                    entity_type: EntityNotificationsKey::entity_type_key(key.entity_type)
                        .to_owned(),
                    entity_id: key.id,
                },
                notifications,
            );
        }

        Ok(result)
    }
}

/// DataLoader for entity notification edges.
pub struct EntityNotificationsLoader {
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupNotificationEdgeReader>,
}

impl EntityNotificationsLoader {
    /// Create a new entity notifications DataLoader.
    pub fn new(
        user_id: MacroUserIdStr<'static>,
        reader: Arc<dyn SoupNotificationEdgeReader>,
    ) -> Self {
        Self { user_id, reader }
    }
}

impl Loader<EntityNotificationsKey> for EntityNotificationsLoader {
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
pub fn entity_notifications_loader(
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupNotificationEdgeReader>,
) -> DataLoader<EntityNotificationsLoader> {
    DataLoader::new(
        EntityNotificationsLoader::new(user_id, reader),
        tokio::spawn,
    )
}
