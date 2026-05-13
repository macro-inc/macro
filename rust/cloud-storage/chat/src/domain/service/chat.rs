//! Default [`ChatService`] implementation backed by a [`ChatRepo`].

use crate::domain::{
    models::{ChatErr, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs, Result},
    ports::{ChatRepo, ChatService},
};
use ai::types::{AssistantMessagePart, ChatMessageContent};
use ai_toolset::{AsyncToolCollection, RequestContext, tool_object::UserToolResponse};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use entity_access_management::domain::ports::EntityAccessManagementService;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_permissions::share_permission::SharePermissionV2;
use std::sync::Arc;
use unicode_segmentation::UnicodeSegmentation;

/// Concrete service implementation that delegates to a [`ChatRepo`]
pub struct ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
{
    // toolset should be replaced with trait;
    toolset: Arc<AsyncToolCollection<ToolSetContext>>,
    context: ToolSetContext,
    repo: R,
    entity_access_management_service: Eam,
}

impl<R: ChatRepo, ToolSetContext, Eam: EntityAccessManagementService>
    ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
{
    /// Create a new [`ChatServiceImpl`] wrapping the given repo and tool executor.
    pub fn new(
        repo: R,
        toolset: Arc<AsyncToolCollection<ToolSetContext>>,
        context: ToolSetContext,
        entity_access_management_service: Eam,
    ) -> Self {
        Self {
            repo,
            toolset,
            context,
            entity_access_management_service,
        }
    }
}

