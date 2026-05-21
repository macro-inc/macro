//! Listener for notification database events.

use std::time::Duration;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::models::{NotificationStatusUpdate, PatchDelete, UserNotificationStatusUpdate};
use crate::domain::ports::{NotificationEventsReceiver, NotificationRealtimePublisher};

/// Worker that listens for notification database events and forwards them to realtime clients.
pub struct NotificationEventsListener<E, R> {
    receiver: E,
    realtime: R,
}

impl<E, R> NotificationEventsListener<E, R>
where
    E: NotificationEventsReceiver,
    R: NotificationRealtimePublisher,
{
    /// Create a new notification database event listener.
    pub fn new(receiver: E, realtime: R) -> Self {
        Self { receiver, realtime }
    }

    /// Run the listener forever, reconnecting after receiver failures.
    pub async fn run(&mut self) -> ! {
        loop {
            match self.receiver.receive().await {
                Ok(payload) => self.handle_payload(&payload).await,
                Err(err) => {
                    tracing::error!(error = ?err, "notification event listener receive failed");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }

    async fn handle_payload(&self, payload: &str) {
        let event = match serde_json::from_str::<NotificationDatabaseEvent>(payload) {
            Ok(event) => event,
            Err(err) => {
                tracing::warn!(error = ?err, payload, "failed to deserialize notification database event");
                return;
            }
        };

        match event {
            NotificationDatabaseEvent::UserNotificationDeletes {
                notification_id,
                user_ids,
            } => {
                let user_ids = user_ids
                    .into_iter()
                    .filter_map(|user_id| match MacroUserIdStr::parse_from_str(&user_id) {
                        Ok(user_id) => Some(user_id.into_owned()),
                        Err(err) => {
                            tracing::warn!(error = ?err, user_id, "invalid user id in notification delete event");
                            None
                        }
                    })
                    .collect::<Vec<_>>();

                if user_ids.is_empty() {
                    return;
                }

                let updates = user_ids
                    .iter()
                    .map(|user| UserNotificationStatusUpdate {
                        user: user.copied(),
                        update: NotificationStatusUpdate::new(vec![PatchDelete::Delete {
                            id: notification_id,
                        }]),
                    })
                    .collect::<Vec<_>>();

                if let Err(err) = self.realtime.publish_updates(&updates).await {
                    tracing::warn!(error = ?err, "failed to publish notification delete realtime update");
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum NotificationDatabaseEvent {
    UserNotificationDeletes {
        #[serde(rename = "notificationId")]
        notification_id: Uuid,
        #[serde(rename = "userIds")]
        user_ids: Vec<String>,
    },
}
