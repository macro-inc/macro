use std::sync::{Arc, Mutex};

use entity_access::domain::models::{
    EditAccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    OwnerAccessLevel, ViewAccessLevel,
};
use entity_access_management::domain::models::EntityAccessManagementError;
use entity_access_management::domain::ports::EntityAccessManagementService;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{ContentType, DocumentMetadata, FileType};
use model::folder::{
    FileSystemNodeWithIds, FolderItem, S3Destination, UploadFolderRequest,
    UploadFolderWithIdsResponse,
};
use model::item::Item;
use model::project::request::{CreateProjectRequest, PatchProjectRequestV2};
use model::project::{
    BasicProject, Project, ProjectPreviewData, ProjectPreviewV2, ProjectWithUploadRequest,
};
use models_bulk_upload::{
    BulkUploadRequest, BulkUploadRequestDocuments, ProjectDocumentStatus, UploadDocumentStatus,
    UploadExtractFolderRequest, UploadFolderStatus,
};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use s3_key::BulkUploadStagingKey;
use uuid::Uuid;

use super::*;
use crate::domain::models::PurgedProjectTree;
use crate::domain::ports::MockProjectRepo;

#[derive(Clone, Copy)]
struct NullPort;

impl ProjectUploadUrlPort for NullPort {
    async fn put_upload_zip_staging_presigned_url(
        &self,
        _key: BulkUploadStagingKey,
        _sha: String,
    ) -> anyhow::Result<String> {
        unreachable!()
    }

    async fn put_document_storage_presigned_url(
        &self,
        _key: String,
        _sha: String,
        _content_type: ContentType,
    ) -> anyhow::Result<String> {
        unreachable!()
    }

    async fn put_docx_upload_presigned_url(
        &self,
        _key: String,
        _sha: String,
        _content_type: ContentType,
    ) -> anyhow::Result<String> {
        unreachable!()
    }

    fn document_storage_bucket(&self) -> &str {
        "unused"
    }

    fn docx_upload_bucket(&self) -> &str {
        "unused"
    }
}

impl ShaCounterPort for NullPort {
    async fn decrement_counts(&self, _sha_counts: &[(String, i64)]) -> anyhow::Result<()> {
        unreachable!()
    }
}

impl EntityAccessManagementService for NullPort {
    async fn add_entity_to_project(
        &self,
        _entity_id: &Uuid,
        _entity_type: EntityType,
        _project_id: &Uuid,
    ) -> Result<(), EntityAccessManagementError> {
        unreachable!()
    }

    async fn remove_entity_from_project(
        &self,
        _entity_id: &Uuid,
        _entity_type: EntityType,
        _old_project_id: &Uuid,
    ) -> Result<(), EntityAccessManagementError> {
        unreachable!()
    }

    async fn move_project(
        &self,
        _project_id: &Uuid,
        _old_project_id: Option<&Uuid>,
        _new_project_id: Option<&Uuid>,
    ) -> Result<(), EntityAccessManagementError> {
        unreachable!()
    }
}

impl ProjectSearchIndexer for NullPort {
    async fn upsert_projects(&self, _project_ids: Vec<String>) -> anyhow::Result<()> {
        unreachable!()
    }

    async fn remove_projects(&self, _project_ids: Vec<String>) -> anyhow::Result<()> {
        unreachable!()
    }

    async fn remove_chats(&self, _chat_ids: Vec<String>) -> anyhow::Result<()> {
        unreachable!()
    }

    async fn remove_documents(&self, _document_ids: Vec<String>) -> anyhow::Result<()> {
        unreachable!()
    }

