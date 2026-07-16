//! Concrete project service composition.

use std::collections::HashSet;

use entity_access::domain::models::{
    EntityAccessAuth, EntityAccessReceipt, EntityPermission, OwnerAccessLevel, ViewAccessLevel,
};
use entity_access_management::domain::ports::EntityAccessManagementService;
use futures::stream::{FuturesUnordered, StreamExt};
use macro_user_id::user_id::MacroUserIdStr;
use model::item::{Item, ItemWithUserAccessLevel};
use model::project::response::GetProjectResponseData;
use model::project::{
    BasicProject, PendingProject, Project, ProjectPreview, ProjectPreviewData, ProjectPreviewV2,
    WithProjectId,
};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use uuid::Uuid;

use super::models::ProjectError;
use super::ports::{
    BulkUploadRequestPort, ProjectRepo, ProjectSearchIndexer, ProjectService, ProjectUploadUrlPort,
    ShaCounterPort,
};

#[cfg(test)]
mod tests;

/// Concrete project service backed by repository and external-system ports.
pub struct ProjectServiceImpl<R, U, D, Sha, Eam, Idx>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
{
    /// Project repository.
    pub repo: R,
    /// Upload destination provider.
    pub upload_url_service: U,
    /// Bulk-upload request provider.
    pub bulk_upload_service: D,
    /// Content-hash reference counter.
    pub sha_counter: Sha,
    /// Entity-access inheritance manager.
    pub entity_access_management_service: Eam,
    /// Search and deletion queue publisher.
    pub search_indexer: Idx,
    /// Optional deterministic upload request ID used by local development.
    pub fixed_upload_request_id: Option<Uuid>,
}

impl<R, U, D, Sha, Eam, Idx> ProjectServiceImpl<R, U, D, Sha, Eam, Idx>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
{
    /// Create a project service from its repository and external-system ports.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        repo: R,
        upload_url_service: U,
        bulk_upload_service: D,
        sha_counter: Sha,
        entity_access_management_service: Eam,
        search_indexer: Idx,
        fixed_upload_request_id: Option<Uuid>,
    ) -> Self {
        Self {
            repo,
            upload_url_service,
            bulk_upload_service,
            sha_counter,
            entity_access_management_service,
            search_indexer,
            fixed_upload_request_id,
        }
    }
}

