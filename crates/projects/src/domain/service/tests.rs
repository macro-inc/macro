use std::sync::{Arc, Mutex};

use entity_access::domain::models::{
    Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType, ViewAccessLevel,
};
use entity_access_management::domain::models::EntityAccessManagementError;
use entity_access_management::domain::ports::EntityAccessManagementService;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::ContentType;
use model::item::Item;
use model::project::{Project, ProjectPreviewData, ProjectPreviewV2, ProjectWithUploadRequest};
use models_bulk_upload::{
    BulkUploadRequest, BulkUploadRequestDocuments, ProjectDocumentStatus, UploadDocumentStatus,
};
use models_permissions::share_permission::access_level::AccessLevel;
use s3_key::BulkUploadStagingKey;
use uuid::Uuid;

use super::*;
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
