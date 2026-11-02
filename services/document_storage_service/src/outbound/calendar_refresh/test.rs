use std::future::Future;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use serde_json::{Value, json};
use sqlx::PgPool;
use tracing_subscriber::{Registry, layer::SubscriberExt as _};
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path_regex},
};

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

/// The adapter with its tracker, as the service composes them.
fn adapter(
    client: ConnectionGatewayClient,
    pool: PgPool,
) -> (ConnectionGatewayCalendarRefresh, TaskTracker) {
    let tasks = TaskTracker::new();
    (
        ConnectionGatewayCalendarRefresh::new(client, pool, tasks.clone()),
        tasks,
    )
}

/// The gateway drops every message for `recipient`, whose id the pattern matches.
async fn refuse(server: &MockServer, recipient: &str) {
    Mock::given(method("POST"))
        .and(path_regex(recipient))
        .respond_with(ResponseTemplate::new(500))
        .with_priority(1)
        .mount(server)
        .await;
}

/// The span named `name` that `work` finishes under a recording subscriber.
async fn recorded_span(name: &str, work: impl Future<Output = ()>) -> SpanData {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = Registry::default()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let guard = tracing::subscriber::set_default(subscriber);
    work.await;
    drop(guard);
    exporter
        .get_finished_spans()
        .unwrap()
        .into_iter()
        .find(|span| span.name == name)
        .unwrap()
}

fn attribute(span: &SpanData, key: &str) -> String {
    span.attributes
        .iter()
        .find(|attribute| attribute.key.as_str() == key)
        .map(|attribute| attribute.value.to_string())
        .unwrap()
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
    let (refresh, tasks) = adapter(client, pool);

    refresh.calendar_changed(OWNER, link, false).await;
    // Shutdown's drain: it waits for the nudge the response did not.
    tasks.close();
    tasks.wait().await;

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
    let (refresh, _) = adapter(client, pool.clone());
    pool.close().await;

    let span = recorded_span(
        "calendar.refresh_inbox_viewers",
        refresh.refresh_inbox_viewers(OWNER, link, false),
    )
    .await;

    assert_eq!(
        refreshes(&server).await,
        [(
            OWNER.to_string(),
            json!({ "event": "synced", "link_id": link, "team_ooo_changed": false }),
        )]
    );
    assert_eq!(attribute(&span, "failed_sends"), "0");
    assert_eq!(attribute(&span, "outcome"), "partial");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_send_shows_on_the_span_and_the_rest_still_go_out(pool: PgPool) {
    for user in [OWNER, DELEGATE, MAILBOX] {
        insert_user(&pool, user).await;
    }
    let link = insert_link(&pool, MAILBOX).await;
    for primary in [OWNER, DELEGATE] {
        macro_db_client::macro_user_links::insert_edge(&pool, primary, MAILBOX, link)
            .await
            .unwrap();
    }
    let (server, client) = gateway().await;
    refuse(&server, "refresh-delegate").await;
    let (refresh, _) = adapter(client, pool);

    let span = recorded_span(
        "calendar.refresh_inbox_viewers",
        refresh.refresh_inbox_viewers(OWNER, link, false),
    )
    .await;

    // Both were tried, in order, so the refused one did not stop the other.
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
    assert_eq!(attribute(&span, "recipients"), "2");
    assert_eq!(attribute(&span, "failed_sends"), "1");
    assert_eq!(attribute(&span, "outcome"), "partial");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_clean_refresh_shows_on_the_span(pool: PgPool) {
    let (server, client) = gateway().await;
    let (refresh, _) = adapter(client, pool);
    let link = Uuid::now_v7();

    let span = recorded_span(
        "calendar.refresh_inbox_viewers",
        refresh.refresh_inbox_viewers(OWNER, link, false),
    )
    .await;

    assert_eq!(server.received_requests().await.unwrap().len(), 1);
    assert_eq!(attribute(&span, "recipients"), "1");
    assert_eq!(attribute(&span, "failed_sends"), "0");
    assert_eq!(attribute(&span, "outcome"), "refreshed");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_answer_names_the_event_and_never_the_inbox(pool: PgPool) {
    let event_id = Uuid::now_v7();
    let (server, client) = gateway().await;
    let (refresh, tasks) = adapter(client, pool);

    refresh.join_request_answered(REQUESTER, event_id).await;
    tasks.close();
    tasks.wait().await;

    assert_eq!(
        refreshes(&server).await,
        [(
            REQUESTER.to_string(),
            json!({ "event": "join_request_answered", "event_id": event_id }),
        )]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_answer_refresh_shows_on_the_span(pool: PgPool) {
    let event_id = Uuid::now_v7();
    let (server, client) = gateway().await;
    refuse(&server, "refresh-requester").await;
    let (refresh, _) = adapter(client, pool);

    let span = recorded_span(
        "calendar.refresh_join_requester",
        refresh.refresh_requester(REQUESTER, event_id),
    )
    .await;

    assert_eq!(attribute(&span, "outcome"), "failed");
}
