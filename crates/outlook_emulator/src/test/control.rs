use serde_json::{Value, json};

use super::{ADA, BOB, start};
use crate::Seed;

const SEED: &str = "mailboxes:\n  - email: ada@example.com\n    link_id: 0195A000-0000-7000-8000-00000000A11C\n    messages:\n      - subject: Hello\n";

async fn body(response: reqwest::Response) -> Value {
    response.json().await.unwrap()
}

#[test]
fn the_example_seed_is_valid() {
    let seed = Seed::parse(include_str!("../../seed.example.yaml")).unwrap();
    assert_eq!(seed.mailboxes.len(), 3);
}

#[tokio::test]
async fn the_control_api_seeds_delivers_and_reports() {
    let (emulator, _) = start(SEED).await;
    let http = reqwest::Client::new();
    let control = format!("{}/_emulator", emulator.base_url());

    let added = http
        .post(format!("{control}/mailboxes"))
        .json(&json!({"email": BOB, "name": "Bob"}))
        .send()
        .await
        .unwrap();
    assert_eq!(added.status(), 200);
    let delivered = http
        .post(format!("{control}/mailboxes/{BOB}/messages"))
        .json(&json!({"subject": "Welcome", "from": "Carol <carol@example.com>"}))
        .send()
        .await
        .unwrap();
    let delivered = body(delivered).await;
    let id = delivered["id"].as_str().unwrap();

    let changed = http
        .patch(format!("{control}/mailboxes/{BOB}/messages/{id}"))
        .json(&json!({"read": true, "folder": "archive"}))
        .send()
        .await
        .unwrap();
    assert_eq!(changed.status(), 200);
    let messages = body(
        http.get(format!("{control}/mailboxes/{BOB}/messages"))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(messages[0]["folder"], "Archive");
    assert_eq!(messages[0]["is_read"], true);

    let fault = http
        .post(format!("{control}/faults"))
        .json(&json!({"mailbox": BOB, "route": "messages.delta", "error": "rate_limit", "retry_after_seconds": 5}))
        .send()
        .await
        .unwrap();
    assert_eq!(body(fault).await["id"], 1);
    let state = body(http.get(format!("{control}/state")).send().await.unwrap()).await;
    assert_eq!(state["mailboxes"].as_array().unwrap().len(), 2);
    assert_eq!(state["faults"][0]["fault"]["route"], "messages.delta");

    let unknown = http
        .post(format!("{control}/mailboxes/nobody@example.com/messages"))
        .json(&json!({"subject": "Lost"}))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status(), 404);
}

