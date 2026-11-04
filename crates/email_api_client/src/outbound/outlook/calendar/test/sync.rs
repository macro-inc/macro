use super::mutations::{IssuedToken, NoOpenClients, OWNER, connected_mailbox};
use super::*;
use calendar_events::outbound::pg::PgCalendarRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use wiremock::matchers::query_param_is_missing;

type Sync = OutlookCalendarSync<
    PgCalendarRepository,
    OutlookApiClientRepository,
    IssuedToken,
    NoOpenClients,
>;

/// A meeting tomorrow that Macro can read.
fn upcoming(id: &str) -> Value {
    let now = Utc::now();
    let mut value = event(id);
    value["start"]["dateTime"] = json!((now + chrono::Duration::days(1)).to_rfc3339());
    value["end"]["dateTime"] =
        json!((now + chrono::Duration::days(1) + chrono::Duration::hours(1)).to_rfc3339());
    value
}

/// A series repeating hourly, which no Macro recurrence represents.
fn hourly(id: &str) -> Value {
    let mut value = upcoming(id);
    value["type"] = json!("seriesMaster");
    value["recurrence"] = json!({"pattern":{"type":"hourly","interval":1},"range":{"type":"noEnd","startDate":"2026-11-02"}});
    value
}

async fn serve_delta(server: &MockServer, cursor: Option<&str>, ids: &[&str], next: &str) {
    let mock = Mock::given(method("GET")).and(path("/v1.0/me/calendarView/delta"));
    let mock = match cursor {
        Some(cursor) => mock.and(query_param("$deltatoken", cursor)),
        None => mock.and(query_param_is_missing("$deltatoken")),
    };
    mock.respond_with(ResponseTemplate::new(200).set_body_json(json!({
        "value":ids.iter().map(|id| json!({"id":id})).collect::<Vec<_>>(),
        "@odata.deltaLink":format!("{}/v1.0/me/calendarView/delta?$deltatoken={next}", server.uri()),
    })))
    .mount(server)
    .await;
}

async fn serve_event(server: &MockServer, body: Value) {
    let id = body["id"].as_str().unwrap().to_owned();
    Mock::given(method("GET"))
        .and(path(format!("/v1.0/me/calendars/AAMkCalendar/events/{id}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1.0/me/events/{id}/instances")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[]})))
        .mount(server)
        .await;
}

async fn sync_until_idle(sync: &Sync) {
    // A page, each event, then the finish; a blocked round stops early.
    for _ in 0..6 {
        if !matches!(sync.run_once().await, Ok(true)) {
            break;
        }
    }
}

async fn assert_synced(pool: &PgPool) {
    let calendar = sqlx::query!(
        r#"SELECT c.synced_at, c.consecutive_sync_failures, w.pending_ids
        FROM calendars c JOIN calendar_outlook_work w ON w.calendar_id = c.id
        WHERE c.provider_calendar_id = 'AAMkCalendar'"#
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(calendar.synced_at.is_some(), "the round finished");
    assert_eq!(calendar.consecutive_sync_failures, 0);
    assert!(calendar.pending_ids.is_empty());
}

async fn imported(pool: &PgPool) -> Vec<String> {
    sqlx::query_scalar!(
        r#"SELECT s.provider_event_id AS "provider_event_id!" FROM calendar_event_sources s
        JOIN calendar_events e ON e.id = s.event_id WHERE e.owner_id = $1 ORDER BY 1"#,
        OWNER
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn connected(pool: &PgPool) -> (MockServer, Sync) {
    let (server, api) = setup().await;
    let repo = connected_mailbox(
        pool,
        &server,
        &api,
        json!([{"id":"AAMkCalendar","name":"Calendar","canEdit":true,"isDefaultCalendar":true}]),
    )
    .await;
    (
        server,
        OutlookCalendarSync::new(repo, api, IssuedToken, NoOpenClients),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_macro_cannot_read_is_skipped_and_the_rest_of_the_calendar_syncs(pool: PgPool) {
    let (server, sync) = connected(&pool).await;
    // The unreadable series sorts first, so it is refreshed first.
    serve_delta(&server, None, &["AAMkReadable", "AAMkHourly"], "complete").await;
    serve_event(&server, upcoming("AAMkReadable")).await;
    serve_event(&server, hourly("AAMkHourly")).await;
    sync_until_idle(&sync).await;

    assert_synced(&pool).await;
    assert_eq!(
        imported(&pool).await,
        vec!["AAMkReadable"],
        "the readable meeting is imported and the unreadable one is absent"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stored_event_that_turns_unreadable_leaves_the_calendar(pool: PgPool) {
    let (server, sync) = connected(&pool).await;
    serve_delta(&server, None, &["AAMkReadable", "AAMkChanged"], "first").await;
    serve_event(&server, upcoming("AAMkReadable")).await;
    serve_event(&server, upcoming("AAMkChanged")).await;
    sync_until_idle(&sync).await;
    assert_eq!(imported(&pool).await, vec!["AAMkChanged", "AAMkReadable"]);

    // The organizer turns the meeting into a series Macro cannot read. Its
    // stored copy would show a version Microsoft no longer has.
    server.reset().await;
    serve_delta(&server, Some("first"), &["AAMkChanged"], "second").await;
    serve_event(&server, hourly("AAMkChanged")).await;
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at = now() WHERE calendar_id IS NOT NULL"
    )
    .execute(&pool)
    .await
    .unwrap();
    sync_until_idle(&sync).await;

    assert_synced(&pool).await;
    assert_eq!(imported(&pool).await, vec!["AAMkReadable"]);
    let members = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM calendar_outlook_members WHERE master_id = 'AAMkChanged'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(members, 1, "a later tombstone for it still resolves");
}
