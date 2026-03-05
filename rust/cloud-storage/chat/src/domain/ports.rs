/*
This is a refactor of the document_cognition_service api
This should _NOT_ refactor types. All types should still be imported
from the same crate that they're imported from in document_cognition_service

This refactor is intended to separate logic from http handlers
This refactor is in the "hex" style that can be seen in the other hex crates (see comms)

This refactor is not a complete refactor of DCS only a refactor of the chat api
it does not handle streaming, or any of the other stuff that DCS does. This is only
intended to be an abstraction over the Chat and ChatMessage table

*/

use crate::models::{ChatResponse, CopyChatArgs, CreateChatArgs, PatchChatArgs};
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::Chat;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;

/// Repository trait for chat CRUD operations.
pub trait ChatRepo: Send + Sync + 'static {
    /// Create a new chat, returning the chat ID.
    fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
    ) -> impl std::future::Future<Output = anyhow::Result<String>> + Send;

    /// Get the full chat response (metadata, messages, web citations).
    fn get_chat(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<ChatResponse>> + Send;

    /// Get a chat metadata by its ID.
    fn get_metadata(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<Chat>> + Send;

    /// Get the requesting user's access level on a chat.
    fn get_access_level(
        &self,
        user_id: MacroUserIdStr<'_>,
        chat_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<AccessLevel>> + Send;

    /// Copy a chat (create a new chat and duplicate its messages), returning the new chat ID.
    fn copy_chat(
        &self,
        user_id: MacroUserIdStr<'static>,
        source_chat_id: &str,
        args: CopyChatArgs,
    ) -> impl std::future::Future<Output = anyhow::Result<String>> + Send;

    /// Revert a soft-deleted chat (clears `deleted_at`, restores history).
    fn revert_delete(
        &self,
        chat_id: &str,
        project_id: Option<&str>,
    ) -> impl std::future::Future<Output = anyhow::Result<()>> + Send;

    /// Get the share permissions for a chat.
    fn get_permissions(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<SharePermissionV2>> + Send;

    /// Soft-delete a chat (sets `deleted_at`, removes pins and history).
    fn delete(&self, chat_id: &str)
    -> impl std::future::Future<Output = anyhow::Result<()>> + Send;

    /// Permanently delete a chat and all associated data.
    fn permanently_delete(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<()>> + Send;

    /// Patch a chat's metadata (name, project, share permissions).
    fn patch(
        &self,
        user_id: MacroUserIdStr<'static>,
        chat_id: &str,
        args: PatchChatArgs,
    ) -> impl std::future::Future<Output = anyhow::Result<()>> + Send;
}