    async fn enqueue_document_deletes(
        &self,
        _documents: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        unreachable!()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum EamCall {
    Add(Uuid, Uuid),
    Move(Uuid, Option<Uuid>, Option<Uuid>),
}

#[derive(Clone, Default)]
struct RecordingEam {
    calls: Arc<Mutex<Vec<EamCall>>>,
}

impl EntityAccessManagementService for RecordingEam {
    async fn add_entity_to_project(
        &self,
        entity_id: &Uuid,
        _entity_type: EntityType,
        project_id: &Uuid,
    ) -> Result<(), EntityAccessManagementError> {
        self.calls
            .lock()
            .unwrap()
            .push(EamCall::Add(*entity_id, *project_id));
        Ok(())
    }

    async fn remove_entity_from_project(
        &self,
        _entity_id: &Uuid,
        _entity_type: EntityType,
        _old_project_id: &Uuid,
    ) -> Result<(), EntityAccessManagementError> {
        unreachable!()
    }

    async fn move_project(
        &self,
        project_id: &Uuid,
        old_project_id: Option<&Uuid>,
        new_project_id: Option<&Uuid>,
    ) -> Result<(), EntityAccessManagementError> {
        self.calls.lock().unwrap().push(EamCall::Move(
            *project_id,
            old_project_id.copied(),
            new_project_id.copied(),
        ));
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum IndexCall {
    Upsert(Vec<String>),
    Remove(Vec<String>),
}

#[derive(Clone, Default)]
struct RecordingIndexer {
    calls: Arc<Mutex<Vec<IndexCall>>>,
}

impl ProjectSearchIndexer for RecordingIndexer {
    async fn upsert_projects(&self, project_ids: Vec<String>) -> anyhow::Result<()> {
        self.calls
            .lock()
            .unwrap()
            .push(IndexCall::Upsert(project_ids));
        Ok(())
    }

    async fn remove_projects(&self, project_ids: Vec<String>) -> anyhow::Result<()> {
        self.calls
            .lock()
            .unwrap()
            .push(IndexCall::Remove(project_ids));
        Ok(())
    }

    async fn remove_chats(&self, _chat_ids: Vec<String>) -> anyhow::Result<()> {
        unreachable!()
    }

    async fn remove_documents(&self, _document_ids: Vec<String>) -> anyhow::Result<()> {
        unreachable!()
    }

    async fn enqueue_document_deletes(
        &self,
        _documents: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        unreachable!()
    }
}

fn mutation_service(
    repo: MockProjectRepo,
    eam: RecordingEam,
    indexer: RecordingIndexer,
) -> ProjectServiceImpl<
    MockProjectRepo,
    NullPort,
    RecordingBulkUpload,
    NullPort,
    RecordingEam,
    RecordingIndexer,
> {
    ProjectServiceImpl::new(
        repo,
        NullPort,
        RecordingBulkUpload::default(),
        NullPort,
        eam,
        indexer,
        None,
    )
}

#[derive(Clone, Default)]
struct RecordingBulkUpload {
    calls: Arc<Mutex<Vec<String>>>,
}

impl BulkUploadRequestPort for RecordingBulkUpload {
    async fn create_bulk_upload_request(
        &self,
        _request_id: Uuid,
        _user_id: &str,
        _name: Option<&str>,
        _parent_id: Option<&str>,
    ) -> anyhow::Result<BulkUploadRequest> {
        unreachable!()
    }

    async fn get_bulk_upload_document_statuses(
        &self,
        upload_request_id: &str,
    ) -> anyhow::Result<BulkUploadRequestDocuments> {
        self.calls
            .lock()
            .unwrap()
            .push(upload_request_id.to_string());
        match upload_request_id {
            "failed" => anyhow::bail!("sensitive dynamo failure"),
            "mismatch" => Ok(BulkUploadRequestDocuments {
                root_project_id: "another-project".to_string(),
                documents: vec![document_status()],
            }),
            _ => Ok(BulkUploadRequestDocuments {
                root_project_id: upload_request_id.to_string(),
                documents: vec![document_status()],
            }),
        }
    }
}

fn service<D: BulkUploadRequestPort>(
    repo: MockProjectRepo,
    bulk_upload_service: D,
) -> ProjectServiceImpl<MockProjectRepo, NullPort, D, NullPort, NullPort, NullPort> {
    ProjectServiceImpl::new(
        repo,
        NullPort,
        bulk_upload_service,
        NullPort,
        NullPort,
        NullPort,
        None,
    )
}

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).unwrap()
}

fn project(id: &str, owner: &str, parent_id: Option<&str>) -> Project {
    Project {
        id: id.to_string(),
        name: id.to_string(),
        user_id: owner.to_string(),
        parent_id: parent_id.map(str::to_string),
        created_at: None,
        updated_at: None,
        deleted_at: None,
    }
}

fn receipt(
    auth: EntityAccessAuth,
    access_level: AccessLevel,
) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new(
        auth,
        Entity {
            entity_id: "root".to_string(),
            entity_type: EntityType::Project,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
}

fn basic_project(id: Uuid, parent_id: Option<Uuid>, deleted: bool) -> BasicProject {
    BasicProject {
        id: id.to_string(),
        user_id: user_id("macro|owner@example.com"),
        parent_id: parent_id.map(|id| id.to_string()),
        name: "Project".to_string(),
        deleted_at: deleted.then(chrono::Utc::now),
    }
}

fn mutation_receipt<T>(project_id: Uuid, access_level: AccessLevel) -> EntityAccessReceipt<T>
where
    T: entity_access::domain::models::RequiredPermission,
{
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(user_id("macro|owner@example.com")),
        Entity {
            entity_id: project_id.to_string(),
            entity_type: EntityType::Project,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
}

fn patch_request(
    parent_id: Option<String>,
    share_permission: Option<UpdateSharePermissionRequestV2>,
) -> PatchProjectRequestV2 {
    PatchProjectRequestV2 {
        name: None,
        project_parent_id: parent_id,
        share_permission,
    }
}

fn share_update() -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        is_public: Some(true),
        public_access_level: Some(AccessLevel::View),
        channel_share_permissions: None,
    }
}

fn document_status() -> ProjectDocumentStatus {
    ProjectDocumentStatus {
        document_id: "document".to_string(),
        status: UploadDocumentStatus::Pending,
    }
}

#[tokio::test]
async fn content_attributes_owner_access_to_owned_items() {
    let mut repo = MockProjectRepo::new();
    repo.expect_get_project_children().return_once(|_| {
        Box::pin(async {
            Ok(vec![
                Item::Project(project("owned", "macro|owner@example.com", Some("root"))),
                Item::Project(project("shared", "macro|other@example.com", Some("root"))),
            ])
        })
    });
    let service = service(repo, RecordingBulkUpload::default());

    let content = service
        .get_project_content(receipt(
            EntityAccessAuth::Authenticated(user_id("macro|owner@example.com")),
            AccessLevel::Edit,
        ))
        .await
        .unwrap();

    assert_eq!(content[0].user_access_level, AccessLevel::Owner);
    assert_eq!(content[1].user_access_level, AccessLevel::Edit);
}

#[tokio::test]
async fn content_attributes_owner_access_to_every_item_for_internal_receipts() {
    let mut repo = MockProjectRepo::new();
    repo.expect_get_project_children().return_once(|_| {
        Box::pin(async {
            Ok(vec![Item::Project(project(
                "shared",
                "macro|other@example.com",
                Some("root"),
            ))])
        })
    });
    let service = service(repo, RecordingBulkUpload::default());

    let content = service
        .get_project_content(receipt(EntityAccessAuth::Internal, AccessLevel::View))
        .await
        .unwrap();

    assert_eq!(content[0].user_access_level, AccessLevel::Owner);
}

#[tokio::test]
async fn pending_projects_isolate_status_failures_and_root_mismatches() {
    let mut repo = MockProjectRepo::new();
    repo.expect_get_pending_root_projects().return_once(|_| {
        Box::pin(async {
            Ok(vec![
                ProjectWithUploadRequest {
                    project: project("failed", "owner", None),
                    upload_request_id: Some("failed".to_string()),
                },
                ProjectWithUploadRequest {
                    project: project("mismatch", "owner", None),
                    upload_request_id: Some("mismatch".to_string()),
                },
                ProjectWithUploadRequest {
                    project: project("nested", "owner", Some("root")),
                    upload_request_id: Some("nested".to_string()),
                },
                ProjectWithUploadRequest {
                    project: project("without-request", "owner", None),
                    upload_request_id: None,
                },
            ])
        })
    });
    let bulk_upload = RecordingBulkUpload::default();
    let calls = bulk_upload.calls.clone();
    let service = service(repo, bulk_upload);

    let pending = service
        .list_pending_projects(user_id("macro|owner@example.com"))
        .await
        .unwrap();

    assert_eq!(pending.len(), 2);
    assert!(
        pending
            .iter()
            .all(|project| project.document_statuses.is_empty())
    );
    assert!(pending.iter().any(|project| project.project.id == "failed"));
    assert!(
        pending
            .iter()
            .any(|project| project.project.id == "without-request")
    );
    let mut calls = calls.lock().unwrap().clone();
    calls.sort();
    assert_eq!(calls, vec!["failed", "mismatch"]);
}

#[tokio::test]
async fn preview_deduplicates_ids_before_calling_repository() {
    let mut repo = MockProjectRepo::new();
    repo.expect_batch_get_project_preview()
        .withf(|ids| {
            ids.len() == 2 && ids.iter().any(|id| id == "one") && ids.iter().any(|id| id == "two")
        })
        .return_once(|_| {
            Box::pin(async {
                Ok(vec![ProjectPreviewV2::Found(ProjectPreviewData {
                    id: "one".to_string(),
                    name: "One".to_string(),
                    owner: "owner".to_string(),
                    path: Vec::new(),
                    updated_at: None,
                })])
            })
        });
    let service = service(repo, RecordingBulkUpload::default());

    let previews = service
        .get_batch_preview(
            Some(user_id("macro|owner@example.com")),
            vec!["one".to_string(), "two".to_string(), "one".to_string()],
        )
        .await
        .unwrap();

    assert_eq!(previews.len(), 1);
    assert!(matches!(&previews[0], ProjectPreview::Access(data) if data.id == "one"));
}

#[tokio::test]
async fn create_uses_grapheme_limit_and_orchestrates_parent_side_effects() {
    let project_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let accepted_name = "👨‍👩‍👧‍👦".repeat(100);
    let expected_name = accepted_name.clone();
    let mut repo = MockProjectRepo::new();
    repo.expect_create_project()
        .withf(move |args| {
            args.name == expected_name
                && args.parent_id.as_deref() == Some(parent_id.to_string().as_str())
                && !args.share_permission.is_public
        })
        .return_once(move |_| {
            Box::pin(async move {
                Ok(project(
                    &project_id.to_string(),
                    "macro|owner@example.com",
                    Some(&parent_id.to_string()),
                ))
            })
        });
    repo.expect_update_project_modified()
        .withf(move |id| id == parent_id.to_string())
        .return_once(|_| Box::pin(async { Ok(()) }));
    let eam = RecordingEam::default();
    let eam_calls = eam.calls.clone();
    let indexer = RecordingIndexer::default();
    let index_calls = indexer.calls.clone();
    let service = mutation_service(repo, eam, indexer);

    service
        .create_project(
            user_id("macro|owner@example.com"),
            CreateProjectRequest {
                name: accepted_name,
                project_parent_id: Some(parent_id),
            },
        )
        .await
        .unwrap();
    let error = service
        .create_project(
            user_id("macro|owner@example.com"),
            CreateProjectRequest {
                name: "👨‍👩‍👧‍👦".repeat(101),
                project_parent_id: None,
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ProjectError::NameTooLong { max: 100 }));
    assert_eq!(
        *eam_calls.lock().unwrap(),
        vec![EamCall::Add(project_id, parent_id)]
    );
    assert_eq!(
        *index_calls.lock().unwrap(),
        vec![
            IndexCall::Upsert(vec![project_id.to_string()]),
            IndexCall::Upsert(vec![parent_id.to_string()]),
        ]
    );
}

#[tokio::test]
async fn edit_requires_owner_for_moves_and_share_changes() {
    let project_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let repo = MockProjectRepo::new();
    let service = mutation_service(repo, RecordingEam::default(), RecordingIndexer::default());

    let move_error = service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Edit),
            basic_project(project_id, None, false),
            patch_request(Some(parent_id.to_string()), None),
        )
        .await
        .unwrap_err();
    let share_error = service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Edit),
            basic_project(project_id, None, false),
            patch_request(None, Some(share_update())),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        move_error,
        ProjectError::UnauthorizedWithMessage(_)
    ));
    assert!(matches!(
        share_error,
        ProjectError::UnauthorizedWithMessage(_)
    ));
}

