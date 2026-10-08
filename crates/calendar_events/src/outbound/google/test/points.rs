use super::*;

fn instant(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn target() -> GoogleCalendarTarget {
    GoogleCalendarTarget {
        observed_access_role: Some("owner".to_owned()),
        owner_id: "macro|points@example.test".to_owned(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_owned(),
        is_read_only: false,
        range: OccurrenceRange {
            starts_at: instant("2026-07-01T00:00:00Z"),
            ends_at: instant("2026-08-01T00:00:00Z"),
            start_date: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
        },
    }
}

fn timed_event(id: &str, start: &str, end: &str) -> GoogleEvent {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "iCalUID": format!("{id}@example.test"),
        "status": "confirmed",
        "eventType": "default",
        "summary": "Imported calendar event",
        "start": {"dateTime": start, "timeZone": "UTC"},
        "end": {"dateTime": end, "timeZone": "UTC"},
        "updated": "2026-07-01T01:00:00Z"
    }))
    .unwrap()
}

fn instance(master: &GoogleEvent, original: &str, start: &str, end: &str) -> GoogleEvent {
    let mut event = timed_event("instance", start, end);
    event.ical_uid = master.ical_uid.clone();
    event.recurring_event_id = Some(master.id.clone());
    event.original_start_time = Some(GoogleEventDateTime {
        date: None,
        date_time: Some(original.to_owned()),
        time_zone: Some("UTC".to_owned()),
    });
    event
}

#[test]
fn point_snapshot_preserves_source_and_exact_window_membership() {
    let target = target();
    let events = [
        ("before", "2026-06-30T23:59:59.500Z"),
        ("left", "2026-07-01T00:00:00Z"),
        ("inside", "2026-07-24T14:00:00Z"),
        ("right", "2026-08-01T00:00:00Z"),
    ]
    .map(|(id, at)| timed_event(id, at, at));
    let snapshot = map_snapshot(&target, events.to_vec(), events.to_vec()).unwrap();
    assert_eq!(snapshot.upserts.len(), events.len());
    assert_eq!(snapshot.observed_provider_event_ids.len(), events.len());
    for upsert in snapshot.upserts {
        let CalendarEventSource::Google(source) = &upsert.source;
        assert_eq!(source.account_id, target.account_id);
        assert_eq!(source.calendar_id, target.calendar_id);
        assert_eq!(source.observed_access_role.as_deref(), Some("owner"));
        assert!(upsert.event.time.is_valid());
        assert!(!upsert.event.time.has_positive_duration());
        let expected_count = usize::from(matches!(
            source.provider_event_id.as_str(),
            "left" | "inside"
        ));
        assert_eq!(upsert.occurrences.len(), expected_count);
        if let Some(occurrence) = upsert.occurrences.first() {
            assert_eq!(occurrence.time, upsert.event.time);
            assert_eq!(
                occurrence.occurrence_key,
                upsert.event.time.occurrence_key()
            );
        }
    }
}

#[test]
fn point_series_master_retains_positive_moved_exception_and_point_instance() {
    let target = target();
    let mut master = timed_event("master", "2026-07-24T14:00:00Z", "2026-07-24T14:00:00Z");
    master.recurrence = vec!["RRULE:FREQ=DAILY;COUNT=2".to_owned()];
    let point = instance(
        &master,
        "2026-07-24T14:00:00Z",
        "2026-07-24T14:00:00Z",
        "2026-07-24T14:00:00Z",
    );
    let positive = instance(
        &master,
        "2026-07-25T14:00:00Z",
        "2026-07-25T15:00:00Z",
        "2026-07-25T16:00:00Z",
    );
    let upsert = map_upsert(
        &target,
        master,
        vec![positive.clone()],
        vec![point, positive],
    )
    .unwrap();
    assert!(!upsert.event.time.has_positive_duration());
    assert_eq!(upsert.overrides.len(), 1);
    assert!(upsert.overrides[0].time.has_positive_duration());
    assert_eq!(upsert.occurrences.len(), 2);
    assert!(!upsert.occurrences[0].time.has_positive_duration());
    assert!(upsert.occurrences[1].time.has_positive_duration());
    assert_eq!(
        upsert.occurrences[1].recurrence_id,
        Some("2026-07-25T14:00:00+00:00".to_owned())
    );
    assert_eq!(
        upsert.occurrences[1].occurrence_key,
        upsert.overrides[0].recurrence_id
    );
}

