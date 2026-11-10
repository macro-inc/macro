use super::*;

#[tokio::test]
async fn scripted_send_as_does_not_change_label_requests() {
    let gmail = FakeGmail::start(GmailState::default()).await;
    gmail.lock().send_as = Some((
        200,
        json!({"sendAs":[{"sendAsEmail":"user@example.com","signature":"Signature"}]}),
    ));
    let client = reqwest::Client::new();
    let result = client
        .get(format!("{}/users/me/settings/sendAs", gmail.url))
        .send()
        .await
        .expect("send-as response");
    assert_eq!(
        result.json::<Value>().await.expect("send-as JSON")["sendAs"][0]["signature"],
        "Signature"
    );
    let result = client
        .get(format!("{}/users/me/labels", gmail.url))
        .send()
        .await
        .expect("labels response");
    assert_eq!(
        result.json::<Value>().await.expect("labels JSON"),
        json!({"labels":[]})
    );
    gmail.lock().send_as = Some((429, json!({"error":{"code":429}})));
    assert_eq!(
        client
            .get(format!("{}/users/me/settings/sendAs", gmail.url))
            .send()
            .await
            .expect("scripted failure")
            .status(),
        429
    );
}

#[tokio::test]
async fn scripted_send_as_disconnect_cannot_complete_a_response() {
    let gmail = FakeGmail::start(GmailState::default()).await;
    gmail.lock().drop_send_as = true;
    let response = reqwest::Client::new()
        .get(format!("{}/users/me/settings/sendAs", gmail.url))
        .send()
        .await;
    if let Ok(response) = response {
        assert!(response.bytes().await.is_err());
    }
}