#[tokio::test]
async fn edit_rejects_deleted_self_recursive_and_invalid_parents() {
    let project_id = Uuid::new_v4();
    let recursive_parent = Uuid::new_v4();
    let mut repo = MockProjectRepo::new();
    repo.expect_is_project_recursively_nested()
        .withf(move |id, parent| {
            id == project_id.to_string() && parent == recursive_parent.to_string()
        })
        .return_once(|_, _| Box::pin(async { Ok(true) }));
    let service = mutation_service(repo, RecordingEam::default(), RecordingIndexer::default());

    let deleted = service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Owner),
            basic_project(project_id, None, true),
            patch_request(None, None),
        )
        .await
        .unwrap_err();
    let self_parent = service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Owner),
            basic_project(project_id, None, false),
            patch_request(Some(project_id.to_string()), None),
        )
        .await
        .unwrap_err();
    let invalid_parent = service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Owner),
            basic_project(project_id, None, false),
            patch_request(Some("not-a-uuid".to_string()), None),
        )
        .await
        .unwrap_err();
    let recursive = service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Owner),
            basic_project(project_id, None, false),
            patch_request(Some(recursive_parent.to_string()), None),
        )
        .await
        .unwrap_err();

    assert!(matches!(deleted, ProjectError::CannotModifyDeleted));
    assert!(matches!(self_parent, ProjectError::BadRequest(_)));
    assert!(matches!(invalid_parent, ProjectError::BadRequest(_)));
    assert!(matches!(recursive, ProjectError::RecursiveNesting));
}

