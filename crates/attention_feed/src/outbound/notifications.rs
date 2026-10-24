//! Notifications through the notification domain's reader service.

use std::{collections::HashMap, sync::Arc};

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use model_notifications::NotifEvent;
use notification::domain::{
    models::{
        entity_query::EntityNotificationQuery,
        request::{NotificationStatus, UpdateNotificationsRequest},
    },
    service::NotificationReader,
};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::{
    models::FeedNotification,
    ports::{FeedNotifications, NotificationTransition},
};

/// Reads and acknowledges notifications through [`NotificationReader`].
pub struct ReaderFeedNotifications<R> {
    reader: Arc<R>,
}

impl<R> ReaderFeedNotifications<R> {
    /// Create the adapter over a notification reader.
    pub fn new(reader: Arc<R>) -> Self {
        Self { reader }
    }
}

impl<R> Clone for ReaderFeedNotifications<R> {
    fn clone(&self) -> Self {
        Self {
            reader: Arc::clone(&self.reader),
        }
    }
}

impl<R> FeedNotifications for ReaderFeedNotifications<R>
where
    R: NotificationReader,
{
    async fn active(
        &self,
        user: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, Vec<FeedNotification>>, Report> {
        // The default query is the active (unseen and seen) edge, unlimited.
        Ok(self
            .reader
            .get_entity_notifications_batch::<NotifEvent>(
                user,
                entities,
                EntityNotificationQuery::default(),
            )
            .await?
            .into_iter()
            .map(|(entity, rows)| (entity, rows.into_iter().map(Arc::new).collect()))
            .collect())
    }

    async fn transition(
        &self,
        user: MacroUserIdStr<'static>,
        notification_ids: Vec<Uuid>,
        transition: NotificationTransition,
    ) -> Result<Vec<Uuid>, Report> {
        Ok(self
            .reader
            .update_notifications_and_return::<serde_json::Value>(UpdateNotificationsRequest {
                user_id: user,
                notification_ids: &notification_ids,
                status: match transition {
                    NotificationTransition::Seen => NotificationStatus::Seen,
                    NotificationTransition::Done => NotificationStatus::Done(true),
                    NotificationTransition::Undone => NotificationStatus::Done(false),
                },
            })
            .await?
            .into_iter()
            .map(|row| row.notification_id)
            .collect())
    }
}
