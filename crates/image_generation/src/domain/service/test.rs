use super::*;
use crate::domain::models::{
    GeneratedImage, ImageAspectRatio, ImageReference, ReadImageError, ReferenceImage,
    SaveImageError, StoredImage,
};
use crate::domain::ports::UnconfiguredImageGenerator;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const STATIC_FILE_ID: Uuid = Uuid::from_u128(0x123);
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
    saves: Mutex<Vec<NewStaticImage>>,
    fail: bool,
}

impl ImageStore for Arc<RecordingStore> {
    async fn save_image(&self, image: NewStaticImage) -> Result<StoredImage, SaveImageError> {
        if self.fail {
            return Err(SaveImageError::Internal(rootcause::report!(
                "upload failed"
            )));
        }
        self.saves.lock().unwrap().push(image);
        Ok(StoredImage {
            id: STATIC_FILE_ID,
            url: "https://static.example/file/image".to_string(),
        })
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
        usage: &UsageContext,
        recorder: &dyn UsageRecorder,
    ) -> Result<GeneratedImage, ImageGenerationError> {
        self.requests.lock().unwrap().push(request.clone());
        recorder.record(usage.clone().into_event(
            "gemini-2.5-flash-image".to_string(),
            ai_usage::UsageAmount::Tokens {
                input: 8,
                output: 1290,
                cache_read: 0,
                cache_write: 0,
            },
        ));
        self.result
            .clone()
            .map_err(|reason| ImageGenerationError::Refused(reason.to_string()))
    }
}

#[derive(Default)]
struct RecordingComposer {
    calls: Mutex<Vec<(Uuid, String, u32, u32)>>,
    fail: bool,
}

#[async_trait::async_trait]
impl ImageMarkdownComposer for RecordingComposer {
    async fn compose_image(
        &self,
        image: &StoredImage,
        width: u32,
        height: u32,
    ) -> Result<String, crate::domain::models::ComposeImageError> {
        self.calls
            .lock()
            .unwrap()
            .push((image.id, image.url.clone(), width, height));
        if self.fail {
            return Err(crate::domain::models::ComposeImageError(
                rootcause::report!("lexical unavailable"),
            ));
        }
        Ok("markup returned by Lexical".to_string())
    }
}