#[tokio::test]
async fn the_authentication_service_stand_in_answers_for_a_linked_mailbox() {
    let (emulator, _) = start(SEED).await;
    let http = reqwest::Client::new();
    let url = format!(
        "{}/internal/microsoft_access_token",
        emulator.authentication_service_url()
    );
    let link = "0195a000-0000-7000-8000-00000000a11c";
    let query = |force: bool| {
        [
            ("link_id", link.to_string()),
            ("generation", "1".to_string()),
            ("sync_generation", "1".to_string()),
            ("force_refresh", force.to_string()),
        ]
    };

    let first = body(http.get(&url).query(&query(false)).send().await.unwrap()).await;
    let second = body(http.get(&url).query(&query(false)).send().await.unwrap()).await;
    let forced = body(http.get(&url).query(&query(true)).send().await.unwrap()).await;
    assert_eq!(first["cached"], false);
    assert_eq!(second["cached"], true);
    assert_eq!(second["access_token"], first["access_token"]);
    assert_ne!(forced["access_token"], first["access_token"]);
    assert!(
        first["scopes"]
            .as_array()
            .unwrap()
            .contains(&json!("Mail.ReadWrite"))
    );

    // The token it hands out is the mailbox's.
    let me = http
        .get(format!("{}/me", emulator.graph_url()))
        .bearer_auth(forced["access_token"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(body(me).await["mail"], ADA);

    let unknown = http
        .get(&url)
        .query(&[("link_id", "0195a000-0000-7000-8000-000000000000")])
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status(), 404);
    emulator.revoke_grant(ADA).unwrap();
    let revoked = http.get(&url).query(&query(false)).send().await.unwrap();
    assert_eq!(revoked.status(), 401);
    // Token requests are in the request log, like Graph's.
    let logged = emulator.requests();
    let tokens = logged
        .iter()
        .filter(|r| r.route == Some(crate::Route::OauthToken));
    assert_eq!(tokens.count(), 5);
}

#[tokio::test]
async fn the_token_endpoint_refreshes_until_the_grant_is_revoked() {
    let (emulator, _) = start(SEED).await;
    let http = reqwest::Client::new();
    let form = [
        ("grant_type", "refresh_token"),
        ("client_id", "client"),
        ("client_secret", "secret"),
        ("refresh_token", "refresh-ada@example.com"),
    ];

    let refreshed = http
        .post(emulator.token_url())
        .form(&form)
        .send()
        .await
        .unwrap();
    assert_eq!(refreshed.status(), 200);
    let refreshed = body(refreshed).await;
    assert_eq!(refreshed["expires_in"], 3600);
    assert_eq!(refreshed["token_type"], "Bearer");
    let me = http
        .get(format!("{}/me", emulator.graph_url()))
        .bearer_auth(refreshed["access_token"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(me.status(), 200);

    emulator.revoke_grant(ADA).unwrap();
    let refused = http
        .post(emulator.token_url())
        .form(&form)
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 400);
    assert_eq!(body(refused).await["error"], "invalid_grant");
}

#[tokio::test]
async fn a_batch_answers_each_request_with_its_own_status() {
    let (emulator, _) = start(SEED).await;
    let http = reqwest::Client::new();
    let id = emulator.messages(ADA).unwrap()[0].id.clone();
    let batch = json!({"requests": [
        {"id": "1", "method": "GET", "url": format!("/me/messages/{id}?$select=subject")},
        {"id": "2", "method": "PATCH", "url": format!("/me/messages/{id}"),
         "headers": {"Content-Type": "application/json"}, "body": {"isRead": true}},
        {"id": "3", "method": "GET", "url": "/me/messages/AAMkADmissing"},
        {"id": "4", "method": "GET", "url": "/me/mailFolders/inbox/messages?$filter=isRead eq false"},
    ]});

    let answered = http
        .post(format!("{}/$batch", emulator.graph_url()))
        .bearer_auth(emulator.access_token(ADA).unwrap())
        .json(&batch)
        .send()
        .await
        .unwrap();

    assert_eq!(answered.status(), 200);
    let responses = body(answered).await["responses"].clone();
    assert_eq!(responses[0]["status"], 200);
    assert_eq!(responses[0]["body"]["subject"], "Hello");
    assert_eq!(responses[1]["status"], 200);
    assert_eq!(responses[1]["body"]["isRead"], true);
    assert_eq!(responses[2]["status"], 404);
    assert_eq!(responses[2]["body"]["error"]["code"], "ErrorItemNotFound");
    assert_eq!(responses[3]["body"]["value"], json!([]));
}

#[tokio::test]
async fn unsupported_queries_and_paths_fail_loudly() {
    let (emulator, _) = start(SEED).await;
    let http = reqwest::Client::new();
    let token = emulator.access_token(ADA).unwrap();
    let get = |path: &str| {
        http.get(format!("{}/{path}", emulator.graph_url()))
            .bearer_auth(&token)
            .send()
    };

    let filter = get("me/messages?$filter=contains(subject,'x')")
        .await
        .unwrap();
    assert_eq!(filter.status(), 400);
    let select = get("me/messages?$select=nonsense").await.unwrap();
    assert_eq!(select.status(), 400);
    let path = get("me/todo/lists").await.unwrap();
    assert_eq!(path.status(), 400);
    let anonymous = http
        .get(format!("{}/me/messages", emulator.graph_url()))
        .send()
        .await
        .unwrap();
    assert_eq!(anonymous.status(), 401);
    assert_eq!(
        body(anonymous).await["error"]["code"],
        "InvalidAuthenticationToken"
    );
}

#[tokio::test]
async fn send_mail_replies_and_forwards_behave_as_graph_documents() {
    let seed = "mailboxes:\n  - email: ada@example.com\n    messages:\n      - subject: Hello\n        from: Carol <carol@example.com>\n        text: Original words.\n  - email: bob@example.com\n";
    let (emulator, _) = start(seed).await;
    let http = reqwest::Client::new();
    let token = emulator.access_token(ADA).unwrap();
    let post = |path: String, body: Value| {
        http.post(format!("{}/{path}", emulator.graph_url()))
            .bearer_auth(&token)
            .json(&body)
            .send()
    };
    let recipient = json!([{"emailAddress": {"address": BOB}}]);

    // sendMail carries its attachments.
    let mail = json!({"message": {
        "subject": "With a file",
        "toRecipients": recipient,
        "attachments": [{"@odata.type": "#microsoft.graph.fileAttachment", "name": "a.txt", "contentBytes": "aGk="}],
    }});
    assert_eq!(
        post("me/sendMail".into(), mail).await.unwrap().status(),
        202
    );
    let received = emulator.messages(BOB).unwrap();
    assert_eq!(received[0].attachments, vec!["a.txt".to_string()]);

    // A forward keeps the original body under the comment.
    let hello = emulator.messages(ADA).unwrap()[0].id.clone();
    let forward = json!({"comment": "FYI", "toRecipients": recipient});
    let draft = body(
        post(format!("me/messages/{hello}/createForward"), forward)
            .await
            .unwrap(),
    )
    .await;
    let content = draft["body"]["content"].as_str().unwrap();
    assert!(content.starts_with("FYI") && content.ends_with("Original words."));
    assert_eq!(draft["subject"], "FW: Hello");

    // A reply goes to replyTo when the parent names one.
    let reply = body(
        post(format!("me/messages/{hello}/createReply"), json!({}))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        reply["toRecipients"][0]["emailAddress"]["address"],
        "carol@example.com"
    );
    let patch = json!({"replyTo": [{"emailAddress": {"address": "desk@example.com"}}]});
    http.patch(format!("{}/me/messages/{hello}", emulator.graph_url()))
        .bearer_auth(&token)
        .json(&patch)
        .send()
        .await
        .unwrap();
    let reply = body(
        post(format!("me/messages/{hello}/createReply"), json!({}))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        reply["toRecipients"][0]["emailAddress"]["address"],
        "desk@example.com"
    );

    // A batch that asks for ordering is refused, not run out of order.
    let batch = json!({"requests": [
        {"id": "0", "method": "DELETE", "url": format!("/me/messages/{hello}")},
        {"id": "1", "method": "GET", "url": "/me", "dependsOn": ["0"]},
    ]});
    assert_eq!(post("$batch".into(), batch).await.unwrap().status(), 400);
    // Nothing before the refused request ran.
    let kept = emulator.messages(ADA).unwrap();
    assert!(kept.iter().any(|message| message.id == hello));
}

#[tokio::test]
async fn a_link_bound_to_another_mailbox_gets_that_mailboxs_token() {
    let seed = "mailboxes:\n  - email: ada@example.com\n  - email: bob@example.com\n";
    let (emulator, _) = start(seed).await;
    let http = reqwest::Client::new();
    let link = "0195a000-0000-7000-8000-00000000a11c";
    let url = format!(
        "{}/internal/microsoft_access_token?link_id={link}",
        emulator.authentication_service_url()
    );
    let owner = async |token: &Value| {
        let me = http
            .get(format!("{}/me", emulator.graph_url()))
            .bearer_auth(token["access_token"].as_str().unwrap())
            .send()
            .await
            .unwrap();
        body(me).await["mail"].clone()
    };

    emulator.link_mailbox(link, ADA).unwrap();
    let first = body(http.get(&url).send().await.unwrap()).await;
    assert_eq!(owner(&first).await, ADA);

    emulator.link_mailbox(link, BOB).unwrap();
    let second = body(http.get(&url).send().await.unwrap()).await;
    assert_eq!(second["cached"], false);
    assert_eq!(owner(&second).await, BOB);
}

#[tokio::test]
async fn each_principal_holds_their_own_grant_for_a_mailbox() {
    let (emulator, _) = start("mailboxes:\n  - email: ada@example.com\n").await;
    let http = reqwest::Client::new();
    let service = format!("{}/internal", emulator.authentication_service_url());
    let link = "0195a000-0000-7000-8000-00000000a11c";
    emulator.link_mailbox(link, ADA).unwrap();

    let grant = async |owner: &str| {
        let url = format!("{service}/microsoft_grant?attempt_id={link}&owner={owner}");
        body(http.get(url).send().await.unwrap()).await["grant_id"].clone()
    };
    let revoke = async |grant_id: &Value| {
        http.post(format!("{service}/revoke_microsoft_grant"))
            .json(&json!({ "grant_id": grant_id }))
            .send()
            .await
            .unwrap()
    };
    let token_status = async || {
        let url = format!("{service}/microsoft_access_token?link_id={link}&force_refresh=true");
        http.get(url).send().await.unwrap().status()
    };

    let first = grant("first").await;
    let second = grant("second").await;
    assert_ne!(first, second);

    // One principal letting go leaves the other's access to the mailbox.
    revoke(&first).await;
    assert_eq!(token_status().await, 200);

    // The mailbox is revoked with its last grant.
    revoke(&second).await;
    assert_eq!(token_status().await, 401);
}

#[tokio::test]
async fn a_link_whose_grant_was_released_gets_no_access_token() {
    let (emulator, _) = start("mailboxes:\n  - email: ada@example.com\n").await;
    let http = reqwest::Client::new();
    let service = format!("{}/internal", emulator.authentication_service_url());
    // Two principals connect the same mailbox, each through an attempt and
    // a link of their own.
    let attempts = [
        "0195a000-0000-7000-8000-0000000a77e1",
        "0195a000-0000-7000-8000-0000000a77e2",
    ];
    let links = [
        "0195a000-0000-7000-8000-00000000a1c1",
        "0195a000-0000-7000-8000-00000000a1c2",
    ];
    let mut grants = Vec::new();
    for (index, (attempt, link)) in attempts.iter().zip(links).enumerate() {
        emulator.link_mailbox(attempt, ADA).unwrap();
        let url = format!("{service}/microsoft_grant?attempt_id={attempt}&owner=owner-{index}");
        grants.push(body(http.get(url).send().await.unwrap()).await["grant_id"].clone());
        emulator.link_attempt(link, attempt).unwrap();
    }
    let token_status = async |link: &str| {
        let url = format!("{service}/microsoft_access_token?link_id={link}&force_refresh=true");
        http.get(url).send().await.unwrap().status()
    };
    assert_eq!(token_status(links[0]).await, 200);

    http.post(format!("{service}/revoke_microsoft_grant"))
        .json(&json!({ "grant_id": grants[0] }))
        .send()
        .await
        .unwrap();

    // The released grant's link is refused; the other principal's is not.
    assert_eq!(token_status(links[0]).await, 401);
    assert_eq!(token_status(links[1]).await, 200);

    // Signing in again gives the principal a grant for the link again.
    let url = format!(
        "{service}/microsoft_grant?attempt_id={}&owner=owner-0",
        links[0]
    );
    assert_eq!(http.get(url).send().await.unwrap().status(), 200);
    assert_eq!(token_status(links[0]).await, 200);
}

#[tokio::test]
async fn a_link_moved_to_another_mailbox_leaves_its_grants_behind() {
    let (emulator, _) =
        start("mailboxes:\n  - email: ada@example.com\n  - email: bob@example.com\n").await;
    let http = reqwest::Client::new();
    let service = format!("{}/internal", emulator.authentication_service_url());
    let link = "0195a000-0000-7000-8000-00000000a11c";
    emulator.link_mailbox(link, ADA).unwrap();
    let url = format!("{service}/microsoft_grant?attempt_id={link}&owner=first");
    let grant = body(http.get(url).send().await.unwrap()).await["grant_id"].clone();
    // A second grant keeps the first mailbox itself from being revoked.
    let url = format!("{service}/microsoft_grant?attempt_id={link}&owner=second");
    http.get(url).send().await.unwrap();

    emulator.link_mailbox(link, BOB).unwrap();
    http.post(format!("{service}/revoke_microsoft_grant"))
        .json(&json!({ "grant_id": grant }))
        .send()
        .await
        .unwrap();

    // A grant for the first mailbox says nothing about the second.
    let url = format!("{service}/microsoft_access_token?link_id={link}&force_refresh=true");
    assert_eq!(http.get(url).send().await.unwrap().status(), 200);

    // A link made from an attempt no grant was described for is answered.
    let attempt = "0195a000-0000-7000-8000-0000000a77e3";
    let made = "0195a000-0000-7000-8000-00000000a1c3";
    emulator.link_mailbox(attempt, BOB).unwrap();
    emulator.link_attempt(made, attempt).unwrap();
    let url = format!("{service}/microsoft_access_token?link_id={made}");
    assert_eq!(http.get(url).send().await.unwrap().status(), 200);
}
