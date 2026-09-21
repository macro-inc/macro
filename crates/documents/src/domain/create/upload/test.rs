use super::*;
use std::sync::{Arc, Mutex};

use activity::Actor;
use entity_access::domain::models::{BotReceiptScope, Entity, EntityPermission};
use model::document::response::DocumentResponseMetadata;
use models_permissions::share_permission::access_level::AccessLevel;

use crate::domain::{
    content::DocumentContent,
    models::{CreateDocumentRepoArgs, CreateTaskRequest},
    response::{CreateDocumentResponseData, DocumentResponse, DocumentResponseMetadataWithContent},
};

const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000123";
const PROJECT_ID: &str = "00000000-0000-0000-0000-000000000456";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap()
}

#[derive(Default)]
struct RecordingService {
    creates: Mutex<Vec<CreateDocumentRepoArgs>>,
    cleanups: Mutex<Vec<String>>,
    omit_url: bool,
}

impl DocumentCreationService for RecordingService {
    async fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateDocumentRepoArgs,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        let file_type = args.file_type.map(|kind| kind.to_string());
        let document_name = args.document_name.clone();
        self.creates.lock().unwrap().push(args);
        Ok(CreateDocumentResponseData {
            document_response: DocumentResponse {
                document_metadata: DocumentResponseMetadataWithContent::new(
                    DocumentResponseMetadata {
                        document_id: DOCUMENT_ID.to_string(),
                        document_version_id: 1,
                        owner: user_id,
                        document_name,
                        file_type: file_type.clone(),
                        sha: None,
                        branched_from_id: None,
                        branched_from_version_id: None,
                        document_family_id: None,
                        document_bom: None,
                        modification_data: None,
                        created_at: None,
                        updated_at: None,
                        sub_type: None,
                    },
                    DocumentContent::pending(),
                ),
                presigned_url: (!self.omit_url)
                    .then(|| "https://storage.example/upload".to_string()),
            },
            content_type: "application/octet-stream".to_string(),
            file_type,
        })
    }

    async fn handle_task_properties(
        &self,
        _: MacroUserIdStr<'static>,
        _: &str,
        _: &CreateTaskRequest,
        _: &Attribution,
    ) -> Result<(), DocumentError> {
        panic!("file uploads do not create tasks")
    }

    async fn mark_document_uploaded(&self, _: &str) -> Result<(), DocumentError> {
        panic!("the storage event pipeline finalizes uploads")
    }

    async fn set_document_content(&self, _: &str, _: DocumentContent) -> Result<(), DocumentError> {
        panic!("the storage event pipeline finalizes uploads")
    }

    async fn cleanup_created_document(&self, id: &str) {
        self.cleanups.lock().unwrap().push(id.to_string());
    }
}

#[derive(Default)]
struct RecordingUploader {
    uploads: Mutex<Vec<DocumentBytesUpload>>,
    fail: bool,
}

impl DocumentBytesUploadPort for &RecordingUploader {
    async fn upload_document_bytes(
        &self,
        upload: DocumentBytesUpload,
    ) -> Result<(), DocumentError> {
        self.uploads.lock().unwrap().push(upload);
        if self.fail {
            return Err(DocumentError::Gone);
        }
        Ok(())
    }
}

fn upload(name: &str, bytes: Vec<u8>) -> NewFileUpload {
    NewFileUpload {
        file_name: name.to_string(),
        bytes,
        project: None,
        attribution: Attribution::delegated(Actor::new_from_bot(bot_id::MACRO_AI_BOT_ID), owner()),
    }
}

