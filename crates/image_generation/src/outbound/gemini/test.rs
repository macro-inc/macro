use super::*;
use crate::domain::models::{ImageAspectRatio, ReferenceImage};
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn image_bytes(format: image::ImageFormat) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(96, 64)
        .write_to(&mut bytes, format)
        .unwrap();
    bytes.into_inner()
}

static PNG: std::sync::LazyLock<Vec<u8>> =
    std::sync::LazyLock::new(|| image_bytes(image::ImageFormat::Png));

fn generator(server: &MockServer) -> GeminiImageGenerator {
    GeminiImageGenerator::new("test-key".to_string()).with_base_url(server.uri())
}

fn request(aspect_ratio: Option<ImageAspectRatio>) -> ImageGenerationRequest {
    ImageGenerationRequest {
        prompt: "a lighthouse at dusk".to_string(),
        aspect_ratio,
        reference_images: Vec::new(),
    }
}

fn image_response(parts: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "candidates": [{ "content": { "role": "model", "parts": parts }, "finishReason": "STOP" }],
        "usageMetadata": { "promptTokenCount": 8, "candidatesTokenCount": 1290, "totalTokenCount": 1298 }
    })
}

#[tokio::test]
async fn posts_the_prompt_and_decodes_the_first_inline_image() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/models/{NANO_BANANA_MODEL}:generateContent")))
        .and(header("x-goog-api-key", "test-key"))
        .and(body_json(serde_json::json!({
            "contents": [{ "role": "user", "parts": [{ "text": "a lighthouse at dusk" }] }],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": { "aspectRatio": "16:9" }
            }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(image_response(
            serde_json::json!([
                { "text": "  Here is your lighthouse. " },
                { "inlineData": { "mimeType": "image/png", "data": base64::engine::general_purpose::STANDARD.encode(&*PNG) } },
                { "inlineData": { "mimeType": "image/jpeg", "data": "AAAA" } }
            ]),
        )))
        .expect(1)
        .mount(&server)
        .await;

    let image = generator(&server)
        .generate_image(
            &request(Some(ImageAspectRatio::Widescreen)),
            &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
            &ai_usage::NoOpUsageRecorder,
        )
        .await
        .unwrap();

    assert_eq!(image.bytes, *PNG);
    assert_eq!((image.width, image.height), (96, 64));
    assert_eq!(image.mime_type, "image/png");
    assert_eq!(image.note.as_deref(), Some("Here is your lighthouse."));
}

#[tokio::test]
async fn posts_ordered_reference_images_with_their_mime_types_and_exact_bytes() {
    let server = MockServer::start().await;
    let jpeg = b"\xff\xd8\xff\xe0reference";
    let prompt = "Draw the subject from image 1 in the style of image 2";
    Mock::given(method("POST"))
        .and(path(format!("/models/{NANO_BANANA_MODEL}:generateContent")))
        .and(header("x-goog-api-key", "test-key"))
        .and(body_json(serde_json::json!({
            "contents": [{
                "role": "user",
                "parts": [
                    { "text": prompt },
                    {
                        "inlineData": {
                            "mimeType": "image/png",
                            "data": base64::engine::general_purpose::STANDARD.encode(&*PNG),
                        }
                    },
                    {
                        "inlineData": {
                            "mimeType": "image/jpeg",
                            "data": base64::engine::general_purpose::STANDARD.encode(jpeg),
                        }
                    },
                ]
            }],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": { "aspectRatio": "3:4" },
            }
        })))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(image_response(serde_json::json!([
                { "text": "Here is the edited image." },
                {
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": base64::engine::general_purpose::STANDARD.encode(&*PNG),
                    }
                },
            ]))),
        )
        .expect(1)
        .mount(&server)
        .await;

    let image = generator(&server)
        .generate_image(
            &ImageGenerationRequest {
                prompt: prompt.to_string(),
                aspect_ratio: Some(ImageAspectRatio::Portrait),
                reference_images: vec![
                    ReferenceImage {
                        bytes: PNG.to_vec(),
                        mime_type: "image/png".to_string(),
                    },
                    ReferenceImage {
                        bytes: jpeg.to_vec(),
                        mime_type: "image/jpeg".to_string(),
                    },
                ],
            },
            &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
            &ai_usage::NoOpUsageRecorder,
        )
        .await
        .unwrap();

    assert_eq!(image.bytes, *PNG);
    assert_eq!((image.width, image.height), (96, 64));
    assert_eq!(image.mime_type, "image/png");
    assert_eq!(image.note.as_deref(), Some("Here is the edited image."));
}

