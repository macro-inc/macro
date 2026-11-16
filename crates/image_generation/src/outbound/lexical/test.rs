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

#[tokio::test]
async fn generated_image_markup_uses_the_selected_route_in_every_mode() {
    use lexical_client::test_utils::FakeLexical;
    let expected = r#"<m-image>{"url":"https://example.com/image.png","alt":"Generated image","srcType":"sfs","id":"00000000-0000-4000-8000-000000000001","width":800,"height":600,"scale":1,"constrainedWidth":400,"constrainedHeight":400}</m-image>"#;
    for mode in ["http", "in_process", "shadow"] {
        let backend = FakeLexical::new(
            "",
            vec![(
                "POST",
                "/image-markdown",
                serde_json::json!({"markdown":expected}),
            )],
        )
        .await;
        let composer = LexicalImageMarkdownComposer::new(Arc::new(
            backend.client(&format!("composers={mode}")),
        ));
        let image = StoredImage {
            id: uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap(),
            url: "https://example.com/image.png".into(),
        };
        assert_eq!(
            composer.compose_image(&image, 800, 600).await.unwrap(),
            expected
        );
        let requests = backend.requests();
        assert_eq!(requests.len(), usize::from(mode != "in_process"));
        if let Some(request) = requests.first() {
            assert_eq!(
                request.body,
                serde_json::json!({"staticFileId":image.id,"url":image.url,"width":800,"height":600})
            );
        }
        assert_eq!(backend.raw_reads(), 0);
    }
}