#[tokio::test]
async fn owner_edit_propagates_move_and_pairs_every_bump_with_an_upsert() {
    let project_id = Uuid::new_v4();
    let old_parent_id = Uuid::new_v4();
    let new_parent_id = Uuid::new_v4();
    let bumped = Arc::new(Mutex::new(Vec::new()));
    let recorded_bumps = bumped.clone();
    let mut repo = MockProjectRepo::new();
    repo.expect_is_project_recursively_nested()
        .return_once(|_, _| Box::pin(async { Ok(false) }));
    repo.expect_edit_project()
        .withf(move |args| {
            args.project_id == project_id.to_string()
                && args.update_parent
                && args.parent_id.as_deref() == Some(new_parent_id.to_string().as_str())
        })
        .return_once(move |_| {
            Box::pin(async move {
                Ok(project(
                    &project_id.to_string(),
                    "macro|owner@example.com",
                    Some(&new_parent_id.to_string()),
                ))
            })
        });
    repo.expect_update_project_modified()
        .times(3)
        .returning(move |id| {
            recorded_bumps.lock().unwrap().push(id.to_string());
            Box::pin(async { Ok(()) })
        });
    let eam = RecordingEam::default();
    let eam_calls = eam.calls.clone();
    let indexer = RecordingIndexer::default();
    let index_calls = indexer.calls.clone();
    let service = mutation_service(repo, eam, indexer);

    service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Owner),
            basic_project(project_id, Some(old_parent_id), false),
            patch_request(Some(new_parent_id.to_string()), Some(share_update())),
        )
        .await
        .unwrap();

    assert_eq!(
        *eam_calls.lock().unwrap(),
        vec![EamCall::Move(
            project_id,
            Some(old_parent_id),
            Some(new_parent_id)
        )]
    );
    let bumps = bumped.lock().unwrap().clone();
    let indexed = index_calls
        .lock()
        .unwrap()
        .iter()
        .filter_map(|call| match call {
            IndexCall::Upsert(ids) if ids.len() == 1 => Some(ids[0].clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(bumps, indexed);
}

#[tokio::test]
async fn empty_parent_clears_persistence_and_eam_parent_argument() {
    let project_id = Uuid::new_v4();
    let old_parent_id = Uuid::new_v4();
    let mut repo = MockProjectRepo::new();
    repo.expect_edit_project()
        .withf(|args| args.update_parent && args.parent_id.is_none())
        .return_once(move |_| {
            Box::pin(async move {
                Ok(project(
                    &project_id.to_string(),
                    "macro|owner@example.com",
                    None,
                ))
            })
        });
    repo.expect_update_project_modified()
        .times(2)
        .returning(|_| Box::pin(async { Ok(()) }));
    let eam = RecordingEam::default();
    let calls = eam.calls.clone();
    let service = mutation_service(repo, eam, RecordingIndexer::default());

    service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Owner),
            basic_project(project_id, Some(old_parent_id), false),
            patch_request(Some(String::new()), None),
        )
        .await
        .unwrap();

    assert_eq!(
        *calls.lock().unwrap(),
        vec![EamCall::Move(project_id, Some(old_parent_id), None)]
    );
}

