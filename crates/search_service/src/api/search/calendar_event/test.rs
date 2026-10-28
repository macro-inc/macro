use super::*;
use chrono::{NaiveDate, TimeZone, Utc};
use opensearch_client::search::model::{Highlight, SearchHit};

fn hit(entity_id: Uuid) -> SearchHit {
    SearchHit {
        entity_id,
        entity_type: models_opensearch::SearchEntityType::CalendarEvents,
        score: Some(1.0),
        highlight: Highlight::default(),
        goto: None,
        updated_at: None,
    }
}

fn timed_series(id: Uuid) -> CalendarEventSearchInfo {
    CalendarEventSearchInfo {
        id,
        owner_id: "user123".to_string(),
        title: "Standup".to_string(),
        status: "confirmed".to_string(),
        starts_at: Some(Utc.with_ymd_and_hms(2024, 1, 3, 10, 0, 0).unwrap()),
        ends_at: Some(Utc.with_ymd_and_hms(2024, 1, 3, 10, 15, 0).unwrap()),
        start_date: None,
        end_date: None,
        time_zone: Some("America/New_York".to_string()),
        is_recurring: true,
        conference_url: None,
        organizer_email: Some("jacob@example.com".to_string()),
        organizer_name: Some("Jacob Beckerman".to_string()),
        description: None,
        is_read_only: false,
        created_at: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2024, 1, 2, 0, 0, 0).unwrap(),
        occurrence_key: None,
        occurrence_starts_at: None,
        occurrence_ends_at: None,
        occurrence_start_date: None,
        occurrence_end_date: None,
    }
}

#[test]
fn resolved_occurrence_rides_on_the_row() {
    let id = Uuid::new_v4();
    let mut info = timed_series(id);
    // The lateral resolved next Tuesday rather than the series' 2024 master.
    info.occurrence_key = Some("2026-08-25T10:00:00+00:00".to_string());
    info.occurrence_starts_at = Some(Utc.with_ymd_and_hms(2026, 8, 25, 10, 0, 0).unwrap());
    info.occurrence_ends_at = Some(Utc.with_ymd_and_hms(2026, 8, 25, 10, 15, 0).unwrap());

    let results =
        construct_search_result(vec![hit(id)], HashMap::from([(id, info)]), HashMap::new());

    assert_eq!(results.len(), 1);
    let metadata = results[0].metadata.as_ref().expect("metadata");
    assert!(metadata.is_recurring);
    let occurrence = metadata.occurrence.as_ref().expect("resolved occurrence");
    assert_eq!(occurrence.occurrence_key, "2026-08-25T10:00:00+00:00");
    match &occurrence.time {
        CalendarEventSearchTime::Timed { starts_at, .. } => {
            assert_eq!(
                *starts_at,
                Utc.with_ymd_and_hms(2026, 8, 25, 10, 0, 0).unwrap()
            );
        }
        other => panic!("expected a timed occurrence, got {other:?}"),
    }
    // The master span still rides along so a client can fall back to it.
    match &metadata.time {
        CalendarEventSearchTime::Timed { starts_at, .. } => {
            assert_eq!(
                *starts_at,
                Utc.with_ymd_and_hms(2024, 1, 3, 10, 0, 0).unwrap()
            );
        }
        other => panic!("expected a timed master, got {other:?}"),
    }
}

#[test]
fn series_with_no_materialized_occurrence_keeps_its_row() {
    // Occurrences live only inside a rolling window, so a series can resolve
    // to none. The row must still render, falling back to the master span.
    let id = Uuid::new_v4();
    let results = construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, timed_series(id))]),
        HashMap::new(),
    );

    assert_eq!(results.len(), 1);
    let metadata = results[0].metadata.as_ref().expect("metadata");
    assert!(
        metadata.occurrence.is_none(),
        "no occurrence should be reported when none is materialized"
    );
    assert!(matches!(
        metadata.time,
        CalendarEventSearchTime::Timed { .. }
    ));
}

#[test]
fn all_day_series_reads_the_date_pair() {
    let id = Uuid::new_v4();
    let mut info = timed_series(id);
    info.starts_at = None;
    info.ends_at = None;
    info.start_date = Some(NaiveDate::from_ymd_opt(2026, 8, 25).unwrap());
    info.end_date = Some(NaiveDate::from_ymd_opt(2026, 8, 26).unwrap());

    let results =
        construct_search_result(vec![hit(id)], HashMap::from([(id, info)]), HashMap::new());

    let metadata = results[0].metadata.as_ref().expect("metadata");
    match &metadata.time {
        CalendarEventSearchTime::AllDay {
            start_date,
            end_date,
        } => {
            assert_eq!(*start_date, NaiveDate::from_ymd_opt(2026, 8, 25).unwrap());
            assert_eq!(*end_date, NaiveDate::from_ymd_opt(2026, 8, 26).unwrap());
        }
        other => panic!("expected an all-day master, got {other:?}"),
    }
}

#[test]
fn hit_the_caller_cannot_see_is_dropped() {
    // The visibility query is the authority: an id absent from its result set
    // is one the caller lost access to since it was indexed.
    let id = Uuid::new_v4();
    let results = construct_search_result(vec![hit(id)], HashMap::new(), HashMap::new());
    assert!(
        results.is_empty(),
        "a hit with no visible row must not reach the response"
    );
}

#[test]
fn unreadable_span_is_dropped_rather_than_dated_wrong() {
    let id = Uuid::new_v4();
    let mut info = timed_series(id);
    info.starts_at = None;
    info.ends_at = None;
    // Neither leg of the time-shape constraint is satisfied.
    let results =
        construct_search_result(vec![hit(id)], HashMap::from([(id, info)]), HashMap::new());
    assert!(results.is_empty());
}

#[test]
fn multiple_hits_for_one_event_collapse_into_one_row() {
    let id = Uuid::new_v4();
    let results = construct_search_result(
        vec![hit(id), hit(id)],
        HashMap::from([(id, timed_series(id))]),
        HashMap::new(),
    );
    assert_eq!(results.len(), 1, "one row per event entity");
    assert_eq!(
        results[0].extra.calendar_event_search_results.len(),
        2,
        "both hits are kept on that row"
    );
}

#[test]
fn organizer_rides_on_the_row_when_named() {
    let id = Uuid::new_v4();
    let results = construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, timed_series(id))]),
        HashMap::new(),
    );
    let organizer = results[0]
        .metadata
        .as_ref()
        .expect("metadata")
        .organizer
        .as_ref()
        .expect("organizer");
    assert_eq!(organizer.name.as_deref(), Some("Jacob Beckerman"));
    assert_eq!(organizer.email.as_deref(), Some("jacob@example.com"));
}

#[test]
fn organizer_absent_when_source_names_neither() {
    let id = Uuid::new_v4();
    let mut info = timed_series(id);
    info.organizer_email = None;
    info.organizer_name = None;
    let results =
        construct_search_result(vec![hit(id)], HashMap::from([(id, info)]), HashMap::new());
    assert!(
        results[0]
            .metadata
            .as_ref()
            .expect("metadata")
            .organizer
            .is_none()
    );
}
