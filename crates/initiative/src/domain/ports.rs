//! Ports (trait contracts) for the initiative domain.

use super::reads::{
    InitiativePage, InitiativePageRequest, InitiativePageRow, InitiativeTasksPage,
    InitiativeTasksRequest, TaskInitiativeReferences, TaskInitiativeReferencesRequest,
};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::team_share::{TeamShareCreation, TeamShareFacts};
use models_permissions::share_permission::{SharePermissionV2, TeamLinkShareDefault};
use std::collections::HashMap;

use crate::domain::events::{AssignedTasks, TaskMembershipChange};
use crate::domain::models::{
    AssignTasksResponse, CreateInitiativeRepoArgs, CreateInitiativeRequest, InitiativeBasic,
    InitiativeDetail, InitiativeError, InitiativeId, InitiativeList, TaskAssignment,
    UpdateInitiativeRepoArgs, UpdateInitiativeRequest,
};

/// Outbound port for the collab surface holding an initiative's description. The surface
/// has the initiative's id and is parented by it, so its access derives from initiative
/// access; the initiative domain has already authorized every call.
#[cfg_attr(test, mockall::automock)]
pub trait InitiativeDescriptionSurfaces: Send + Sync + 'static {
    /// Idempotently ensure the initiative's surface exists and is ready. A new surface starts
    /// from `markdown`; an existing one keeps its content.
    fn ensure(
        &self,
        initiative: InitiativeId,
        markdown: String,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;

    /// The description as GitHub-flavored markdown; empty while the surface was never ensured.
    fn read(
        &self,
        initiative: InitiativeId,
    ) -> impl Future<Output = Result<String, InitiativeError>> + Send;

    /// Soft-delete the surface so no new connection token is minted for it. Idempotent, and a
    /// surface that was never ensured is already gone.
    fn delete(
        &self,
        initiative: InitiativeId,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;
}

/// Outbound persistence port for initiatives.
#[cfg_attr(test, mockall::automock(type Err = InitiativeError;))]
pub trait InitiativeRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<InitiativeError> + Send + std::fmt::Debug;

    /// Read task membership in one batch. Callers authorize both ends before displaying it.
    fn task_memberships(
        &self,
        task_ids: Vec<String>,
    ) -> impl Future<Output = Result<HashMap<String, InitiativeId>, Self::Err>> + Send;

    /// Persist a new initiative, its members, and initial share state in one transaction.
    fn create(
        &self,
        args: CreateInitiativeRepoArgs,
        share_permission: SharePermissionV2,
        team_share: TeamShareCreation,
    ) -> impl Future<Output = Result<InitiativeDetail, Self::Err>> + Send;

    /// Load the identity row used by access checks.
    fn get_basic(
        &self,
        id: InitiativeId,
    ) -> impl Future<Output = Result<Option<InitiativeBasic>, Self::Err>> + Send;

    /// Load the full initiative, including members, tasks, and share state.
    fn get_detail(
        &self,
        id: InitiativeId,
    ) -> impl Future<Output = Result<Option<InitiativeDetail>, Self::Err>> + Send;

    /// List initiatives the user can view.
    fn list_accessible(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<InitiativeList, Self::Err>> + Send;

    /// Apply an update, including member add/remove sets, share patch, and optional team
    /// share, in one transaction.
    fn update(
        &self,
        args: UpdateInitiativeRepoArgs,
    ) -> impl Future<Output = Result<InitiativeDetail, Self::Err>> + Send;

    /// Load canonical team-share facts for an initiative.
    fn get_team_share_facts(
        &self,
        id: InitiativeId,
    ) -> impl Future<Output = Result<TeamShareFacts, Self::Err>> + Send;

    /// Load the owner's team default link-share preference, if any.
    fn get_team_default_link_share(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<TeamLinkShareDefault>, Self::Err>> + Send;

    /// Assign the accepted task ids. Returns one outcome per submitted id.
    fn assign_tasks(
        &self,
        id: InitiativeId,
        task_ids: Vec<String>,
    ) -> impl Future<Output = Result<AssignedTasks, Self::Err>> + Send;

    /// Remove one task from the initiative.
    fn unassign_task(
        &self,
        id: InitiativeId,
        task_id: &str,
    ) -> impl Future<Output = Result<Option<TaskMembershipChange>, Self::Err>> + Send;

    /// Clear any initiative association for a task. Already unassigned tasks succeed.
    fn clear_task(
        &self,
        task_id: &str,
    ) -> impl Future<Output = Result<Option<TaskMembershipChange>, Self::Err>> + Send;

    /// Grant assignees edit access to the initiative in one transaction,
    /// recording non-owner recipients as collaborators without removing anyone or
    /// downgrading existing grants. Clearing the property does not undo this share.
    fn grant_assignees(
        &self,
        id: InitiativeId,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the initiative and clean up its own rows in one transaction.
    fn delete(&self, id: InitiativeId) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Inbound service port: the initiative API used by drivers (HTTP).
pub trait InitiativeService: Send + Sync + 'static {
    /// Read canonical properties and visible task progress for one authorized initiative.
    fn summary(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<InitiativePageRow, InitiativeError>> + Send;

    /// Filter, order and page the caller's discoverable initiatives.
    fn page(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: InitiativePageRequest,
    ) -> impl Future<Output = Result<InitiativePage, InitiativeError>> + Send;

    /// Page visible tasks within an authorized initiative.
    fn tasks_page(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: InitiativeTasksRequest,
    ) -> impl Future<Output = Result<InitiativeTasksPage, InitiativeError>> + Send;

    /// Resolve task chips without revealing inaccessible initiative metadata.
    fn task_references(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: TaskInitiativeReferencesRequest,
    ) -> impl Future<Output = Result<TaskInitiativeReferences, InitiativeError>> + Send;
    /// Create an initiative owned by `user_id`.
    fn create(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
    ) -> impl Future<Output = Result<InitiativeDetail, InitiativeError>> + Send;

    /// Create for a trusted principal. Direct users must be the owner; delegated
    /// bots must act for that owner. HTTP bodies and tool inputs never provide attribution.
    fn create_attributed(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
        attribution: activity::Attribution,
    ) -> impl Future<Output = Result<InitiativeDetail, InitiativeError>> + Send;

    /// Load identity without an access receipt. For internal callers only.
    fn internal_get_basic(
        &self,
        id: InitiativeId,
    ) -> impl Future<Output = Result<InitiativeBasic, InitiativeError>> + Send;

    /// Load the full initiative the receipt already authorized for view.
    fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<InitiativeDetail, InitiativeError>> + Send;

    /// Idempotently ensure the description surface of an initiative the receipt authorized
    /// for view, before a client connects to it. The surface has the initiative's id.
    fn ensure_description_surface(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;

    /// The description of an initiative the receipt authorized for view, as GitHub-flavored
    /// markdown; empty while no one has opened or written it.
    fn read_description(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<String, InitiativeError>> + Send;

    /// List initiatives the user can view.
    fn list(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<InitiativeList, InitiativeError>> + Send;

    /// Update fields the receipt already authorized for edit.
    fn update(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: UpdateInitiativeRequest,
    ) -> impl Future<Output = Result<InitiativeDetail, InitiativeError>> + Send;

    /// Assign or move tasks using destination and task edit capabilities for the same actor.
    /// Source initiative edit access is deliberately not required.
    fn assign_tasks(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        assignments: Vec<TaskAssignment>,
    ) -> impl Future<Output = Result<AssignTasksResponse, InitiativeError>> + Send;

    /// Unassign one task using both initiative and task edit capabilities for the same actor.
    fn unassign_task(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        task_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;

    /// Clear a task's initiative using task edit access alone, including after project access
    /// is revoked. Already unassigned tasks succeed.
    fn clear_task(
        &self,
        task_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;

    /// Share both project entities with assignees, adding non-owner collaborators.
    /// Clearing an assignee does not revoke access or membership, matching task sharing.
    fn grant_assignees(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;

    /// Delete the initiative the receipt already authorized as owner.
    fn delete(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;
}
