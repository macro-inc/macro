use reqwest::StatusCode;
use wiremock::matchers::{method, path, query_param, query_param_is_missing};
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
async fn history_paginates_and_advances_to_the_latest_cursor() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/history"))
        .and(query_param("startHistoryId", "100"))
        .and(query_param("maxResults", "500"))
        .and(query_param_is_missing("pageToken"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "history": [{
                "id": "101", "messages": null, "messagesAdded": null,
                "messagesDeleted": null, "labelsAdded": null, "labelsRemoved": null
            }],
            "historyId": "101",
            "nextPageToken": "next"
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/users/me/history"))
        .and(query_param("pageToken", "next"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "history": [{
                "id": "102", "messages": null, "messagesAdded": null,
                "messagesDeleted": null, "labelsAdded": null, "labelsRemoved": null
            }],
            "historyId": "102"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let response = get_history(&client(&server), "token", "100")
        .await
        .expect("history should decode");

    assert_eq!(response.history_id, "102");
    assert_eq!(response.history.unwrap().len(), 2);
    assert!(response.next_page_token.is_none());
}

#[tokio::test]
async fn stale_history_not_found_status_is_preserved() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/history"))
        .respond_with(
            ResponseTemplate::new(StatusCode::NOT_FOUND.as_u16())
                .set_body_string("History cursor for private@example.com is stale"),
        )
        .mount(&server)
        .await;

    let error = get_history(&client(&server), "token", "stale")
        .await
        .expect_err("stale history should fail");

    assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
    assert_eq!(
        error.body(),
        Some("History cursor for [REDACTED_EMAIL] is stale")
    );
}