impl<R, U, D, Sha, Eam, Idx> ProjectService for ProjectServiceImpl<R, U, D, Sha, Eam, Idx>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
{
    async fn list_projects(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<Project>, ProjectError> {
        self.repo
            .get_projects_for_user(user_id.as_ref())
            .await
            .map_err(|error| internal_error(error, "unable to list projects"))
    }

    async fn list_pending_projects(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<PendingProject>, ProjectError> {
        let pending_projects = self
            .repo
            .get_pending_root_projects(user_id.as_ref())
            .await
            .map_err(|error| internal_error(error, "unable to list pending projects"))?;
        let mut pending_futures = FuturesUnordered::new();

        for pending_project in pending_projects {
            let project = pending_project.project;
            if project.parent_id.is_some() {
                tracing::warn!(project_id = %project.id, "skipping non-root pending project");
                continue;
            }

            let upload_request_id = pending_project.upload_request_id;
            pending_futures.push(async move {
                let Some(upload_request_id) = upload_request_id else {
                    tracing::warn!(project_id = %project.id, "pending project has no upload request");
                    return Some(PendingProject {
                        project,
                        document_statuses: Vec::new(),
                    });
                };

                let status_result = match self
                    .bulk_upload_service
                    .get_bulk_upload_document_statuses(&upload_request_id)
                    .await
                {
                    Ok(status_result) => status_result,
                    Err(error) => {
                        tracing::error!(
                            error = ?error,
                            project_id = %project.id,
                            "unable to get pending project document statuses"
                        );
                        return Some(PendingProject {
                            project,
                            document_statuses: Vec::new(),
                        });
                    }
                };

                if status_result.documents.is_empty() {
                    tracing::warn!(%upload_request_id, "upload request has no documents");
                } else if status_result.root_project_id != project.id {
                    tracing::error!(
                        %upload_request_id,
                        project_id = %project.id,
                        dynamo_root_project_id = %status_result.root_project_id,
                        "upload request root project ID does not match pending project"
                    );
                    return None;
                }

                Some(PendingProject {
                    project,
                    document_statuses: status_result.documents,
                })
            });
        }

        let mut projects = Vec::new();
        while let Some(project) = pending_futures.next().await {
            if let Some(project) = project {
                projects.push(project);
            }
        }
        Ok(projects)
    }

    async fn get_project(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetProjectResponseData, ProjectError> {
        let project_id = &receipt.entity().entity_id;
        let project_metadata = self
            .repo
            .get_project_by_id(project_id)
            .await
            .map_err(|error| internal_error(error, "unable to get project"))?
            .ok_or_else(|| ProjectError::NotFound(project_id.clone()))?;

        Ok(GetProjectResponseData {
            project_metadata,
            user_access_level: receipt_access_level(&receipt)?,
        })
    }

    async fn get_project_content(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<ItemWithUserAccessLevel>, ProjectError> {
        let project_access_level = receipt_access_level(&receipt)?;
        let actor = match receipt.auth() {
            EntityAccessAuth::Authenticated(user_id) => Some(user_id.as_ref()),
            _ => None,
        };
        let internal = matches!(receipt.auth(), EntityAccessAuth::Internal);
        let children = self
            .repo
            .get_project_children(&receipt.entity().entity_id)
            .await
            .map_err(|error| internal_error(error, "unable to get project content"))?;

        Ok(children
            .into_iter()
            .map(|item| {
                let user_access_level = if internal || actor.is_some_and(|actor| owns(&item, actor))
                {
                    AccessLevel::Owner
                } else {
                    project_access_level
                };
                ItemWithUserAccessLevel {
                    item,
                    user_access_level,
                }
            })
            .collect())
    }

    async fn get_project_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<SharePermissionV2, ProjectError> {
        self.repo
            .get_project_share_permission(&receipt.entity().entity_id)
            .await
            .map_err(|error| internal_error(error, "unable to get project permissions"))
    }

    async fn get_project_access_level(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<AccessLevel, ProjectError> {
        receipt_access_level(&receipt)
    }

    async fn get_batch_preview(
        &self,
        _actor: Option<MacroUserIdStr<'static>>,
        project_ids: Vec<String>,
    ) -> Result<Vec<ProjectPreview>, ProjectError> {
        let unique_project_ids: HashSet<String> = project_ids.into_iter().collect();
        let project_ids: Vec<String> = unique_project_ids.into_iter().collect();
        let previews = self
            .repo
            .batch_get_project_preview(&project_ids)
            .await
            .map_err(|error| internal_error(error, "unable to get project previews"))?;

        Ok(previews.into_iter().map(map_preview).collect())
    }

    async fn internal_get_basic_project(
        &self,
        project_id: &str,
    ) -> Result<BasicProject, ProjectError> {
        self.repo
            .get_basic_project(project_id)
            .await
            .map_err(|error| internal_error(error, "unable to get basic project"))?
            .ok_or_else(|| ProjectError::NotFound(project_id.to_string()))
    }
}

fn receipt_access_level<T>(receipt: &EntityAccessReceipt<T>) -> Result<AccessLevel, ProjectError>
where
    T: entity_access::domain::models::RequiredPermission,
{
    if matches!(receipt.auth(), EntityAccessAuth::Internal) {
        return Ok(AccessLevel::Owner);
    }

    match receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => Ok(*access_level),
        _ => Err(ProjectError::Internal(anyhow::anyhow!(
            "invalid project access receipt"
        ))),
    }
}

fn owns(item: &Item, actor: &str) -> bool {
    match item {
        Item::Project(project) => project.user_id == actor,
        Item::Document(document) => document.owner.as_ref() == actor,
        Item::Chat(chat) => chat.user_id == actor,
    }
}

fn map_preview(preview: ProjectPreviewV2) -> ProjectPreview {
    match preview {
        ProjectPreviewV2::Found(data) => ProjectPreview::Access(ProjectPreviewData {
            id: data.id,
            name: data.name,
            owner: data.owner,
            path: data.path,
            updated_at: data.updated_at,
        }),
        ProjectPreviewV2::DoesNotExist(data) => {
            ProjectPreview::DoesNotExist(WithProjectId { id: data.id })
        }
    }
}

fn internal_error(error: impl std::fmt::Debug, message: &'static str) -> ProjectError {
    tracing::error!(error = ?error, message);
    ProjectError::Internal(anyhow::anyhow!(message))
}
