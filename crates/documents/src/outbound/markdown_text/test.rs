use super::*;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn live_markdown_is_read_in_the_lossless_internal_format() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/markdown/doc-1"))
        .and(query_param("target", "internal"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"data": "Owner: <m-user-mention>{}</m-user-mention>"}),
        ))
        .expect(1)
        .mount(&server)
        .await;
    let client = LexicalClient::new("test-key".to_owned(), server.uri());

    assert_eq!(
        client.markdown("doc-1").await.unwrap(),
        "Owner: <m-user-mention>{}</m-user-mention>"
    );
}
