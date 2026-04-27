use crate::domain::models::{
    ChatResponse, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs,
    PatchChatMessageArgs, Result,
};
use ai::types::ChatMessageContent;
use ai_toolset::tool_object::UserToolResponse;
use attachment::FormattedParts;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::Chat;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;

/// Repository trait for low-level chat data access.
pub trait ChatRepo: Send + Sync + 'static {
    /// Create a new chat, returning the chat ID.
    fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
    ) -> impl std::future::Future<Output = Result<String>> + Send;

    /// Get the full chat response (metadata, messages, web citations).
    fn get_chat(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<ChatResponse>> + Send;

    /// Get a chat metadata by its ID.
    fn get_metadata(&self, chat_id: &str)
    -> impl std::future::Future<Output = Result<Chat>> + Send;

    /// Get the requesting user's access level on a chat.
    fn get_access_level(
        &self,
        user_id: MacroUserIdStr<'_>,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<AccessLevel>> + Send;

    /// Copy a chat (create a new chat and duplicate its messages), returning the new chat ID.
    fn copy_chat(
        &self,
        user_id: MacroUserIdStr<'static>,
        source_chat_id: &str,
        args: CopyChatArgs,
    ) -> impl std::future::Future<Output = Result<String>> + Send;

    /// Revert a soft-deleted chat (clears `deleted_at`, restores history).
    fn revert_delete(
        &self,
        chat_id: &str,
        project_id: Option<&str>,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Get the share permissions for a chat.
    fn get_permissions(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<SharePermissionV2>> + Send;

    /// Soft-delete a chat (sets `deleted_at`, removes pins and history).
    fn delete(&self, chat_id: &str) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Permanently delete a chat and all associated data.
    fn permanently_delete(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Patch a chat's metadata (name, project, share permissions).
    fn patch(
        &self,
        user_id: MacroUserIdStr<'static>,
        chat_id: &str,
        args: PatchChatArgs,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Update a project's `updatedAt` timestamp.
    fn update_project_modified(
        &self,
        project_id: &str,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Patch a message's content.
    fn patch_message(
        &self,
        chat_id: &str,
        args: PatchChatMessageArgs,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Get the content of a single message by ID
    fn get_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> impl std::future::Future<Output = Result<ChatMessageContent>> + Send;

    /// Update the content of a specific message.
    fn update_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &ChatMessageContent,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Store the resolved (AI-facing) representation of a user message.
    fn store_resolved_message(
        &self,
        message_id: &str,
        parts: FormattedParts,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Get the resolved representation of a user message, if it exists.
    fn get_resolved_message(
        &self,
        message_id: &str,
    ) -> impl std::future::Future<Output = Result<FormattedParts>> + Send;
}

/// Service trait for chat business logic.
///
/// Handlers depend on this trait rather than [`ChatRepo`] directly.
/// The default implementation is [`super::service::ChatServiceImpl`].
pub trait ChatService: Send + Sync + 'static {
    /// Create a new chat, returning the chat ID.
    fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
    ) -> impl std::future::Future<Output = Result<String>> + Send;

    /// Get a chat with messages, web citations, and the user's access level.
    fn get_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl std::future::Future<Output = Result<GetChatResponse>> + Send;

    /// Copy a chat and its messages, returning the new chat ID.
    fn copy_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl std::future::Future<Output = Result<String>> + Send;

    /// Soft-delete a chat.
    fn delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Permanently delete a chat and all associated data.
    fn permanently_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Patch a chat's metadata (name, project, share permissions).
    fn patch(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        args: PatchChatArgs,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Revert a soft-deleted chat.
    fn revert_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Get the share permissions for a chat.
    fn get_permissions(
        &self,
        entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl std::future::Future<Output = Result<SharePermissionV2>> + Send;

    /// Update a tool call's arguments after validation.
    fn update_tool_call(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
        new_args: serde_json::Value,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Update a tool response.
    fn update_tool_response(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
        response: UserToolResponse<serde_json::Value>,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Execute a pending tool call. Optionally update its arguments first.
    fn call_tool(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
        args: Option<serde_json::Value>,
    ) -> impl std::future::Future<Output = Result<serde_json::Value>> + Send;

    /// Reject a pending tool call.
    fn reject_tool_call(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        message_id: &str,
        tool_call_id: &str,
    ) -> impl std::future::Future<Output = Result<()>> + Send;
}
