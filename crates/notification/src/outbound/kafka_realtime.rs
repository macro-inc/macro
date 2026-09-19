//! Kafka adapter for asynchronous realtime notification delivery.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_event_broker::MacroEventBroker;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::prelude::ResultExt as _;
use serde::Serialize;

use crate::domain::models::UserNotificationRow;
use crate::domain::models::queue_message::RealtimeNotif;
use crate::domain::models::websocket_notification_event::NotificationMacroEvent;
use crate::domain::ports::RealtimeSender;

/// Kafka-backed implementation of the realtime sender port.
///
/// Each call publishes one message containing a user-scoped notification row per recipient.
pub struct KafkaRealtimeSender<B> {
    broker: B,
}

impl<B> KafkaRealtimeSender<B> {
    /// Creates a realtime sender backed by `broker`.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker> RealtimeSender for KafkaRealtimeSender<B> {
    #[tracing::instrument(
        err,
        skip_all,
        fields(recipient_count = recipients.len(), topic = "macro.notifications")
    )]
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let notifications = if recipients.is_empty() {
            Vec::new()
        } else {
            let notification: RealtimeNotif<serde_json::Value> = serde_json::from_value(
                serde_json::to_value(notification)
                    .context("failed to serialize realtime notification for Kafka")?,
            )
            .context("failed to decode realtime notification for Kafka")?;

            recipients
                .iter()
                .map(|recipient| {
                    user_notification_row(recipient.clone().into_owned(), &notification)
                })
                .collect()
        };
        let event = NotificationMacroEvent::new(notifications);

        let publish = self
            .broker
            .send_event(&event)
            .context("failed to dispatch realtime notification Kafka event")?;
        publish
            .await
            .context("realtime notification Kafka publish task failed")?
            .context("failed to publish realtime notification to Kafka")?;

        // Kafka acknowledges durable publication, not delivery to an active WebSocket connection.
        Ok(HashSet::new())
    }
}

fn user_notification_row(
    owner_id: MacroUserIdStr<'static>,
    notification: &RealtimeNotif<serde_json::Value>,
) -> UserNotificationRow<serde_json::Value> {
    UserNotificationRow {
        owner_id,
        notification_id: notification.notification_id,
        notification_event_type: notification.notification_event_type.clone(),
        entity: notification.entity.clone(),
        sent: notification.sent,
        done: notification.done,
        created_at: notification.created_at,
        viewed_at: notification.viewed_at,
        updated_at: notification.updated_at,
        deleted_at: notification.deleted_at,
        notification_metadata: notification.notification_metadata.clone(),
        sender_id: notification.sender_id.clone(),
    }
}