#[tokio::test]
async fn edit_name_limit_counts_unicode_graphemes() {
    let project_id = Uuid::new_v4();
    let mut repo = MockProjectRepo::new();
    repo.expect_edit_project().return_once(move |_| {
        Box::pin(async move {
            Ok(project(
                &project_id.to_string(),
                "macro|owner@example.com",
                None,
            ))
        })
    });
    repo.expect_update_project_modified()
        .return_once(|_| Box::pin(async { Ok(()) }));
    let service = mutation_service(repo, RecordingEam::default(), RecordingIndexer::default());
    let mut accepted = patch_request(None, None);
    accepted.name = Some("é".repeat(100));

    service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Edit),
            basic_project(project_id, None, false),
            accepted,
        )
        .await
        .unwrap();
    let mut rejected = patch_request(None, None);
    rejected.name = Some("é".repeat(101));
    let error = service
        .edit_project(
            mutation_receipt::<EditAccessLevel>(project_id, AccessLevel::Edit),
            basic_project(project_id, None, false),
            rejected,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ProjectError::NameTooLong { max: 100 }));
}

#[tokio::test]
async fn failed_database_bump_still_runs_the_paired_index_upsert() {
    let project_id = Uuid::new_v4();
    let mut repo = MockProjectRepo::new();
    repo.expect_update_project_modified()
        .return_once(|_| Box::pin(async { Err(anyhow::anyhow!("database unavailable")) }));
    let indexer = RecordingIndexer::default();
    let calls = indexer.calls.clone();
    let service = mutation_service(repo, RecordingEam::default(), indexer);

    service.bump_project_modified(&project_id.to_string()).await;

    assert_eq!(
        *calls.lock().unwrap(),
        vec![IndexCall::Upsert(vec![project_id.to_string()])]
    );
}

