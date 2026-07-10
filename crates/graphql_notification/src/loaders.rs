use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::{
    UserNotificationRow,
    request::{NotificationEntityRef, NotificationItemType},
};

type OwnedEntity = model_entity::Entity<'static>;

fn notification_item_type(
    entity_type: model_entity::EntityType,
) -> Result<NotificationItemType, rootcause::Report> {
    use model_entity::EntityType;
    match entity_type {
        EntityType::EmailThread => Ok(NotificationItemType::Email),
        EntityType::ChannelMessage => Ok(NotificationItemType::Message),
        EntityType::Channel => Ok(NotificationItemType::Channel),
        EntityType::Document => Ok(NotificationItemType::Document),
        EntityType::Project => Ok(NotificationItemType::Project),
        EntityType::Chat => Ok(NotificationItemType::Chat),
        EntityType::Call => Ok(NotificationItemType::Call),
        EntityType::ForeignEntity => Ok(NotificationItemType::Github),
        other => Err(rootcause::report!(
            "unsupported notification entity type {other}"
        )),
    }
}

/// Reader used by GraphQL notification edges.
pub trait SoupNotificationEdgeReader: Send + Sync + 'static {
    /// Load notifications for the requested entity keys.
    fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<OwnedEntity>,
    ) -> impl Future<
        Output = Result<
            HashMap<OwnedEntity, Vec<UserNotificationRow<serde_json::Value>>>,
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
        keys: Vec<OwnedEntity>,
    ) -> Result<HashMap<OwnedEntity, Vec<UserNotificationRow<serde_json::Value>>>, rootcause::Report>
    {
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
                        entity_type: notification_item_type(key.entity_type)?,
                        id: key.entity_id.to_string(),
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
        keys: Vec<OwnedEntity>,
    ) -> Result<HashMap<OwnedEntity, Vec<UserNotificationRow<serde_json::Value>>>, rootcause::Report>
    {
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

impl<R> Loader<(model_entity::EntityType, String)> for EntityNotificationsLoader<R>
where
    R: SoupNotificationEdgeReader,
{
    type Value = Vec<UserNotificationRow<serde_json::Value>>;
    type Error = Arc<rootcause::Report>;

    async fn load(
        &self,
        keys: &[(model_entity::EntityType, String)],
    ) -> Result<HashMap<(model_entity::EntityType, String), Self::Value>, Self::Error> {
        let owned_keys = keys
            .iter()
            .map(|(entity_type, entity_id)| entity_type.with_entity_string(entity_id.clone()))
            .collect();
        let mut loaded = self
            .reader
            .get_notifications(self.user_id.clone(), owned_keys)
            .await
            .map_err(Arc::new)?;

        Ok(keys
            .iter()
            .cloned()
            .map(|key| {
                let owned_key = key.0.with_entity_string(key.1.clone());
                let value = loaded.remove(&owned_key).unwrap_or_default();
                (key, value)
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
