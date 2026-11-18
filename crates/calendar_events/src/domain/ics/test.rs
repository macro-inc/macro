use chrono::{NaiveDate, TimeZone, Utc};

use super::{
    CalendarEventExport, CalendarEventExportAccess, ForwardedCopy, IcsParticipant, IcsPurpose,
    JoinLink, content_without_macro_call, render_event_ics,
};
use crate::domain::{
    meeting_links::attach_macro_call,
    models::{ConferenceProvider, EventTime, EventType},
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

    let lines = unfolded(&render_event_ics(&event, IcsPurpose::Share));

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

    let lines = unfolded(&render_event_ics(&event, IcsPurpose::Share));

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

    let lines = unfolded(&render_event_ics(&event, IcsPurpose::Share));

    assert!(lines.contains(&"DTSTART:20260924T233000Z".to_string()));
    assert!(lines.contains(&"DTEND:20260925T000000Z".to_string()));
}

#[test]
fn all_day_event_keeps_the_exclusive_end_date() {
    let lines = unfolded(&render_event_ics(&export(all_day()), IcsPurpose::Share));

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

    let lines = unfolded(&render_event_ics(&event, IcsPurpose::Share));

    assert!(
        lines.contains(&"DESCRIPTION:Agenda:\\nBudget & hiring\\nNotes\\, too".to_string()),
        "{lines:?}"
    );
}

#[test]
fn plain_text_description_keeps_its_line_breaks() {
    let mut event = export(all_day());
    event.description = Some("Dial in first\r\nthen share your screen\n".to_string());

    let lines = unfolded(&render_event_ics(&event, IcsPurpose::Share));

    assert!(lines.contains(&"DESCRIPTION:Dial in first\\nthen share your screen".to_string()));
}

#[test]
fn a_macro_call_leaves_neither_its_join_line_nor_its_link_as_the_location() {
    let mut event = export(all_day());
    let (description, location) =
        attach_macro_call(Some("<p>Bring the budget draft</p>"), None, CALL_URL);
    event.description = Some(description);
    event.location = Some(location);

    let document = render_event_ics(&event, IcsPurpose::Share);
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

    let lines = unfolded(&render_event_ics(&event, IcsPurpose::Share));

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

    let document = render_event_ics(&event, IcsPurpose::Share);
    let lines = unfolded(&document);

    assert!(
        lines.contains(&format!("DESCRIPTION:Last week: {earlier}")),
        "{lines:?}"
    );
    assert!(!document.contains(CALL_URL), "{lines:?}");
}

#[test]
fn only_a_description_holding_the_link_is_reduced_to_plain_text() {
    let rich = "<p>See <a href=\"https://example.com/notes\">the notes</a></p>";
    let (description, location) =
        content_without_macro_call(Some(rich.to_string()), Some(CALL_URL.to_string()));
    assert_eq!(description.as_deref(), Some(rich));
    assert_eq!(location, None);

    // No join line to match here, so only the markup going takes the link.
    let behind_text = format!("<p><a href=\"{CALL_URL}\">Agenda</a></p>");
    let (description, _) = content_without_macro_call(Some(behind_text), None);
    assert!(
        !description.unwrap_or_default().contains("/meet/join/"),
        "the link must not survive in an href"
    );
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

    let lines = unfolded(&render_event_ics(&event, IcsPurpose::Share));

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

    let document = render_event_ics(&event, IcsPurpose::Share);

    for line in document.split("\r\n") {
        assert!(line.len() <= 75, "line exceeds 75 octets: {line:?}");
    }
    assert!(unfolded(&document).contains(&format!("SUMMARY:{}", "é".repeat(80))));
}

fn meet() -> JoinLink {
    JoinLink {
        url: "https://meet.google.com/abc-defg-hij".to_string(),
        provider: Some(ConferenceProvider::GoogleMeet),
    }
}

fn forward_file(join_link: Option<&JoinLink>) -> IcsPurpose<'_> {
    IcsPurpose::Forward {
        join_link,
        invitees: None,
    }
}

#[test]
fn a_share_never_carries_the_join_link() {
    // The .ics download has no conference to name: the export carries none.
    let mut event = export(all_day());
    let (description, location) = attach_macro_call(None, None, CALL_URL);
    event.description = Some(description);
    event.location = Some(location);

    let document = render_event_ics(&event, IcsPurpose::Share);

    assert!(!document.contains("CONFERENCE"));
    assert!(!document.contains("Join"));
    assert!(document.contains("METHOD:PUBLISH"));
}

#[test]
fn a_forward_keeps_the_macro_call_it_would_strip_from_a_share() {
    let mut event = export(all_day());
    let (description, location) =
        attach_macro_call(Some("<p>Bring the budget draft</p>"), None, CALL_URL);
    event.description = Some(description);
    event.location = Some(location);

    let document = render_event_ics(&event, forward_file(None));
    let lines = unfolded(&document);

    assert!(lines.contains(&format!("LOCATION:{CALL_URL}")), "{lines:?}");
    let description = lines
        .iter()
        .find(|line| line.starts_with("DESCRIPTION:"))
        .expect("the description stays");
    assert!(description.contains("Bring the budget draft"), "{lines:?}");
    assert!(
        description.ends_with(&format!("\\nJoin Macro call: {CALL_URL}")),
        "{lines:?}"
    );
    assert!(lines.contains(&"METHOD:PUBLISH".to_string()));
    assert!(!document.contains("ATTENDEE"));
}