#[tokio::test]
async fn soft_delete_removes_index_entries_and_bumps_parent_with_upsert() {
    let project_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let deleted_ids = vec![project_id.to_string(), Uuid::new_v4().to_string()];
    let expected_deleted_ids = deleted_ids.clone();
    let mut repo = MockProjectRepo::new();
    repo.expect_soft_delete_project().return_once(move |_| {
        Box::pin(async move {
            Ok(SoftDeleteResult {
                project_ids: deleted_ids,
                document_ids: vec!["document".to_string()],
                chat_ids: vec!["chat".to_string()],
            })
        })
    });
    repo.expect_update_project_modified()
        .withf(move |id| id == parent_id.to_string())
        .return_once(|_| Box::pin(async { Ok(()) }));
    let indexer = RecordingIndexer::default();
    let calls = indexer.calls.clone();
    let service = mutation_service(repo, RecordingEam::default(), indexer);

    service
        .soft_delete_project(
            mutation_receipt::<OwnerAccessLevel>(project_id, AccessLevel::Owner),
            basic_project(project_id, Some(parent_id), false),
            "macro|owner@example.com".to_string(),
        )
        .await
        .unwrap();

    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            IndexCall::Remove(expected_deleted_ids),
            IndexCall::Upsert(vec![parent_id.to_string()]),
        ]
    );
}

#[tokio::test]
async fn revert_upserts_every_restored_project() {
    let project_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let restored_ids = vec![project_id.to_string(), Uuid::new_v4().to_string()];
    let expected_ids = restored_ids.clone();
    let mut repo = MockProjectRepo::new();
    repo.expect_revert_delete_project()
        .withf(move |id, parent| {
            id == project_id.to_string()
                && parent.as_deref() == Some(parent_id.to_string().as_str())
        })
        .return_once(move |_, _| {
            Box::pin(async move {
                Ok(crate::domain::models::RevertDeleteResult {
                    project_ids: restored_ids,
                })
            })
        });
    let indexer = RecordingIndexer::default();
    let calls = indexer.calls.clone();
    let service = mutation_service(repo, RecordingEam::default(), indexer);

    service
        .revert_delete_project(
            mutation_receipt::<OwnerAccessLevel>(project_id, AccessLevel::Owner),
            basic_project(project_id, Some(parent_id), true),
        )
        .await
        .unwrap();

    assert_eq!(
        *calls.lock().unwrap(),
        vec![IndexCall::Upsert(expected_ids)]
    );
}

#[tokio::test]
async fn missing_full_project_maps_to_not_found() {
    let mut repo = MockProjectRepo::new();
    repo.expect_get_project_by_id()
        .return_once(|_| Box::pin(async { Ok(None) }));
    let service = service(repo, RecordingBulkUpload::default());

    let error = service
        .get_project(receipt(
            EntityAccessAuth::Authenticated(user_id("macro|owner@example.com")),
            AccessLevel::View,
        ))
        .await
        .unwrap_err();

    assert!(matches!(error, ProjectError::NotFound(id) if id == "root"));
}

#[derive(Clone)]
struct OrderedSha {
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl ShaCounterPort for OrderedSha {
    async fn decrement_counts(&self, _sha_counts: &[(String, i64)]) -> anyhow::Result<()> {
        self.events.lock().unwrap().push("sha");
        Ok(())
    }
}

#[derive(Clone)]
struct OrderedIndexer {
    events: Arc<Mutex<Vec<&'static str>>>,
    fail: bool,
}

impl OrderedIndexer {
    fn record(&self, event: &'static str) -> anyhow::Result<()> {
        self.events.lock().unwrap().push(event);
        if self.fail {
            anyhow::bail!("index unavailable");
        }
        Ok(())
    }
}

impl ProjectSearchIndexer for OrderedIndexer {
    async fn upsert_projects(&self, _project_ids: Vec<String>) -> anyhow::Result<()> {
        self.record("upsert")
    }