#[test]
fn moved_exception_can_change_between_duration_and_point_without_changing_identity() {
    let target = target();
    let mut master = timed_event("master", "2026-07-24T14:00:00Z", "2026-07-24T15:00:00Z");
    master.recurrence = vec!["RRULE:FREQ=DAILY".to_owned()];
    for end in [
        "2026-07-25T16:00:00Z",
        "2026-07-25T15:00:00Z",
        "2026-07-25T17:00:00Z",
    ] {
        let exception = instance(&master, "2026-07-25T14:00:00Z", "2026-07-25T15:00:00Z", end);
        let upsert = map_upsert(
            &target,
            master.clone(),
            vec![exception.clone()],
            vec![exception],
        )
        .unwrap();
        assert_eq!(upsert.occurrences.len(), 1);
        assert_eq!(upsert.overrides.len(), 1);
        assert_eq!(
            upsert.occurrences[0].occurrence_key,
            "2026-07-25T14:00:00+00:00"
        );
        assert_eq!(
            upsert.overrides[0].recurrence_id,
            upsert.occurrences[0].occurrence_key
        );
        assert_eq!(upsert.overrides[0].time, upsert.occurrences[0].time);
        assert!(
            matches!(&upsert.occurrences[0].time, EventTime::Timed { ends_at, .. } if *ends_at == instant(end))
        );
    }
}

#[tokio::test]
async fn a_duration_becoming_a_point_is_an_upsert_with_the_same_provider_identity() {
    let target = target();
    let client = GoogleCalendarClient::new(Client::new());
    let mut event = timed_event("same-event", "2026-07-24T14:00:00Z", "2026-07-24T15:00:00Z");
    let before = client
        .apply_change_feed("unused", &target, vec![event.clone()])
        .await
        .unwrap();
    event.end = event.start.clone();
    event.updated = Some("2026-07-24T13:00:00Z".to_owned());
    let after = client
        .apply_change_feed("unused", &target, vec![event])
        .await
        .unwrap();
    assert_eq!(before.upserts.len(), 1);
    assert_eq!(after.upserts.len(), 1);
    assert!(after.cancelled.is_empty());
    assert!(after.upserted_singles.contains("same-event"));
    let before = &before.upserts[0];
    let after = &after.upserts[0];
    let CalendarEventSource::Google(before_source) = &before.source;
    let CalendarEventSource::Google(after_source) = &after.source;
    assert_eq!(
        before_source.provider_event_id,
        after_source.provider_event_id
    );
    assert_eq!(before_source.calendar_id, after_source.calendar_id);
    assert_eq!(before.event.ical_uid, after.event.ical_uid);
    assert!(before.event.time.has_positive_duration());
    assert!(!after.event.time.has_positive_duration());
    assert_eq!(after.occurrences.len(), 1);
    assert_eq!(after.occurrences[0].time, after.event.time);
    assert_eq!(
        after.occurrences[0].occurrence_key,
        before.occurrences[0].occurrence_key
    );
    assert_eq!(
        after_source.raw_payload["start"]["dateTime"],
        after_source.raw_payload["end"]["dateTime"]
    );
    assert!(after.event.updated_at > before.event.updated_at);
}

#[tokio::test]
async fn reversed_timed_and_nonpositive_all_day_events_still_reject_whole_batches() {
    let target = target();
    let client = GoogleCalendarClient::new(Client::new());
    let valid = timed_event(
        "valid-point",
        "2026-07-24T14:00:00Z",
        "2026-07-24T14:00:00Z",
    );
    let reversed = timed_event("reversed", "2026-07-24T14:00:00Z", "2026-07-24T13:00:00Z");
    let all_day = |end: &str| {
        serde_json::from_value::<GoogleEvent>(serde_json::json!({
            "id": "invalid-all-day", "iCalUID": "all-day@example.test",
            "start": {"date": "2026-07-24"}, "end": {"date": end}
        }))
        .unwrap()
    };
    for invalid in [reversed, all_day("2026-07-24"), all_day("2026-07-23")] {
        assert!(google_time(&invalid).is_err());
        assert!(
            map_snapshot(
                &target,
                vec![valid.clone(), invalid.clone()],
                vec![valid.clone()]
            )
            .is_err()
        );
        let result = client
            .apply_change_feed("unused", &target, vec![valid.clone(), invalid])
            .await;
        assert!(matches!(result, Err(error) if error.kind() == GoogleProviderErrorKind::Transient));
    }
}

