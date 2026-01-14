//! Port definitions for entity access.
//!
//! These traits define the contracts that adapters must implement.

use super::models::EntityType;
use crate::domain::models::{AccessError, AccessLevel};
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
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for a chat.
    ///
    /// Considers both explicit grants (UserItemAccess) and public access
    /// (SharePermission) inherited through the project hierarchy.
    fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for a project.
    ///
    /// Considers both explicit grants (UserItemAccess) and public access
    /// (SharePermission) inherited through the project hierarchy.
    fn get_project_access(
        &self,
        project_id: &str,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level a user has for an email thread.
    ///
    /// Considers both explicit grants (UserItemAccess) and public access
    /// (SharePermission) inherited through the project hierarchy.
    fn get_thread_access(
        &self,
        thread_id: &str,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Check if a user is a member of the specified channels.
    ///
    /// Returns the subset of channel_ids that the user is a participant of.
    fn check_user_channel_membership(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        channel_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Uuid>, AccessError>> + Send;
}

/// Service for checking entity access levels.
///
/// This service orchestrates access checks using the repository.
pub trait EntityAccessService: Clone + Send + Sync + 'static {
    /// Get the access level a user has for an entity.
    ///
    /// Returns `None` if the user has no access to the entity.
    fn get_access_level(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Check if a user has at least the required access level for an entity.
    ///
    /// Returns the actual access level if access is granted.
    /// Returns an error if the user does not have sufficient access.
    fn check_access(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> impl Future<Output = Result<AccessLevel, AccessError>> + Send;
}
