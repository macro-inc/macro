use super::mutations::{IssuedToken, NoOpenClients, OWNER, connected_mailbox, linked_mailbox};
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
    meeting_in(id, chrono::Duration::days(1))
}

/// A meeting an hour long, `offset` from now, that Macro can read.
fn meeting_in(id: &str, offset: chrono::Duration) -> Value {
    let starts_at = Utc::now() + offset;
    let mut value = event(id);
    value["start"]["dateTime"] = json!(starts_at.to_rfc3339());
    value["end"]["dateTime"] = json!((starts_at + chrono::Duration::hours(1)).to_rfc3339());
    value
}

/// A daily out-of-office series as Graph returns it, carrying Macro's own
/// preferences property with an automatic-decline policy this build cannot
/// read, as another Macro version could have written it. The reader rejects
/// it at `singleValueExtendedProperties.automaticDecline`.
fn unreadable_series(id: &str) -> Value {
    let mut value = upcoming(id);
    let start_date = value["start"]["dateTime"].as_str().unwrap()[..10].to_owned();
    value["type"] = json!("seriesMaster");
    value["showAs"] = json!("oof");
    value["recurrence"] = json!({
        "pattern":{"type":"daily","interval":1,"month":0,"dayOfMonth":0,"firstDayOfWeek":"sunday","index":"first"},
        "range":{"type":"noEnd","startDate":start_date,"endDate":"0001-01-01","recurrenceTimeZone":"UTC","numberOfOccurrences":0},
    });
    value["singleValueExtendedProperties"] = json!([{
        "id":PREFERENCES_ID,
        "value":json!({"automaticDecline":{"mode":"declineWhenAway"}}).to_string(),
    }]);
    value
}

/// A delta entry for a single event.
fn single(id: &str) -> Value {
    json!({"id":id})
}

/// A delta entry for one occurrence, which the page maps to its series.
fn occurrence(master: &str) -> Value {
    json!({"id":format!("{master}-occurrence"),"seriesMasterId":master})
}

async fn serve_delta(server: &MockServer, cursor: Option<&str>, entries: &[Value], next: &str) {
    let mock = Mock::given(method("GET")).and(path("/v1.0/me/calendarView/delta"));
    let mock = match cursor {
        Some(cursor) => mock.and(query_param("$deltatoken", cursor)),
        None => mock.and(query_param_is_missing("$deltatoken")),
    };
    mock.respond_with(ResponseTemplate::new(200).set_body_json(json!({
        "value":entries,
        "@odata.deltaLink":format!("{}/v1.0/me/calendarView/delta?$deltatoken={next}", server.uri()),
    })))
    .mount(server)
    .await;
}

/// The listing a first import reads before anything else: every event this
/// month and next.
async fn serve_near_window(server: &MockServer, entries: &[Value]) {
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/AAMkCalendar/calendarView"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":entries})))
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
    // A first import's near window, then a page, each event and the finish;
    // a blocked round stops early.
    for _ in 0..12 {
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

/// Whether the page membership of a series' occurrence survives. An event
/// confirmed gone drops it; one skipped as unreadable keeps it.
async fn occurrence_is_member(pool: &PgPool, master: &str) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM calendar_outlook_members
        WHERE provider_id = $1 AND master_id = $2) AS "member!""#,
        format!("{master}-occurrence"),
        master
    )
    .fetch_one(pool)
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

