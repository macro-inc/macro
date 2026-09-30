use super::*;
use crate::domain::models::{
    GeneratedImage, ImageAspectRatio, ImageReference, ReadImageError, ReferenceImage,
    SaveImageError,
};
use crate::domain::ports::UnconfiguredImageGenerator;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const DOCUMENT_ID: Uuid = Uuid::from_u128(0x123);
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake";
const DOCUMENT_REFERENCE: ImageReference = ImageReference::Document(Uuid::from_u128(0x456));
const STATIC_REFERENCE: ImageReference = ImageReference::StaticFile(Uuid::from_u128(0x789));

fn principal() -> CreationPrincipal {
    CreationPrincipal::BotForUser {
        bot: bot_id::MACRO_AI_BOT_ID,
        user: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
    }
}

#[derive(Default)]
struct RecordingStore {
    saves: Mutex<Vec<(CreationPrincipal, NewImageDocument)>>,
    deny: bool,
}

impl ImageDocumentStore for Arc<RecordingStore> {
    async fn save_image(
        &self,
        principal: &CreationPrincipal,
        image: NewImageDocument,
    ) -> Result<Uuid, SaveImageError> {
        if self.deny {
            return Err(SaveImageError::Unauthorized);
        }
        self.saves.lock().unwrap().push((principal.clone(), image));
        Ok(DOCUMENT_ID)
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
        file_name: Some(file_name.to_string()),
        project: None,
        reference_images: Vec::new(),
    }
}

#[tokio::test]
async fn generates_then_saves_with_the_delegated_identity() {
    let store = Arc::new(RecordingStore::default());
    let generator = Arc::new(FakeGenerator::returning(png()));
    let service = ImageGenerationServiceImpl::new(generator.clone(), store.clone());
    let created = service
        .create_generated_image(
            &principal(),
            request("  a lighthouse at dusk ", "Lighthouse"),
        )
        .await
        .unwrap();
    assert_eq!(created.document_id, DOCUMENT_ID);
    assert_eq!(created.file_name, "Lighthouse.png");
    assert_eq!(created.mime_type, "image/png");
    assert_eq!(created.size_bytes, PNG.len());
    assert_eq!(created.note.as_deref(), Some("A calm scene."));
    assert_eq!(
        *generator.requests.lock().unwrap(),
        [ImageGenerationRequest {
            prompt: "a lighthouse at dusk".to_string(),
            aspect_ratio: Some(ImageAspectRatio::Widescreen),
            reference_images: Vec::new(),
        }]
    );
    let saves = store.saves.lock().unwrap();
    assert_eq!(saves.len(), 1);
    assert_eq!(saves[0].0, principal());
    assert_eq!(saves[0].1.bytes, PNG);
    assert_eq!(saves[0].1.file_name, "Lighthouse.png");
    assert!(saves[0].1.project.is_none());
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
        let generator = Arc::new(FakeGenerator::returning(GeneratedImage {
            mime_type: mime_type.to_string(),
            ..png()
        }));
        let service =
            ImageGenerationServiceImpl::new(generator, Arc::new(RecordingStore::default()));
        let created = service
            .create_generated_image(&principal(), request("prompt", file_name))
            .await
            .unwrap();
        assert_eq!(created.file_name, expected, "{file_name} / {mime_type}");
    }
}

#[tokio::test]
async fn names_the_document_after_the_prompt_when_no_name_is_given() {
    for (prompt, file_name, expected) in [
        (
            "A red lighthouse on a rocky shore at dusk, flat vector",
            None,
            "A red lighthouse on a rocky.png",
        ),
        (
            "Draw: \"Q3 revenue\" chart (bar)!",
            Some("  "),
            "Draw Q3 revenue chart bar.png",
        ),
        ("café-style sign", None, "café-style sign.png"),
        ("!!! ???", None, "Generated image.png"),
    ] {
        let service = ImageGenerationServiceImpl::new(
            Arc::new(FakeGenerator::returning(png())),
            Arc::new(RecordingStore::default()),
        );
        let created = service
            .create_generated_image(
                &principal(),
                NewGeneratedImage {
                    prompt: prompt.to_string(),
                    aspect_ratio: None,
                    file_name: file_name.map(str::to_string),
                    project: None,
                    reference_images: Vec::new(),
                },
            )
            .await
            .unwrap();
        assert_eq!(created.file_name, expected, "{prompt:?}");
    }
}

