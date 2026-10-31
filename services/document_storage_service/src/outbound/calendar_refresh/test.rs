use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
use wiremock::{Mock, MockServer, ResponseTemplate, matchers::method};

use super::*;

const OWNER: &str = "macro|refresh-owner@example.com";
const DELEGATE: &str = "macro|refresh-delegate@example.com";
const MAILBOX: &str = "macro|refresh-mailbox@example.com";
const OTHER_DELEGATE: &str = "macro|refresh-other-delegate@example.com";
const REQUESTER: &str = "macro|refresh-requester@example.com";

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)",
        macro_user_id,
        id,
        id,
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        id,
        id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_link(pool: &PgPool, owner_id: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        id,
        owner_id,
        format!("calendar-{id}@example.com"),
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn gateway() -> (MockServer, ConnectionGatewayClient) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "receipts": [] })))
        .mount(&server)
        .await;
    let client = ConnectionGatewayClient::new("test".to_string(), server.uri());
    (server, client)
}

/// `(recipient, message)` of every `refresh_calendar` the gateway received.
async fn refreshes(server: &MockServer) -> Vec<(String, Value)> {
    let mut sent: Vec<(String, Value)> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|request| {
            let body: Value = request.body_json().unwrap();
            assert_eq!(body["message_type"], "refresh_calendar");
            let recipient = request.url.path().replace("%7C", "|");
            let recipient = recipient.strip_prefix("/message/send/user/").unwrap();
            (recipient.to_string(), body["message"].clone())
        })
        .collect();
    sent.sort_by(|a, b| a.0.cmp(&b.0));
    sent
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_inbox_refresh_reaches_its_owner_and_each_delegate_once(pool: PgPool) {
    for user in [OWNER, DELEGATE, MAILBOX, OTHER_DELEGATE] {
        insert_user(&pool, user).await;
    }
    let link = insert_link(&pool, MAILBOX).await;
    let other_link = insert_link(&pool, MAILBOX).await;
    // A promoted shared mailbox: the edges name the mailbox as their child
    // while its older events still carry the owner, who is a delegate too.
    for primary in [OWNER, DELEGATE] {
        macro_db_client::macro_user_links::insert_edge(&pool, primary, MAILBOX, link)
            .await
            .unwrap();
    }
    macro_db_client::macro_user_links::insert_edge(&pool, OTHER_DELEGATE, MAILBOX, other_link)
        .await
        .unwrap();
    let (server, client) = gateway().await;

    ConnectionGatewayCalendarRefresh::new(client, pool)
        .refresh_inbox_viewers(OWNER, link, false)
        .await;

    let message = json!({ "event": "synced", "link_id": link, "team_ooo_changed": false });
    assert_eq!(
        refreshes(&server).await,
        [
            (DELEGATE.to_string(), message.clone()),
            (OWNER.to_string(), message),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owner_still_hears_when_delegates_cannot_be_resolved(pool: PgPool) {
    let link = Uuid::now_v7();
    let (server, client) = gateway().await;
    let refresh = ConnectionGatewayCalendarRefresh::new(client, pool.clone());
    pool.close().await;

    refresh.refresh_inbox_viewers(OWNER, link, false).await;

    assert_eq!(
        refreshes(&server).await,
        [(
            OWNER.to_string(),
            json!({ "event": "synced", "link_id": link, "team_ooo_changed": false }),
        )]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_answer_names_the_event_and_never_the_inbox(pool: PgPool) {
    let event_id = Uuid::now_v7();
    let (server, client) = gateway().await;

    ConnectionGatewayCalendarRefresh::new(client, pool)
        .refresh_requester(REQUESTER, event_id)
        .await;

    assert_eq!(
        refreshes(&server).await,
        [(
            REQUESTER.to_string(),
            json!({ "event": "join_request_answered", "event_id": event_id }),
        )]
    );
}
