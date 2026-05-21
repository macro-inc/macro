//! ReadChat tool for fetching a chat's message history.

use crate::domain::ports::ChatService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ChatToolContext;

/// A single message in the tool response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagePreview {
    /// The role of the message author (user, assistant, or system).
    pub role: String,
    /// The text content of the message.
    pub content: String,
    /// IDs of attachments referenced by this message.
    pub attachment_ids: Vec<String>,
}

/// Response for [`ReadChat`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadChatResponse {
    /// The chat id.
    pub chat_id: String,
    /// The chat title.
    pub title: String,
    /// The messages in the chat.
    pub messages: Vec<ChatMessagePreview>,
}

/// Tool: read a chat thread's message history.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadChat",
    description = "Retrieve a chat thread's message history by its ID. Returns the conversation title and messages with their roles, content, and attachment references."
)]
pub struct ReadChat {
    #[schemars(description = "The id of the chat thread to read.")]
    pub chat_id: String,
}

#[async_trait]
impl<CSvc, ESvc> AsyncTool<ChatToolContext<CSvc, ESvc>> for ReadChat
where
    CSvc: ChatService,
    ESvc: EntityAccessService,
{
    type Output = ReadChatResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, chat_id=?self.chat_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChatToolContext<CSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Read chat");

        let receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &request_context.user_id,
                None,
                &self.chat_id,
                EntityType::Chat,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "unable to verify access to chat".to_string(),
                internal_error: e.into(),
            })?;

        let response = service_context
            .service
            .get_chat(receipt)
            .await
            .map_err(|e| ToolCallError {
                description: "failed to fetch chat".to_string(),
                internal_error: e.into(),
            })?;

        let chat = response.chat;
        let messages = chat
            .messages
            .into_iter()
            .filter_map(|msg| {
                let content = msg.content_text()?;
                Some(ChatMessagePreview {
                    role: msg.role.to_string(),
                    content,
                    attachment_ids: msg
                        .attachments
                        .into_iter()
                        .map(|a| a.entity_id.into_owned())
                        .collect(),
                })
            })
            .collect();

        Ok(ReadChatResponse {
            chat_id: chat.id,
            title: chat.name,
            messages,
        })
    }
}