impl<R: ChatRepo, ToolSetContext, Eam: EntityAccessManagementService> ChatService
    for ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
{
    #[tracing::instrument(err, skip(self))]
    async fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
    ) -> Result<String> {
        if args.name.graphemes(true).count() > 100 {
            return Err(ChatErr::BadRequest("name too long".to_string()));
        }

        let project_id = args.project_id.clone();
        let chat_id = self.repo.create(user_id, args).await?;

        if let Some(project_id) = &project_id
            && !project_id.is_empty()
            && let (Ok(chat_uuid), Ok(project_uuid)) = (
                uuid::Uuid::parse_str(&chat_id),
                uuid::Uuid::parse_str(project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .add_entity_to_project(&chat_uuid, EntityType::Chat, &project_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?project_id, "unable to update entity access for project"));
            let _ = self.repo.update_project_modified(project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date"),
            );
        }

        Ok(chat_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetChatResponse> {
        let user_id = entity_access_receipt.get_authenticated_user()?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        let (chat, access_level) = tokio::join!(
            self.repo.get_chat(chat_id),
            self.repo.get_access_level(user_id.to_owned(), chat_id),
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
    ) -> Result<String> {
        let user_id = entity_access_receipt.get_authenticated_user()?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        let chat = self.repo.get_metadata(chat_id).await?;
        self.repo
            .copy_chat(
                user_id.to_owned(),
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
    ) -> Result<()> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let project_id = self
            .repo
            .get_metadata(chat_id)
            .await
            .ok()
            .and_then(|c| c.project_id);
        self.repo.delete(chat_id).await?;

        if let Some(project_id) = &project_id
            && !project_id.is_empty()
            && let (Ok(chat_uuid), Ok(project_uuid)) = (
                uuid::Uuid::parse_str(chat_id),
                uuid::Uuid::parse_str(project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .remove_entity_from_project(&chat_uuid, EntityType::Chat, &project_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?project_id, "unable to remove entity from project"));
            let _ = self.repo.update_project_modified(project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date"),
            );
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let project_id = self
            .repo
            .get_metadata(chat_id)
            .await
            .ok()
            .and_then(|c| c.project_id);
        self.repo.permanently_delete(chat_id).await?;

        if let Some(project_id) = &project_id
            && !project_id.is_empty()
            && let (Ok(chat_uuid), Ok(project_uuid)) = (
                uuid::Uuid::parse_str(chat_id),
                uuid::Uuid::parse_str(project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .remove_entity_from_project(&chat_uuid, EntityType::Chat, &project_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?project_id, "unable to remove entity from project"));
            let _ = self.repo.update_project_modified(project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date"),
            );
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        args: PatchChatArgs,
    ) -> Result<()> {
        if let Some(name) = args.name.as_ref()
            && name.graphemes(true).count() > 100
        {
            return Err(ChatErr::BadRequest("name too long".to_string()));
        }
        let user_id = entity_access_receipt.get_authenticated_user()?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        let old_project_id = self
            .repo
            .get_metadata(chat_id)
            .await
            .ok()
            .and_then(|c| c.project_id);
        let new_project_id = args.project_id.clone();
        let project_changing =
            new_project_id.is_some() && new_project_id.as_deref() != old_project_id.as_deref();

        self.repo.patch(user_id.to_owned(), chat_id, args).await?;

        // Remove from old project (only if the project is actually changing)
        if project_changing
            && let Some(old_project_id) = &old_project_id
            && !old_project_id.is_empty()
            && let (Ok(chat_uuid), Ok(old_uuid)) = (
                uuid::Uuid::parse_str(chat_id),
                uuid::Uuid::parse_str(old_project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .remove_entity_from_project(&chat_uuid, EntityType::Chat, &old_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?old_project_id, "unable to remove entity from project"));
            let _ = self.repo.update_project_modified(old_project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?old_project_id, "unable to update project modified date"),
            );
        }

        // Add to new project's entity access + bump modified timestamp
        if let Some(new_project_id) = &new_project_id
            && !new_project_id.is_empty()
            && let (Ok(chat_uuid), Ok(new_uuid)) = (
                uuid::Uuid::parse_str(chat_id),
                uuid::Uuid::parse_str(new_project_id),
            )
        {
            let _ = self
                .entity_access_management_service
                .add_entity_to_project(&chat_uuid, EntityType::Chat, &new_uuid)
                .await
                .inspect_err(|e| tracing::error!(error=?e, project_id=?new_project_id, "unable to add entity to project"));
            let _ = self.repo.update_project_modified(new_project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?new_project_id, "unable to update project modified date"),
            );
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<()> {
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
    ) -> Result<SharePermissionV2> {
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
    ) -> Result<()> {
        let chat_id = &entity_access_receipt.entity().entity_id;

        let mut parts = self
            .get_tool_call_parts(chat_id, message_id, tool_call_id)
            .await?;

        let Some((name, _)) = find_tool_call(&parts, tool_call_id) else {
            return Err(ChatErr::NotFound);
        };

        if !self.toolset.is_valid_tool(name, &new_args) {
            return Err(ChatErr::BadRequest("Invalid tool".into()));
        }

        update_tool_call_args(&mut parts, tool_call_id, new_args);

        let content = ChatMessageContent::AssistantMessageParts(parts);
        self.repo
            .update_message_content(chat_id, message_id, &content)
            .await
    }

    #[tracing::instrument(err, skip(self, response))]
    async fn update_tool_response(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
        response: UserToolResponse<serde_json::Value>,
    ) -> Result<()> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let mut parts = self
            .get_tool_call_parts(chat_id, message_id, tool_call_id)
            .await?;

        let response_json = serde_json::to_value(response).map_err(anyhow::Error::from)?;
        update_tool_response_json(&mut parts, tool_call_id, response_json);

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
    ) -> Result<serde_json::Value> {
        let user_id = entity_access_receipt.get_authenticated_user()?.to_owned();
        let chat_id = entity_access_receipt.entity().entity_id.clone();

        let parts = self
            .get_tool_call_parts(&chat_id, message_id, tool_call_id)
            .await?;

        let Some((tool_name, stored_args)) = find_tool_call(&parts, tool_call_id) else {
            return Err(ChatErr::NotFound);
        };
        let tool_name = tool_name.to_owned();
        let args = match args {
            Some(args) => {
                self.update_tool_call(
                    entity_access_receipt,
                    message_id,
                    tool_call_id,
                    args.clone(),
                )
                .await?;
                args
            }
            None => stored_args.clone(),
        };

        let request_context = RequestContext { user_id };

        let outcome = self
            .toolset
            .try_user_tool_call(self.context.clone(), request_context, &tool_name, &args)
            .await
            // this should never happen (validation prevents)
            .map_err(anyhow::Error::from)?;

        let response_json = match outcome {
            Ok(user_response) => {
                serde_json::to_value(user_response).map_err(anyhow::Error::from)?
            }
            Err(tool_err) => serde_json::json!({ "error": tool_err.description }),
        };

        // re-fetch parts since update_tool_call modified them
        let mut parts = self
            .get_tool_call_parts(&chat_id, message_id, tool_call_id)
            .await?;

        update_tool_response_json(&mut parts, tool_call_id, response_json.clone());

        let content = ChatMessageContent::AssistantMessageParts(parts);
        self.repo
            .update_message_content(&chat_id, message_id, &content)
            .await?;

        Ok(response_json)
    }

    #[tracing::instrument(err, skip(self))]
    async fn reject_tool_call(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
    ) -> Result<()> {
        let rejected_json =
            serde_json::to_value(UserToolResponse::Rejected::<()>).map_err(anyhow::Error::from)?;

        let chat_id = &entity_access_receipt.entity().entity_id;
        let mut parts = self
            .get_tool_call_parts(chat_id, message_id, tool_call_id)
            .await?;

        update_tool_response_json(&mut parts, tool_call_id, rejected_json);

        let content = ChatMessageContent::AssistantMessageParts(parts);
        self.repo
            .update_message_content(chat_id, message_id, &content)
            .await
    }
}

impl<R: ChatRepo, ToolSetContext, Eam: EntityAccessManagementService>
    ChatServiceImpl<R, ToolSetContext, Eam>
where
    ToolSetContext: Clone + Send + Sync + 'static,
{
    /// Fetch a message's content and extract its AssistantMessageParts,
    /// verifying the tool_call_id exists within it.
    async fn get_tool_call_parts(
        &self,
        chat_id: &str,
        message_id: &str,
        tool_call_id: &str,
    ) -> Result<Vec<AssistantMessagePart>> {
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

fn find_tool_call<'a>(
    parts: &'a [AssistantMessagePart],
    tool_call_id: &str,
) -> Option<(&'a str, &'a serde_json::Value)> {
    parts.iter().find_map(|part| match part {
        AssistantMessagePart::ToolCall { id, name, json } if id == tool_call_id => {
            Some((name.as_str(), json))
        }
        _ => None,
    })
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
fn update_tool_response_json(
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