#[test]
fn a_forward_names_its_conference_in_the_description_and_as_a_property() {
    let mut event = export(all_day());
    event.description = Some("Agenda".to_string());
    let link = meet();

    let lines = unfolded(&render_event_ics(&event, forward_file(Some(&link))));

    assert!(
        lines.contains(
            &"DESCRIPTION:Agenda\\n\\nJoin with Google Meet: https://meet.google.com/abc-defg-hij"
                .to_string()
        ),
        "{lines:?}"
    );
    assert!(
        lines.contains(&"X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij".to_string())
    );
    assert!(lines.contains(
        &"CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://meet.google.com/abc-defg-hij".to_string()
    ));
}

#[test]
fn a_forward_does_not_repeat_a_link_the_description_already_shows() {
    let mut event = export(all_day());
    event.description =
        Some("Microsoft Teams meeting\nJoin: https://teams.microsoft.com/l/meetup-join/abc".into());
    let link = JoinLink {
        url: "https://teams.microsoft.com/l/meetup-join/abc".to_string(),
        provider: Some(ConferenceProvider::MicrosoftTeams),
    };

    let document = render_event_ics(&event, forward_file(Some(&link)));
    let lines = unfolded(&document);

    assert!(
        lines.contains(
            &"DESCRIPTION:Microsoft Teams meeting\\nJoin: https://teams.microsoft.com/l/meetup-join/abc"
                .to_string()
        ),
        "{lines:?}"
    );
    assert!(!document.contains("X-GOOGLE-CONFERENCE"));
    assert!(
        lines.contains(
            &"CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://teams.microsoft.com/l/meetup-join/abc"
                .to_string()
        )
    );
}

#[test]
fn a_conference_that_is_not_a_web_link_is_left_out() {
    let event = export(all_day());
    let link = JoinLink {
        url: "tel:+1-555-0100".to_string(),
        provider: Some(ConferenceProvider::Other),
    };

    let document = render_event_ics(&event, forward_file(Some(&link)));

    assert!(!document.contains("tel:"));
    assert!(!document.contains("CONFERENCE"));
}

#[test]
fn an_invitation_names_only_the_invitees_answerable_to_the_organizer() {
    let event = export(all_day());
    let invitees = [
        IcsParticipant {
            email: "friend@example.net".to_string(),
            name: Some("Friend, \"Best\"".to_string()),
        },
        IcsParticipant {
            email: "other@example.net".to_string(),
            name: None,
        },
    ];

    let lines = unfolded(&render_event_ics(
        &event,
        IcsPurpose::Forward {
            join_link: None,
            invitees: Some(&invitees),
        },
    ));

    assert!(lines.contains(&"METHOD:REQUEST".to_string()));
    assert!(lines.contains(
        &"ORGANIZER;CN=\"Ada 'The' Organizer\":mailto:organizer@example.com".to_string()
    ));
    let attendees: Vec<&String> = lines
        .iter()
        .filter(|line| line.starts_with("ATTENDEE"))
        .collect();
    assert_eq!(
        attendees,
        [
            "ATTENDEE;CN=\"Friend, 'Best'\";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:friend@example.net",
            "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:other@example.net",
        ]
    );
}

fn outside_copy() -> ForwardedCopy {
    ForwardedCopy {
        google_private_copy: true,
        is_snapshot: false,
        join_link: None,
    }
}

#[test]
fn a_private_copy_of_an_outside_meeting_names_its_organizer() {
    let mut event = export(all_day());
    event.ical_uid = "040000008200E00074C5B7101A82E0080000000080F2".to_string();

    let organizer = outside_copy()
        .outside_organizer(&event)
        .expect("Google keeps an outside organizer's invitation as a private copy");

    assert_eq!(organizer.email, "organizer@example.com");
    assert_eq!(organizer.name.as_deref(), Some("Ada \"The\" Organizer"));
}

#[test]
fn anything_short_of_an_outside_private_copy_names_no_organizer() {
    let mut outside = export(all_day());
    outside.ical_uid = "evt-123@scheduler.example".to_string();
    let mut google_meeting = outside.clone();
    google_meeting.ical_uid = "abc123@google.com".to_string();
    let mut unnamed = outside.clone();
    unnamed.organizer_email = Some("  ".to_string());

    assert_eq!(
        ForwardedCopy {
            google_private_copy: false,
            ..outside_copy()
        }
        .outside_organizer(&outside),
        None
    );
    assert_eq!(
        ForwardedCopy {
            is_snapshot: true,
            ..outside_copy()
        }
        .outside_organizer(&outside),
        None
    );
    assert_eq!(outside_copy().outside_organizer(&google_meeting), None);
    assert_eq!(outside_copy().outside_organizer(&unnamed), None);
    assert!(outside_copy().outside_organizer(&outside).is_some());
}
