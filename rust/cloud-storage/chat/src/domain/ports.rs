use crate::domain::models::{
    ChatErr, ChatResponse, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs,
};
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
    ) -> impl std::future::Future<Output = Result<String, ChatErr>> + Send;

    /// Get the full chat response (metadata, messages, web citations).
    fn get_chat(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<ChatResponse, ChatErr>> + Send;

    /// Get a chat metadata by its ID.
    fn get_metadata(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<Chat, ChatErr>> + Send;

    /// Get the requesting user's access level on a chat.
    fn get_access_level(
        &self,
        user_id: MacroUserIdStr<'_>,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<AccessLevel, ChatErr>> + Send;

    /// Copy a chat (create a new chat and duplicate its messages), returning the new chat ID.
    fn copy_chat(
        &self,
        user_id: MacroUserIdStr<'static>,
        source_chat_id: &str,
        args: CopyChatArgs,
    ) -> impl std::future::Future<Output = Result<String, ChatErr>> + Send;

    /// Revert a soft-deleted chat (clears `deleted_at`, restores history).
    fn revert_delete(
        &self,
        chat_id: &str,
        project_id: Option<&str>,
    ) -> impl std::future::Future<Output = Result<(), ChatErr>> + Send;

    /// Get the share permissions for a chat.
    fn get_permissions(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<SharePermissionV2, ChatErr>> + Send;

    /// Soft-delete a chat (sets `deleted_at`, removes pins and history).
    fn delete(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<(), ChatErr>> + Send;

    /// Permanently delete a chat and all associated data.
    fn permanently_delete(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<(), ChatErr>> + Send;

    /// Patch a chat's metadata (name, project, share permissions).
    fn patch(
        &self,
        user_id: MacroUserIdStr<'static>,
        chat_id: &str,
        args: PatchChatArgs,
    ) -> impl std::future::Future<Output = Result<(), ChatErr>> + Send;
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
    ) -> impl std::future::Future<Output = Result<String, ChatErr>> + Send;

    /// Get a chat with messages, web citations, and the user's access level.
    fn get_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl std::future::Future<Output = Result<GetChatResponse, ChatErr>> + Send;

    /// Copy a chat and its messages, returning the new chat ID.
    fn copy_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl std::future::Future<Output = Result<String, ChatErr>> + Send;

    /// Soft-delete a chat.
    fn delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl std::future::Future<Output = Result<(), ChatErr>> + Send;

    /// Permanently delete a chat and all associated data.
    fn permanently_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl std::future::Future<Output = Result<(), ChatErr>> + Send;

    /// Patch a chat's metadata (name, project, share permissions).
    fn patch(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        args: PatchChatArgs,
    ) -> impl std::future::Future<Output = Result<(), ChatErr>> + Send;

    /// Revert a soft-deleted chat.
    fn revert_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl std::future::Future<Output = Result<(), ChatErr>> + Send;

    /// Get the share permissions for a chat.
    fn get_permissions(
        &self,
        entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl std::future::Future<Output = Result<SharePermissionV2, ChatErr>> + Send;
}
