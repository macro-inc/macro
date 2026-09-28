use super::*;

fn parse(event: &str, method: &str) -> Vec<CalendarInvitation> {
    let bytes = format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:{method}\r\nBEGIN:VEVENT\r\nUID:test@example.com\r\n{event}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    );
    parse_invitation_parts(&[bytes.as_bytes()])
}

#[test]
fn folded_escaped_text_and_attendee_parameters() {
    let parsed = parse(
        "SUMMARY:Review\\, product\r\n  design\r\nDESCRIPTION:Line one\\nLine two\\; password 123\r\nATTENDEE;CN=\"Alex Chen\";ROLE=OPT-PARTICIPANT;CUTYPE=RESOURCE;PARTSTAT=ACCEPTED:mailto:alex@example.com",
        "REPLY",
    );
    let invite = &parsed[0];
    assert_eq!(invite.title.as_deref(), Some("Review, product design"));
    assert_eq!(
        invite.description.as_deref(),
        Some("Line one\nLine two; password 123")
    );
    assert_eq!(invite.attendees[0].name.as_deref(), Some("Alex Chen"));
    assert_eq!(invite.method, InvitationMethod::Reply);
}

#[test]
fn typed_dates_dst_and_unresolved_zones() {
    let parsed = parse(
        "DTSTART;VALUE=DATE:20260924\r\nDTEND;VALUE=DATE:20260926",
        "REQUEST",
    );
    assert_eq!(
        parsed[0].end,
        Some(InvitationDateTime::Date {
            value: "2026-09-26".into()
        })
    );
    let parsed = parse(
        "DTSTART;TZID=America/Los_Angeles:20260924T100000",
        "REQUEST",
    );
    assert!(
        matches!(&parsed[0].start, Some(InvitationDateTime::Zoned { value, .. }) if value == "2026-09-24T17:00:00+00:00")
    );
    for start in [
        "TZID=Unknown/Zone:20260924T100000",
        "TZID=America/Los_Angeles:20260308T023000",
        "TZID=America/Los_Angeles:20261101T013000",
    ] {
        let parsed = parse(&format!("DTSTART;{start}"), "REQUEST");
        assert!(matches!(
            parsed[0].start,
            Some(InvitationDateTime::Unresolved { .. })
        ));
    }
    assert!(matches!(
        parse("DTSTART:20260924T100000", "REQUEST")[0].start,
        Some(InvitationDateTime::Unresolved {
            time_zone: None,
            ..
        })
    ));
}

#[test]
fn cancellation_preserves_original_occurrence_and_partial_metadata() {
    let parsed = parse(
        "RECURRENCE-ID;TZID=America/Los_Angeles:20260924T100000\r\nSTATUS:CANCELLED\r\nSEQUENCE:4",
        "CANCEL",
    );
    let invite = &parsed[0];
    assert_eq!(invite.method, InvitationMethod::Cancel);
    assert!(invite.start.is_none());
    assert!(invite.recurrence_id.is_some());
    assert_eq!(invite.sequence, 4);
}

#[test]
fn duplicates_collapse_but_overrides_remain() {
    let bytes = b"BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:series\nDTSTART:20260924T170000Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:series\nRECURRENCE-ID:20261001T170000Z\nDTSTART:20261001T180000Z\nEND:VEVENT\nEND:VCALENDAR\n";
    let parsed = parse_invitation_parts(&[bytes, bytes]);
    assert_eq!(parsed.len(), 2);
    assert!(parsed[1].recurrence_id.is_some());
}

#[test]
fn malformed_oversized_and_unsafe_input() {
    assert!(parse_invitation_parts(&[]).is_empty());
    for bytes in [
        vec![b'x'; MAX_INVITATION_BYTES + 1],
        b"not a calendar".to_vec(),
        vec![255],
    ] {
        assert!(parse_invitation_parts(&[&bytes]).is_empty());
    }
    let parsed = parse(
        "X-GOOGLE-CONFERENCE:https://evil:password@example.com\r\nLOCATION:javascript:alert(1)",
        "REQUEST",
    );
    assert!(parsed[0].conference_url.is_none());
}

#[test]
fn mixed_case_tokens_and_duration() {
    let invite = &parse(
        "dtstart;value=date:20260924\r\nDURATION:P3D\r\nattendee;partstat=accepted:mailto:a@example.com\r\nrrule:FREQ=DAILY",
        "cancel",
    )[0];
    assert_eq!(invite.method, InvitationMethod::Cancel);
    assert_eq!(
        invite.attendees[0].participation_status.as_deref(),
        Some("ACCEPTED")
    );
    assert_eq!(
        invite.end,
        Some(InvitationDateTime::Date {
            value: "2026-09-27".into()
        })
    );
    let invite = &parse(
        "DTSTART;TZID=America/Los_Angeles:20260307T120000\r\nDURATION:P1DT1H",
        "REQUEST",
    )[0];
    assert!(
        matches!(&invite.end, Some(InvitationDateTime::Zoned { value, .. }) if value == "2026-03-08T20:00:00+00:00")
    );
}

#[test]
fn provider_compatibility_resolves_iana_and_windows_zones() {
    for (bytes, resolved) in [
        (
            include_bytes!("../../../fixtures/calendar/google.ics").as_slice(),
            true,
        ),
        (
            include_bytes!("../../../fixtures/calendar/outlook.ics").as_slice(),
            true,
        ),
        (
            include_bytes!("../../../fixtures/calendar/apple.ics").as_slice(),
            false,
        ),
    ] {
        let parsed = parse_invitation_parts(&[bytes]);
        assert_eq!(parsed.len(), 1);
        assert_eq!(
            matches!(parsed[0].start, Some(InvitationDateTime::Zoned { .. })),
            resolved
        );
    }
}

#[test]
fn utc_times_with_unknown_zones_keep_an_iana_zone_and_duration_end() {
    let parsed = parse(
        "DTSTART;TZID=Customized Time Zone:20260924T170000Z\r\nDURATION:PT30M",
        "REQUEST",
    );
    assert!(
        matches!(&parsed[0].start, Some(InvitationDateTime::Zoned { time_zone, .. }) if time_zone == "UTC")
    );
    assert!(
        matches!(&parsed[0].end, Some(InvitationDateTime::Zoned { value, .. }) if value == "2026-09-24T17:30:00+00:00")
    );
}

#[test]
fn windows_zone_table_is_sorted_and_known_to_chrono_tz() {
    let zones = windows_zones::WINDOWS_ZONES;
    assert!(zones.windows(2).all(|pair| pair[0].0 < pair[1].0));
    for (windows, iana) in zones {
        assert!(iana.parse::<chrono_tz::Tz>().is_ok(), "{windows} -> {iana}");
    }
    let parsed = parse(
        "DTSTART;TZID=W. Europe Standard Time:20260924T100000",
        "REQUEST",
    );
    assert!(
        matches!(&parsed[0].start, Some(InvitationDateTime::Zoned { value, time_zone }) if value == "2026-09-24T08:00:00+00:00" && time_zone == "Europe/Berlin")
    );
}
