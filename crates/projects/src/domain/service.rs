//! Concrete project service composition.

use std::collections::HashSet;

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    OwnerAccessLevel, ViewAccessLevel,
};
use entity_access_management::domain::ports::EntityAccessManagementService;
use futures::stream::{FuturesUnordered, StreamExt};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use model::folder::{UploadFolderRequest, UploadFolderResponseData};
use model::item::{Item, ItemWithUserAccessLevel};
use model::project::request::{CreateProjectRequest, PatchProjectRequestV2};
use model::project::response::GetProjectResponseData;
use model::project::{
    BasicProject, PendingProject, Project, ProjectPreview, ProjectPreviewData, ProjectPreviewV2,
    WithProjectId,
};
use models_bulk_upload::{UploadExtractFolderRequest, UploadExtractFolderResponseData};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use s3_key::BulkUploadStagingKey;
use unicode_segmentation::UnicodeSegmentation;
use uuid::Uuid;

use super::events::{
    ProjectCreatedMetadata, ProjectDeletedMetadata, ProjectMacroEvent,
    ProjectPermanentlyDeletedMetadata, ProjectRestoredMetadata, ProjectUpdatedMetadata,
    ProjectUploadedMetadata,
};
use super::models::{
    CreateProjectArgs, EditProjectArgs, ProjectError, SoftDeleteResult, UploadFolderRepoArgs,
};
use super::ports::{
    BulkUploadRequestPort, ProjectRepo, ProjectSearchIndexer, ProjectService, ProjectUploadUrlPort,
    ShaCounterPort,
};
use super::upload::{build_destination_map, build_root_folder};

#[cfg(test)]
mod tests;

const MAX_PROJECT_NAME_GRAPHEMES: usize = 100;

/// The user id to attribute a project lifecycle event to, when the caller is an
/// authenticated user.
fn event_actor_user_id(auth: &EntityAccessAuth) -> Option<MacroUserIdStr<'static>> {
    match auth {
        EntityAccessAuth::Authenticated(user_id) => Some(user_id.clone()),
        EntityAccessAuth::Bot(_)
        | EntityAccessAuth::Unauthenticated
        | EntityAccessAuth::Internal => None,
    }
}

/// Concrete project service backed by repository and external-system ports.
pub struct ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
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
    /// Project lifecycle event broker.
    pub macro_event_broker: B,
    /// Optional deterministic upload request ID used by local development.
    pub fixed_upload_request_id: Option<Uuid>,
}

impl<R, U, D, Sha, Eam, Idx, B> ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
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
        macro_event_broker: B,
    ) -> Self {
        Self {
            repo,
            upload_url_service,
            bulk_upload_service,
            sha_counter,
            entity_access_management_service,
            search_indexer,
            macro_event_broker,
            fixed_upload_request_id,
        }
    }

    /// Publish a project lifecycle event; failures are logged and dropped.
    fn publish_project_event(&self, event: &ProjectMacroEvent) {
        let _ = self
            .macro_event_broker
            .send_event(event)
            .inspect_err(|error| {
                tracing::error!(error=?error, "failed to publish project event");
            });
    }

    async fn bump_project_modified(&self, project_id: &str) {
        let _ = self
            .repo
            .update_project_modified(project_id)
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    project_id,
                    "unable to update project modified date"
                );
            });
        let _ = self
            .search_indexer
            .upsert_projects(vec![project_id.to_string()])
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    project_id,
                    "unable to enqueue project search upsert"
                );
            });
    }
}

