use super::*;

#[tokio::test]
async fn only_bare_unauthenticated_listener_probes_skip_request_logging() {
    let gmail = FakeGmail::start(GmailState::default()).await;
    let root = gmail.url.strip_suffix("/gmail/v1").unwrap();
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{root}/"))
        .send()
        .await
        .expect("listener probe");
    assert_eq!(response.status(), 200);
    assert_eq!(response.json::<Value>().await.unwrap(), json!({}));
    assert!(gmail.lock().log.is_empty());

    for request in [
        client.get(format!("{root}/")).bearer_auth("fixture"),
        client.get(format!("{root}/?probe=1")),
        client.get(format!("{root}/")).body("body"),
        client.get(format!("{}/users/me/profile", gmail.url)),
    ] {
        assert_eq!(
            request.send().await.expect("retained request").status(),
            200
        );
    }
    assert_eq!(gmail.lock().log.len(), 4);
}
