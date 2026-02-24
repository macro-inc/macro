use std::collections::HashSet;

use connection_gateway_client::service::connection::ConnectionRepo;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{ChannelMessageSendMetadata, CommonChannelMetadata};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;

/// Send a chat notification to the chat owner if they are not currently connected.
///
/// Checks the connection gateway for active WebSocket connections to the chat entity.
/// If the owner is already connected, no notification is sent.
#[tracing::instrument(err, skip(connection_repo, notification_ingress))]
pub async fn send_chat_notification(
    connection_repo: &dyn ConnectionRepo,
    notification_ingress: &impl NotificationIngress,
    chat_id: &str,
    message_id: &str,
    summary: &str,
    sender_id: MacroUserIdStr<'static>,
) -> anyhow::Result<()> {
    let entity = EntityType::Chat.with_entity_str(chat_id);

    let connections = connection_repo.get_entries_by_entity(&entity).await?;

    let sender_is_connected = connections
        .iter()
        .any(|c| c.user_id == sender_id.as_ref());

    if sender_is_connected {
        return Ok(());
    }

    let req = SendNotificationRequestBuilder {
        notification_entity: EntityType::Chat.with_entity_string(chat_id.to_string()),
        notification: ChannelMessageSendMetadata {
            sender: sender_id.clone(),
            message_content: summary.to_string(),
            message_id: message_id.to_string(),
            common: CommonChannelMetadata {
                channel_type: model_notifications::ChannelType::DirectMessage,
                channel_name: String::new(),
            },
        },
        sender_id: Some(sender_id.clone()),
        recipient_ids: HashSet::from([sender_id]),
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
