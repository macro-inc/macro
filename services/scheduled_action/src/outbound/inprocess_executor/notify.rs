use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::AiResponseMetadata;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use std::collections::HashSet;
use std::time::Duration;

/// Best-effort APNS/gateway notification, awaited within the tracked run.
/// Notification delivery is not evidence of agent execution success or failure.
pub async fn notify_completion(
    ingress: &impl NotificationIngress,
    chat_id: &str,
    owner: &MacroUserIdStr<'static>,
    assistant_text: &str,
) {
    let req = SendNotificationRequestBuilder {
        notification_entity: EntityType::Chat.with_entity_string(chat_id.to_owned()),
        secondary_notification_entity: None,
        notification: AiResponseMetadata {
            summary: assistant_text.to_owned(),
            message_id: chat_id.to_owned(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([owner.clone()]),
    }
    .into_request()
    .with_apns()
    .with_conn_gateway();

    match tokio::time::timeout(Duration::from_secs(10), ingress.send_notification(req)).await {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => {
            tracing::error!(?error, %chat_id, "failed to send scheduled action completion notification")
        }
        Err(error) => tracing::warn!(?error, %chat_id, "scheduled action notification timed out"),
    }
}
