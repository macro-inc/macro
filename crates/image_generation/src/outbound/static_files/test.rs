use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_bytes, body_json, header, method, path},
};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake";
const FILE_ID: &str = "00000000-0000-0000-0000-000000000123";

fn image() -> NewStaticImage {
    NewStaticImage {
        bytes: PNG.to_vec(),
        mime_type: "image/png".to_string(),
    }
}

fn store(server: &MockServer) -> StaticFileImageStore {
    StaticFileImageStore::new(StaticFileServiceClient::new(
        "test-key".to_string(),
        server.uri(),
    ))
}

async fn reserve(server: &MockServer) {
    Mock::given(method("PUT"))
        .and(path("/internal/file"))
        .and(header("x-internal-auth-key", "test-key"))
        .and(body_json(serde_json::json!({
            "file_name": "generated-image",
            "content_type": "image/png",
            "extension_data": null
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": FILE_ID,
            "file_location": format!("{}/file/{FILE_ID}", server.uri()),
            "upload_url": format!("{}/upload", server.uri())
        })))
        .expect(1)
        .mount(server)
        .await;
}

#[tokio::test]
async fn uploads_image_bytes_before_returning_the_permanent_location() {
    let server = MockServer::start().await;
    reserve(&server).await;
    Mock::given(method("PUT"))
        .and(path("/upload"))
        .and(header("content-type", "image/png"))
        .and(body_bytes(PNG))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    let stored = store(&server).save_image(image()).await.unwrap();
    assert_eq!(stored.id.to_string(), FILE_ID);
    assert_eq!(stored.url, format!("{}/file/{FILE_ID}", server.uri()));
}

#[tokio::test]
async fn failed_upload_does_not_return_a_successful_image() {
    let server = MockServer::start().await;
    reserve(&server).await;
    Mock::given(method("PUT"))
        .and(path("/upload"))
        .respond_with(ResponseTemplate::new(500))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        store(&server).save_image(image()).await,
        Err(SaveImageError::Internal(_))
    ));
}

#[tokio::test]
async fn failed_reservation_does_not_upload() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/internal/file"))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&server)
        .await;
    assert!(store(&server).save_image(image()).await.is_err());
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}
