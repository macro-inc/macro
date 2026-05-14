//! Port definitions for entity access.
//!
//! These traits define the contracts that adapters must implement.

use super::models::EntityType;
use crate::domain::models::{
    AccessError, AccessLevel, CallChannelInfo, ChannelRoleResult, EntityAccessReceipt,
    EntityPermission, RequiredPermission, UserTeamInfo,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use std::future::Future;
use uuid::Uuid;

/// Repository for accessing entity permissions from the database.
///
/// This trait abstracts database operations for checking user access to entities.
/// All methods query the database directly - no HTTP calls to external services.
pub trait AccessRepository: Clone + Send + Sync + 'static {
    /// Get the highest access level a user has for a document.
    fn get_document_access(
        &self,
        document_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for a chat.
    fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for a project.
    fn get_project_access(
        &self,
        project_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for an email thread.
    fn get_thread_access(
        &self,
        thread_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for a call.
    fn get_call_access(
        &self,
        call_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Check if a user is a member of the specified channels.
    ///
    /// Returns the subset of channel_ids that the user is a participant of.
    fn check_user_channel_membership(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        channel_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Uuid>, AccessError>> + Send;

    /// Get the user's role in a channel.
    ///
    /// Returns a [`ChannelRoleResult`] that distinguishes between:
    /// - User has a role (considering channel type rules)
    /// - Channel exists but user has no access
    /// - Channel does not exist
    fn get_channel_role(
        &self,
        channel_id: &Uuid,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        user_org_id: Option<i64>,
    ) -> impl Future<Output = Result<ChannelRoleResult, AccessError>> + Send;

    /// Gets all the user's that have access to a given entity.
    fn get_entity_users(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, AccessError>> + Send;

    /// Get all active participant user IDs in a channel.
    fn get_channel_users(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, AccessError>> + Send;

    /// Resolve a call ID to its channel ID and share permission ID.
    ///
    /// Checks both the `calls` table (active calls) and the `call_records` table
    /// (archived calls). Returns `None` if the call does not exist in either table.
    fn get_call_channel(
        &self,
        call_id: &Uuid,
    ) -> impl Future<Output = Result<Option<CallChannelInfo>, AccessError>> + Send;

    /// Resolve a channel ID to the call's channel info and share permission ID.
    ///
    /// Checks both the `calls` table (active calls) and the `call_records` table
    /// (archived calls). Returns `None` if no call exists for the channel.
    fn get_call_channel_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Option<CallChannelInfo>, AccessError>> + Send;

    /// Look up the single team a user belongs to and the role they hold.
    ///
    /// Returns `None` if the user does not belong to any team. If the user is in
    /// more than one team (which is not expected), the highest-privileged role
    /// is returned.
    fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Option<UserTeamInfo>, AccessError>> + Send;
}

/// Service for checking entity access levels.
///
/// This service orchestrates access checks using the repository.
pub trait EntityAccessService: Clone + Send + Sync + 'static {
    /// Generates an [`EntityAccessReceipt<T>`] for a given entity and user.
    ///
    /// The type parameter `T` specifies the minimum permission required.
    /// Returns an error if the user does not satisfy that requirement.
    fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<EntityAccessReceipt<T>, AccessError>> + Send;

    /// Get the access level a user has for an entity.
    ///
    /// Returns `None` if the user has no access to the entity.
    fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Check if a user has at least the required access level for an entity.
    ///
    /// Returns the actual access level if access is granted.
    /// Returns an error if the user does not have sufficient access.
    fn check_access(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> impl Future<Output = Result<AccessLevel, AccessError>> + Send;

    /// Check if the public access level is at least the required access level for an entity.
    ///
    /// Returns the actual access level if access is granted.
    /// Returns an error if there is not sufficient access.
    fn check_public_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> impl Future<Output = Result<AccessLevel, AccessError>> + Send;

    /// Get the user's permission for an entity.
    ///
    /// Returns `EntityPermission::AccessLevel` for items (documents, chats, projects, threads)
    /// and `EntityPermission::ChannelRole` for channels.
    ///
    /// Returns `AccessError::Unauthorized` if the user has no access.
    fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        user_org_id: Option<i64>,
    ) -> impl Future<Output = Result<EntityPermission, AccessError>> + Send;

    /// Get all user IDs that have access to a given entity.
    ///
    /// For Document, Chat, Project, and EmailThread: returns user IDs with direct
    /// access or inherited access through the project hierarchy via `entity_access`.
    /// For Channel: returns active channel participants.
    /// Returns `AccessError::BadRequest` for unsupported types (Team, User).
    fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, AccessError>> + Send;

    /// Resolve a call ID to its channel ID and share permission ID.
    ///
    /// Checks both `calls` (active) and `call_records` (archived) tables.
    fn get_call_channel(
        &self,
        call_id: &Uuid,
    ) -> impl Future<Output = Result<Option<CallChannelInfo>, AccessError>> + Send;

    /// Resolve a channel ID to the call's channel info and share permission ID.
    ///
    /// Checks both `calls` (active) and `call_records` (archived) tables.
    fn get_call_channel_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Option<CallChannelInfo>, AccessError>> + Send;

    /// Look up the team a user belongs to and the role they hold in it.
    ///
    /// Returns `None` if the user has no team membership.
    fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Option<UserTeamInfo>, AccessError>> + Send;
}
