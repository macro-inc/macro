mod enqueue;
mod message_attribute;

use std::collections::HashMap;
use std::fmt::Debug;

use anyhow::Context;
use message_attribute::build_string_message_attribute;
use model_notifications::{NotificationEventType, NotificationQueueMessage};

/// Maximum number of messages that can be sent out in a single batch.
pub const MAX_BATCH_SIZE: usize = 10;

use uuid::Uuid;

pub use MacroNotifyClient as MacroNotify;

#[derive(Clone, Debug)]
pub struct MacroNotifyClient {
    /// The SQS client to use for sending notifications
    inner: aws_sdk_sqs::Client,
    /// The notification queue to send notification messages to
    notification_queue: String,
    /// The service that initialized the client
    service: String,
}

impl MacroNotifyClient {
    pub async fn new(notification_queue: String, service: String) -> Self {
        let config = if cfg!(feature = "local_queue") {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .endpoint_url(&notification_queue)
                .load()
                .await
        } else {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await
        };

        Self {
            inner: aws_sdk_sqs::Client::new(&config),
            notification_queue,
            service,
        }
    }

    pub async fn send_notification(
        &self,
        message: NotificationQueueMessage,
    ) -> anyhow::Result<Uuid> {
        // Generate a the notification id
        let notification_id = macro_uuid::generate_uuid_v7();

        let NotificationMessageAttributes(message_attributes) =
            NotificationMessageAttributes::try_from_message(
                &notification_id.to_string(),
                &message,
                self.service.as_str(),
            )
            .context("Failed to build message attributes")?;

        let body = serde_json::to_string(&message)?;
        enqueue::enqueue(
            &self.inner,
            &self.notification_queue,
            Some(message_attributes),
            &body,
        )
        .await?;

        Ok(notification_id)
    }
}

struct NotificationMessageAttributes(
    pub HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>,
);

impl NotificationMessageAttributes {
    fn try_from_message(
        notification_id: &str,
        message: &NotificationQueueMessage,
        service: &str,
    ) -> anyhow::Result<Self> {
        const ATTRIBUTES: &[&str] = &[
            "notification_id",
            "notification_event_type",
            "service_sender",
        ];

        let event_type: NotificationEventType = (&message.notification_event).into();
        let event_type_str = event_type.to_string();

        let values = [notification_id, &event_type_str, service];

        let attributes = ATTRIBUTES
            .iter()
            .zip(values.iter())
            .map(|(key, value)| {
                build_string_message_attribute(value).map(|attr| ((*key).to_string(), attr))
            })
            .collect::<anyhow::Result<HashMap<_, _>>>()?;

        Ok(Self(attributes))
    }
}