    async fn remove_projects(&self, _project_ids: Vec<String>) -> anyhow::Result<()> {
        self.record("projects")
    }

    async fn remove_chats(&self, _chat_ids: Vec<String>) -> anyhow::Result<()> {
        self.record("chats")
    }

    async fn remove_documents(&self, _document_ids: Vec<String>) -> anyhow::Result<()> {
        self.record("documents")
    }

    async fn enqueue_document_deletes(
        &self,
        _documents: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        self.record("document_deletes")
    }
}

#[derive(Clone)]
struct RecordingUploadUrls {
    calls: Arc<Mutex<Vec<String>>>,
    fail_document: bool,
}

impl ProjectUploadUrlPort for RecordingUploadUrls {
    async fn put_upload_zip_staging_presigned_url(
        &self,
        key: BulkUploadStagingKey,
        _sha: String,
    ) -> anyhow::Result<String> {
        self.calls.lock().unwrap().push(key.to_key());
        Ok("https://upload.example".to_string())
    }

    async fn put_document_storage_presigned_url(
        &self,
        key: String,
        _sha: String,
        _content_type: ContentType,
    ) -> anyhow::Result<String> {
        self.calls.lock().unwrap().push(key);
        if self.fail_document {
            anyhow::bail!("sensitive S3 failure");
        }
        Ok("https://document.example".to_string())
    }

    async fn put_docx_upload_presigned_url(
        &self,
        _key: String,
        _sha: String,
        _content_type: ContentType,
    ) -> anyhow::Result<String> {
        unreachable!()
    }

    fn document_storage_bucket(&self) -> &str {
        "documents-bucket"
    }

    fn docx_upload_bucket(&self) -> &str {
        "docx-bucket"
    }
}

#[derive(Clone)]
struct RecordingExtract {
    request_ids: Arc<Mutex<Vec<Uuid>>>,
}

impl BulkUploadRequestPort for RecordingExtract {
    async fn create_bulk_upload_request(
        &self,
        request_id: Uuid,
        user_id: &str,
        name: Option<&str>,
        parent_id: Option<&str>,
    ) -> anyhow::Result<BulkUploadRequest> {
        self.request_ids.lock().unwrap().push(request_id);
        Ok(BulkUploadRequest {
            request_id: request_id.to_string(),
            user_id: user_id.to_string(),
            key: format!("extract/{request_id}"),
            status: UploadFolderStatus::Pending,
            name: name.map(str::to_string),
            created_at: String::new(),
            updated_at: String::new(),
            completed_at: None,
            error_message: None,
            root_project_id: None,
            parent_id: parent_id.map(str::to_string),
        })
    }

    async fn get_bulk_upload_document_statuses(
        &self,
        _upload_request_id: &str,
    ) -> anyhow::Result<BulkUploadRequestDocuments> {
        unreachable!()
    }
}

fn upload_document(id: &str, file_type: FileType) -> DocumentMetadata {
    DocumentMetadata::new_document(
        id,
        7,
        user_id("macro|owner@example.com"),
        id,
        Some(file_type),
        "0123456789abcdef",
        None,
        None,
        None,
        Some("project"),
        Some("Project"),
        None,
        None,
        None,
    )
}

#[tokio::test]
async fn permanent_delete_runs_external_work_after_committed_purge() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let repo_events = events.clone();
    let mut repo = MockProjectRepo::new();
    repo.expect_purge_deleted_project_tree()
        .return_once(move |_| {
            repo_events.lock().unwrap().push("repo");
            Box::pin(async {
                Ok(PurgedProjectTree {
                    project_ids: vec!["project".to_string()],
                    chat_ids: vec!["chat".to_string()],
                    documents: vec![("document".to_string(), "owner".to_string())],
                    bom_shas: vec![("sha".to_string(), 2)],
                })
            })
        });
    let service = ProjectServiceImpl::new(
        repo,
        NullPort,
        RecordingBulkUpload::default(),
        OrderedSha {
            events: events.clone(),
        },
        NullPort,
        OrderedIndexer {
            events: events.clone(),
            fail: true,
        },
        None,
    );

