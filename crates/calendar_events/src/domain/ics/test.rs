use chrono::{NaiveDate, TimeZone, Utc};

use super::{CalendarEventExport, CalendarEventExportAccess, render_event_ics};
use crate::domain::{
    meeting_links::attach_macro_call,
    models::{EventTime, EventType},
};

const CALL_URL: &str = "https://macro.com/app/meet/join/0123456789abcdef0123456789abcdef";

fn export(time: EventTime) -> CalendarEventExport {
    CalendarEventExport {
        access: CalendarEventExportAccess::ChannelShared,
        owner_id: "macro|organizer@example.com".to_string(),
        event_type: EventType::Default,
        ical_uid: "abc123@google.com".to_string(),
        sequence: 2,
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

fn all_day() -> EventTime {
    EventTime::AllDay {
        start_date: NaiveDate::from_ymd_opt(2026, 9, 24).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 9, 25).unwrap(),
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
fn a_recurring_timed_event_is_written_in_its_zones_wall_time() {
    let mut event = export(EventTime::Timed {
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
fn a_one_off_timed_event_is_written_in_utc() {
    let event = export(EventTime::Timed {
        starts_at: Utc.with_ymd_and_hms(2026, 9, 24, 23, 30, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 9, 25, 0, 0, 0).unwrap(),
        time_zone: Some("America/New_York".to_string()),
    });

    let lines = unfolded(&render_event_ics(&event));

    assert!(lines.contains(&"DTSTART:20260924T233000Z".to_string()));
    assert!(lines.contains(&"DTEND:20260925T000000Z".to_string()));
}

#[test]
fn a_recurring_event_without_a_known_zone_is_written_in_utc() {
    let mut event = export(EventTime::Timed {
        starts_at: Utc.with_ymd_and_hms(2026, 9, 24, 23, 30, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 9, 25, 0, 0, 0).unwrap(),
        time_zone: Some("Not/AZone".to_string()),
    });
    event.recurrence_lines = vec!["RRULE:FREQ=DAILY".to_string()];

    let lines = unfolded(&render_event_ics(&event));

    assert!(lines.contains(&"DTSTART:20260924T233000Z".to_string()));
    assert!(lines.contains(&"DTEND:20260925T000000Z".to_string()));
}

#[test]
fn all_day_event_keeps_the_exclusive_end_date() {
    let lines = unfolded(&render_event_ics(&export(all_day())));

    assert!(lines.contains(&"DTSTART;VALUE=DATE:20260924".to_string()));
    assert!(lines.contains(&"DTEND;VALUE=DATE:20260925".to_string()));
}

#[test]
fn html_description_is_reduced_to_escaped_plain_text() {
    let mut event = export(all_day());
    event.description = Some(
        "<html><head><style>p { margin: 0 }</style></head><body>\
         <p>Agenda:</p><p>Budget &amp; hiring</p><br>Notes, too</body></html>"
            .to_string(),
    );

    let lines = unfolded(&render_event_ics(&event));

    assert!(
        lines.contains(&"DESCRIPTION:Agenda:\\nBudget & hiring\\nNotes\\, too".to_string()),
        "{lines:?}"
    );
}

#[test]
fn plain_text_description_keeps_its_line_breaks() {
    let mut event = export(all_day());
    event.description = Some("Dial in first\r\nthen share your screen\n".to_string());

    let lines = unfolded(&render_event_ics(&event));

    assert!(lines.contains(&"DESCRIPTION:Dial in first\\nthen share your screen".to_string()));
}

#[test]
fn a_macro_call_leaves_neither_its_join_line_nor_its_link_as_the_location() {
    let mut event = export(all_day());
    let (description, location) =
        attach_macro_call(Some("<p>Bring the budget draft</p>"), None, CALL_URL);
    event.description = Some(description);
    event.location = Some(location);

    let document = render_event_ics(&event);
    let lines = unfolded(&document);

    assert!(
        lines.contains(&"DESCRIPTION:Bring the budget draft".to_string()),
        "{lines:?}"
    );
    assert!(
        !lines.iter().any(|line| line.starts_with("LOCATION")),
        "{lines:?}"
    );
    assert!(!document.contains("/meet/join/"), "{lines:?}");
}

#[test]
fn a_macro_call_keeps_a_physical_location_and_drops_an_empty_description() {
    let mut event = export(all_day());
    let (description, location) = attach_macro_call(None, Some("Room 4"), CALL_URL);
    event.description = Some(description);
    event.location = Some(location);

    let lines = unfolded(&render_event_ics(&event));

    assert!(lines.contains(&"LOCATION:Room 4".to_string()), "{lines:?}");
    assert!(
        !lines.iter().any(|line| line.starts_with("DESCRIPTION")),
        "{lines:?}"
    );
}

#[test]
fn the_join_line_goes_even_when_an_earlier_call_link_is_found_first() {
    let earlier = "https://macro.com/app/meet/join/fedcba9876543210fedcba9876543210";
    let mut event = export(all_day());
    let (description, location) = attach_macro_call(
        Some(&format!("<p>Last week: {earlier}</p>")),
        Some("Room 4"),
        CALL_URL,
    );
    event.description = Some(description);
    event.location = Some(location);

    let document = render_event_ics(&event);
    let lines = unfolded(&document);

    assert!(
        lines.contains(&format!("DESCRIPTION:Last week: {earlier}")),
        "{lines:?}"
    );
    assert!(!document.contains(CALL_URL), "{lines:?}");
}

#[test]
fn stored_line_breaks_cannot_start_a_new_property() {
    let mut event = export(EventTime::Timed {
        starts_at: Utc.with_ymd_and_hms(2026, 9, 24, 23, 30, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 9, 25, 0, 0, 0).unwrap(),
        time_zone: None,
    });
    event.recurrence_lines = vec!["RRULE:FREQ=DAILY\r\nATTACH:https://example.com/x".to_string()];
    event.organizer_name = Some("Ada\nBEGIN:VALARM".to_string());
    event.organizer_email =
        Some("organizer@example.com\r\nATTENDEE:mailto:x@example.com".to_string());

    let lines = unfolded(&render_event_ics(&event));

    assert!(
        lines.iter().all(|line| !line.starts_with("ATTACH")
            && !line.starts_with("BEGIN:VALARM")
            && !line.starts_with("ATTENDEE")),
        "{lines:?}"
    );
    assert!(lines.contains(&"RRULE:FREQ=DAILYATTACH:https://example.com/x".to_string()));
}

#[test]
fn long_lines_fold_at_75_octets_without_splitting_characters() {
    let mut event = export(all_day());
    event.title = "é".repeat(80);

    let document = render_event_ics(&event);

    for line in document.split("\r\n") {
        assert!(line.len() <= 75, "line exceeds 75 octets: {line:?}");
    }
    assert!(unfolded(&document).contains(&format!("SUMMARY:{}", "é".repeat(80))));
}