#[test]
fn the_unreadable_series_is_rejected_at_its_decline_policy() {
    assert_eq!(
        normalize::projection(&target(), unreadable_series("series"), vec![]).err(),
        Some(Rejected::at(
            "singleValueExtendedProperties.automaticDecline"
        ))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_macro_cannot_read_is_skipped_and_the_rest_of_the_calendar_syncs(pool: PgPool) {
    let (server, sync) = connected(&pool).await;
    serve_near_window(&server, &[]).await;
    // The unreadable series sorts first, so it is refreshed first.
    serve_delta(
        &server,
        None,
        &[single("AAMkReadable"), occurrence("AAMkAway")],
        "complete",
    )
    .await;
    serve_event(&server, upcoming("AAMkReadable")).await;
    serve_event(&server, unreadable_series("AAMkAway")).await;
    sync_until_idle(&sync).await;

    assert_synced(&pool).await;
    assert_eq!(
        imported(&pool).await,
        vec!["AAMkReadable"],
        "the readable meeting is imported and the unreadable one is absent"
    );
    assert!(
        occurrence_is_member(&pool, "AAMkAway").await,
        "the series was read and skipped, not found gone"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stored_event_that_turns_unreadable_leaves_the_calendar(pool: PgPool) {
    let (server, sync) = connected(&pool).await;
    serve_near_window(&server, &[]).await;
    serve_delta(
        &server,
        None,
        &[single("AAMkReadable"), single("AAMkChanged")],
        "first",
    )
    .await;
    serve_event(&server, upcoming("AAMkReadable")).await;
    serve_event(&server, upcoming("AAMkChanged")).await;
    sync_until_idle(&sync).await;
    assert_eq!(imported(&pool).await, vec!["AAMkChanged", "AAMkReadable"]);

    // The organizer turns the meeting into a series Macro cannot read. Its
    // stored copy would show a version Microsoft no longer has.
    server.reset().await;
    serve_delta(
        &server,
        Some("first"),
        &[occurrence("AAMkChanged")],
        "second",
    )
    .await;
    serve_event(&server, unreadable_series("AAMkChanged")).await;
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at = now() WHERE calendar_id IS NOT NULL"
    )
    .execute(&pool)
    .await
    .unwrap();
    sync_until_idle(&sync).await;

    assert_synced(&pool).await;
    assert_eq!(imported(&pool).await, vec!["AAMkReadable"]);
    assert!(
        occurrence_is_member(&pool, "AAMkChanged").await,
        "a later tombstone for it still resolves"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_mailbox_in_a_time_zone_macro_cannot_map_still_discovers_and_syncs(pool: PgPool) {
    let (server, api) = setup().await;
    let repo = linked_mailbox(
        &pool,
        &server,
        mailbox_settings(Some("tzone://Microsoft/Custom")),
        json!([default_calendar("AAMkCalendar")]),
    )
    .await;
    let sync = OutlookCalendarSync::new(repo, api, IssuedToken, NoOpenClients);
    serve_near_window(&server, &[]).await;
    serve_delta(&server, None, &[single("AAMkReadable")], "complete").await;
    serve_event(&server, upcoming("AAMkReadable")).await;
    // Discovery, then the calendar's page, its event and the finish.
    sync_until_idle(&sync).await;

    assert_synced(&pool).await;
    assert_eq!(imported(&pool).await, vec!["AAMkReadable"]);
    let time_zone = sqlx::query_scalar!(
        "SELECT time_zone FROM calendars WHERE provider_calendar_id = 'AAMkCalendar'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(time_zone, None, "the calendar's zone is unknown, not UTC");
}

async fn serve_series(server: &MockServer, master: Value, instances: Vec<Value>) {
    let id = master["id"].as_str().unwrap().to_owned();
    Mock::given(method("GET"))
        .and(path(format!("/v1.0/me/calendars/AAMkCalendar/events/{id}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(master))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1.0/me/events/{id}/instances")))
        .respond_with(Instances(instances))
        .mount(server)
        .await;
}

/// How many times the round read the event `id` from Graph.
async fn reads_of(server: &MockServer, id: &str) -> usize {
    let event = format!("/v1.0/me/calendars/AAMkCalendar/events/{id}");
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|request| request.url.path() == event)
        .count()
}

async fn next_round(pool: &PgPool) {
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at = now() WHERE calendar_id IS NOT NULL"
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A series whose decline policy this build cannot read, standing in for a
/// series an older build could not read.
fn unreadable(mut master: Value) -> Value {
    master["showAs"] = json!("oof");
    master["singleValueExtendedProperties"] = json!([{
        "id":PREFERENCES_ID,
        "value":json!({"automaticDecline":{"mode":"declineWhenAway"}}).to_string(),
    }]);
    master
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_series_with_a_moved_meeting_is_imported_with_it(pool: PgPool) {
    let (server, sync) = connected(&pool).await;
    serve_near_window(&server, &[]).await;
    serve_delta(&server, None, &[occurrence("AAMkDaily")], "complete").await;
    let (master, instances) = upcoming_series("AAMkDaily", "ada@example.com", false);
    let moved = instances[2]["originalStart"].as_str().unwrap().to_owned();
    serve_series(&server, master, instances).await;
    sync_until_idle(&sync).await;

    assert_synced(&pool).await;
    assert_eq!(imported(&pool).await, vec!["AAMkDaily"]);
    let overrides = sqlx::query!(
        "SELECT o.recurrence_id, o.title FROM calendar_event_overrides o JOIN calendar_events e ON e.id = o.event_id WHERE e.owner_id = $1",
        OWNER
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(overrides.len(), 1);
    assert_eq!(
        overrides[0]
            .recurrence_id
            .parse::<chrono::DateTime<Utc>>()
            .unwrap(),
        moved.parse::<chrono::DateTime<Utc>>().unwrap(),
        "the moved meeting replaces its original slot"
    );
    assert_eq!(
        overrides[0].title.as_deref(),
        Some("Daily standup, an hour later")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_series_an_older_build_skipped_is_read_again_once_on_the_next_delta_round(pool: PgPool) {
    let (server, sync) = connected(&pool).await;
    serve_near_window(&server, &[]).await;
    let (master, instances) = upcoming_series("AAMkDaily", "ada@example.com", false);
    serve_delta(&server, None, &[occurrence("AAMkDaily")], "first").await;
    serve_series(&server, unreadable(master.clone()), instances.clone()).await;
    sync_until_idle(&sync).await;
    assert!(imported(&pool).await.is_empty());

    // Nothing changed in Outlook, so a series this build skipped costs no read.
    server.reset().await;
    serve_delta(&server, Some("first"), &[], "second").await;
    serve_series(&server, master.clone(), instances.clone()).await;
    next_round(&pool).await;
    sync_until_idle(&sync).await;
    assert_eq!(reads_of(&server, "AAMkDaily").await, 0);

    // What a build before reader revisions left behind when it skipped one.
    sqlx::query!("UPDATE calendar_outlook_members SET reader_revision = NULL")
        .execute(&pool)
        .await
        .unwrap();
    server.reset().await;
    serve_delta(&server, Some("second"), &[], "third").await;
    serve_series(&server, master.clone(), instances.clone()).await;
    next_round(&pool).await;
    sync_until_idle(&sync).await;
    assert_synced(&pool).await;
    assert_eq!(reads_of(&server, "AAMkDaily").await, 1);
    assert_eq!(
        imported(&pool).await,
        vec!["AAMkDaily"],
        "the series comes back without changing in Outlook"
    );

    server.reset().await;
    serve_delta(&server, Some("third"), &[], "fourth").await;
    serve_series(&server, master, instances).await;
    next_round(&pool).await;
    sync_until_idle(&sync).await;
    assert_eq!(reads_of(&server, "AAMkDaily").await, 0, "it is read once");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_first_import_brings_this_month_and_next_in_before_last_year(pool: PgPool) {
    let (server, sync) = connected(&pool).await;
    // Last year's meeting sorts first, so a single listing reads it first.
    serve_near_window(&server, &[single("AAMkNextWeek")]).await;
    serve_delta(
        &server,
        None,
        &[single("AAMkLastYear"), single("AAMkNextWeek")],
        "complete",
    )
    .await;
    serve_event(
        &server,
        meeting_in("AAMkLastYear", -chrono::Duration::days(330)),
    )
    .await;
    serve_event(
        &server,
        meeting_in("AAMkNextWeek", chrono::Duration::days(7)),
    )
    .await;

    let mut arrivals: Vec<(String, bool)> = vec![];
    for _ in 0..12 {
        if !matches!(sync.run_once().await, Ok(true)) {
            break;
        }
        let synced = sqlx::query_scalar!(
            "SELECT synced_at IS NOT NULL FROM calendars WHERE provider_calendar_id = 'AAMkCalendar'"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap_or_default();
        for id in imported(&pool).await {
            if !arrivals.iter().any(|(seen, _)| *seen == id) {
                arrivals.push((id, synced));
            }
        }
    }

    assert_eq!(
        arrivals,
        vec![
            ("AAMkNextWeek".to_owned(), false),
            ("AAMkLastYear".to_owned(), false),
        ],
        "next week arrives first, and neither counts as synced before the whole window"
    );
    assert_synced(&pool).await;
    let near = OccurrenceRange::near_window(Utc::now());
    let listed = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|request| request.url.path() == "/v1.0/me/calendars/AAMkCalendar/calendarView")
        .unwrap();
    let bound = |name: &str| {
        listed
            .url
            .query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.parse::<chrono::DateTime<Utc>>().unwrap())
    };
    assert_eq!(
        (bound("startDateTime"), bound("endDateTime")),
        (Some(near.starts_at), Some(near.ends_at)),
        "the first listing is this month and next"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_first_import_reads_the_events_closest_to_today_first(pool: PgPool) {
    let (server, sync) = connected(&pool).await;
    // In ID order the near window would read next month's meeting first and
    // tomorrow's last.
    let near = [
        meeting_in("AAMkEndOfNextMonth", chrono::Duration::days(25)),
        meeting_in("AAMkLastWeek", -chrono::Duration::days(6)),
        meeting_in("AAMkTomorrow", chrono::Duration::days(1)),
    ];
    serve_near_window(&server, &near).await;
    serve_delta(
        &server,
        None,
        &[
            single("AAMkEndOfNextMonth"),
            single("AAMkLastWeek"),
            single("AAMkTomorrow"),
        ],
        "complete",
    )
    .await;
    for event in near {
        serve_event(&server, event).await;
    }

    let mut arrivals: Vec<String> = vec![];
    for _ in 0..16 {
        if !matches!(sync.run_once().await, Ok(true)) {
            break;
        }
        for id in imported(&pool).await {
            if !arrivals.contains(&id) {
                arrivals.push(id);
            }
        }
    }

    assert_eq!(
        arrivals,
        ["AAMkTomorrow", "AAMkLastWeek", "AAMkEndOfNextMonth"],
        "the near window reads tomorrow, then last week, then next month"
    );
    assert_synced(&pool).await;
}

/// Macro's per-mailbox admission, refusing every request as a mailbox whose
/// in-flight slots mail sync holds.
struct BusyMailbox;

impl crate::domain::ports::MailboxRequestGate for BusyMailbox {
    fn acquire(
        &self,
        _: crate::domain::models::MailboxAccess,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Uuid, EmailApiError>> + Send + '_>> {
        Box::pin(async {
            Err(EmailApiError::RateLimited {
                retry_after: Some(std::time::Duration::from_millis(2_500)),
                origin: RateLimitOrigin::Gate(crate::domain::models::GateLimit::Concurrency),
            })
        })
    }
    fn finish(
        &self,
        _: crate::domain::models::MailboxAccess,
        _: Uuid,
        _: Option<std::time::Duration>,
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }
    fn admitted(
        &self,
        _: crate::domain::models::MailboxAccess,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<u64>> + Send + '_>> {
        Box::pin(async { None })
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_step_the_request_gate_refuses_waits_without_counting_a_failure(pool: PgPool) {
    // Discovered already, so the first step is the near window's listing.
    let (server, _) = connected(&pool).await;
    serve_near_window(&server, &[]).await;
    let mut busy = OutlookApiClientRepository::for_test(&format!("{}/v1.0/", server.uri()));
    busy.gate = Some(std::sync::Arc::new(BusyMailbox));
    let busy = OutlookCalendarSync::new(
        PgCalendarRepository::new(pool.clone()),
        busy,
        IssuedToken,
        NoOpenClients,
    );

    assert!(
        matches!(busy.run_once().await, Ok(true)),
        "a deferred step is not an error, and the loop moves on"
    );

    let work = sqlx::query!(
        r#"SELECT w.attempts,w.last_error,w.lease_until,c.consecutive_sync_failures,c.last_sync_error,a.sync_status,
            extract(epoch FROM w.next_run_at-now())::float8 AS "wait!"
        FROM calendar_outlook_work w JOIN calendars c ON c.id=w.calendar_id JOIN calendar_accounts a ON a.id=w.account_id
        WHERE c.provider_calendar_id='AAMkCalendar'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(work.lease_until.is_none());
    assert!(
        (1.0..=2.5).contains(&work.wait),
        "retries after the gate's delay, not {}",
        work.wait
    );
    assert_eq!(
        (
            work.attempts,
            work.last_error,
            work.consecutive_sync_failures,
            work.last_sync_error
        ),
        (0, None, 0, None),
        "nothing reached Microsoft, so nothing failed"
    );
    assert_eq!(work.sync_status, "syncing");
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|request| request.url.path() != "/v1.0/me/calendars/AAMkCalendar/calendarView"),
        "the gate sent nothing"
    );
}
