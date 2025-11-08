use anyhow::Context;
use model_notifications::{
    ChannelInviteMetadata, CommonChannelMetadata, NotificationEntity, NotificationEvent,
    NotificationQueueMessage,
};
use models_comms::ChannelType;

/// Sends a notification to the notification queue you have specified in your .env file
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let notification_queue =
        std::env::var("NOTIFICATION_QUEUE").context("NOTIFICATION_QUEUE not set")?;

    let macro_notify_client =
        macro_notify::MacroNotify::new(notification_queue.clone(), "example".to_string()).await;

    let users_to_notify = vec!["macro|hutch@macro.com".to_string()];

    let metadata = ChannelInviteMetadata {
        invited_by: "macro|hutch@macro.com".to_string(),
        common: CommonChannelMetadata {
            channel_type: ChannelType::Private,
            channel_name: "test channel name".to_string(),
        },
    };

    macro_notify_client
        .send_notification(NotificationQueueMessage {
            notification_entity: NotificationEntity {
                event_item_id: "0195b9ce-b286-79c9-87f6-e2e0e24f90e8".to_string(),
                event_item_type: "channel".parse().unwrap(),
            },
            notification_event: NotificationEvent::ChannelInvite(metadata),
            sender_id: Some("macro|hutch@macro.com".to_string()),
            recipient_ids: Some(users_to_notify),
            is_important_v0: Some(false),
        })
        .await
        .context("unable to send notification")?;

    Ok(())
}
