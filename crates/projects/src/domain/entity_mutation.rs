//! Unified entity-mutation capability impls for projects.

use std::collections::HashSet;

use entity_access::domain::models::{
    AccessError, EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel,
};
use entity_access_management::domain::ports::EntityAccessManagementService;
use entity_mutation::{
    DeleteEntityPermanently, EntityMutationErrorCode, MoveEntity, RenameEntity, RestoreEntity,
    TrashEntity, UpdateEntitySharePolicy, capability::MoveEntityRequest,
};
use macro_event_broker::MacroEventBroker;
use model::project::{BasicProject, request::PatchProjectRequestV2};
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;

use super::{
    models::ProjectError,
    ports::{
        BulkUploadRequestPort, ProjectRepo, ProjectSearchIndexer, ProjectService,
        ProjectUploadUrlPort, ShaCounterPort,
    },
    service::ProjectServiceImpl,
};

impl From<ProjectError> for EntityMutationErrorCode {
    fn from(error: ProjectError) -> Self {
        match error {
            error @ ProjectError::NotFound(_) => Self::not_found(rootcause::report!(error)),
            error @ (ProjectError::Unauthorized | ProjectError::UnauthorizedWithMessage(_)) => {
                Self::forbidden(rootcause::report!(error))
            }
            error @ (ProjectError::BadRequest(_)
            | ProjectError::NameTooLong { .. }
            | ProjectError::RecursiveNesting) => Self::invalid(rootcause::report!(error)),
            error @ ProjectError::CannotModifyDeleted => Self::conflict(rootcause::report!(error)),
            error @ ProjectError::Internal(_) => Self::internal(rootcause::report!(error)),
        }
    }
}

/// Map an access-domain error onto the public mutation vocabulary.
fn access_error(error: AccessError) -> EntityMutationErrorCode {
    match error {
        error @ (AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_)) => {
            EntityMutationErrorCode::forbidden(rootcause::report!(error))
        }
        error @ AccessError::NotFound(_) => {
            EntityMutationErrorCode::not_found(rootcause::report!(error))
        }
        error @ AccessError::BadRequest(_) => {
            EntityMutationErrorCode::invalid(rootcause::report!(error))
        }
        error @ (AccessError::DatabaseError(_) | AccessError::Internal) => {
            EntityMutationErrorCode::internal(rootcause::report!(error))
        }
    }
}

/// Build affected project entities from optional container ids.
fn project_refs(ids: impl IntoIterator<Item = Option<String>>) -> Vec<Entity<'static>> {
    let mut seen = HashSet::new();
    ids.into_iter()
        .flatten()
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .map(|id| EntityType::Project.with_entity_string(id))
        .collect()
}

/// Fetch project metadata; access is enforced separately via receipts.
async fn basic_project<S: ProjectService>(
    service: &S,
    entity: &Entity<'static>,
) -> Result<BasicProject, EntityMutationErrorCode> {
    Ok(service
        .internal_get_basic_project(&entity.entity_id)
        .await?)
}

impl<R, U, D, Sha, Eam, Idx, B> RenameEntity for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
    Self: ProjectService,
{
    type Receipt = EditAccessLevel;

    async fn rename_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        display_name: String,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project = basic_project(self, &entity).await?;
        let parent_id = project.parent_id.clone();
        self.edit_project(
            receipt,
            project,
            PatchProjectRequestV2 {
                name: Some(display_name),
                project_parent_id: None,
                share_permission: None,
            },
        )
        .await?;
        Ok(project_refs([parent_id]))
    }
}

impl<R, U, D, Sha, Eam, Idx, B> MoveEntity for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
    Self: ProjectService,
{
    type Receipt = OwnerAccessLevel;

    async fn move_entity(
        &self,
        request: MoveEntityRequest<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let (entity, receipt, project_id) = match request {
            MoveEntityRequest::MoveToRoot { entity, receipt } => (entity, receipt, None),
            MoveEntityRequest::MoveToProject {
                entity,
                receipt,
                project_id,
                project_receipt: _,
            } => (entity, receipt, Some(project_id)),
        };
        let project = basic_project(self, &entity).await?;
        let old_parent_id = project.parent_id.clone();
        // Moving requires ownership at the API surface; the edit call itself
        // consumes an edit-level receipt. Self-parenting, cycles, and
        // deleted-state are enforced by the project domain service; an empty
        // parent id means "root".
        let receipt = receipt
            .try_into_requirement::<EditAccessLevel>()
            .map_err(access_error)?;
        self.edit_project(
            receipt,
            project,
            PatchProjectRequestV2 {
                name: None,
                project_parent_id: Some(project_id.clone().unwrap_or_default()),
                share_permission: None,
            },
        )
        .await?;
        Ok(project_refs([old_parent_id, project_id]))
    }
}

impl<R, U, D, Sha, Eam, Idx, B> UpdateEntitySharePolicy
    for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
    Self: ProjectService,
{
    type Receipt = OwnerAccessLevel;

    async fn update_share_policy(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project = basic_project(self, &entity).await?;
        let receipt = receipt
            .try_into_requirement::<EditAccessLevel>()
            .map_err(access_error)?;
        self.edit_project(
            receipt,
            project,
            PatchProjectRequestV2 {
                name: None,
                project_parent_id: None,
                share_permission: Some(policy),
            },
        )
        .await?;
        Ok(Vec::new())
    }
}

impl<R, U, D, Sha, Eam, Idx, B> TrashEntity for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
    Self: ProjectService,
{
    type Receipt = OwnerAccessLevel;

    async fn trash_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project = basic_project(self, &entity).await?;
        let actor = receipt
            .get_authenticated_user()
            .map_err(access_error)?
            .to_string();
        let deleted = self.soft_delete_project(receipt, project, actor).await?;
        Ok(refs(EntityType::Project, deleted.project_ids)
            .chain(refs(EntityType::Document, deleted.document_ids))
            .chain(refs(EntityType::Chat, deleted.chat_ids))
            .collect())
    }
}

impl<R, U, D, Sha, Eam, Idx, B> RestoreEntity for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
    Self: ProjectService,
{
    type Receipt = OwnerAccessLevel;

    async fn restore_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project = basic_project(self, &entity).await?;
        let parent_id = project.parent_id.clone();
        self.revert_delete_project(receipt, project).await?;
        Ok(project_refs([parent_id]))
    }
}

impl<R, U, D, Sha, Eam, Idx, B> DeleteEntityPermanently
    for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
    Self: ProjectService,
{
    type Receipt = OwnerAccessLevel;

    async fn delete_entity_permanently(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let project = basic_project(self, &entity).await?;
        let parent_id = project.parent_id.clone();
        self.permanently_delete_project(receipt, project).await?;
        Ok(project_refs([parent_id]))
    }
}

/// Build entity refs of one kind from raw ids.
fn refs(
    entity_type: EntityType,
    ids: impl IntoIterator<Item = String>,
) -> impl Iterator<Item = Entity<'static>> {
    ids.into_iter()
        .map(move |id| entity_type.with_entity_string(id))
}
