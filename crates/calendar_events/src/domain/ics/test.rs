use chrono::{NaiveDate, TimeZone, Utc};

use super::render_event_ics;
use crate::domain::models::{
    CalendarEventCopyAccess, CalendarEventCopySource, EventTime, EventType,
};

fn source(time: EventTime) -> CalendarEventCopySource {
    CalendarEventCopySource {
        access: CalendarEventCopyAccess::ChannelShared,
        ical_uid: "abc123@google.com".to_string(),
        sequence: 2,
        event_type: EventType::Default,
        title: "Planning, part 1; kickoff".to_string(),
        description: None,
        location: None,
        time,
        recurrence_lines: Vec::new(),
        organizer_email: Some("organizer@example.com".to_string()),
        organizer_name: Some("Ada \"The\" Organizer".to_string()),
        updated_at: Utc.with_ymd_and_hms(2026, 9, 20, 12, 0, 0).unwrap(),
    }
}

fn unfolded(document: &str) -> Vec<String> {
    document
        .replace("\r\n ", "")
        .split("\r\n")
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

#[test]
fn timed_event_with_zone_is_written_in_local_wall_time() {
    let mut event = source(EventTime::Timed {
        starts_at: Utc.with_ymd_and_hms(2026, 9, 24, 23, 30, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 9, 25, 0, 0, 0).unwrap(),
        time_zone: Some("America/New_York".to_string()),
    });
    event.recurrence_lines = vec!["RRULE:FREQ=WEEKLY;BYDAY=TH".to_string()];

    let lines = unfolded(&render_event_ics(&event));

    assert!(lines.contains(&"DTSTART;TZID=America/New_York:20260924T193000".to_string()));
    assert!(lines.contains(&"DTEND;TZID=America/New_York:20260924T200000".to_string()));
    assert!(lines.contains(&"RRULE:FREQ=WEEKLY;BYDAY=TH".to_string()));
    assert!(lines.contains(&"UID:abc123@google.com".to_string()));
    assert!(lines.contains(&"SEQUENCE:2".to_string()));
    assert!(lines.contains(&"SUMMARY:Planning\\, part 1\\; kickoff".to_string()));
    assert!(lines.contains(
        &"ORGANIZER;CN=\"Ada 'The' Organizer\":mailto:organizer@example.com".to_string()
    ));
    assert_eq!(lines.first().map(String::as_str), Some("BEGIN:VCALENDAR"));
    assert_eq!(lines.last().map(String::as_str), Some("END:VCALENDAR"));
}

#[test]
fn timed_event_without_a_known_zone_is_written_in_utc() {
    let event = source(EventTime::Timed {
        starts_at: Utc.with_ymd_and_hms(2026, 9, 24, 23, 30, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 9, 25, 0, 0, 0).unwrap(),
        time_zone: Some("Not/AZone".to_string()),
    });

    let lines = unfolded(&render_event_ics(&event));

    assert!(lines.contains(&"DTSTART:20260924T233000Z".to_string()));
    assert!(lines.contains(&"DTEND:20260925T000000Z".to_string()));
}

#[test]
fn all_day_event_keeps_the_exclusive_end_date() {
    let event = source(EventTime::AllDay {
        start_date: NaiveDate::from_ymd_opt(2026, 9, 24).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 9, 25).unwrap(),
    });

    let lines = unfolded(&render_event_ics(&event));

    assert!(lines.contains(&"DTSTART;VALUE=DATE:20260924".to_string()));
    assert!(lines.contains(&"DTEND;VALUE=DATE:20260925".to_string()));
}

#[test]
fn html_description_is_reduced_to_escaped_plain_text() {
    let mut event = source(EventTime::AllDay {
        start_date: NaiveDate::from_ymd_opt(2026, 9, 24).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 9, 25).unwrap(),
    });
    event.description =
        Some("<p>Agenda:</p><ul><li>Budget &amp; hiring</li></ul><br>Notes, too".to_string());

    let lines = unfolded(&render_event_ics(&event));

    assert!(lines.contains(&"DESCRIPTION:Agenda:\\nBudget & hiring\\nNotes\\, too".to_string()));
}

#[test]
fn long_lines_fold_at_75_octets_without_splitting_characters() {
    let mut event = source(EventTime::AllDay {
        start_date: NaiveDate::from_ymd_opt(2026, 9, 24).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 9, 25).unwrap(),
    });
    event.title = "é".repeat(80);

    let document = render_event_ics(&event);

    for line in document.split("\r\n") {
        assert!(line.len() <= 75, "line exceeds 75 octets: {line:?}");
    }
    assert!(unfolded(&document).contains(&format!("SUMMARY:{}", "é".repeat(80))));
}
