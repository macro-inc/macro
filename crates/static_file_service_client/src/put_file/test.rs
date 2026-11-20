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
