use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::NotifEvent;
use notification::domain::models::{UserNotificationRow, entity_query::EntityNotificationQuery};
use rootcause::markers::{Cloneable, Dynamic};

/// Tests for notification entity batching.
#[cfg(test)]
mod test;

/// Reader used by GraphQL notification edges.
pub trait SoupNotificationEdgeReader: Send + Sync + 'static {
    /// Load matching notifications, applying the limit separately per entity.
    fn get_notifications<'a>(
        &'a self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<model_entity::Entity<'static>>,
        query: EntityNotificationQuery,
    ) -> impl Future<
        Output = Result<
            HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<NotifEvent>>>,
            rootcause::Report,
        >,
    > + Send
    + 'a;
}

impl<T> SoupNotificationEdgeReader for Arc<T>
where
    T: notification::domain::service::NotificationReader,
{
    fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<model_entity::Entity<'static>>,
        query: EntityNotificationQuery,
    ) -> impl Future<
        Output = Result<
            HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<NotifEvent>>>,
            rootcause::Report,
        >,
    > + Send {
        self.get_entity_notifications_batch::<NotifEvent>(user_id, keys, query)
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
        _query: EntityNotificationQuery,
    ) -> Result<
        HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<NotifEvent>>>,
        rootcause::Report,
    > {
        Ok(keys.iter().map(|key| (key.clone(), Vec::new())).collect())
    }
}

/// An entity plus its complete selection. Limited and full reads must never collide.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EntityNotificationsKey {
    /// Canonical entity being read.
    pub entity: model_entity::OwnedEntity,
    /// States, event names, and per-entity limit.
    pub query: EntityNotificationQuery,
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

impl<R> Loader<EntityNotificationsKey> for EntityNotificationsLoader<R>
where
    R: SoupNotificationEdgeReader,
{
    type Value = Vec<UserNotificationRow<NotifEvent>>;
    type Error = rootcause::Report<Dynamic, Cloneable>;

    async fn load(
        &self,
        keys: &[EntityNotificationsKey],
    ) -> Result<HashMap<EntityNotificationsKey, Self::Value>, Self::Error> {
        let mut batches: HashMap<EntityNotificationQuery, Vec<EntityNotificationsKey>> =
            HashMap::new();
        for key in keys {
            batches
                .entry(key.query.clone())
                .or_default()
                .push(key.clone());
        }
        let mut result = HashMap::new();
        for (query, keys) in batches {
            let entities = keys
                .iter()
                .map(|key| key.entity.as_entity().clone())
                .collect();
            let mut loaded = self
                .reader
                .get_notifications(self.user_id.clone(), entities, query)
                .await
                .map_err(|error| error.into_cloneable())?;
            for key in keys {
                let notifications = loaded.remove(key.entity.as_entity()).unwrap_or_default();
                result.insert(key, notifications);
            }
        }
        Ok(result)
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