fn project_receipt(
    user: MacroUserIdStr<'static>,
    entity_type: EntityType,
) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_bot(
        bot_id::MACRO_AI_BOT_ID.into(),
        BotReceiptScope::User { acting_user: user },
        Entity {
            entity_id: PROJECT_ID.to_string(),
            entity_type,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn uploads_exact_bytes_with_checksums_owner_project_and_attribution() {
    let service = Arc::new(RecordingService::default());
    let uploader = RecordingUploader::default();
    let creator = DocumentCreator::new(service.clone(), (), &uploader, ());
    let bytes = vec![0, 255, 128, 13, 10];
    let mut file = upload("Report.PDF", bytes.clone());
    file.project = Some(project_receipt(owner(), EntityType::Project));
    let created = creator.upload_file(owner(), file).await.unwrap();
    assert_eq!(created.document_id(), DOCUMENT_ID);
    assert_eq!(
        created
            .response()
            .document_response
            .document_metadata
            .content,
        DocumentContent::pending()
    );
    let creates = service.creates.lock().unwrap();
    assert_eq!(creates.len(), 1);
    assert_eq!(creates[0].document_name, "Report");
    assert_eq!(creates[0].file_type, Some(FileType::Pdf));
    assert_eq!(creates[0].user_id, owner());
    assert_eq!(creates[0].project_id, Some(PROJECT_ID.parse().unwrap()));
    assert!(creates[0].attribution.is_some());
    assert_eq!(creates[0].sha, file_shas(&bytes).hex);
    let uploads = uploader.uploads.lock().unwrap();
    assert_eq!(uploads.len(), 1);
    assert_eq!(uploads[0].bytes, bytes);
    assert_eq!(uploads[0].base64_sha256, file_shas(&bytes).base64);
    assert_eq!(uploads[0].content_type, "application/octet-stream");
    assert!(service.cleanups.lock().unwrap().is_empty());
}

#[tokio::test]
async fn preserves_unknown_extensions_and_leaves_conversion_to_the_pipeline() {
    for (name, expected_name, expected_type) in [
        ("archive.custom", "archive.custom", None),
        ("README", "README", None),
        ("report.docx", "report", Some(FileType::Docx)),
        ("notes.md", "notes", Some(FileType::Md)),
    ] {
        let service = Arc::new(RecordingService::default());
        let uploader = RecordingUploader::default();
        let creator = DocumentCreator::new(service.clone(), (), &uploader, ());
        creator
            .upload_file(owner(), upload(name, b"contents".to_vec()))
            .await
            .unwrap();
        let creates = service.creates.lock().unwrap();
        assert_eq!(creates[0].document_name, expected_name);
        assert_eq!(creates[0].file_type, expected_type);
    }
}

#[tokio::test]
async fn rejects_invalid_files_before_creating_metadata() {
    let service = Arc::new(RecordingService::default());
    let uploader = RecordingUploader::default();
    let creator = DocumentCreator::new(service.clone(), (), &uploader, ());
    for file in [
        upload("../report.pdf", vec![]),
        upload("C:\\report.pdf", vec![]),
        upload(" ", vec![]),
        upload(".pdf", vec![]),
        upload("bad\0.pdf", vec![]),
        upload("native.spreadsheet", vec![]),
        upload("bad.md", vec![255]),
        upload("large.pdf", vec![0; MAX_INLINE_UPLOAD_BYTES + 1]),
    ] {
        assert!(matches!(
            creator.upload_file(owner(), file).await,
            Err(DocumentError::BadRequest(_))
        ));
    }
    assert!(service.creates.lock().unwrap().is_empty());
    assert!(uploader.uploads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn rejects_receipts_for_another_user_or_entity_type() {
    let service = Arc::new(RecordingService::default());
    let uploader = RecordingUploader::default();
    let creator = DocumentCreator::new(service.clone(), (), &uploader, ());
    for receipt in [
        project_receipt(
            MacroUserIdStr::try_from("macro|other@example.com".to_string()).unwrap(),
            EntityType::Project,
        ),
        project_receipt(owner(), EntityType::Document),
    ] {
        let mut file = upload("report.pdf", vec![]);
        file.project = Some(receipt);
        assert!(matches!(
            creator.upload_file(owner(), file).await,
            Err(DocumentError::Unauthorized)
        ));
    }
    assert!(service.creates.lock().unwrap().is_empty());
    assert!(uploader.uploads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cleans_up_when_storage_upload_fails_or_url_is_missing() {
    for omit_url in [false, true] {
        let service = Arc::new(RecordingService {
            omit_url,
            ..Default::default()
        });
        let uploader = RecordingUploader {
            fail: true,
            ..Default::default()
        };
        let creator = DocumentCreator::new(service.clone(), (), &uploader, ());
        assert!(
            creator
                .upload_file(owner(), upload("report.pdf", vec![1]))
                .await
                .is_err()
        );
        assert_eq!(*service.cleanups.lock().unwrap(), [DOCUMENT_ID]);
        assert_eq!(
            uploader.uploads.lock().unwrap().len(),
            usize::from(!omit_url)
        );
    }
}

#[tokio::test]
async fn accepts_empty_files_and_the_exact_size_limit() {
    let service = Arc::new(RecordingService::default());
    let uploader = RecordingUploader::default();
    let creator = DocumentCreator::new(service, (), &uploader, ());
    for size in [0, MAX_INLINE_UPLOAD_BYTES] {
        creator
            .upload_file(owner(), upload("file.bin", vec![0; size]))
            .await
            .unwrap();
    }
    assert_eq!(uploader.uploads.lock().unwrap().len(), 2);
}