impl<R, U, D, Sha, Eam, Idx, B> ProjectService for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
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

    async fn create_project(
        &self,
        actor: MacroUserIdStr<'static>,
        args: CreateProjectRequest,
    ) -> Result<Project, ProjectError> {
        validate_project_name(&args.name)?;

        let parent_id = args.project_parent_id.map(|id| id.to_string());
        let project = self
            .repo
            .create_project(CreateProjectArgs {
                user_id: actor.to_string(),
                name: args.name,
                parent_id: parent_id.clone(),
                share_permission: SharePermissionV2::new_project_share_permission(),
            })
            .await
            .map_err(|error| internal_error(error, "unable to create project"))?;

        let entity_id = args
            .project_parent_id
            .map(|_| parse_internal_uuid(&project.id, "created project ID"))
            .transpose()?;
        let _ = self
            .search_indexer
            .upsert_projects(vec![project.id.clone()])
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    project_id = %project.id,
                    "unable to enqueue project search upsert"
                );
            });

        if let Some((parent_id, entity_id)) = args.project_parent_id.zip(entity_id) {
            let _ = self
                .entity_access_management_service
                .add_entity_to_project(&entity_id, EntityType::Project, &parent_id)
                .await
                .inspect_err(|error| {
                    tracing::error!(
                        error = ?error,
                        %entity_id,
                        project_id = %parent_id,
                        "unable to update entity access for project"
                    );
                });
            self.bump_project_modified(&parent_id.to_string()).await;
        }

        self.publish_project_event(&ProjectMacroEvent::created(
            project.id.clone(),
            ProjectCreatedMetadata {
                project_id: project.id.clone(),
                owner: actor,
                name: project.name.clone(),
                parent_project_id: project.parent_id.clone(),
                created_at: project.created_at,
            },
        ));

        Ok(project)
    }

    async fn edit_project(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        project: BasicProject,
        args: PatchProjectRequestV2,
    ) -> Result<(), ProjectError> {
        if project.deleted_at.is_some() {
            return Err(ProjectError::CannotModifyDeleted);
        }
        if let Some(name) = args.name.as_deref() {
            validate_project_name(name)?;
        }

        let requested_name = args.name.clone();
        let requested_parent_id = args.project_parent_id.clone();
        let share_permission_updated = args.share_permission.is_some();

        let is_owner = receipt_is_owner(&receipt);
        if args.project_parent_id.is_some() && !is_owner {
            return Err(ProjectError::UnauthorizedWithMessage(
                "you do not have valid permissions to move this item".to_string(),
            ));
        }
        if args.share_permission.is_some() && !is_owner {
            return Err(ProjectError::UnauthorizedWithMessage(
                "you do not have valid permission to modify share permissions".to_string(),
            ));
        }

        let new_parent_id = args
            .project_parent_id
            .as_deref()
            .filter(|id| !id.is_empty());
        if new_parent_id == Some(project.id.as_str()) {
            return Err(ProjectError::BadRequest(
                "project parent id matches project id".to_string(),
            ));
        }
        if let Some(parent_id) = new_parent_id {
            parse_request_uuid(parent_id, "project parent ID")?;
            let recursively_nested = self
                .repo
                .is_project_recursively_nested(&project.id, parent_id)
                .await
                .map_err(|error| {
                    internal_error(error, "error checking if project is recursively nested")
                })?;
            if recursively_nested {
                return Err(ProjectError::RecursiveNesting);
            }
        }

        let project_uuid = parse_internal_uuid(&project.id, "project ID")?;
        let old_parent_uuid = project
            .parent_id
            .as_deref()
            .map(|id| parse_internal_uuid(id, "stored parent project ID"))
            .transpose()?;
        let new_parent_uuid = new_parent_id
            .map(|id| parse_request_uuid(id, "project parent ID"))
            .transpose()?;

        self.repo
            .edit_project(EditProjectArgs {
                project_id: project.id.clone(),
                name: args.name,
                update_parent: args.project_parent_id.is_some(),
                parent_id: new_parent_id.map(str::to_string),
                share_permission: args.share_permission,
            })
            .await
            .map_err(|error| internal_error(error, "unable to patch project"))?;

        self.bump_project_modified(&project.id).await;
        let _ = self
            .entity_access_management_service
            .move_project(
                &project_uuid,
                old_parent_uuid.as_ref(),
                new_parent_uuid.as_ref(),
            )
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    project_id = %project.id,
                    "unable to update entity access for project"
                );
            });
        if let Some(parent_id) = project.parent_id.as_deref() {
            self.bump_project_modified(parent_id).await;
        }
        if let Some(parent_id) = new_parent_id {
            self.bump_project_modified(parent_id).await;
        }

        let project_id = receipt.entity().entity_id.clone();
        self.publish_project_event(&ProjectMacroEvent::updated(
            project_id.clone(),
            ProjectUpdatedMetadata {
                project_id,
                owner: project.user_id,
                actor_user_id: event_actor_user_id(receipt.auth()),
                name: requested_name,
                previous_parent_id: project.parent_id,
                parent_id: requested_parent_id,
                share_permission_updated,
            },
        ));

        Ok(())
    }

    async fn soft_delete_project(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        project: BasicProject,
        _actor_user_id: String,
    ) -> Result<SoftDeleteResult, ProjectError> {
        let deleted = self
            .repo
            .soft_delete_project(&receipt.entity().entity_id)
            .await
            .map_err(|error| internal_error(error, "unable to delete project"))?;

        if !deleted.project_ids.is_empty() {
            let _ = self
                .search_indexer
                .remove_projects(deleted.project_ids.clone())
                .await
                .inspect_err(|error| {
                    tracing::error!(error = ?error, "unable to enqueue deleted projects for search");
                });
        }
        if let Some(parent_id) = project.parent_id.as_deref() {
            self.bump_project_modified(parent_id).await;
        }

        let project_id = receipt.entity().entity_id.clone();
        self.publish_project_event(&ProjectMacroEvent::deleted(
            project_id.clone(),
            ProjectDeletedMetadata {
                project_id,
                owner: project.user_id,
                actor_user_id: event_actor_user_id(receipt.auth()),
                parent_project_id: project.parent_id,
                deleted_project_ids: deleted.project_ids.clone(),
                deleted_document_ids: deleted.document_ids.clone(),
                deleted_chat_ids: deleted.chat_ids.clone(),
            },
        ));

        Ok(deleted)
    }

    async fn permanently_delete_project(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        project: BasicProject,
    ) -> Result<(), ProjectError> {
        let purged = self
            .repo
            .purge_deleted_project_tree(&receipt.entity().entity_id)
            .await
            .map_err(|error| internal_error(error, "unable to permanently delete project"))?;

        if !purged.bom_shas.is_empty() {
            self.sha_counter
                .decrement_counts(&purged.bom_shas)
                .await
                .map_err(|error| internal_error(error, "unable to update document references"))?;
        }

        let purged_project_ids = purged.project_ids.clone();
        let purged_chat_ids = purged.chat_ids.clone();
        let purged_document_ids = purged
            .documents
            .iter()
            .map(|(document_id, _)| document_id.clone())
            .collect::<Vec<_>>();

        if !purged.project_ids.is_empty() {
            let _ = self
                .search_indexer
                .remove_projects(purged.project_ids)
                .await
                .inspect_err(|error| tracing::error!(error = ?error, "unable to enqueue purged projects for search"));
        }
        if !purged.chat_ids.is_empty() {
            let _ = self
                .search_indexer
                .remove_chats(purged.chat_ids)
                .await
                .inspect_err(|error| tracing::error!(error = ?error, "unable to enqueue purged chats for search"));
        }
        if !purged.documents.is_empty() {
            let _ = self
                .search_indexer
                .remove_documents(purged_document_ids.clone())
                .await
                .inspect_err(|error| tracing::error!(error = ?error, "unable to enqueue purged documents for search"));
            let _ = self
                .search_indexer
                .enqueue_document_deletes(purged.documents)
                .await
                .inspect_err(
                    |error| tracing::error!(error = ?error, "unable to enqueue document deletion"),
                );
        }

        let project_id = receipt.entity().entity_id.clone();
        self.publish_project_event(&ProjectMacroEvent::permanently_deleted(
            project_id.clone(),
            ProjectPermanentlyDeletedMetadata {
                project_id,
                owner: project.user_id,
                actor_user_id: event_actor_user_id(receipt.auth()),
                parent_project_id: project.parent_id,
                purged_project_ids,
                purged_document_ids,
                purged_chat_ids,
            },
        ));

        Ok(())
    }

    async fn revert_delete_project(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        project: BasicProject,
    ) -> Result<(), ProjectError> {
        let parent_project_id = project.parent_id.clone();
        let restored = self
            .repo
            .revert_delete_project(&receipt.entity().entity_id, parent_project_id.clone())
            .await
            .map_err(|error| internal_error(error, "unable to revert project"))?;

        if !restored.project_ids.is_empty() {
            let _ = self
                .search_indexer
                .upsert_projects(restored.project_ids.clone())
                .await
                .inspect_err(|error| {
                    tracing::error!(error = ?error, "unable to enqueue restored projects for search");
                });
        }

        let project_id = receipt.entity().entity_id.clone();
        self.publish_project_event(&ProjectMacroEvent::restored(
            project_id.clone(),
            ProjectRestoredMetadata {
                project_id,
                owner: project.user_id,
                actor_user_id: event_actor_user_id(receipt.auth()),
                parent_project_id,
                restored_project_ids: restored.project_ids,
            },
        ));

        Ok(())
    }

    async fn upload_folder(
        &self,
        actor: MacroUserIdStr<'static>,
        internal: bool,
        args: UploadFolderRequest,
    ) -> Result<UploadFolderResponseData, ProjectError> {
        let root_folder = build_root_folder(&args.root_folder_name, args.content)
            .map_err(|error| internal_error(error, "unable to prepare folder upload"))?;
        let uploaded = self
            .repo
            .upload_folder(UploadFolderRepoArgs {
                user_id: actor,
                share_permission: SharePermissionV2::new_project_share_permission(),
                root_folder,
                root_folder_name: args.root_folder_name,
                upload_request_id: args.upload_request_id,
                parent_id: args.parent_id,
            })
            .await
            .map_err(|error| internal_error(error, "unable to upload folder"))?;

        let document_ids: Vec<String> = uploaded
            .documents
            .iter()
            .map(|document| document.document_id.clone())
            .collect();
        let destination_map =
            match build_destination_map(&self.upload_url_service, &uploaded.documents, internal)
                .await
            {
                Ok(destination_map) => destination_map,
                Err(error) => {
                    tracing::error!(error = ?error, "unable to build upload destinations");
                    let _ = self
                        .repo
                        .delete_uploaded_tree(&uploaded.project_ids, &document_ids)
                        .await
                        .inspect_err(|compensation_error| {
                            tracing::error!(
                                error = ?compensation_error,
                                "unable to compensate failed folder upload"
                            );
                        });
                    return Err(ProjectError::Internal(anyhow::anyhow!(
                        "unable to prepare folder upload"
                    )));
                }
            };

        if !uploaded.project_ids.is_empty() {
            let _ = self
                .search_indexer
                .upsert_projects(uploaded.project_ids)
                .await
                .inspect_err(|error| {
                    tracing::error!(error = ?error, "unable to enqueue uploaded projects for search");
                });
        }

        Ok(UploadFolderResponseData {
            file_system: uploaded.file_system,
            destination_map,
        })
    }

    async fn create_upload_extract_request(
        &self,
        actor: MacroUserIdStr<'static>,
        args: UploadExtractFolderRequest,
    ) -> Result<UploadExtractFolderResponseData, ProjectError> {
        let request_id = self.fixed_upload_request_id.unwrap_or_else(Uuid::new_v4);
        let request = self
            .bulk_upload_service
            .create_bulk_upload_request(
                request_id,
                actor.as_ref(),
                args.name.as_deref(),
                args.parent_id.as_deref(),
            )
            .await
            .map_err(|error| internal_error(error, "unable to create upload request"))?;
        let key = BulkUploadStagingKey::from_s3_key(&request.key)
            .map_err(|error| internal_error(error, "unable to create upload request"))?;
        let presigned_url = self
            .upload_url_service
            .put_upload_zip_staging_presigned_url(key, args.sha)
            .await
            .map_err(|error| internal_error(error, "unable to create upload URL"))?;

        Ok(UploadExtractFolderResponseData {
            request_id: request_id.to_string(),
            presigned_url,
        })
    }

    async fn mark_projects_uploaded(
        &self,
        root_project_id: &str,
    ) -> Result<Vec<String>, ProjectError> {
        let uploaded_tree = self
            .repo
            .mark_projects_uploaded(root_project_id)
            .await
            .map_err(|error| internal_error(error, "unable to mark projects uploaded"))?;

        if uploaded_tree.upload_pending_transitioned {
            self.publish_project_event(&ProjectMacroEvent::uploaded(
                uploaded_tree.id.clone(),
                ProjectUploadedMetadata {
                    root_project_id: uploaded_tree.id,
                    owner: uploaded_tree.user_id,
                    name: uploaded_tree.name,
                    parent_project_id: uploaded_tree.parent_id,
                    project_ids: uploaded_tree.project_ids.clone(),
                },
            ));
        }

        Ok(uploaded_tree.project_ids)
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

fn validate_project_name(name: &str) -> Result<(), ProjectError> {
    if name.graphemes(true).count() > MAX_PROJECT_NAME_GRAPHEMES {
        return Err(ProjectError::NameTooLong {
            max: MAX_PROJECT_NAME_GRAPHEMES,
        });
    }
    Ok(())
}

fn receipt_is_owner(receipt: &EntityAccessReceipt<EditAccessLevel>) -> bool {
    matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    )
}

fn parse_request_uuid(value: &str, field: &str) -> Result<Uuid, ProjectError> {
    Uuid::parse_str(value)
        .map_err(|_| ProjectError::BadRequest(format!("{field} must be a valid UUID")))
}

fn parse_internal_uuid(value: &str, field: &str) -> Result<Uuid, ProjectError> {
    Uuid::parse_str(value).map_err(|error| {
        ProjectError::Internal(anyhow::anyhow!("invalid {field} in project data: {error}"))
    })
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