#[tokio::test]
async fn omits_image_config_without_an_aspect_ratio() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(image_response(
            serde_json::json!([{ "inlineData": { "mimeType": "image/png", "data": base64::engine::general_purpose::STANDARD.encode(&*PNG) } }]),
        )))
        .mount(&server)
        .await;

    generator(&server)
        .generate_image(
            &request(None),
            &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
            &ai_usage::NoOpUsageRecorder,
        )
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(
        body["generationConfig"],
        serde_json::json!({ "responseModalities": ["IMAGE"] })
    );
}

#[tokio::test]
async fn text_only_and_blocked_responses_are_refusals() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(image_response(
            serde_json::json!([{ "text": "I can't draw that." }]),
        )))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    let error = generator(&server)
        .generate_image(
            &request(None),
            &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
            &ai_usage::NoOpUsageRecorder,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&error, ImageGenerationError::Refused(reason) if reason.contains("I can't draw that.")),
        "{error:?}"
    );

    server.reset().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "promptFeedback": { "blockReason": "PROHIBITED_CONTENT" }
        })))
        .mount(&server)
        .await;
    let error = generator(&server)
        .generate_image(
            &request(None),
            &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
            &ai_usage::NoOpUsageRecorder,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&error, ImageGenerationError::Refused(reason) if reason.contains("PROHIBITED_CONTENT")),
        "{error:?}"
    );

    server.reset().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "candidates": [{ "finishReason": "IMAGE_SAFETY" }]
        })))
        .mount(&server)
        .await;
    let error = generator(&server)
        .generate_image(
            &request(None),
            &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
            &ai_usage::NoOpUsageRecorder,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&error, ImageGenerationError::Refused(reason) if reason.contains("IMAGE_SAFETY")),
        "{error:?}"
    );
}

#[tokio::test]
async fn http_errors_surface_the_provider_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429).set_body_json(serde_json::json!({
            "error": { "code": 429, "message": "Resource has been exhausted", "status": "RESOURCE_EXHAUSTED" }
        })))
        .mount(&server)
        .await;

    let error = generator(&server)
        .generate_image(
            &request(None),
            &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
            &ai_usage::NoOpUsageRecorder,
        )
        .await
        .unwrap_err();
    match error {
        ImageGenerationError::Provider(error) => {
            let message = format!("{error:#}");
            assert!(message.contains("429"), "{message}");
            assert!(message.contains("Resource has been exhausted"), "{message}");
        }
        other => panic!("expected a provider error, got {other:?}"),
    }
}

#[tokio::test]
async fn invalid_base64_is_a_provider_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(image_response(
            serde_json::json!([{ "inlineData": { "mimeType": "image/png", "data": "not base64!" } }]),
        )))
        .mount(&server)
        .await;

    assert!(matches!(
        generator(&server)
            .generate_image(
                &request(None),
                &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
                &ai_usage::NoOpUsageRecorder
            )
            .await
            .unwrap_err(),
        ImageGenerationError::Provider(_)
    ));
}

#[test]
fn reads_actual_dimensions_for_supported_image_formats() {
    for (format, mime) in [
        (image::ImageFormat::Png, "image/png"),
        (image::ImageFormat::Jpeg, "image/jpeg"),
        (image::ImageFormat::WebP, "image/webp"),
        (image::ImageFormat::Gif, "image/gif"),
    ] {
        let response: GenerateContentResponse =
            serde_json::from_value(image_response(serde_json::json!([{ "inlineData": {
                "mimeType": mime,
                "data": base64::engine::general_purpose::STANDARD.encode(image_bytes(format)),
            }}])))
            .unwrap();
        let image = response.into_image().unwrap();
        assert_eq!((image.width, image.height), (96, 64), "{mime}");
    }
}

