//! Port definitions for entity access.
//!
//! These traits define the contracts that adapters must implement.

use super::models::EntityType;
use crate::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, ChannelRoleResult,
    CrmEntityAccess, EntityAccessReceipt, EntityPermission, RequiredPermission, TeamRole,
    UserTeamInfo, ViewAccessLevel,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use std::{collections::HashMap, future::Future};
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

    /// Return the requested email threads owned by, or inbox-delegated to, a user.
    fn get_owned_email_thread_ids(
        &self,
        thread_ids: &[Uuid],
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Vec<Uuid>, AccessError>> + Send;

    /// Get the highest access level a user has for a call.
    fn get_call_access(
        &self,
        call_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get the highest access level available to a bot in its owning team's
    /// scope for a document, chat, project, email thread, or call.
    ///
    /// Team scope includes the team, its team channels, the bot principal, and
    /// channels in which the bot is an active participant. Email-thread
    /// ownership and inbox delegation are intentionally excluded.
    fn get_team_entity_access(
        &self,
        bot_id: BotId,
        team_id: Uuid,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;

    /// Get a bot's channel permission while operating in its owning team's scope.
    ///
    /// Active bot participation grants the stored role in any channel. Without
    /// participation, only a channel owned by the scoped team grants view-only
    /// access.
    fn get_team_channel_role(
        &self,
        channel_id: &Uuid,
        team_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<ChannelRoleResult, AccessError>> + Send;

    /// Check whether a scoped team or bot-principal source pair grants access
    /// to a foreign entity.
    fn has_team_foreign_entity_access(
        &self,
        foreign_entity_id: &str,
        team_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<bool, AccessError>> + Send;

    /// Get member-equivalent access to a visible CRM company owned by the
    /// scoped team.
    fn get_team_crm_company_access(
        &self,
        company_id: &str,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Option<CrmEntityAccess>, AccessError>> + Send;

    /// Get member-equivalent access to a visible CRM contact owned by the
    /// scoped team. Hidden contacts and contacts of hidden companies are
    /// excluded.
    fn get_team_crm_contact_access(
        &self,
        contact_id: &str,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Option<CrmEntityAccess>, AccessError>> + Send;

    /// Check whether a user has access to a foreign entity.
    ///
    /// Foreign entity access is boolean because it only maps to [`AccessLevel::View`]
    /// at the service layer.
    fn has_foreign_entity_access(
        &self,
        foreign_entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<bool, AccessError>> + Send;

    /// Get the access level a user has for a CRM company, with the company's
    /// owning `team_id`.
    ///
    /// Access derives from the user's role on the team that owns the company:
    /// `Owner` → [`AccessLevel::Owner`], `Admin` and `Member` →
    /// [`AccessLevel::Edit`]. Hidden companies are invisible to plain members
    /// (returns `None`) but reachable by admins and owners. The returned
    /// `team_id` is the company's owning team and `team_role` the user's role
    /// on it, both resolved from the same row that grants access.
    fn get_crm_company_access(
        &self,
        company_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<CrmEntityAccess>, AccessError>> + Send;

    /// Get the access level a user has for a CRM contact, with the contact's
    /// owning `team_id` (its parent company's team).
    ///
    /// Access derives from the user's role on the team that owns the contact's
    /// parent company, with the same role-to-level mapping as
    /// [`Self::get_crm_company_access`]. Hidden contacts (or contacts whose
    /// parent company is hidden) are invisible to plain members.
    fn get_crm_contact_access(
        &self,
        contact_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> impl Future<Output = Result<Option<CrmEntityAccess>, AccessError>> + Send;

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
    /// - User has an active participant role (considering channel type rules)
    /// - User has view-only access without an active participant role
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

    /// Mint view receipts for a distinct batch of email thread IDs.
    ///
    /// Implementations may override this to share authorization work across
    /// the batch. The default preserves correctness for test and alternate
    /// adapters by delegating to the single-entity API.
    fn generate_email_thread_view_access_receipts<'a>(
        &'a self,
        user_id: &'a MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        thread_ids: &'a [String],
    ) -> impl Future<
        Output = HashMap<String, Result<EntityAccessReceipt<ViewAccessLevel>, AccessError>>,
    > + Send
    + 'a {
        async move {
            let mut receipts = HashMap::with_capacity(thread_ids.len());
            for thread_id in thread_ids {
                receipts.insert(
                    thread_id.clone(),
                    self.generate_entity_access_receipt::<ViewAccessLevel>(
                        user_id,
                        user_org_id,
                        thread_id,
                        EntityType::EmailThread,
                    )
                    .await,
                );
            }
            receipts
        }
    }

    /// Generates an [`EntityAccessReceipt<T>`] for an authenticated bot.
    ///
    /// User scope delegates to the acting user's permission path. Team scope
    /// resolves item, channel, foreign-entity, CRM, and owning-team permissions
    /// from the scoped team's shared pool plus explicit bot grants. Unsupported
    /// entity types return [`AccessError::BadRequest`].
    ///
    /// The type parameter `T` specifies the minimum permission required.
    /// Returns an error if the bot does not satisfy that requirement.
    fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
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
    /// Returns `EntityPermission::AccessLevel` for items (documents, chats, projects, threads).
    /// Channels return `EntityPermission::ChannelRole` for active participants or
    /// `EntityPermission::ChannelViewOnly` for view-only access.
    ///
    /// Returns `AccessError::Unauthorized` if the user has no access.
    fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        user_org_id: Option<i64>,
    ) -> impl Future<Output = Result<EntityPermission, AccessError>> + Send;

    /// Resolve a user's permission for a CRM company or contact **together
    /// with the entity's owning `team_id` and the user's role on that team**
    /// — all resolved from the same ownership lookup that grants access.
    /// Mint team-scoped CRM receipts off this rather than pairing
    /// [`Self::get_entity_permission`] with [`Self::get_user_team`], so the
    /// bundled team can't drift from the authorized entity for a multi-team
    /// user. The role rides along so CRM receipts can gate hidden-row
    /// visibility and governance actions on admin/owner without a second
    /// lookup. Errors `AccessError::Unauthorized` when access fails.
    ///
    /// No default impl on purpose: implementors must derive the team from the
    /// entity's ownership row (not the user's default team), so the invariant
    /// can't be silently weakened by inheriting a fallback.
    fn get_crm_entity_permission_with_team(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(EntityPermission, Uuid, TeamRole), AccessError>> + Send;

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

/// No-op [`EntityAccessService`] for binaries that need to satisfy the
/// bound but never check access — e.g. schema-only GraphQL SDL export.
/// `get_user_team` reports no membership; every other method errors.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpEntityAccessService;

impl EntityAccessService for NoOpEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(None)
    }
}
