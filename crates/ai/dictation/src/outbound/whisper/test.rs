use super::*;
use crate::domain::AudioFormat;
use bytes::Bytes;
use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

/// Minimal Ogg page header so container detection yields `.ogg`.
const OGG_HEADER: &[u8] = b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00";

fn transcriber(server: &MockServer) -> WhisperTranscriber {
    let api_key = OpenaiApiKey::new_testing("test-server-key");
    WhisperTranscriber::with_api_base(&api_key, Some(&format!("{}/v1", server.uri()))).unwrap()
}

fn recording() -> Recording {
    Recording::new(Bytes::from_static(OGG_HEADER), Some("en".parse().unwrap())).unwrap()
}

fn multipart_body(request: &Request) -> String {
    String::from_utf8_lossy(&request.body).into_owned()
}

#[tokio::test]
async fn posts_whisper_multipart_with_server_credential_and_reads_duration() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .and(header("authorization", "Bearer test-server-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "task": "transcribe",
            "language": "english",
            "duration": 2.5,
            "text": "Hello.",
            "segments": []
        })))
        .expect(1)
        .mount(&server)
        .await;

    let transcript = transcriber(&server).transcribe(recording()).await.unwrap();

    assert_eq!(transcript.text, "Hello.");
    assert_eq!(transcript.duration_seconds, 2.5);
    let requests = server.received_requests().await.unwrap();
    let body = multipart_body(&requests[0]);
    for expected in [
        "name=\"model\"\r\n\r\nwhisper-1",
        "name=\"response_format\"\r\n\r\nverbose_json",
        "name=\"language\"\r\n\r\nen",
        "filename=\"dictation.ogg\"",
        "OggS",
    ] {
        assert!(body.contains(expected), "missing {expected:?} in {body:?}");
    }
    assert_eq!(recording().format(), AudioFormat::Ogg);
}

#[tokio::test]
async fn rejects_responses_without_billable_duration() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "text": "Only text." })))
        .mount(&server)
        .await;

    assert_eq!(
        transcriber(&server).transcribe(recording()).await,
        Err(DictationError::Provider)
    );
}

#[test]
fn rejects_empty_credentials_at_construction() {
    assert!(matches!(
        WhisperTranscriber::new(&OpenaiApiKey::new_testing("  ")),
        Err(WhisperConfigError::EmptyApiKey)
    ));
}

#[tokio::test]
async fn maps_provider_rejections_to_a_content_free_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": {
                "message": "Invalid file format.",
                "type": "invalid_request_error",
                "param": "file",
                "code": null
            }
        })))
        .expect(1)
        .mount(&server)
        .await;

    let error = transcriber(&server)
        .transcribe(recording())
        .await
        .unwrap_err();

    assert_eq!(error, DictationError::Provider);
}