#[test]
fn rejects_image_bytes_without_readable_dimensions() {
    let response: GenerateContentResponse =
        serde_json::from_value(image_response(serde_json::json!([{ "inlineData": {
            "mimeType": "image/png",
            "data": base64::engine::general_purpose::STANDARD.encode(b"not an image"),
        }}])))
        .unwrap();
    assert!(matches!(
        response.into_image(),
        Err(ImageGenerationError::Provider(_))
    ));
}

#[derive(Default)]
struct RecordingUsage(std::sync::Mutex<Vec<ai_usage::UsageEvent>>);

impl UsageRecorder for RecordingUsage {
    fn record(&self, event: ai_usage::UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[tokio::test]
async fn records_provider_counts_before_image_decoding_or_refusal() {
    for parts in [
        serde_json::json!([{ "inlineData": { "mimeType": "image/png", "data": base64::engine::general_purpose::STANDARD.encode(&*PNG) } }]),
        serde_json::json!([{ "inlineData": { "mimeType": "image/png", "data": "bad base64!" } }]),
        serde_json::json!([{ "text": "Cannot generate this image" }]),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(image_response(parts)))
            .expect(1)
            .mount(&server)
            .await;
        let recorder = RecordingUsage::default();
        let user = macro_user_id::user_id::MacroUserIdStr::try_from(
            "macro|artist@example.com".to_string(),
        )
        .unwrap();
        let usage = UsageContext::new(ai_usage::AiFeature::ImageGeneration, user.clone());
        let _ = generator(&server)
            .generate_image(&request(None), &usage, &recorder)
            .await;
        let events = recorder.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].user, user);
        assert_eq!(events[0].feature, ai_usage::AiFeature::ImageGeneration);
        assert_eq!(events[0].model, NANO_BANANA_MODEL);
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
async fn blocked_prompt_records_reported_input_without_inventing_output() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "promptFeedback": { "blockReason": "SAFETY" },
            "usageMetadata": { "promptTokenCount": 12, "totalTokenCount": 12 }
        })))
        .mount(&server)
        .await;
    let recorder = RecordingUsage::default();
    assert!(
        generator(&server)
            .generate_image(
                &request(None),
                &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
                &recorder,
            )
            .await
            .is_err()
    );
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].amount,
        ai_usage::UsageAmount::Tokens {
            input: 12,
            output: 0,
            cache_read: 0,
            cache_write: 0,
        }
    );
}

#[tokio::test]
async fn absent_metadata_and_http_errors_do_not_fabricate_usage() {
    for (status, body) in [
        (
            200,
            serde_json::json!({ "candidates": [{ "content": { "parts": [
            { "inlineData": { "mimeType": "image/png", "data": base64::engine::general_purpose::STANDARD.encode(&*PNG) } }
        ] } }] }),
        ),
        (
            429,
            serde_json::json!({ "error": { "message": "quota exceeded" } }),
        ),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&server)
            .await;
        let recorder = RecordingUsage::default();
        let result = generator(&server)
            .generate_image(
                &request(None),
                &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
                &recorder,
            )
            .await;
        assert_eq!(result.is_ok(), status == 200);
        assert!(recorder.0.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn uses_total_minus_prompt_when_candidate_count_is_absent() {
    let server = MockServer::start().await;
    let mut body = image_response(serde_json::json!([
        { "inlineData": { "mimeType": "image/png", "data": base64::engine::general_purpose::STANDARD.encode(&*PNG) } }
    ]));
    body["usageMetadata"]
        .as_object_mut()
        .unwrap()
        .remove("candidatesTokenCount");
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(&server)
        .await;
    let recorder = RecordingUsage::default();
    generator(&server)
        .generate_image(
            &request(None),
            &UsageContext::system(ai_usage::AiFeature::ImageGeneration),
            &recorder,
        )
        .await
        .unwrap();
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
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
