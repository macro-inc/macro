use authentication_service_client::AuthServiceClient;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn settle_requests_carry_the_camel_case_user_id() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/ai-billing/settle"))
        .and(header("x-internal-auth-key", "key"))
        .and(body_json(
            serde_json::json!({"userId": "macro|payer@x.com"}),
        ))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let client = AuthServiceClient::new("key".to_string(), server.uri());
    client.settle_ai_billing("macro|payer@x.com").await.unwrap();
}
