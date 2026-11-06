use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn client(server: &MockServer) -> GmailClient {
    GmailClient::new_with_urls(
        String::new(),
        server.uri(),
        server.uri(),
        server.uri(),
        String::new(),
    )
}

#[tokio::test]
async fn profile_decodes_the_complete_wire_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "emailAddress": "person@example.com",
            "messagesTotal": 42,
            "threadsTotal": 21,
            "historyId": "1234"
        })))
        .mount(&server)
        .await;

    let profile = get_profile(&client(&server), "token")
        .await
        .expect("profile should decode");

    assert_eq!(profile.email_address, "person@example.com");
    assert_eq!(profile.messages_total, 42);
    assert_eq!(profile.threads_total, 21);
    assert_eq!(profile.history_id, "1234");
}
