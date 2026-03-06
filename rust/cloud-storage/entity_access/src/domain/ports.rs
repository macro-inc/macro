//! Port definitions for entity access.
//!
//! These traits define the contracts that adapters must implement.

use super::models::EntityType;
use crate::domain::models::{
    AccessError, AccessLevel, ChannelRoleResult, EntityAccessReceipt, EntityPermission,
    RequiredAccessLevel,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use std::future::Future;
use uuid::Uuid;

/// Repository for accessing entity permissions from the database.
///
/// This trait abstracts database operations for checking user access to entities.
/// All methods query the database directly - no HTTP calls to external services.
pub trait AccessRepository: Clone + Send + Sync + 'static {
    /// Get the highest access level a user has for a document.
    ///
    /// Considers both explicit grants (UserItemAccess) and public access
    /// (SharePermission) inherited through the project hierarchy.
    fn get_document_access(
        &self,
        document_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for a chat.
    ///
    /// Considers both explicit grants (UserItemAccess) and public access
    /// (SharePermission) inherited through the project hierarchy.
    fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for a project.
    ///
    /// Considers both explicit grants (UserItemAccess) and public access
    /// (SharePermission) inherited through the project hierarchy.
    fn get_project_access(
        &self,
        project_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for an email thread.
    ///
    /// Considers both explicit grants (UserItemAccess) and public access
    /// (SharePermission) inherited through the project hierarchy.
    fn get_thread_access(
        &self,
        thread_id: &str,
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
}

/// Service for checking entity access levels.
///
/// This service orchestrates access checks using the repository.
pub trait EntityAccessService: Clone + Send + Sync + 'static {
    /// Generates an [`EntityAccessReceipt<T>`] for a given entity and user.
    ///
    /// The type parameter `T` specifies the minimum access level required.
    /// Returns an error if the user does not have at least that level.
    fn generate_entity_access_receipt<T: RequiredAccessLevel>(
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
}
