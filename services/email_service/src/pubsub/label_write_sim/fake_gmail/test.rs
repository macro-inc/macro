use super::*;

#[tokio::test]
async fn initialization_endpoints_and_scripted_watch_failures() {
    let gmail = FakeGmail::start(GmailState {
        history_id: 101,
        ..GmailState::default()
    })
    .await;
    let client = reqwest::Client::new();
    let profile: Value = client
        .get(format!("{}/users/me/profile", gmail.url))
        .send()
        .await
        .expect("profile")
        .json()
        .await
        .expect("profile JSON");
    assert_eq!(profile["historyId"], "101");
    let watch: Value = client
        .post(format!("{}/users/me/watch", gmail.url))
        .send()
        .await
        .expect("watch")
        .json()
        .await
        .expect("watch JSON");
    assert_eq!(watch["historyId"], "101");
    gmail.lock().endpoint_replies.insert(
        "/gmail/v1/users/me/watch".into(),
        vec![
            (401, json!({"error":{"message":"expired"}})),
            (200, json!({"historyId":"102","expiration":"1893456000000"})),
        ]
        .into(),
    );
    for expected in [401, 200, 200] {
        let response = client
            .post(format!("{}/users/me/watch", gmail.url))
            .send()
            .await
            .expect("scripted watch");
        assert_eq!(response.status().as_u16(), expected);
    }
    gmail
        .lock()
        .drop_endpoints
        .insert("/gmail/v1/users/me/watch".into());
    let response = client
        .post(format!("{}/users/me/watch", gmail.url))
        .send()
        .await;
    if let Ok(response) = response {
        assert!(response.bytes().await.is_err());
    }
}

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

#[tokio::test]
async fn scripted_http_pause_keeps_the_response_chosen_before_the_barrier() {
    let gmail = FakeGmail::start(GmailState::default()).await;
    let path = "/gmail/v1/users/me/history";
    gmail
        .lock()
        .endpoint_replies
        .insert(path.into(), [(200, json!({"historyId":"100"}))].into());
    let pause = gmail.pause_next_http(path, PauseAt::AfterApply);
    let endpoint = format!("{}/users/me/history", gmail.url);
    let next = endpoint.clone();
    let request = tokio::spawn(async move { reqwest::get(next).await.expect("fake request") });
    pause.arrived.await.expect("response chosen");
    gmail
        .lock()
        .endpoint_replies
        .insert(path.into(), [(503, json!({"error":"later"}))].into());
    pause.release.send(()).expect("release");
    let response = request.await.expect("request task");
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(
        response.json::<Value>().await.expect("body"),
        json!({"historyId":"100"})
    );
    assert_eq!(
        reqwest::get(endpoint)
            .await
            .expect("later response")
            .status()
            .as_u16(),
        503
    );
}
