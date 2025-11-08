use crate::api::context::ApiContext;
use chrono::{DateTime, Utc};
use sqs_client::search::SearchQueueMessage;

/// Spawns a tokio task to send a remove chat message to the search text extractor
pub fn send_remove_chat_message_to_search(ctx: &ApiContext, chat_id: &str, message_id: &str) {
    let chat_id = chat_id.to_string();
    let message_id = message_id.to_string();
    tokio::spawn({
        let sqs_client = ctx.sqs_client.clone();
        async move {
            let _ = sqs_client
                .send_message_to_search_event_queue(
                    sqs_client::search::SearchQueueMessage::RemoveChatMessage(
                        sqs_client::search::chat::RemoveChatMessage {
                            chat_id: chat_id.to_string(),
                            message_id: Some(message_id.to_string()),
                        },
                    ),
                )
                .await;
        }
    });
}

/// Spawns a tokio task to send the chat message to the search text extractor
pub fn send_chat_message_to_search(
    ctx: &ApiContext,
    chat_id: &str,
    message_id: &str,
    user_id: &str,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
) {
    let chat_id = chat_id.to_string();
    let message_id = message_id.to_string();
    let user_id = user_id.to_string();
    tokio::spawn({
        let sqs_client = ctx.sqs_client.clone();
        async move {
            let _ = sqs_client
                .send_message_to_search_event_queue(SearchQueueMessage::ChatMessage(
                    sqs_client::search::chat::ChatMessage {
                        chat_id,
                        message_id,
                        user_id,
                        created_at,
                        updated_at,
                    },
                ))
                .await;
        }
    });
}
