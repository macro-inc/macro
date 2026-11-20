use super::*;
use crate::StaticFileServiceClient;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// A file service whose upload URL refuses a PUT without a Content-Length,
/// as S3 does with 411 Length Required.
async fn storage() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/internal/file"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "upload_url": format!("{}/upload", server.uri()),
            "file_location": format!("{}/file/stored", server.uri()),
            "id": "stored",
        })))
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/upload"))
        .and(header("content-length", "0"))
        .respond_with(ResponseTemplate::new(200))
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/upload"))
        .respond_with(ResponseTemplate::new(411))
        .with_priority(2)
        .mount(&server)
        .await;
    server
}

#[tokio::test]
async fn an_empty_file_is_uploaded_with_its_length() {
    let server = storage().await;
    let client = StaticFileServiceClient::new("key".to_string(), server.uri());

    let stored = client
        .put_file_with_bytes("a", Bytes::new(), "image/png".to_string())
        .await
        .unwrap();

    assert_eq!(stored.id, "stored");
}

#[tokio::test]
async fn a_failed_upload_names_no_part_of_its_presigned_url() {
    let server = MockServer::start().await;
    // Nothing listens on the upload URL, so sending to it fails.
    Mock::given(method("PUT"))
        .and(path("/internal/file"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "upload_url": "http://127.0.0.1:9/upload?X-Amz-Credential=access-key-id&X-Amz-Security-Token=session-token-value&X-Amz-Signature=signature-value",
            "file_location": format!("{}/file/stored", server.uri()),
            "id": "stored",
        })))
        .mount(&server)
        .await;
    let client = StaticFileServiceClient::new("key".to_string(), server.uri());

    let error = client
        .put_file_with_bytes("a", Bytes::from_static(b"image"), "image/png".to_string())
        .await
        .unwrap_err();

    let logged = format!("{error:#} {error:?}");
    for secret in [
        "/upload",
        "X-Amz",
        "access-key-id",
        "session-token-value",
        "signature-value",
    ] {
        assert!(!logged.contains(secret), "{secret} in {logged}");
    }
}
