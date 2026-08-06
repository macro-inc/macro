use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

#[tokio::test]
async fn injectable_urls_route_requests_to_the_configured_endpoint() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/users/me/messages"))
        .and(header("authorization", "Bearer test-token"))
        .and(query_param("maxResults", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "messages": [{ "id": "message-1", "threadId": "thread-1" }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = GmailClient::new_with_urls(
        "projects/test/topics/gmail".to_string(),
        format!("{}/gmail/", server.uri()),
        format!("{}/people/", server.uri()),
        format!("{}/jwks", server.uri()),
        "test-audience".to_string(),
    );

    let message_ids = client
        .list_messages("test-token", 1, &[])
        .await
        .expect("configured Gmail endpoint should be used");

    assert_eq!(message_ids, vec!["message-1"]);
    assert_eq!(client.contacts_url, format!("{}/people", server.uri()));
    assert_eq!(client.certs_url, format!("{}/jwks", server.uri()));
    assert_eq!(client.audience, "test-audience");
    assert_eq!(client.subscription_topic, "projects/test/topics/gmail");
}
