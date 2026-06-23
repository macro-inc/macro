use crate::domain::models::ScheduledAction;
use model_entity::EntityType;
use model_notifications::AiResponseMetadata;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::{NotificationIngress, SqsNotificationIngress};
use notification::outbound::queue::SqsQueue;
use std::collections::HashSet;
use std::sync::Arc;
/// Spawn a best-effort notification to the action owner announcing the run has
/// completed. Mirrors the DCS chat-stream notification pattern (APNS + websocket
/// via the connection gateway). Errors are logged and never propagated, since a
/// notification failure should not mark the scheduled run as failed.
pub fn notify_completion(
    notification_ingress: &Arc<SqsNotificationIngress<SqsQueue>>,
    chat_id: &str,
    action: &ScheduledAction,
    assistant_text: &str,
) {
    let ingress = Arc::clone(notification_ingress);
    let chat_id = chat_id.to_string();
    let owner = action.owner.clone();
    let message_id = chat_id.clone();
    let assistant_text = assistant_text.to_string();

    tokio::spawn(async move {
        let req = SendNotificationRequestBuilder {
            notification_entity: EntityType::Chat.with_entity_string(chat_id.clone()),
            secondary_notification_entity: None,
            notification: AiResponseMetadata {
                summary: assistant_text,
                message_id,
            },
            sender_id: None,
            recipient_ids: HashSet::from([owner]),
        }
        .into_request()
        .with_apns()
        .with_conn_gateway();

        if let Err(e) = ingress.send_notification(req).await {
            tracing::error!(error=?e, chat_id = %chat_id, "failed to send scheduled action completion notification");
        }
    });
}
