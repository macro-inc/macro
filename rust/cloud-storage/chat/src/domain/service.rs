//! Default [`ChatService`] implementation backed by a [`ChatRepo`].

use crate::domain::{
    models::{
        ChatErr, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs, ToolCallOutcome,
    },
    ports::{ChatRepo, ChatService, ToolExecutor},
};
use ai::types::{AssistantMessagePart, ChatMessageContent};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::SharePermissionV2;
use unicode_segmentation::UnicodeSegmentation;

/// Concrete service implementation that delegates to a [`ChatRepo`] and [`ToolExecutor`].
pub struct ChatServiceImpl<R, T> {
    repo: R,
    tool_executor: T,
}

impl<R: ChatRepo, T: ToolExecutor> ChatServiceImpl<R, T> {
    /// Create a new [`ChatServiceImpl`] wrapping the given repo and tool executor.
    pub fn new(repo: R, tool_executor: T) -> Self {
        Self {
            repo,
            tool_executor,
        }
    }
}

/// Extract an authenticated user ID from an [`EntityAccessReceipt`], or return an error.
fn extract_user_id<T: entity_access::domain::models::RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<MacroUserIdStr<'static>, ChatErr> {
    match receipt.auth() {
        EntityAccessAuth::Authenticated(id) => Ok(id.clone()),
        _ => Err(ChatErr::Unknown(anyhow::anyhow!("unauthenticated"))),
    }
}

