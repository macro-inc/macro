use super::*;
use documents::domain::{
    content::DocumentContent,
    create::DocumentCreator,
    models::{CreateTaskRequest, NewDocument},
    ports::create::{DocumentBytesUpload, DocumentBytesUploadPort, DocumentCreationService},
    response::{CreateDocumentResponseData, DocumentResponse, DocumentResponseMetadataWithContent},
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{FileType, response::DocumentResponseMetadata};
use std::sync::{Arc, Mutex};
const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000123";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake";

fn principal() -> CreationPrincipal {
    CreationPrincipal::BotForUser {
        bot: bot_id::MACRO_AI_BOT_ID,
        user: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
    }
}
#[derive(Default)]
struct RecordingService {
    creates: Mutex<Vec<NewDocument>>,
}

impl DocumentCreationService for RecordingService {
    async fn create_document(
        &self,
        principal: &CreationPrincipal,
        document: NewDocument,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        let file_type = document.file_type.map(|kind| kind.to_string());
        let document_name = document.document_name.clone();
        self.creates.lock().unwrap().push(document);
        Ok(CreateDocumentResponseData {
            document_response: DocumentResponse {
                document_metadata: DocumentResponseMetadataWithContent::new(
                    DocumentResponseMetadata {
                        document_id: DOCUMENT_ID.to_string(),
                        document_version_id: 1,
                        owner: principal.owner(),
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
                presigned_url: Some("https://storage.example/upload".to_string()),
            },
            content_type: "image/png".to_string(),
            file_type,
        })
    }

    async fn handle_task_properties(
        &self,
        _: &CreationPrincipal,
        _: &str,
        _: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        panic!("generated images are not tasks")
    }

    async fn mark_document_uploaded(&self, _: &str) -> Result<(), DocumentError> {
        panic!("the storage event pipeline finalizes uploads")
    }

    async fn set_document_content(&self, _: &str, _: DocumentContent) -> Result<(), DocumentError> {
        panic!("the storage event pipeline finalizes uploads")
    }

    async fn cleanup_created_document(&self, _: &str) {}
}

#[derive(Clone, Default)]
struct RecordingUploader {
    uploads: Arc<Mutex<Vec<DocumentBytesUpload>>>,
}

impl DocumentBytesUploadPort for RecordingUploader {
    async fn upload_document_bytes(
        &self,
        upload: DocumentBytesUpload,
    ) -> Result<(), DocumentError> {
        self.uploads.lock().unwrap().push(upload);
        Ok(())
    }
}

#[tokio::test]
async fn saves_through_the_existing_document_upload_lifecycle() {
    let service = Arc::new(RecordingService::default());
    let uploader = RecordingUploader::default();
    let store = DocumentsImageStore::new(DocumentCreator::new(
        service.clone(),
        (),
        uploader.clone(),
        (),
    ));
    let id = store
        .save_image(
            &principal(),
            NewImageDocument {
                file_name: "Lighthouse.png".to_string(),
                bytes: PNG.to_vec(),
                project: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(id.to_string(), DOCUMENT_ID);
    let creates = service.creates.lock().unwrap();
    assert_eq!(creates.len(), 1);
    assert_eq!(creates[0].document_name, "Lighthouse");
    assert_eq!(creates[0].file_type, Some(FileType::Png));
    let uploads = uploader.uploads.lock().unwrap();
    assert_eq!(uploads.len(), 1);
    assert_eq!(uploads[0].bytes, PNG);
    assert_eq!(uploads[0].content_type, "image/png");
}

#[tokio::test]
async fn preserves_destination_capabilities_and_document_authorization() {
    use entity_access::domain::models::{
        BotReceiptScope, EditAccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
    };
    use models_permissions::share_permission::access_level::AccessLevel;

    let project_id = Uuid::from_u128(0x456);
    for (user, entity_type, allowed) in [
        ("macro|owner@example.com", EntityType::Project, true),
        ("macro|other@example.com", EntityType::Project, false),
        ("macro|owner@example.com", EntityType::Document, false),
    ] {
        let receipt = EntityAccessReceipt::<EditAccessLevel>::try_new_bot(
            bot_id::MACRO_AI_BOT_ID.into(),
            BotReceiptScope::User {
                acting_user: MacroUserIdStr::try_from(user.to_string()).unwrap(),
            },
            Entity {
                entity_id: project_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit,
            },
        )
        .unwrap();
        let service = Arc::new(RecordingService::default());
        let uploader = RecordingUploader::default();
        let store = DocumentsImageStore::new(DocumentCreator::new(
            service.clone(),
            (),
            uploader.clone(),
            (),
        ));
        let result = store
            .save_image(
                &principal(),
                NewImageDocument {
                    file_name: "Lighthouse.png".to_string(),
                    bytes: PNG.to_vec(),
                    project: Some(receipt),
                },
            )
            .await;
        let creates = service.creates.lock().unwrap();
        if allowed {
            assert_eq!(result.unwrap().to_string(), DOCUMENT_ID);
            assert_eq!(creates[0].project_id, Some(project_id));
        } else {
            assert!(matches!(result, Err(SaveImageError::Unauthorized)));
            assert!(creates.is_empty());
            assert!(uploader.uploads.lock().unwrap().is_empty());
        }
    }
}
