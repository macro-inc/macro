use std::collections::HashSet;
use std::sync::Arc;

use connection_gateway_client::service::connection::ConnectionRepo;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::AiResponseMetadata;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;

/// Summarize an AI response and send a notification to the chat owner in a background task.
///
/// Spawns a tokio task that summarizes the assistant response with Haiku and then
/// sends a notification if the owner is not currently connected. Best-effort — errors
/// are logged but never propagated.
pub fn notify(
    connection_repo: Arc<dyn ConnectionRepo>,
    notification_ingress: Arc<impl NotificationIngress>,
    chat_id: String,
    message_id: String,
    assistant_text: String,
    user_id: MacroUserIdStr<'static>,
) {
    tokio::spawn(async move {
        if let Err(err) = send_chat_notification(
            connection_repo.as_ref(),
            &*notification_ingress,
            &chat_id,
            &message_id,
            &assistant_text,
            user_id,
        )
        .await
        {
            tracing::error!(error=?err, "failed to send chat notification");
        }
    });
}

/// Send a chat notification to the chat owner if they are not currently connected.
///
/// Checks the connection gateway for active WebSocket connections to the chat entity.
/// If the owner is already connected, no notification is sent.
/// The sender is the system AI user, and the recipient is the chat owner.
#[tracing::instrument(err, skip(connection_repo, notification_ingress))]
async fn send_chat_notification(
    connection_repo: &dyn ConnectionRepo,
    notification_ingress: &impl NotificationIngress,
    chat_id: &str,
    message_id: &str,
    summary: &str,
    recipient_id: MacroUserIdStr<'static>,
) -> anyhow::Result<()> {
    let entity = EntityType::Chat.with_entity_str(chat_id);

    let connections = connection_repo.get_entries_by_entity(&entity).await?;

    let recipient_is_connected = connections
        .iter()
        .any(|c| c.user_id == recipient_id.as_ref());

    if recipient_is_connected {
        return Ok(());
    }

    let req = SendNotificationRequestBuilder {
        notification_entity: EntityType::Chat.with_entity_string(chat_id.to_string()),
        notification: AiResponseMetadata {
            summary: summary.to_string(),
            message_id: message_id.to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient_id]),
    }
    .into_request()
    .with_apns()
    .with_conn_gateway();

    notification_ingress
        .send_notification(req)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    Ok(())
}
