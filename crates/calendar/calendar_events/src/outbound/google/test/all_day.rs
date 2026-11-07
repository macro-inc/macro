use super::*;

fn target() -> ProviderCalendarTarget {
    ProviderCalendarTarget {
        binding: None,
        provider: crate::domain::models::CalendarProvider::Google,
        observed_access_role: Some("reader".to_owned()),
        owner_id: "macro|calendar@example.test".to_owned(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_owned(),
        is_read_only: true,
        range: OccurrenceRange {
            starts_at: DateTime::parse_from_rfc3339("2026-07-01T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            ends_at: DateTime::parse_from_rfc3339("2026-08-01T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            start_date: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
        },
    }
}

#[tokio::test]
async fn matching_all_day_dates_complete_snapshot_and_incremental_sync() {
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/calendars/primary/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "items": [
                {
                    "id": "same-day-all-day",
                    "iCalUID": "same-day@example.test",
                    "status": "confirmed",
                    "start": {"date": "2026-07-24"},
                    "end": {"date": "2026-07-24"}
                },
                {
                    "id": "valid-timed",
                    "iCalUID": "valid@example.test",
                    "status": "confirmed",
                    "start": {"dateTime": "2026-07-24T14:00:00Z"},
                    "end": {"dateTime": "2026-07-24T15:00:00Z"}
                }
            ],
            "nextSyncToken": "next-token"
        })))
        .expect(4)
        .mount(&server)
        .await;
    let client = GoogleCalendarClient {
        client: Client::new(),
        gate: UnmeteredGate,
        api_base: server.uri(),
    };
    let target = target();
    let expected = EventTime::AllDay {
        start_date: NaiveDate::from_ymd_opt(2026, 7, 24).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 7, 25).unwrap(),
    };

    for (plan, sync_token, materialized_range) in [
        (
            GoogleSyncPlan::FullSnapshot,
            None,
            Some(target.range.clone()),
        ),
        (
            GoogleSyncPlan::Incremental,
            Some("previous-token".to_owned()),
            None,
        ),
    ] {
        let batch = client
            .sync_events(
                "test-token",
                GoogleEventSyncContext {
                    target: target.clone(),
                    sync_token,
                    plan,
                },
            )
            .await
            .unwrap();
        assert_eq!(batch.next_sync_token, "next-token");
        assert_eq!(batch.materialized_range, materialized_range);
        assert_eq!(batch.upserts.len(), 2, "both calendar events survive sync");
        let all_day = batch
            .upserts
            .iter()
            .find(|upsert| upsert.source.details().provider_event_id == "same-day-all-day")
            .unwrap();
        assert_eq!(all_day.event.time, expected);
        assert_eq!(all_day.occurrences.len(), 1);
        assert_eq!(all_day.occurrences[0].time, expected);
        assert_eq!(all_day.occurrences[0].occurrence_key, "2026-07-24");
        assert!(all_day.event.is_read_only);
        assert_eq!(
            all_day.source.details().raw_payload["end"]["date"],
            "2026-07-24"
        );
    }
}

#[test]
fn matching_all_day_dates_normalize_recurring_instances_and_overrides() {
    let master: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "series", "iCalUID": "series@example.test",
        "start": {"date": "2026-07-24"}, "end": {"date": "2026-07-24"},
        "recurrence": ["RRULE:FREQ=DAILY;COUNT=2"]
    }))
    .unwrap();
    let moved: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "moved-instance", "iCalUID": "series@example.test", "recurringEventId": "series",
        "originalStartTime": {"date": "2026-07-25"},
        "start": {"date": "2026-07-26"}, "end": {"date": "2026-07-26"}
    }))
    .unwrap();
    let upsert = map_upsert(&target(), master, vec![moved.clone()], vec![moved]).unwrap();
    assert_eq!(
        upsert.event.time,
        EventTime::AllDay {
            start_date: NaiveDate::from_ymd_opt(2026, 7, 24).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 7, 25).unwrap(),
        }
    );
    let expected = EventTime::AllDay {
        start_date: NaiveDate::from_ymd_opt(2026, 7, 26).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 7, 27).unwrap(),
    };
    assert_eq!(upsert.overrides[0].time, expected);
    assert_eq!(upsert.occurrences[0].time, expected);
    assert_eq!(upsert.occurrences[0].occurrence_key, "2026-07-25");
}

#[test]
fn matching_all_day_dates_handle_date_boundaries_without_overflow() {
    for (start, end) in [("2028-02-29", "2028-03-01"), ("2026-12-31", "2027-01-01")] {
        let event: GoogleEvent = serde_json::from_value(serde_json::json!({
            "id": "boundary", "start": {"date": start}, "end": {"date": start}
        }))
        .unwrap();
        assert_eq!(
            google_time(&event).unwrap(),
            EventTime::AllDay {
                start_date: NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap(),
                end_date: NaiveDate::parse_from_str(end, "%Y-%m-%d").unwrap(),
            }
        );
    }
    let max_date = NaiveDate::MAX.to_string();
    let event: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "unrepresentable-end", "start": {"date": max_date}, "end": {"date": max_date}
    }))
    .unwrap();
    assert!(google_time(&event).is_err());
}