#[test]
fn a_point_orphan_at_the_left_edge_is_missing_coverage_but_outside_is_not() {
    let target = target();
    let master = timed_event(
        "missing-master",
        "2026-07-01T00:00:00Z",
        "2026-07-01T01:00:00Z",
    );
    for (at, in_window) in [
        ("2026-06-30T23:59:59Z", false),
        ("2026-07-01T00:00:00Z", true),
        ("2026-08-01T00:00:00Z", false),
    ] {
        let orphan = instance(&master, "2026-07-01T00:00:00Z", at, at);
        assert_eq!(
            map_snapshot(&target, vec![orphan], Vec::new()).is_err(),
            in_window
        );
    }
}

#[cfg(feature = "inbound")]
#[tokio::test]
async fn list_queries_admit_left_edge_points_and_incremental_tokens_keep_their_query_contract() {
    use axum::{
        Json, Router,
        extract::{Query, State},
        routing::get,
    };
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    #[derive(Clone, Default)]
    struct Remote {
        requests: Arc<Mutex<Vec<HashMap<String, String>>>>,
    }
    async fn list(
        State(remote): State<Remote>,
        Query(query): Query<HashMap<String, String>>,
    ) -> Json<serde_json::Value> {
        remote.requests.lock().unwrap().push(query.clone());
        let lower = query.get("timeMin").map(|value| instant(value));
        let upper = query.get("timeMax").map(|value| instant(value));
        let events: Vec<_> = [
            ("padding-only", "2026-06-30T23:59:59.500Z"),
            ("left", "2026-07-01T00:00:00Z"),
            ("inside", "2026-07-24T14:00:00Z"),
            ("right", "2026-08-01T00:00:00Z"),
        ]
        .into_iter()
        .filter(|(_, at)| {
            let at = instant(at);
            lower.is_none_or(|lower| at > lower) && upper.is_none_or(|upper| at < upper)
        })
        .map(|(id, at)| timed_event(id, at, at))
        .collect();
        Json(serde_json::json!({"items": events, "nextSyncToken": "next-token"}))
    }
    let remote = Remote::default();
    let app = Router::new()
        .route("/calendars/primary/events", get(list))
        .with_state(remote.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = GoogleCalendarClient {
        client: Client::new(),
        gate: UnmeteredGate,
        api_base: endpoint,
    };
    let target = target();
    let batch = client
        .sync_events(
            "test-token",
            GoogleEventSyncContext {
                target: target.clone(),
                sync_token: None,
                plan: GoogleSyncPlan::FullSnapshot,
            },
        )
        .await
        .unwrap();
    assert_eq!(batch.next_sync_token, "next-token");
    assert_eq!(batch.materialized_range, Some(target.range.clone()));
    assert_eq!(
        batch
            .upserts
            .iter()
            .map(|upsert| upsert.occurrences.len())
            .sum::<usize>(),
        2
    );
    assert!(batch.upserts.iter().any(|upsert| {
        upsert.occurrences.first().is_some_and(|occurrence| {
            occurrence.time.occurrence_key() == "2026-07-01T00:00:00+00:00"
        })
    }));
    client
        .event_changes(
            "test-token",
            target.email_link_id,
            "primary",
            Some("next-token"),
            &target.range,
        )
        .await
        .unwrap();
    let requests = remote.requests.lock().unwrap();
    assert_eq!(requests.len(), 4);
    for query in &requests[..3] {
        assert_eq!(query["timeMin"], "2026-06-30T23:59:59+00:00");
        assert!(!query.contains_key("syncToken"));
    }
    assert!(
        !requests[0].contains_key("timeMax"),
        "the initial token must cover future additions"
    );
    assert_eq!(requests[1]["timeMax"], "2026-08-01T00:00:00+00:00");
    assert_eq!(requests[2]["timeMax"], requests[1]["timeMax"]);
    assert_eq!(requests[3]["syncToken"], "next-token");
    assert!(!requests[3].contains_key("timeMin"));
    assert!(!requests[3].contains_key("timeMax"));
    task.abort();
}
