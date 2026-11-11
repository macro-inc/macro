use super::*;

const SEED: &str = r#"
clock: "2026-03-01T09:00:00Z"
mailboxes:
  - email: ada@example.com
    name: Ada Example
    labels:
      - name: Receipts
    messages:
      - from: Grace <grace@example.com>
        subject: Invoice 42
        text: Please find the invoice attached.
        labels: [INBOX, UNREAD, Label_1]
        date: "2026-02-27T10:00:00Z"
  - email: bob@example.com
"#;

#[tokio::test]
async fn the_control_api_seeds_delivers_injects_and_reports() {
    let emulator = GmailEmulator::start(Seed::default()).await.unwrap();
    let http = reqwest::Client::new();
    let control = format!("{}/_emulator", emulator.base_url());

    let seeded = http.post(format!("{control}/seed")).body(SEED).send().await.unwrap();
    assert_eq!(seeded.status().as_u16(), 200);
    let state: serde_json::Value =
        http.get(format!("{control}/state")).send().await.unwrap().json().await.unwrap();
    assert_eq!(state["mailboxes"][0]["messages"], 1);
    assert!(state["now"].as_str().unwrap().starts_with("2026-03-01T09:00"));

    let delivered: serde_json::Value = http
        .post(format!("{control}/mailboxes/ada@example.com/messages"))
        .json(&serde_json::json!({ "from": "alan@example.com", "subject": "New", "text": "Hello" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(delivered["history_id"], 1002);

    let token: serde_json::Value = http
        .post(format!("{control}/mailboxes/ada@example.com/access-tokens"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ada = token["access_token"].as_str().unwrap();
    let client = client(&emulator);
    let receipts = client.list_messages(ada, 10, &["Label_1"]).await.unwrap();
    assert_eq!(receipts.len(), 1);
    let seeded_message = client.get_message(ada, &receipts[0]).await.unwrap().unwrap();
    assert_eq!(seeded_message.internal_date, "1772186400000");

    let fault = http
        .post(format!("{control}/faults"))
        .json(&serde_json::json!({ "route": "messages.get", "error": "unavailable", "times": 1 }))
        .send()
        .await
        .unwrap();
    assert_eq!(fault.status().as_u16(), 200);
    let failed = client.get_message(ada, &receipts[0]).await.unwrap_err();
    assert_eq!(failed.status().unwrap().as_u16(), 503);

    let requests: Vec<crate::RequestRecord> = http
        .get(format!("{control}/requests?route=messages.get"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let statuses: Vec<u16> = requests.iter().map(|request| request.status).collect();
    assert_eq!(statuses, vec![200, 503]);
    assert_eq!(requests[0].mailbox.as_deref(), Some(ADA));

    let unknown = http
        .post(format!("{control}/mailboxes/nobody@example.com/messages"))
        .json(&serde_json::json!({ "subject": "x" }))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status().as_u16(), 404);
}

#[tokio::test]
async fn the_authentication_service_stand_in_answers_like_the_real_route() {
    let emulator = two_mailboxes().await;
    let http = reqwest::Client::new();
    let route = format!(
        "{}/internal/google_access_token",
        emulator.authentication_service_url()
    );
    let ask = |email: &'static str| {
        http.get(&route)
            .query(&[("fusionauth_user_id", "fusion-1"), ("email", email)])
            .send()
    };

    let granted: serde_json::Value = ask(ADA).await.unwrap().json().await.unwrap();
    let access = granted["access_token"].as_str().unwrap();
    assert_eq!(client(&emulator).get_profile(access).await.unwrap().email_address, ADA);

    assert_eq!(ask("nobody@example.com").await.unwrap().status().as_u16(), 404);
    emulator.revoke_grant(ADA).unwrap();
    assert_eq!(ask(ADA).await.unwrap().status().as_u16(), 403);
}
