use super::*;
use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;
use model::document::response::DocumentResponseMetadata;

use crate::domain::content::DocumentContent;
use crate::domain::create::file_shas;
use crate::domain::models::{CreateTaskRequest, NewDocument};
use crate::domain::ports::create::DocumentBytesUpload;
use crate::domain::ports::image_generation::{GeneratedImage, UnconfiguredImageGenerator};
use crate::domain::response::{
    CreateDocumentResponseData, DocumentResponse, DocumentResponseMetadataWithContent,
};

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

#[derive(Default)]
struct RecordingUploader {
    uploads: Mutex<Vec<DocumentBytesUpload>>,
}

impl DocumentBytesUploadPort for Arc<RecordingUploader> {
    async fn upload_document_bytes(
        &self,
        upload: DocumentBytesUpload,
    ) -> Result<(), DocumentError> {
        self.uploads.lock().unwrap().push(upload);
        Ok(())
    }
}

/// Returns a fixed image and records what it was asked for.
struct FakeGenerator {
    requests: Mutex<Vec<ImageGenerationRequest>>,
    result: Result<GeneratedImage, &'static str>,
}

impl FakeGenerator {
    fn returning(image: GeneratedImage) -> Self {
        Self {
            requests: Mutex::default(),
            result: Ok(image),
        }
    }

    fn refusing(reason: &'static str) -> Self {
        Self {
            requests: Mutex::default(),
            result: Err(reason),
        }
    }
}

#[async_trait::async_trait]
impl ImageGenerator for FakeGenerator {
    async fn generate_image(
        &self,
        request: &ImageGenerationRequest,
    ) -> Result<GeneratedImage, ImageGenerationError> {
        self.requests.lock().unwrap().push(request.clone());
        self.result
            .clone()
            .map_err(|reason| ImageGenerationError::Refused(reason.to_string()))
    }
}

fn png() -> GeneratedImage {
    GeneratedImage {
        bytes: PNG.to_vec(),
        mime_type: "image/png".to_string(),
        note: Some("A calm scene.".to_string()),
    }
}

fn request(prompt: &str, file_name: &str) -> NewGeneratedImage {
    NewGeneratedImage {
        prompt: prompt.to_string(),
        aspect_ratio: Some(ImageAspectRatio::Widescreen),
        file_name: file_name.to_string(),
        project: None,
    }
}

#[tokio::test]
async fn generates_then_uploads_the_image_as_a_document() {
    let service = Arc::new(RecordingService::default());
    let uploader = Arc::new(RecordingUploader::default());
    let generator = FakeGenerator::returning(png());
    let creator = DocumentCreator::new(service.clone(), (), uploader.clone(), ());

    let created = creator
        .create_generated_image(
            &principal(),
            &generator,
            request("  a lighthouse at dusk ", "Lighthouse"),
        )
        .await
        .unwrap();

    assert_eq!(created.document.document_id(), DOCUMENT_ID);
    assert_eq!(created.file_name, "Lighthouse.png");
    assert_eq!(created.mime_type, "image/png");
    assert_eq!(created.size_bytes, PNG.len());
    assert_eq!(created.note.as_deref(), Some("A calm scene."));

    let requests = generator.requests.lock().unwrap();
    assert_eq!(
        *requests,
        [ImageGenerationRequest {
            prompt: "a lighthouse at dusk".to_string(),
            aspect_ratio: Some(ImageAspectRatio::Widescreen),
        }]
    );
    let creates = service.creates.lock().unwrap();
    assert_eq!(creates.len(), 1);
    assert_eq!(creates[0].document_name, "Lighthouse");
    assert_eq!(creates[0].file_type, Some(FileType::Png));
    assert_eq!(creates[0].sha, file_shas(PNG).hex);
    let uploads = uploader.uploads.lock().unwrap();
    assert_eq!(uploads.len(), 1);
    assert_eq!(uploads[0].bytes, PNG);
    assert_eq!(uploads[0].content_type, "image/png");
}

#[tokio::test]
async fn keeps_an_existing_image_extension_and_adds_the_generated_one_otherwise() {
    for (file_name, mime_type, expected) in [
        ("hero.png", "image/png", "hero.png"),
        ("hero.PNG", "image/jpeg", "hero.PNG"),
        ("hero", "image/jpeg", "hero.jpg"),
        ("hero", "image/webp", "hero.webp"),
        ("v1.2 draft", "image/png", "v1.2 draft.png"),
        ("notes.md", "image/png", "notes.md.png"),
    ] {
        let service = Arc::new(RecordingService::default());
        let uploader = Arc::new(RecordingUploader::default());
        let generator = FakeGenerator::returning(GeneratedImage {
            mime_type: mime_type.to_string(),
            ..png()
        });
        let creator = DocumentCreator::new(service, (), uploader, ());
        let created = creator
            .create_generated_image(&principal(), &generator, request("prompt", file_name))
            .await
            .unwrap();
        assert_eq!(created.file_name, expected, "{file_name} / {mime_type}");
    }
}

#[tokio::test]
async fn rejects_bad_input_before_calling_the_provider() {
    let generator = FakeGenerator::returning(png());
    let service = Arc::new(RecordingService::default());
    let creator = DocumentCreator::new(
        service.clone(),
        (),
        Arc::new(RecordingUploader::default()),
        (),
    );
    for image in [
        request("   ", "name"),
        request("prompt", "  "),
        request(&"p".repeat(MAX_PROMPT_BYTES + 1), "name"),
    ] {
        assert!(matches!(
            creator
                .create_generated_image(&principal(), &generator, image)
                .await,
            Err(GenerateImageError::Document(DocumentError::BadRequest(_)))
        ));
    }
    assert!(generator.requests.lock().unwrap().is_empty());
    assert!(service.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn provider_failures_create_no_document() {
    let service = Arc::new(RecordingService::default());
    let uploader = Arc::new(RecordingUploader::default());
    let creator = DocumentCreator::new(service.clone(), (), uploader.clone(), ());

    let refused = creator
        .create_generated_image(
            &principal(),
            &FakeGenerator::refusing("blocked by safety filters"),
            request("prompt", "name"),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        refused,
        GenerateImageError::Generation(ImageGenerationError::Refused(ref reason))
            if reason == "blocked by safety filters"
    ));

    let unavailable = creator
        .create_generated_image(
            &principal(),
            &UnconfiguredImageGenerator,
            request("prompt", "name"),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        unavailable,
        GenerateImageError::Generation(ImageGenerationError::Unavailable)
    ));

    let unsupported = creator
        .create_generated_image(
            &principal(),
            &FakeGenerator::returning(GeneratedImage {
                mime_type: "application/pdf".to_string(),
                ..png()
            }),
            request("prompt", "name"),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        unsupported,
        GenerateImageError::Generation(ImageGenerationError::Provider(_))
    ));

    assert!(service.creates.lock().unwrap().is_empty());
    assert!(uploader.uploads.lock().unwrap().is_empty());
}
