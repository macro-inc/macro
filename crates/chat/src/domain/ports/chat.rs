use crate::domain::models::{
    ChatResponse, CopyChatArgs, GetChatResponse, PatchChatArgs, PatchChatRepoArgs, Result,
};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::Chat;
use model_owner::Owner;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::TeamShareFacts;
use models_permissions::share_permission::{SharePermissionV2, TeamLinkShareDefault};

/// Repository trait for low-level chat data access.
pub trait ChatRepo: Send + Sync + 'static {
    /// Get the link-share preference of the owner's team, or `None` when the
    /// owner has no team. The team is the one [`model_owner::team::owner_team`]
    /// resolves, so a bot owner gets its team's default.
    fn get_team_default_link_share(
        &self,
        owner: &Owner,
    ) -> impl std::future::Future<Output = Result<Option<TeamLinkShareDefault>>> + Send;

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
    /// Only entity duplication calls this; nothing else creates a legacy chat.
    ///
    /// `share_permission` is the pre-resolved initial share permission for the
    /// copy — the repository persists it verbatim.
    fn copy_chat(
        &self,
        owner: Owner,
        source_chat_id: &str,
        args: CopyChatArgs,
        share_permission: SharePermissionV2,
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

    /// Load the canonical team-share facts (persisted owner, owner's team,
    /// current explicit grant, revision) the owner policy authorizes against.
    fn get_team_share_facts(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<TeamShareFacts>> + Send;

    /// Soft-delete a chat (sets `deleted_at`, removes pins and history).
    fn delete(&self, chat_id: &str) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Permanently delete a chat and all associated data.
    fn permanently_delete(
        &self,
        chat_id: &str,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Patch a chat's metadata (name, project, share permissions).
    ///
    /// `args.team_share` is the owner-authorized command for an explicit
    /// `teamShareAccessLevel`; the repository applies it atomically with the
    /// rest of the patch and rejects a team level that arrives without one.
    fn patch(
        &self,
        user_id: MacroUserIdStr<'static>,
        chat_id: &str,
        args: PatchChatRepoArgs,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Update a project's `updatedAt` timestamp.
    fn update_project_modified(
        &self,
        project_id: &str,
    ) -> impl std::future::Future<Output = Result<()>> + Send;
}

/// Service trait for chat business logic.
///
/// Handlers depend on this trait rather than [`ChatRepo`] directly.
/// The default implementation is [`super::service::ChatServiceImpl`].
pub trait ChatService: Send + Sync + 'static {
    /// Get a chat with messages, web citations, and the user's access level.
    fn get_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl std::future::Future<Output = Result<GetChatResponse>> + Send;

    /// Get chat metadata without loading messages.
    fn get_metadata(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl std::future::Future<Output = Result<model::chat::Chat>> + Send;

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
}
