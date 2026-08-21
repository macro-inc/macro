use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::{DataLoader, Loader};
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::NotifEvent;
use notification::domain::models::UserNotificationRow;
use rootcause::markers::{Cloneable, Dynamic};

/// Tests for notification entity batching.
#[cfg(test)]
mod test;

/// Reader used by GraphQL notification edges.
pub trait SoupNotificationEdgeReader: Send + Sync + 'static {
    /// Load notifications for the requested entity keys.
    fn get_notifications<'a>(
        &'a self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<model_entity::Entity<'static>>,
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
    ) -> impl Future<
        Output = Result<
            HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<NotifEvent>>>,
            rootcause::Report,
        >,
    > {
        self.get_entity_notifications_batch::<NotifEvent>(user_id, keys)
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
        HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<NotifEvent>>>,
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
    type Value = Vec<UserNotificationRow<NotifEvent>>;
    type Error = rootcause::Report<Dynamic, Cloneable>;

    async fn load(
        &self,
        keys: &[model_entity::OwnedEntity],
    ) -> Result<HashMap<model_entity::OwnedEntity, Self::Value>, Self::Error> {
        let entities = keys
            .iter()
            .map(|key| key.as_entity().clone())
            .collect::<Vec<_>>();
        let mut loaded = self
            .reader
            .get_notifications(self.user_id.clone(), entities)
            .await
            .map_err(|error| error.into_cloneable())?;

        Ok(keys
            .iter()
            .cloned()
            .map(|key| {
                let notifications = loaded.remove(key.as_entity()).unwrap_or_default();
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
