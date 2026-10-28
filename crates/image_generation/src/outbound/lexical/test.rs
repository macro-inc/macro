use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path},
};

#[tokio::test]
async fn delegates_dimensions_and_identity_to_authenticated_lexical_endpoint() {
    let server = MockServer::start().await;
    let image = StoredImage {
        id: uuid::Uuid::from_u128(123),
        url: "https://static.example/file/image".to_string(),
    };
    Mock::given(method("POST"))
        .and(path("/image-markdown"))
        .and(header("x-internal-auth-key", "test-key"))
        .and(body_json(serde_json::json!({ "staticFileId": image.id, "url": image.url, "width": 1536, "height": 1024 })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "markdown": "serialized by Lexical" })))
        .expect(1).mount(&server).await;
    let composer = LexicalImageMarkdownComposer::new(Arc::new(LexicalClient::new(
        "test-key".to_string(),
        server.uri(),
    )));
    assert_eq!(
        composer.compose_image(&image, 1536, 1024).await.unwrap(),
        "serialized by Lexical"
    );
}

#[tokio::test]
async fn propagates_lexical_failures_without_fabricating_markup() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let composer = LexicalImageMarkdownComposer::new(Arc::new(LexicalClient::new(
        "test-key".to_string(),
        server.uri(),
    )));
    let image = StoredImage {
        id: uuid::Uuid::from_u128(123),
        url: "https://static.example/file/image".to_string(),
    };
    assert!(composer.compose_image(&image, 1536, 1024).await.is_err());
}
