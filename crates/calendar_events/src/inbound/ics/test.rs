use super::*;
use chrono::{NaiveDate, TimeZone};

fn range() -> OccurrenceRange {
    OccurrenceRange {
        starts_at: Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap(),
        start_date: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
    }
}

fn source(bytes: &[u8]) -> EmailIcsSource {
    EmailIcsSource {
        email_link_id: Uuid::now_v7(),
        email_thread_id: Some(Uuid::now_v7()),
        email_message_id: Uuid::now_v7(),
        email_attachment_id: Some("invite".to_string()),
        content_hash: ics_content_hash(bytes),
        raw_payload: serde_json::json!({"mimeType": "text/calendar"}),
    }
}

#[test]
fn parses_timed_invitation_and_attendees() {
    let ics = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting@example.com\r\nDTSTAMP:20260701T120000Z\r\nDTSTART:20260724T140000Z\r\nDTEND:20260724T150000Z\r\nSUMMARY:Design review\r\nORGANIZER;CN=Taylor:mailto:taylor@example.com\r\nATTENDEE;CN=Sam;PARTSTAT=ACCEPTED:mailto:sam@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    let events = parse_email_ics("macro|owner@example.com", source(ics), ics, &range()).unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event.ical_uid, "meeting@example.com");
    assert_eq!(events[0].event.title, "Design review");
    assert_eq!(
        events[0].event.organizer_email.as_deref(),
        Some("taylor@example.com")
    );
    assert_eq!(events[0].event.attendees[0].email, "sam@example.com");
    assert_eq!(events[0].occurrences.len(), 1);
}

#[test]
fn parses_all_day_with_exclusive_end() {
    let ics = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:offsite@example.com\r\nDTSTAMP:20260701T120000Z\r\nDTSTART;VALUE=DATE:20260724\r\nDTEND;VALUE=DATE:20260726\r\nSUMMARY:Offsite\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    let events = parse_email_ics("macro|owner@example.com", source(ics), ics, &range()).unwrap();

    assert!(matches!(
        events[0].event.time,
        EventTime::AllDay {
            start_date,
            end_date
        } if start_date == NaiveDate::from_ymd_opt(2026, 7, 24).unwrap()
            && end_date == NaiveDate::from_ymd_opt(2026, 7, 26).unwrap()
    ));
}

#[test]
fn defaults_an_all_day_event_without_dtend_to_one_day() {
    let ics = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:holiday@example.com\r\nDTSTAMP:20260701T120000Z\r\nDTSTART;VALUE=DATE:20260724\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    let events = parse_email_ics("macro|owner@example.com", source(ics), ics, &range()).unwrap();

    assert!(matches!(
        events[0].event.time,
        EventTime::AllDay {
            start_date,
            end_date
        } if start_date == NaiveDate::from_ymd_opt(2026, 7, 24).unwrap()
            && end_date == NaiveDate::from_ymd_opt(2026, 7, 25).unwrap()
    ));
}

#[test]
fn folds_override_into_master_entity() {
    let ics = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:standup@example.com\r\nDTSTAMP:20260701T120000Z\r\nDTSTART:20260724T140000Z\r\nDTEND:20260724T143000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:standup@example.com\r\nDTSTAMP:20260701T120000Z\r\nRECURRENCE-ID:20260725T140000Z\r\nDTSTART:20260725T150000Z\r\nDTEND:20260725T153000Z\r\nSUMMARY:Late standup\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    let events = parse_email_ics("macro|owner@example.com", source(ics), ics, &range()).unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].overrides.len(), 1);
    assert_eq!(events[0].occurrences.len(), 3);
    assert!(
        events[0]
            .occurrences
            .iter()
            .any(|occurrence| occurrence.recurrence_id.is_some())
    );
}

#[test]
fn recurrence_limit_caps_materialized_occurrences() {
    let ics = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:dense@example.com\r\nDTSTAMP:20260701T000000Z\r\nDTSTART:20260701T000000Z\r\nDTEND:20260701T000100Z\r\nRRULE:FREQ=MINUTELY\r\nSUMMARY:Dense recurrence\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let requested = range();

    let events = parse_email_ics("macro|owner@example.com", source(ics), ics, &requested).unwrap();

    assert_eq!(events[0].occurrences.len(), 20_000);
    let last_start = events[0]
        .occurrences
        .iter()
        .map(|occurrence| match occurrence.time {
            EventTime::Timed { starts_at, .. } => starts_at,
            EventTime::AllDay { .. } => unreachable!("dense recurrence is timed"),
        })
        .max()
        .unwrap();
    assert!(last_start < requested.ends_at);
}

#[test]
fn calendar_cancel_method_cancels_the_materialized_occurrence() {
    let ics = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:CANCEL\r\nBEGIN:VEVENT\r\nUID:cancelled@example.com\r\nDTSTAMP:20260701T120000Z\r\nDTSTART:20260724T140000Z\r\nDTEND:20260724T150000Z\r\nSUMMARY:Cancelled meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    let events = parse_email_ics("macro|owner@example.com", source(ics), ics, &range()).unwrap();

    assert_eq!(events[0].event.status, EventStatus::Cancelled);
    assert!(events[0].occurrences[0].is_cancelled);
}

#[test]
fn malformed_event_does_not_discard_valid_events_in_the_same_calendar() {
    let ics = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:broken@example.com\r\nSUMMARY:Missing time\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:valid@example.com\r\nDTSTAMP:20260701T120000Z\r\nDTSTART:20260724T140000Z\r\nDTEND:20260724T150000Z\r\nSUMMARY:Valid meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    let events = parse_email_ics("macro|owner@example.com", source(ics), ics, &range()).unwrap();

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event.ical_uid, "valid@example.com");
}

#[test]
fn recurrence_is_detected_in_either_property_map() {
    let mut single = Event::new();
    single.add_property("RRULE", "FREQ=DAILY");
    assert!(declares_recurrence(&single));

    let mut multi = Event::new();
    multi.append_multi_property(icalendar::Property::new("RRULE", "FREQ=WEEKLY"));
    assert!(
        declares_recurrence(&multi),
        "an RRULE stored in multi_properties must still count as recurring"
    );

    let mut rdate = Event::new();
    rdate.append_multi_property(icalendar::Property::new("RDATE", "20260801T120000Z"));
    assert!(declares_recurrence(&rdate));

    assert!(!declares_recurrence(&Event::new()));
}

#[test]
fn duration_stands_in_for_a_missing_dtend() {
    let ics = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:duration@example.com\r\nDTSTAMP:20260701T120000Z\r\nDTSTART:20260724T140000Z\r\nDURATION:PT1H30M\r\nSUMMARY:Duration event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    let events = parse_email_ics("macro|owner@example.com", source(ics), ics, &range()).unwrap();

    assert_eq!(events.len(), 1);
    let EventTime::Timed {
        starts_at, ends_at, ..
    } = events[0].event.time
    else {
        panic!("expected a timed event");
    };
    assert_eq!((ends_at - starts_at).num_minutes(), 90);
}

#[test]
fn ical_durations_parse_per_rfc_5545() {
    assert_eq!(parse_ical_duration("PT1H"), Some(Duration::hours(1)));
    assert_eq!(
        parse_ical_duration("P1DT2H30M"),
        Some(Duration::minutes(24 * 60 + 150))
    );
    assert_eq!(parse_ical_duration("P2W"), Some(Duration::weeks(2)));
    assert_eq!(parse_ical_duration("-PT15M"), Some(Duration::minutes(-15)));
    assert_eq!(parse_ical_duration("nonsense"), None);
    assert_eq!(parse_ical_duration("P1X"), None);
}
