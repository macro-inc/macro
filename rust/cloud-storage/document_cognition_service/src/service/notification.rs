use std::collections::HashSet;
use std::sync::Arc;

use connection_gateway_client::service::connection::ConnectionRepo;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{ChannelMessageSendMetadata, CommonChannelMetadata};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;

use ai::chat_completion::get_chat_completion;
use ai::types::{MessageBuilder, Model, RequestBuilder, Role};

/// Summarize a chat message into 1-2 sentences using Claude Haiku.
#[tracing::instrument(skip(text), err)]
async fn summarize_message(text: &str) -> anyhow::Result<String> {
    let request = RequestBuilder::new()
        .system_prompt("Summarize the following AI assistant response in 1-2 concise sentences for a notification. Be brief and capture the key point.")
        .messages(vec![
            MessageBuilder::new()
                .content(text.to_string())
                .role(Role::User)
                .build(),
        ])
        .model(Model::Claude45Haiku)
        .max_tokens(256)
        .build();

    let response = get_chat_completion(request).await?;

    Ok(response)
}

/// Summarize an AI response and send a notification to the chat owner in a background task.
///
/// Spawns a tokio task that summarizes the assistant response with Haiku and then
/// sends a notification if the owner is not currently connected. Best-effort — errors
/// are logged but never propagated.
pub fn summarize_and_notify(
    connection_repo: Arc<dyn ConnectionRepo>,
    notification_ingress: Arc<impl NotificationIngress>,
    chat_id: String,
    message_id: String,
    assistant_text: String,
    user_id: MacroUserIdStr<'static>,
) {
    tokio::spawn(async move {
        let summary = match summarize_message(&assistant_text).await {
            Ok(s) => s,
            Err(err) => {
                tracing::error!(error=?err, "failed to summarize message");
                return;
            }
        };

        if let Err(err) = send_chat_notification(
            connection_repo.as_ref(),
            &*notification_ingress,
            &chat_id,
            &message_id,
            &summary,
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
#[tracing::instrument(err, skip(connection_repo, notification_ingress))]
async fn send_chat_notification(
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
