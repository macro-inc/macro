//! Ports (trait contracts) for the initiative domain.

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::team_share::TeamShareCreation;
use models_permissions::share_permission::{SharePermissionV2, TeamLinkShareDefault};

use crate::domain::models::{
    AssignTasksResponse, AssignTasksResult, CreateInitiativeRepoArgs, CreateInitiativeRequest,
    DescriptionDocumentId, InitiativeBasic, InitiativeDetail, InitiativeError, InitiativeId,
    InitiativeList, LockstepTeamShareFacts, NewDescriptionDocument, TaskAssignment,
    UpdateInitiativeRepoArgs, UpdateInitiativeRequest,
};

/// Outbound port for the description document's lifecycle.
#[cfg_attr(test, mockall::automock)]
pub trait InitiativeDescriptionDocuments: Send + Sync + 'static {
    /// Create the `initiative_description` markdown document, editor-ready, owned by
    /// `document.owner` with link share exactly `document.link_share`. Commits before returning.
    fn create(
        &self,
        document: NewDescriptionDocument,
    ) -> impl Future<Output = Result<DescriptionDocumentId, InitiativeError>> + Send;

    /// Remove the document and everything that hangs off it: rows, grants, sync-service state,
    /// mentions, and the events downstream consumers need to forget it. Purging an id that is
    /// already gone succeeds, so a failed purge can be retried.
    fn purge(
        &self,
        id: DescriptionDocumentId,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;
}

/// Outbound persistence port for initiatives.
#[cfg_attr(test, mockall::automock(type Err = InitiativeError;))]
pub trait InitiativeRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<InitiativeError> + Send + std::fmt::Debug;

    /// Persist a new initiative, its members, and initial share state, mirroring the member
    /// and team grants onto `args.description_document_id` in the same transaction.
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
    /// share, to the initiative and its description document in one transaction.
    fn update(
        &self,
        args: UpdateInitiativeRepoArgs,
    ) -> impl Future<Output = Result<InitiativeDetail, Self::Err>> + Send;

    /// Load canonical team-share facts for an initiative and its description document from
    /// one guarded read.
    fn get_team_share_facts(
        &self,
        id: InitiativeId,
    ) -> impl Future<Output = Result<LockstepTeamShareFacts, Self::Err>> + Send;

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
    ) -> impl Future<Output = Result<Vec<AssignTasksResult>, Self::Err>> + Send;

    /// Remove one task from the initiative.
    fn unassign_task(
        &self,
        id: InitiativeId,
        task_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the initiative and clean up its own rows in one transaction, returning the
    /// description document id for the caller to purge afterwards.
    fn delete(
        &self,
        id: InitiativeId,
    ) -> impl Future<Output = Result<DescriptionDocumentId, Self::Err>> + Send;
}

/// Inbound service port: the initiative API used by drivers (HTTP).
pub trait InitiativeService: Send + Sync + 'static {
    /// Create an initiative owned by `user_id`.
    fn create(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
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

    /// Assign tasks the receipt already authorized for edit.
    fn assign_tasks(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        assignments: Vec<TaskAssignment>,
    ) -> impl Future<Output = Result<AssignTasksResponse, InitiativeError>> + Send;

    /// Unassign one task the receipt already authorized for edit.
    fn unassign_task(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        task_id: &str,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;

    /// Delete the initiative the receipt already authorized as owner.
    fn delete(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), InitiativeError>> + Send;
}
