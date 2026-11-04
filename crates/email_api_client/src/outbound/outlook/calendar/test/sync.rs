use super::mutations::{IssuedToken, NoOpenClients, OWNER, connected_mailbox};
use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

/// A delta page listing one meeting Macro can read and one it cannot, which
/// sorts first and is refreshed first.
async fn serve_scan(server: &MockServer) {
    let now = Utc::now();
    let mut readable = event("AAMkReadable");
    readable["start"]["dateTime"] = json!((now + chrono::Duration::days(1)).to_rfc3339());
    readable["end"]["dateTime"] =
        json!((now + chrono::Duration::days(1) + chrono::Duration::hours(1)).to_rfc3339());
    let mut unreadable = event("AAMkHourly");
    unreadable["type"] = json!("seriesMaster");
    unreadable["recurrence"] = json!({"pattern":{"type":"hourly","interval":1},"range":{"type":"noEnd","startDate":"2026-11-02"}});
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendarView/delta"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value":[{"id":"AAMkReadable"},{"id":"AAMkHourly"}],
            "@odata.deltaLink":format!("{}/v1.0/me/calendarView/delta?$deltatoken=complete", server.uri()),
        })))
        .mount(server)
        .await;
    for (id, body) in [("AAMkReadable", readable), ("AAMkHourly", unreadable)] {
        Mock::given(method("GET"))
            .and(path(format!("/v1.0/me/calendars/AAMkCalendar/events/{id}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }
    Mock::given(method("GET"))
        .and(path("/v1.0/me/events/AAMkHourly/instances"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[]})))
        .mount(server)
        .await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_macro_cannot_read_is_skipped_and_the_rest_of_the_calendar_syncs(pool: PgPool) {
    let (server, api) = setup().await;
    let repo = connected_mailbox(
        &pool,
        &server,
        &api,
        json!([{"id":"AAMkCalendar","name":"Calendar","canEdit":true,"isDefaultCalendar":true}]),
    )
    .await;
    serve_scan(&server).await;
    let sync = OutlookCalendarSync::new(repo, api, IssuedToken, NoOpenClients);
    // The page, each event, then the finish; a blocked scan stops early.
    for _ in 0..6 {
        if !matches!(sync.run_once().await, Ok(true)) {
            break;
        }
    }

    let calendar = sqlx::query!(
        r#"SELECT c.synced_at, c.consecutive_sync_failures, w.pending_ids
        FROM calendars c JOIN calendar_outlook_work w ON w.calendar_id = c.id
        WHERE c.provider_calendar_id = 'AAMkCalendar'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(calendar.synced_at.is_some(), "the full scan finished");
    assert_eq!(calendar.consecutive_sync_failures, 0);
    assert!(calendar.pending_ids.is_empty());
    let imported = sqlx::query_scalar!(
        r#"SELECT s.provider_event_id AS "provider_event_id!" FROM calendar_event_sources s JOIN calendar_events e ON e.id = s.event_id WHERE e.owner_id = $1"#,
        OWNER
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        imported,
        vec!["AAMkReadable"],
        "the readable meeting is imported and the unreadable one is absent"
    );
}
