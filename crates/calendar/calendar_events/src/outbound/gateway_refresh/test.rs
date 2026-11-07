use std::future::Future;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use serde_json::{Value, json};
use tracing_subscriber::{Registry, layer::SubscriberExt as _};
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
const TEAMMATE: &str = "macro|refresh-teammate@example.com";
const QUIET: &str = "macro|refresh-quiet@example.com";

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        macro_user_id,
        id,
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
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

async fn insert_delegate(pool: &PgPool, primary: &str, child: &str, link: Uuid) {
    sqlx::query!(
        "INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES ($1, $2, $3)",
        primary,
        child,
        link,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// One team of `members`, each with the sharing setting given, or none.
async fn team(pool: &PgPool, members: &[(&str, Option<&str>)]) {
    let team_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team_id,
        members[0].0,
    )
    .execute(pool)
    .await
    .unwrap();
    for (member, sharing) in members {
        sqlx::query!(
            "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
            member,
            team_id,
        )
        .execute(pool)
        .await
        .unwrap();
        if let Some(sharing) = sharing {
            sqlx::query!(
                "INSERT INTO calendar_team_sharing (user_id, sharing) VALUES ($1, $2)",
                member,
                sharing,
            )
            .execute(pool)
            .await
            .unwrap();
        }
    }
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

/// The adapter with its tracker, as a service composes them.
fn adapter(client: ConnectionGatewayClient, pool: PgPool) -> (GatewayCalendarRefresh, TaskTracker) {
    let tasks = TaskTracker::new();
    (
        GatewayCalendarRefresh::new(client, pool, tasks.clone()),
        tasks,
    )
}

/// Shutdown's drain: it waits for the refreshes no response waited for.
async fn drain(tasks: TaskTracker) {
    tasks.close();
    tasks.wait().await;
}

/// The gateway refuses every request whose path matches `route`.
async fn refuse(server: &MockServer, route: &str) {
    Mock::given(method("POST"))
        .and(path_regex(route))
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

/// What each request to the gateway asked it to send: `(recipient, message)`
/// per `refresh_calendar`, sorted by recipient.
async fn requests(server: &MockServer) -> Vec<Vec<(String, Value)>> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|request| {
            let body: Value = request.body_json().unwrap();
            let mut sent: Vec<(String, Value)> = match request.url.path() {
                "/message/batch_send_unique" => body["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|message| {
                        assert_eq!(message["message_type"], "refresh_calendar");
                        (
                            message["entity"]["entity_id"].as_str().unwrap().to_owned(),
                            message["message_content"].clone(),
                        )
                    })
                    .collect(),
                single => {
                    assert_eq!(body["message_type"], "refresh_calendar");
                    let recipient = single.replace("%7C", "|");
                    let recipient = recipient.strip_prefix("/message/send/user/").unwrap();
                    vec![(recipient.to_owned(), body["message"].clone())]
                }
            };
            sent.sort_by(|a, b| a.0.cmp(&b.0));
            sent
        })
        .collect()
}

fn synced(link: Uuid) -> Value {
    json!({ "event": "synced", "link_id": link, "team_ooo_changed": false })
}