fn test_service(
    generator: Arc<dyn ImageGenerator>,
    store: Arc<RecordingStore>,
) -> ImageGenerationServiceImpl<Arc<RecordingStore>> {
    ImageGenerationServiceImpl::new(
        generator,
        store,
        Arc::new(RecordingComposer::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
}

fn png() -> GeneratedImage {
    GeneratedImage {
        width: 1536,
        height: 1024,
        bytes: PNG.to_vec(),
        mime_type: "image/png".to_string(),
        note: Some("A calm scene.".to_string()),
    }
}

fn request(prompt: &str) -> NewGeneratedImage {
    NewGeneratedImage {
        prompt: prompt.to_string(),
        aspect_ratio: Some(ImageAspectRatio::Widescreen),
        reference_images: Vec::new(),
    }
}

#[tokio::test]
async fn generates_then_uploads_bytes_and_returns_the_static_file() {
    let store = Arc::new(RecordingStore::default());
    let generator = Arc::new(FakeGenerator::returning(png()));
    let service = test_service(generator.clone(), store.clone());
    let created = service
        .create_generated_image(&principal(), request("  a lighthouse at dusk "))
        .await
        .unwrap();
    assert_eq!(created.static_file.id, STATIC_FILE_ID);
    assert_eq!(created.static_file.url, "https://static.example/file/image");
    assert_eq!(created.mime_type, "image/png");
    assert_eq!((created.width, created.height), (1536, 1024));
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
    assert_eq!(saves[0].bytes, PNG);
    assert_eq!(saves[0].mime_type, "image/png");
}

#[tokio::test]
async fn rejects_bad_input_before_calling_the_provider() {
    let generator = Arc::new(FakeGenerator::returning(png()));
    let store = Arc::new(RecordingStore::default());
    let service = test_service(generator.clone(), store.clone());
    for image in [request("   "), request(&"p".repeat(MAX_PROMPT_BYTES + 1))] {
        assert!(matches!(
            service.create_generated_image(&principal(), image).await,
            Err(GenerateImageError::BadRequest(_))
        ));
    }
    assert!(generator.requests.lock().unwrap().is_empty());
    assert!(store.saves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn provider_failures_upload_no_image() {
    let store = Arc::new(RecordingStore::default());
    let service = test_service(
        Arc::new(FakeGenerator::refusing("blocked by safety filters")),
        store.clone(),
    );
    assert!(
        matches!(service.create_generated_image(&principal(), request("prompt")).await,
        Err(GenerateImageError::Generation(ImageGenerationError::Refused(ref reason))) if reason == "blocked by safety filters")
    );
    let service = test_service(Arc::new(UnconfiguredImageGenerator), store.clone());
    assert!(matches!(
        service
            .create_generated_image(&principal(), request("prompt"))
            .await,
        Err(GenerateImageError::Generation(
            ImageGenerationError::Unavailable
        ))
    ));
    for image in [
        GeneratedImage {
            mime_type: "application/pdf".to_string(),
            ..png()
        },
        GeneratedImage {
            bytes: Vec::new(),
            ..png()
        },
    ] {
        let service = test_service(Arc::new(FakeGenerator::returning(image)), store.clone());
        assert!(matches!(
            service
                .create_generated_image(&principal(), request("prompt"))
                .await,
            Err(GenerateImageError::Generation(
                ImageGenerationError::Provider(_)
            ))
        ));
    }
    assert!(store.saves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn propagates_static_file_upload_failures() {
    let service = test_service(
        Arc::new(FakeGenerator::returning(png())),
        Arc::new(RecordingStore {
            fail: true,
            ..Default::default()
        }),
    );
    assert!(matches!(
        service
            .create_generated_image(&principal(), request("prompt"))
            .await,
        Err(GenerateImageError::Storage(SaveImageError::Internal(_)))
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
    let service =
        test_service(generator.clone(), store.clone()).with_reference_reader(reader.clone());
    let mut image = request("  edit image 1 using image 2  ");
    image.reference_images = vec![DOCUMENT_REFERENCE, STATIC_REFERENCE];

    let created = service
        .create_generated_image(&principal(), image)
        .await
        .unwrap();

    assert_eq!(created.static_file.id, STATIC_FILE_ID);
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
    assert_eq!(saves[0].bytes, PNG);
    assert_eq!(saves[0].mime_type, "image/png");
}

#[tokio::test]
async fn excessive_reference_count_is_rejected_before_any_read_or_generation() {
    let reader = Arc::new(RecordingReader::returning(Vec::new()));
    let generator = Arc::new(FakeGenerator::returning(png()));
    let store = Arc::new(RecordingStore::default());
    let service =
        test_service(generator.clone(), store.clone()).with_reference_reader(reader.clone());
    let mut image = request("edit these images");
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
        let service =
            test_service(generator.clone(), store.clone()).with_reference_reader(reader.clone());
        let mut image = request("combine all three images");
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
        let service =
            test_service(generator.clone(), store.clone()).with_reference_reader(reader.clone());
        let mut image = request("edit these images");
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
    let service = test_service(generator.clone(), store.clone()).with_reference_reader(reader);
    let mut image = request("combine all three images");
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
    let service = test_service(generator.clone(), store.clone());
    let mut image = request("edit this photo");
    image.reference_images = vec![DOCUMENT_REFERENCE];

    assert!(matches!(
        service.create_generated_image(&principal(), image).await,
        Err(GenerateImageError::Reference(ReadImageError::Unavailable))
    ));
    assert!(generator.requests.lock().unwrap().is_empty());
    assert!(store.saves.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delegates_saved_image_dimensions_to_the_composer() {
    let store = Arc::new(RecordingStore::default());
    let composer = Arc::new(RecordingComposer::default());
    let service = ImageGenerationServiceImpl::new(
        Arc::new(FakeGenerator::returning(png())),
        store,
        composer.clone(),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    let created = service
        .create_generated_image(&principal(), request("image"))
        .await
        .unwrap();
    assert_eq!(created.markdown, "markup returned by Lexical");
    assert_eq!(
        *composer.calls.lock().unwrap(),
        [(STATIC_FILE_ID, created.static_file.url, 1536, 1024)]
    );
}

#[tokio::test]
async fn reports_composition_failure_after_saving_the_image() {
    let store = Arc::new(RecordingStore::default());
    let service = ImageGenerationServiceImpl::new(
        Arc::new(FakeGenerator::returning(png())),
        store.clone(),
        Arc::new(RecordingComposer {
            fail: true,
            ..Default::default()
        }),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    assert!(matches!(
        service
            .create_generated_image(&principal(), request("image"))
            .await,
        Err(GenerateImageError::Markup(_))
    ));
    assert_eq!(store.saves.lock().unwrap().len(), 1);
}

#[derive(Default)]
struct RecordingUsage(Mutex<Vec<ai_usage::UsageEvent>>);

impl UsageRecorder for RecordingUsage {
    fn record(&self, event: ai_usage::UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[tokio::test]
async fn attributes_usage_to_the_user_even_when_upload_fails() {
    for fail in [false, true] {
        let recorder = Arc::new(RecordingUsage::default());
        let service = ImageGenerationServiceImpl::new(
            Arc::new(FakeGenerator::returning(png())),
            Arc::new(RecordingStore {
                fail,
                ..Default::default()
            }),
            Arc::new(RecordingComposer::default()),
            recorder.clone(),
        )
        .with_reference_reader(Arc::new(RecordingReader::returning(Vec::new())));
        let result = service
            .create_generated_image(&principal(), request("draw a cat"))
            .await;
        assert_eq!(result.is_err(), fail);
        let events = recorder.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].feature, AiFeature::ImageGeneration);
        assert_eq!(&events[0].user, principal().user().unwrap());
        assert_eq!(events[0].entity, None);
        assert_eq!(
            events[0].amount,
            ai_usage::UsageAmount::Tokens {
                input: 8,
                output: 1290,
                cache_read: 0,
                cache_write: 0,
            }
        );
    }
}

#[tokio::test]
async fn invalid_requests_do_not_record_usage() {
    let recorder = Arc::new(RecordingUsage::default());
    let service = ImageGenerationServiceImpl::new(
        Arc::new(FakeGenerator::returning(png())),
        Arc::new(RecordingStore::default()),
        Arc::new(RecordingComposer::default()),
        recorder.clone(),
    );
    assert!(
        service
            .create_generated_image(&principal(), request(" "))
            .await
            .is_err()
    );
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn direct_users_and_team_bots_have_distinct_usage_attribution() {
    let user = principal().user().unwrap().clone();
    let team_bot = CreationPrincipal::TeamBot {
        bot: bot_id::NonSystemBotId::new(bot_id::BotId::new_from_uuid(Uuid::from_u128(42)))
            .unwrap(),
        team: Uuid::from_u128(43),
    };
    for (principal, expected_user) in [
        (CreationPrincipal::User(user.clone()), user),
        (team_bot, ai_usage::SYSTEM_USER_ID.clone()),
    ] {
        let recorder = Arc::new(RecordingUsage::default());
        let service = ImageGenerationServiceImpl::new(
            Arc::new(FakeGenerator::returning(png())),
            Arc::new(RecordingStore::default()),
            Arc::new(RecordingComposer::default()),
            recorder.clone(),
        );
        service
            .create_generated_image(&principal, request("draw a cat"))
            .await
            .unwrap();
        let events = recorder.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].user, expected_user);
    }
}