    service
        .permanently_delete_project(mutation_receipt::<OwnerAccessLevel>(
            Uuid::new_v4(),
            AccessLevel::Owner,
        ))
        .await
        .unwrap();

    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "repo",
            "sha",
            "projects",
            "chats",
            "documents",
            "document_deletes"
        ]
    );
}

#[tokio::test]
async fn permanent_delete_has_no_external_side_effects_when_purge_fails() {
    let mut repo = MockProjectRepo::new();
    repo.expect_purge_deleted_project_tree()
        .return_once(|_| Box::pin(async { Err(anyhow::anyhow!("commit failed")) }));
    let service = service(repo, RecordingBulkUpload::default());

    let result = service
        .permanently_delete_project(mutation_receipt::<OwnerAccessLevel>(
            Uuid::new_v4(),
            AccessLevel::Owner,
        ))
        .await;

    assert!(result.is_err());
}

#[tokio::test]
async fn destination_maps_preserve_internal_external_and_docx_behavior() {
    let urls = RecordingUploadUrls {
        calls: Arc::new(Mutex::new(Vec::new())),
        fail_document: false,
    };
    let pdf = upload_document("pdf", FileType::Pdf);
    let docx = upload_document("docx", FileType::Docx);

    let internal = build_destination_map(&urls, &[pdf.clone(), docx.clone()], true)
        .await
        .unwrap();
    assert!(matches!(
        internal.get("pdf"),
        Some(S3Destination::Internal(info)) if info.bucket == "documents-bucket"
    ));
    assert!(matches!(
        internal.get("docx"),
        Some(S3Destination::Internal(info)) if info.bucket == "docx-bucket"
    ));

    let external = build_destination_map(&urls, &[pdf, docx], false)
        .await
        .unwrap();
    assert!(matches!(
        external.get("pdf"),
        Some(S3Destination::External(_))
    ));
    assert!(!external.contains_key("docx"));
}

#[tokio::test]
async fn upload_folder_compensates_after_destination_failure() {
    let mut repo = MockProjectRepo::new();
    repo.expect_upload_folder().return_once(|_| {
        Box::pin(async {
            Ok(UploadFolderWithIdsResponse {
                file_system: FileSystemNodeWithIds::Folder {
                    content: Default::default(),
                    project_id: "project".to_string(),
                },
                project_ids: vec!["project".to_string()],
                documents: vec![upload_document("document", FileType::Pdf)],
            })
        })
    });
    repo.expect_delete_uploaded_tree()
        .withf(|projects, documents| projects == ["project"] && documents == ["document"])
        .return_once(|_, _| Box::pin(async { Ok(()) }));
    let service = ProjectServiceImpl::new(
        repo,
        RecordingUploadUrls {
            calls: Arc::new(Mutex::new(Vec::new())),
            fail_document: true,
        },
        RecordingBulkUpload::default(),
        NullPort,
        NullPort,
        NullPort,
        None,
    );

    let result = service
        .upload_folder(
            user_id("macro|owner@example.com"),
            false,
            UploadFolderRequest {
                content: vec![FolderItem {
                    name: "document".to_string(),
                    full_name: "document.pdf".to_string(),
                    file_type: Some(FileType::Pdf),
                    relative_path: "Upload".to_string(),
                    sha: "0123456789abcdef".to_string(),
                }],
                root_folder_name: "Upload".to_string(),
                upload_request_id: "request".to_string(),
                parent_id: None,
            },
        )
        .await;

    assert!(matches!(result, Err(ProjectError::Internal(_))));
}

#[tokio::test]
async fn upload_extract_uses_fixed_request_id() {
    let fixed_id = Uuid::new_v4();
    let extract = RecordingExtract {
        request_ids: Arc::new(Mutex::new(Vec::new())),
    };
    let request_ids = extract.request_ids.clone();
    let service = ProjectServiceImpl::new(
        MockProjectRepo::new(),
        RecordingUploadUrls {
            calls: Arc::new(Mutex::new(Vec::new())),
            fail_document: false,
        },
        extract,
        NullPort,
        NullPort,
        NullPort,
        Some(fixed_id),
    );

    let response = service
        .create_upload_extract_request(
            user_id("macro|owner@example.com"),
            UploadExtractFolderRequest {
                sha: "0123456789abcdef".to_string(),
                name: Some("Upload".to_string()),
                parent_id: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(response.request_id, fixed_id.to_string());
    assert_eq!(*request_ids.lock().unwrap(), vec![fixed_id]);
}