fn team_changed(team_ooo_changed: bool) -> Value {
    json!({ "event": "team_sharing_changed", "team_ooo_changed": team_ooo_changed })
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_inbox_refresh_reaches_its_owner_and_each_delegate_in_one_request(pool: PgPool) {
    for user in [OWNER, DELEGATE, MAILBOX, OTHER_DELEGATE] {
        insert_user(&pool, user).await;
    }
    let link = insert_link(&pool, MAILBOX).await;
    let other_link = insert_link(&pool, MAILBOX).await;
    // A promoted shared mailbox: the edges name the mailbox as their child
    // while its older events still carry the owner, who is a delegate too.
    for primary in [OWNER, DELEGATE] {
        insert_delegate(&pool, primary, MAILBOX, link).await;
    }
    insert_delegate(&pool, OTHER_DELEGATE, MAILBOX, other_link).await;
    let (server, client) = gateway().await;
    let (refresh, tasks) = adapter(client, pool);

    refresh.calendar_changed(OWNER, link, false).await;
    drain(tasks).await;

    assert_eq!(
        requests(&server).await,
        [[
            (DELEGATE.to_string(), synced(link)),
            (OWNER.to_string(), synced(link)),
        ]]
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
        requests(&server).await,
        [[(OWNER.to_string(), synced(link))]]
    );
    assert_eq!(attribute(&span, "viewers"), "1");
    assert_eq!(attribute(&span, "outcome"), "partial");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_refused_request_shows_on_the_span(pool: PgPool) {
    let (server, client) = gateway().await;
    refuse(&server, "^/message/batch_send_unique$").await;
    let (refresh, _) = adapter(client, pool);

    let span = recorded_span(
        "calendar.refresh_inbox_viewers",
        refresh.refresh_inbox_viewers(OWNER, Uuid::now_v7(), false),
    )
    .await;

    assert_eq!(attribute(&span, "outcome"), "failed");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_clean_refresh_shows_on_the_span(pool: PgPool) {
    let (server, client) = gateway().await;
    let (refresh, _) = adapter(client, pool);

    let span = recorded_span(
        "calendar.refresh_inbox_viewers",
        refresh.refresh_inbox_viewers(OWNER, Uuid::now_v7(), false),
    )
    .await;

    assert_eq!(server.received_requests().await.unwrap().len(), 1);
    assert_eq!(attribute(&span, "viewers"), "1");
    assert_eq!(attribute(&span, "teammates"), "0");
    assert_eq!(attribute(&span, "outcome"), "refreshed");
}

/// The calendar write authority also refreshes the team views showing the
/// inbox, in the same request, but not those of a viewer who shares nothing.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn with_team_refresh_one_request_reaches_viewers_and_their_teammates(pool: PgPool) {
    for user in [OWNER, DELEGATE, TEAMMATE, QUIET] {
        insert_user(&pool, user).await;
    }
    team(
        &pool,
        &[
            (OWNER, None),
            (TEAMMATE, Some("all")),
            (QUIET, Some("none")),
        ],
    )
    .await;
    let link = insert_link(&pool, OWNER).await;
    let (server, client) = gateway().await;
    let (refresh, tasks) = adapter(client, pool);
    let refresh = refresh.with_team_refresh(true);

    refresh.calendar_changed(OWNER, link, false).await;
    drain(tasks).await;

    assert_eq!(
        requests(&server).await,
        [[
            (OWNER.to_string(), synced(link)),
            (QUIET.to_string(), team_changed(false)),
            (TEAMMATE.to_string(), team_changed(false)),
        ]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_team_refresh_teammates_hear_nothing(pool: PgPool) {
    for user in [OWNER, TEAMMATE] {
        insert_user(&pool, user).await;
    }
    team(&pool, &[(OWNER, None), (TEAMMATE, None)]).await;
    let link = insert_link(&pool, OWNER).await;
    let (server, client) = gateway().await;
    let (refresh, tasks) = adapter(client, pool);

    refresh.calendar_changed(OWNER, link, false).await;
    drain(tasks).await;

    assert_eq!(
        requests(&server).await,
        [[(OWNER.to_string(), synced(link))]]
    );
}

/// Teammates see nothing of a sharer whose setting is `none`, so that
/// sharer's changes refresh no teammate; anyone else's reach every teammate,
/// including the default for a member who never chose.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sharer_who_shares_nothing_refreshes_no_teammate(pool: PgPool) {
    for user in [OWNER, TEAMMATE, QUIET] {
        insert_user(&pool, user).await;
    }
    team(
        &pool,
        &[
            (OWNER, None),
            (TEAMMATE, Some("all")),
            (QUIET, Some("none")),
        ],
    )
    .await;

    let mut teammates = teammates_to_refresh(&pool, &[OWNER.to_owned()], false)
        .await
        .unwrap();
    teammates.sort();
    assert_eq!(teammates, [QUIET, TEAMMATE]);
    assert_eq!(
        teammates_to_refresh(&pool, &[QUIET.to_owned()], false)
            .await
            .unwrap(),
        Vec::<String>::new()
    );
}

/// Turning sharing off is itself the change teammates must see, so a sharing
/// change reaches every teammate and the sharer whatever the new setting, in
/// one request.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sharing_change_reaches_every_teammate_whatever_the_new_setting(pool: PgPool) {
    for user in [OWNER, QUIET] {
        insert_user(&pool, user).await;
    }
    team(&pool, &[(OWNER, None), (QUIET, Some("none"))]).await;
    let (server, client) = gateway().await;
    let (refresh, tasks) = adapter(client, pool);

    refresh.sharing_changed(QUIET).await;
    drain(tasks).await;

    assert_eq!(
        requests(&server).await,
        [[
            (OWNER.to_string(), team_changed(true)),
            (QUIET.to_string(), team_changed(true)),
        ]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_answer_names_the_event_and_never_the_inbox(pool: PgPool) {
    let event_id = Uuid::now_v7();
    let (server, client) = gateway().await;
    let (refresh, tasks) = adapter(client, pool);

    refresh.join_request_answered(REQUESTER, event_id).await;
    drain(tasks).await;

    assert_eq!(
        requests(&server).await,
        [[(
            REQUESTER.to_string(),
            json!({ "event": "join_request_answered", "event_id": event_id }),
        )]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_answer_refresh_shows_on_the_span(pool: PgPool) {
    let event_id = Uuid::now_v7();
    let (server, client) = gateway().await;
    refuse(&server, "/message/send/user/.*refresh-requester").await;
    let (refresh, _) = adapter(client, pool);

    let span = recorded_span(
        "calendar.refresh_join_requester",
        refresh.refresh_requester(REQUESTER, event_id),
    )
    .await;

    assert_eq!(attribute(&span, "outcome"), "failed");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_build_without_the_gateway_sends_nothing(pool: PgPool) {
    let (server, client) = gateway().await;
    let (refresh, tasks) = adapter(client, pool);
    let refresh = refresh.with_sends(false);

    refresh.calendar_changed(OWNER, Uuid::now_v7(), true).await;
    refresh
        .join_request_answered(REQUESTER, Uuid::now_v7())
        .await;
    refresh.sharing_changed(OWNER).await;
    drain(tasks).await;

    assert!(server.received_requests().await.unwrap().is_empty());
}

#[test]
fn an_inbox_refresh_leaves_its_viewers_to_their_own_refresh() {
    let shared_by = [OWNER.to_string(), DELEGATE.to_string()];
    let found = [OWNER, DELEGATE, TEAMMATE].map(|user| Some(user.to_string()));

    assert_eq!(
        team_refresh_recipients(found.to_vec(), &shared_by, false),
        [TEAMMATE]
    );
}

#[test]
fn a_sharing_change_also_refreshes_the_sharer() {
    let shared_by = [OWNER.to_string()];
    let found = [OWNER, TEAMMATE].map(|user| Some(user.to_string()));

    assert_eq!(
        team_refresh_recipients(found.to_vec(), &shared_by, true),
        [OWNER, TEAMMATE]
    );
}