impl<R: ChatRepo, T: ToolExecutor> ChatService for ChatServiceImpl<R, T> {
    #[tracing::instrument(err, skip(self))]
    async fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
    ) -> Result<String, ChatErr> {
        if args.name.graphemes(true).count() > 100 {
            return Err(ChatErr::BadRequest("name too long".to_string()));
        }

        self.repo.create(user_id, args).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetChatResponse, ChatErr> {
        let user_id = extract_user_id(&entity_access_receipt)?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        let (chat, access_level) = tokio::join!(
            self.repo.get_chat(chat_id),
            self.repo.get_access_level(user_id, chat_id),
        );

        Ok(GetChatResponse {
            chat: chat?,
            user_access_level: access_level?,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn copy_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, ChatErr> {
        let user_id = extract_user_id(&entity_access_receipt)?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        let chat = self.repo.get_metadata(chat_id).await?;
        self.repo
            .copy_chat(
                user_id,
                chat_id,
                CopyChatArgs {
                    name: format!("{} Copy", chat.name),
                    project_id: None,
                },
            )
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.delete(chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.permanently_delete(chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        args: PatchChatArgs,
    ) -> Result<(), ChatErr> {
        if let Some(name) = args.name.as_ref()
            && name.graphemes(true).count() > 100
        {
            return Err(ChatErr::BadRequest("name too long".to_string()));
        }

        let user_id = extract_user_id(&entity_access_receipt)?;
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.patch(user_id, chat_id, args).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let chat = self.repo.get_metadata(chat_id).await?;
        self.repo
            .revert_delete(chat_id, chat.project_id.as_deref())
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_permissions(
        &self,
        entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<SharePermissionV2, ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.get_permissions(chat_id).await
    }

    #[tracing::instrument(err, skip(self, new_args))]
    async fn update_tool_call(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
        new_args: serde_json::Value,
    ) -> Result<(), ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let mut parts = self
            .get_tool_call_parts(chat_id, message_id, tool_call_id)
            .await?;

        let (tool_name, _) = extract_tool_call_info(&parts, tool_call_id);

        self.tool_executor.validate_args(&tool_name, &new_args)?;
        update_tool_call_args(&mut parts, tool_call_id, new_args);

        let content = ChatMessageContent::AssistantMessageParts(parts);
        self.repo
            .update_message_content(chat_id, message_id, &content)
            .await
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn call_tool(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
        args: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, ChatErr> {
        let user_id = extract_user_id(&entity_access_receipt)?;
        let chat_id = &entity_access_receipt.entity().entity_id;
        let mut parts = self
            .get_tool_call_parts(chat_id, message_id, tool_call_id)
            .await?;

        let (tool_name, original_args) = extract_tool_call_info(&parts, tool_call_id);
        let exec_args = args.as_ref().unwrap_or(&original_args);

        self.tool_executor.validate_args(&tool_name, exec_args)?;

        if let Some(ref custom_args) = args {
            update_tool_call_args(&mut parts, tool_call_id, custom_args.clone());
        }

        let outcome = self
            .tool_executor
            .call_tool(user_id, &tool_name, exec_args)
            .await?;

        let response_json = match outcome {
            ToolCallOutcome::Success(result) => {
                let json = serde_json::json!({ "Executed": result });
                update_tool_response(&mut parts, tool_call_id, json.clone());
                json
            }
            ToolCallOutcome::ExecutionError { description } => {
                replace_tool_response_with_err(&mut parts, tool_call_id, &tool_name, &description);
                let content = ChatMessageContent::AssistantMessageParts(parts);
                self.repo
                    .update_message_content(chat_id, message_id, &content)
                    .await?;
                return Err(ChatErr::BadRequest(description));
            }
        };

        let content = ChatMessageContent::AssistantMessageParts(parts);
        self.repo
            .update_message_content(chat_id, message_id, &content)
            .await?;

        Ok(response_json)
    }

    #[tracing::instrument(err, skip(self))]
    async fn reject_tool_call(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
    ) -> Result<(), ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let mut parts = self
            .get_tool_call_parts(chat_id, message_id, tool_call_id)
            .await?;

        let rejected = serde_json::json!("Rejected");
        update_tool_response(&mut parts, tool_call_id, rejected);

        let content = ChatMessageContent::AssistantMessageParts(parts);
        self.repo
            .update_message_content(chat_id, message_id, &content)
            .await
    }
}

impl<R: ChatRepo, T: ToolExecutor> ChatServiceImpl<R, T> {
    /// Fetch a message's content and extract its AssistantMessageParts,
    /// verifying the tool_call_id exists within it.
    async fn get_tool_call_parts(
        &self,
        chat_id: &str,
        message_id: &str,
        tool_call_id: &str,
    ) -> Result<Vec<AssistantMessagePart>, ChatErr> {
        let content = self.repo.get_message_content(chat_id, message_id).await?;
        match content {
            ChatMessageContent::AssistantMessageParts(parts) => {
                let has_tool = parts.iter().any(|part| {
                    matches!(part, AssistantMessagePart::ToolCall { id, .. } if id == tool_call_id)
                });
                if has_tool {
                    Ok(parts)
                } else {
                    Err(ChatErr::NotFound)
                }
            }
            _ => Err(ChatErr::BadRequest(
                "message does not contain tool calls".to_string(),
            )),
        }
    }
}

/// Extract the tool name and original args from the parts for a given tool_call_id.
fn extract_tool_call_info(
    parts: &[AssistantMessagePart],
    tool_call_id: &str,
) -> (String, serde_json::Value) {
    parts
        .iter()
        .find_map(|part| match part {
            AssistantMessagePart::ToolCall { name, json, id } if id == tool_call_id => {
                Some((name.clone(), json.clone()))
            }
            _ => None,
        })
        .expect("tool call must exist since we found the message above")
}

/// Update the json field of the ToolCall part matching the given tool_call_id.
fn update_tool_call_args(
    parts: &mut [AssistantMessagePart],
    tool_call_id: &str,
    new_args: serde_json::Value,
) {
    for part in parts.iter_mut() {
        if let AssistantMessagePart::ToolCall { id, json, .. } = part
            && id == tool_call_id
        {
            *json = new_args;
            return;
        }
    }
}

/// Update the json field of the ToolCallResponseJson part matching the given tool_call_id.
fn update_tool_response(
    parts: &mut [AssistantMessagePart],
    tool_call_id: &str,
    new_json: serde_json::Value,
) {
    for part in parts.iter_mut() {
        if let AssistantMessagePart::ToolCallResponseJson { id, json, .. } = part
            && id == tool_call_id
        {
            *json = new_json;
            return;
        }
    }
}

/// Replace a ToolCallResponseJson with a ToolCallErr for the given tool_call_id.
fn replace_tool_response_with_err(
    parts: &mut [AssistantMessagePart],
    tool_call_id: &str,
    tool_name: &str,
    description: &str,
) {
    for part in parts.iter_mut() {
        if let AssistantMessagePart::ToolCallResponseJson { id, .. } = part
            && id == tool_call_id
        {
            *part = AssistantMessagePart::ToolCallErr {
                name: tool_name.to_string(),
                description: description.to_string(),
                id: tool_call_id.to_string(),
            };
            return;
        }
    }
}