#[tokio::test]
async fn rejects_bad_input_before_calling_the_provider() {
    let generator = Arc::new(FakeGenerator::returning(png()));
    let store = Arc::new(RecordingStore::default());
    let service = ImageGenerationServiceImpl::new(generator.clone(), store.clone());
    for image in [
        request("   ", "name"),
        request(&"p".repeat(MAX_PROMPT_BYTES + 1), "name"),
    ] {
        assert!(matches!(
            service.create_generated_image(&principal(), image).await,
            Err(GenerateImageError::BadRequest(_))
        ));
    }
    assert!(generator.requests.lock().unwrap().is_empty());
    assert!(store.saves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn provider_failures_create_no_document() {
    let store = Arc::new(RecordingStore::default());
    let service = ImageGenerationServiceImpl::new(
        Arc::new(FakeGenerator::refusing("blocked by safety filters")),
        store.clone(),
    );
    assert!(
        matches!(service.create_generated_image(&principal(), request("prompt", "name")).await,
        Err(GenerateImageError::Generation(ImageGenerationError::Refused(ref reason))) if reason == "blocked by safety filters")
    );
    let service =
        ImageGenerationServiceImpl::new(Arc::new(UnconfiguredImageGenerator), store.clone());
    assert!(matches!(
        service
            .create_generated_image(&principal(), request("prompt", "name"))
            .await,
        Err(GenerateImageError::Generation(
            ImageGenerationError::Unavailable
        ))
    ));
    let service = ImageGenerationServiceImpl::new(
        Arc::new(FakeGenerator::returning(GeneratedImage {
            mime_type: "application/pdf".to_string(),
            ..png()
        })),
        store.clone(),
    );
    assert!(matches!(
        service
            .create_generated_image(&principal(), request("prompt", "name"))
            .await,
        Err(GenerateImageError::Generation(
            ImageGenerationError::Provider(_)
        ))
    ));
    assert!(store.saves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn propagates_document_authorization_failures() {
    let service = ImageGenerationServiceImpl::new(
        Arc::new(FakeGenerator::returning(png())),
        Arc::new(RecordingStore {
            deny: true,
            ..Default::default()
        }),
    );
    assert!(matches!(
        service
            .create_generated_image(&principal(), request("prompt", "name"))
            .await,
        Err(GenerateImageError::Document(SaveImageError::Unauthorized))
    ));
}

struct RecordingReader {
    calls: Mutex<Vec<(CreationPrincipal, ImageReference)>>,
    results: Mutex<VecDeque<Result<ReferenceImage, ReadImageError>>>,
}

impl RecordingReader {
    fn returning(results: Vec<Result<ReferenceImage, ReadImageError>>) -> Self {
        Self {
            calls: Mutex::default(),
            results: Mutex::new(results.into()),
        }
    }
}

impl ImageReferenceReader for Arc<RecordingReader> {
    async fn read_image(
        &self,
        principal: &CreationPrincipal,
        reference: &ImageReference,
    ) -> Result<ReferenceImage, ReadImageError> {
        self.calls
            .lock()
            .unwrap()
            .push((principal.clone(), *reference));
        self.results
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected reference read")
    }
}

fn reference_image(bytes: Vec<u8>, mime_type: &str) -> ReferenceImage {
    ReferenceImage {
        bytes,
        mime_type: mime_type.to_string(),
    }
}

#[tokio::test]
async fn resolves_references_in_order_under_the_creating_principal_before_generation() {
    let images = vec![
        reference_image(PNG.to_vec(), "image/png"),
        reference_image(b"reference jpeg".to_vec(), "image/jpeg"),
    ];
    let reader = Arc::new(RecordingReader::returning(
        images.iter().cloned().map(Ok).collect(),
    ));
    let generator = Arc::new(FakeGenerator::returning(png()));
    let store = Arc::new(RecordingStore::default());
    let service = ImageGenerationServiceImpl::new(generator.clone(), store.clone())
        .with_reference_reader(reader.clone());
    let mut image = request("  edit image 1 using image 2  ", "Edited image");
    image.reference_images = vec![DOCUMENT_REFERENCE, STATIC_REFERENCE];

    let created = service
        .create_generated_image(&principal(), image)
        .await
        .unwrap();

    assert_eq!(created.document_id, DOCUMENT_ID);
    assert_eq!(
        *reader.calls.lock().unwrap(),
        [
            (principal(), DOCUMENT_REFERENCE),
            (principal(), STATIC_REFERENCE)
        ]
    );
    assert_eq!(
        *generator.requests.lock().unwrap(),
        [ImageGenerationRequest {
            prompt: "edit image 1 using image 2".to_string(),
            aspect_ratio: Some(ImageAspectRatio::Widescreen),
            reference_images: images,
        }]
    );
    let saves = store.saves.lock().unwrap();
    assert_eq!(saves.len(), 1);
    assert_eq!(saves[0].0, principal());
    assert_eq!(saves[0].1.bytes, PNG);
    assert_eq!(saves[0].1.file_name, "Edited image.png");
}

#[tokio::test]
async fn excessive_reference_count_is_rejected_before_any_read_or_generation() {
    let reader = Arc::new(RecordingReader::returning(Vec::new()));
    let generator = Arc::new(FakeGenerator::returning(png()));
    let store = Arc::new(RecordingStore::default());
    let service = ImageGenerationServiceImpl::new(generator.clone(), store.clone())
        .with_reference_reader(reader.clone());
    let mut image = request("edit these images", "Edited");
    image.reference_images = vec![DOCUMENT_REFERENCE; MAX_REFERENCE_IMAGES + 1];

    assert!(matches!(
        service.create_generated_image(&principal(), image).await,
        Err(GenerateImageError::BadRequest(_))
    ));
    assert!(reader.calls.lock().unwrap().is_empty());
    assert!(generator.requests.lock().unwrap().is_empty());
    assert!(store.saves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_reference_reads_never_generate_from_a_partial_set() {
    for error in [
        ReadImageError::Unauthorized,
        ReadImageError::NotImage,
        ReadImageError::Unavailable,
        ReadImageError::Internal(rootcause::report!("storage unavailable")),
    ] {
        let expected_error = error.to_string();
        let reader = Arc::new(RecordingReader::returning(vec![
            Ok(reference_image(PNG.to_vec(), "image/png")),
            Err(error),
        ]));
        let generator = Arc::new(FakeGenerator::returning(png()));
        let store = Arc::new(RecordingStore::default());
        let service = ImageGenerationServiceImpl::new(generator.clone(), store.clone())
            .with_reference_reader(reader.clone());
        let mut image = request("combine all three images", "Combined");
        image.reference_images = vec![DOCUMENT_REFERENCE, STATIC_REFERENCE, DOCUMENT_REFERENCE];

        assert!(matches!(
            service.create_generated_image(&principal(), image).await,
            Err(GenerateImageError::Reference(error)) if error.to_string() == expected_error
        ));
        assert_eq!(reader.calls.lock().unwrap().len(), 2);
        assert!(generator.requests.lock().unwrap().is_empty());
        assert!(store.saves.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn invalid_reference_content_is_rejected_before_generation_or_storage() {
    for images in [
        vec![reference_image(PNG.to_vec(), "image/gif")],
        vec![reference_image(Vec::new(), "image/png")],
        vec![reference_image(
            vec![0; MAX_REFERENCE_BYTES + 1],
            "image/png",
        )],
        vec![
            reference_image(vec![0; MAX_REFERENCE_BYTES / 2], "image/png"),
            reference_image(vec![0; MAX_REFERENCE_BYTES / 2 + 1], "image/webp"),
        ],
    ] {
        let image_count = images.len();
        let reader = Arc::new(RecordingReader::returning(
            images.into_iter().map(Ok).collect(),
        ));
        let generator = Arc::new(FakeGenerator::returning(png()));
        let store = Arc::new(RecordingStore::default());
        let service = ImageGenerationServiceImpl::new(generator.clone(), store.clone())
            .with_reference_reader(reader.clone());
        let mut image = request("edit these images", "Edited");
        image.reference_images = vec![DOCUMENT_REFERENCE; image_count];

        assert!(matches!(
            service.create_generated_image(&principal(), image).await,
            Err(GenerateImageError::BadRequest(_))
        ));
        assert_eq!(reader.calls.lock().unwrap().len(), image_count);
        assert!(generator.requests.lock().unwrap().is_empty());
        assert!(store.saves.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn accepts_three_supported_images_at_the_total_byte_limit() {
    let images = vec![
        reference_image(vec![0; MAX_REFERENCE_BYTES - 2], "image/png"),
        reference_image(vec![1], "image/jpeg"),
        reference_image(vec![2], "image/webp"),
    ];
    let reader = Arc::new(RecordingReader::returning(
        images.into_iter().map(Ok).collect(),
    ));
    let generator = Arc::new(FakeGenerator::returning(png()));
    let store = Arc::new(RecordingStore::default());
    let service = ImageGenerationServiceImpl::new(generator.clone(), store.clone())
        .with_reference_reader(reader);
    let mut image = request("combine all three images", "Combined");
    image.reference_images = vec![DOCUMENT_REFERENCE, STATIC_REFERENCE, DOCUMENT_REFERENCE];

    service
        .create_generated_image(&principal(), image)
        .await
        .unwrap();

    let requests = generator.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].reference_images.len(), MAX_REFERENCE_IMAGES);
    assert_eq!(
        requests[0]
            .reference_images
            .iter()
            .map(|image| image.bytes.len())
            .sum::<usize>(),
        MAX_REFERENCE_BYTES
    );
    assert_eq!(store.saves.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn missing_reference_reader_does_not_silently_fall_back_to_text_only() {
    let generator = Arc::new(FakeGenerator::returning(png()));
    let store = Arc::new(RecordingStore::default());
    let service = ImageGenerationServiceImpl::new(generator.clone(), store.clone());
    let mut image = request("edit this photo", "Edited");
    image.reference_images = vec![DOCUMENT_REFERENCE];

    assert!(matches!(
        service.create_generated_image(&principal(), image).await,
        Err(GenerateImageError::Reference(ReadImageError::Unavailable))
    ));
    assert!(generator.requests.lock().unwrap().is_empty());
    assert!(store.saves.lock().unwrap().is_empty());
}
