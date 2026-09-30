use super::*;
use crate::domain::models::{ImageAspectRatio, ReferenceImage};
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake";

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
        "usageMetadata": { "promptTokenCount": 8, "totalTokenCount": 1300 }
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
                { "inlineData": { "mimeType": "image/png", "data": base64::engine::general_purpose::STANDARD.encode(PNG) } },
                { "inlineData": { "mimeType": "image/jpeg", "data": "AAAA" } }
            ]),
        )))
        .expect(1)
        .mount(&server)
        .await;

    let image = generator(&server)
        .generate_image(&request(Some(ImageAspectRatio::Widescreen)))
        .await
        .unwrap();

    assert_eq!(image.bytes, PNG);
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
                            "data": base64::engine::general_purpose::STANDARD.encode(PNG),
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
                        "data": base64::engine::general_purpose::STANDARD.encode(PNG),
                    }
                },
            ]))),
        )
        .expect(1)
        .mount(&server)
        .await;

    let image = generator(&server)
        .generate_image(&ImageGenerationRequest {
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
        })
        .await
        .unwrap();

    assert_eq!(image.bytes, PNG);
    assert_eq!(image.mime_type, "image/png");
    assert_eq!(image.note.as_deref(), Some("Here is the edited image."));
}

#[tokio::test]
async fn omits_image_config_without_an_aspect_ratio() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(image_response(
            serde_json::json!([{ "inlineData": { "mimeType": "image/png", "data": "AAAA" } }]),
        )))
        .mount(&server)
        .await;

    generator(&server)
        .generate_image(&request(None))
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
        .generate_image(&request(None))
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
        .generate_image(&request(None))
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
        .generate_image(&request(None))
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
        .generate_image(&request(None))
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
            .generate_image(&request(None))
            .await
            .unwrap_err(),
        ImageGenerationError::Provider(_)
    ));
}
