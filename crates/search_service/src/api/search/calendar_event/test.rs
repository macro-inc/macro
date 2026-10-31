use super::*;
use calendar_events::domain::labels::{EventLabels, EventRole};
use calendar_events::domain::meeting_links::attach_macro_call;
use chrono::{NaiveDate, TimeZone, Utc};
use opensearch_client::search::model::{Highlight, SearchHit};

const CALL_URL: &str = "https://macro.com/app/meet/join/0123456789abcdef0123456789abcdef";

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
        holds_meeting: true,
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

/// The description a row returns for an event stored with `description`.
fn returned_description(description: &str, holds_meeting: bool) -> Option<String> {
    let id = Uuid::new_v4();
    let mut info = timed_series(id);
    info.description = Some(description.to_string());
    info.holds_meeting = holds_meeting;
    let results = construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, info)]),
        HashMap::new(),
        HashMap::new(),
    );
    results
        .into_iter()
        .next()
        .and_then(|row| row.metadata)
        .and_then(|metadata| metadata.description)
}

/// The metadata of a row for `info` under `labels`.
fn labelled_row(mut info: CalendarEventSearchInfo, labels: EventLabels) -> CalendarEventMetadata {
    let id = Uuid::new_v4();
    info.id = id;
    construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, info)]),
        HashMap::from([(id, labels)]),
        HashMap::new(),
    )
    .into_iter()
    .next()
    .and_then(|row| row.metadata)
    .expect("a row")
}

/// An event on a colleague's calendar comes back on the user's own inbox, so
/// only the row's labels keep it from reading as the user's.
#[test]
fn a_row_on_a_colleagues_calendar_says_whose_it_is() {
    let metadata = labelled_row(
        timed_series(Uuid::nil()),
        EventLabels {
            calendar_name: Some("colleague@example.com".to_string()),
            contributes_to_availability: Some(false),
            inbox: Some("owner@example.com".to_string()),
            role: None,
        },
    );
    assert_eq!(
        metadata.calendar_name.as_deref(),
        Some("colleague@example.com")
    );
    assert_eq!(metadata.contributes_to_availability, Some(false));
    assert_eq!(metadata.inbox.as_deref(), Some("owner@example.com"));
    assert_eq!(metadata.role, None);
}

#[test]
fn a_real_organizer_and_guest_keep_their_role_on_the_row() {
    for (role, wire) in [
        (EventRole::Organizer, CalendarEventSearchRole::Organizer),
        (EventRole::Guest, CalendarEventSearchRole::Guest),
    ] {
        let metadata = labelled_row(
            timed_series(Uuid::nil()),
            EventLabels {
                role: Some(role),
                ..EventLabels::default()
            },
        );
        assert_eq!(metadata.role, Some(wire));
    }
}

/// A row whose labels failed to load still reaches the caller, without any.
#[test]
fn a_row_without_labels_says_nothing_about_the_calendar() {
    let id = Uuid::new_v4();
    let results = construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, timed_series(id))]),
        HashMap::new(),
        HashMap::new(),
    );
    let metadata = results[0].metadata.as_ref().expect("metadata");
    assert_eq!(metadata.calendar_name, None);
    assert_eq!(metadata.contributes_to_availability, None);
    assert_eq!(metadata.role, None);
}

/// Absent labels stay off the wire, like the row's other optional fields, and
/// a row names the field the way an occurrence does.
#[test]
fn labels_serialize_under_the_occurrence_names() {
    let metadata = labelled_row(
        timed_series(Uuid::nil()),
        EventLabels {
            calendar_name: Some("Team".to_string()),
            contributes_to_availability: Some(false),
            inbox: Some("owner@example.com".to_string()),
            role: Some(EventRole::Guest),
        },
    );
    let row = serde_json::to_value(&metadata).expect("serializes");
    assert_eq!(row["calendarName"], "Team");
    assert_eq!(row["contributesToAvailability"], false);
    assert_eq!(row["inbox"], "owner@example.com");
    assert_eq!(row["role"], "guest");

    let bare = serde_json::to_value(labelled_row(
        timed_series(Uuid::nil()),
        EventLabels::default(),
    ))
    .expect("serializes");
    for field in ["calendarName", "contributesToAvailability", "inbox", "role"] {
        assert!(bare.get(field).is_none(), "{field} stays off the wire");
    }
}

#[test]
fn a_channel_member_reads_the_description_without_the_macro_call() {
    let (stored, _) = attach_macro_call(Some("Quarterly planning"), None, CALL_URL);
    assert_eq!(
        returned_description(&stored, false).as_deref(),
        Some("Quarterly planning")
    );
}

#[test]
fn a_description_holding_only_the_join_line_comes_back_empty() {
    let (stored, _) = attach_macro_call(None, None, CALL_URL);
    assert_eq!(returned_description(&stored, false), None);
}

#[test]
fn a_join_line_closing_a_long_description_still_comes_out() {
    // The mention preview's trap: a cap ahead of the strip would cut the join
    // line short of what the rule recognizes. Search caps nothing.
    let text = "Agenda ".repeat(1_000);
    let (stored, _) = attach_macro_call(Some(&text), None, CALL_URL);
    let returned = returned_description(&stored, false).expect("the text stays");
    assert!(!returned.contains("/meet/join/"), "{returned}");
    assert!(returned.starts_with("Agenda"), "{returned}");
}

#[test]
fn a_holder_keeps_the_macro_call() {
    let (stored, _) = attach_macro_call(Some("Quarterly planning"), None, CALL_URL);
    assert_eq!(
        returned_description(&stored, true).as_deref(),
        Some(stored.as_str())
    );
}

#[test]
fn a_share_without_a_macro_call_keeps_its_markup() {
    let stored = "<p>See <a href=\"https://example.com/notes\">the notes</a></p>";
    assert_eq!(returned_description(stored, false).as_deref(), Some(stored));
}

#[test]
fn resolved_occurrence_rides_on_the_row() {
    let id = Uuid::new_v4();
    let mut info = timed_series(id);
    // The lateral resolved next Tuesday rather than the series' 2024 master.
    info.occurrence_key = Some("2026-08-25T10:00:00+00:00".to_string());
    info.occurrence_starts_at = Some(Utc.with_ymd_and_hms(2026, 8, 25, 10, 0, 0).unwrap());
    info.occurrence_ends_at = Some(Utc.with_ymd_and_hms(2026, 8, 25, 10, 15, 0).unwrap());

    let results = construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, info)]),
        HashMap::new(),
        HashMap::new(),
    );

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

    let results = construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, info)]),
        HashMap::new(),
        HashMap::new(),
    );

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
    let results = construct_search_result(
        vec![hit(id)],
        HashMap::new(),
        HashMap::new(),
        HashMap::new(),
    );
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
    let results = construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, info)]),
        HashMap::new(),
        HashMap::new(),
    );
    assert!(results.is_empty());
}

#[test]
fn multiple_hits_for_one_event_collapse_into_one_row() {
    let id = Uuid::new_v4();
    let results = construct_search_result(
        vec![hit(id), hit(id)],
        HashMap::from([(id, timed_series(id))]),
        HashMap::new(),
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
    let results = construct_search_result(
        vec![hit(id)],
        HashMap::from([(id, info)]),
        HashMap::new(),
        HashMap::new(),
    );
    assert!(
        results[0]
            .metadata
            .as_ref()
            .expect("metadata")
            .organizer
            .is_none()
    );
}
