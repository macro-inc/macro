use chrono::TimeZone;
use uuid::Uuid;

use super::*;

fn received() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 1, 9, 0, 0).unwrap()
}

fn fallback() -> DateTime<Utc> {
    received() + Duration::days(FALLBACK_HOLD_DAYS)
}

fn zoned(value: &str) -> Option<InvitationDateTime> {
    Some(InvitationDateTime::Zoned {
        value: value.to_owned(),
        time_zone: "America/New_York".to_owned(),
    })
}

fn date(value: &str) -> Option<InvitationDateTime> {
    Some(InvitationDateTime::Date {
        value: value.to_owned(),
    })
}

fn invite(method: InvitationMethod, sequence: u32) -> CalendarInvitation {
    CalendarInvitation {
        id: "component".to_owned(),
        uid: "event@example.test".to_owned(),
        method,
        sequence,
        dtstamp: None,
        last_modified: None,
        status: None,
        recurrence_id: None,
        recurrence_id_raw: None,
        title: None,
        organizer: None,
        attendees: Vec::new(),
        comment: None,
        location: None,
        description: None,
        start: zoned("2026-11-05T10:00:00-05:00"),
        end: zoned("2026-11-05T11:00:00-05:00"),
        recurrence: Some(Vec::new()),
        conference_url: None,
    }
}

fn message(subject: &str, calendar_part: Option<CalendarPart>) -> FocusMessage {
    FocusMessage {
        id: Uuid::new_v4(),
        at: received(),
        is_sent: false,
        from_email: None,
        from_name: None,
        to: Vec::new(),
        cc: Vec::new(),
        subject: Some(subject.to_owned()),
        has_attachments: false,
        bulk: false,
        calendar_part,
        body: None,
        snippet: None,
    }
}

fn until(part: Option<CalendarPart>) -> DateTime<Utc> {
    match part {
        Some(CalendarPart::Change { until }) => until,
        other => panic!("expected a change, got {other:?}"),
    }
}

#[test]
fn subjects_tell_changes_from_new_invites_and_rsvps() {
    for subject in [
        "Updated invitation: Standup @ Mon",
        "Updated invitation with note: Scoping/Planning",
        "Canceled event: Standup @ Fri",
        "CANCELLED: Prod Deploy",
        "Rescheduled: Demo @ Thu",
        "Rescheduled : spaced colon",
        "Proposed new time: Demo @ Thu",
    ] {
        assert_eq!(
            notice_in_subject(subject, fallback()),
            Some(CalendarNotice::Change { until: fallback() }),
            "{subject}"
        );
    }
    for subject in [
        "Invitation: Standup @ Mon",
        "Invitation : spaced colon",
        "NEW EVENT: Offsite",
    ] {
        assert_eq!(
            notice_in_subject(subject, fallback()),
            Some(CalendarNotice::NewInvite),
            "{subject}"
        );
    }
    for subject in [
        "Accepted: Demo @ Fri Aug 7, 2026",
        "Tentatively Accepted: Sync Team Meet",
        "Tentative: Standup",
        "DECLINED: Prod Deploy",
    ] {
        assert_eq!(
            notice_in_subject(subject, fallback()),
            Some(CalendarNotice::Rsvp),
            "{subject}"
        );
    }
    for subject in [
        "Re: Invitation: thoughts on the deck",
        "Re: Rescheduled: Demo @ Thu",
        "Invitations for the launch party",
        "Can we reschedule Tuesday?",
        "Greg x Teo",
        "",
    ] {
        assert_eq!(notice_in_subject(subject, fallback()), None, "{subject}");
    }
}

#[test]
fn a_saved_change_or_rsvp_decides_whatever_the_subject_says() {
    let change = CalendarPart::Change { until: fallback() };
    assert_eq!(
        notice_in_message(&message("Moved: Demo", Some(change))),
        Some(CalendarNotice::Change { until: fallback() })
    );
    assert_eq!(
        notice_in_message(&message("Invitation: Demo", Some(change))),
        Some(CalendarNotice::Change { until: fallback() })
    );
    // An RSVP in another language has no subject prefix to match.
    assert_eq!(
        notice_in_message(&message("Aceptada: Demo", Some(CalendarPart::Rsvp))),
        Some(CalendarNotice::Rsvp)
    );
    assert_eq!(
        notice_in_message(&message("Rescheduled: Demo", Some(CalendarPart::Rsvp))),
        Some(CalendarNotice::Rsvp)
    );
}

#[test]
fn a_new_invite_or_unread_file_reads_as_its_subject_or_as_new() {
    let event_end = received() + Duration::days(30);
    for (part, until) in [
        (CalendarPart::NewInvite { until: event_end }, event_end),
        (CalendarPart::Unparsed, fallback()),
    ] {
        assert_eq!(
            notice_in_message(&message("See you there", Some(part))),
            Some(CalendarNotice::NewInvite),
            "{part:?}"
        );
        // Not every tool bumps the sequence; a change subject is enough, and the
        // saved event's own time still decides how long it holds.
        assert_eq!(
            notice_in_message(&message("Rescheduled: Demo", Some(part))),
            Some(CalendarNotice::Change { until }),
            "{part:?}"
        );
        assert_eq!(
            notice_in_message(&message("Accepted: Demo", Some(part))),
            Some(CalendarNotice::Rsvp),
            "{part:?}"
        );
    }
    assert_eq!(notice_in_message(&message("Plain mail", None)), None);
    assert_eq!(
        notice_in_message(&message("Rescheduled: Demo", None)),
        Some(CalendarNotice::Change { until: fallback() })
    );
}

#[test]
fn saved_methods_tell_changes_from_new_invites_and_rsvps() {
    let event_end = Utc.with_ymd_and_hms(2026, 11, 5, 16, 0, 0).unwrap();
    for change in [
        invite(InvitationMethod::Request, 1),
        invite(InvitationMethod::Cancel, 0),
        invite(InvitationMethod::Counter, 0),
    ] {
        assert_eq!(
            CalendarPart::from_saved(&[change], received()),
            Some(CalendarPart::Change { until: event_end })
        );
    }
    for new in [
        invite(InvitationMethod::Request, 0),
        invite(InvitationMethod::Publish, 3),
        invite(InvitationMethod::Unknown, 3),
    ] {
        assert_eq!(
            CalendarPart::from_saved(&[new], received()),
            Some(CalendarPart::NewInvite { until: event_end })
        );
    }
    assert_eq!(
        CalendarPart::from_saved(&[invite(InvitationMethod::Reply, 2)], received()),
        Some(CalendarPart::Rsvp)
    );
    assert_eq!(CalendarPart::from_saved(&[], received()), None);
    // A reply next to an invite doesn't make the message an RSVP.
    assert_eq!(
        CalendarPart::from_saved(
            &[
                invite(InvitationMethod::Reply, 0),
                invite(InvitationMethod::Request, 0)
            ],
            received()
        ),
        Some(CalendarPart::NewInvite { until: event_end })
    );
}

#[test]
fn a_change_holds_until_the_last_changed_event_is_over() {
    let mut later = invite(InvitationMethod::Request, 2);
    later.end = zoned("2026-11-09T11:00:00-05:00");
    // A new event beside it doesn't count, however far ahead.
    let mut unchanged = invite(InvitationMethod::Request, 0);
    unchanged.end = zoned("2027-01-01T00:00:00Z");
    assert_eq!(
        until(CalendarPart::from_saved(
            &[invite(InvitationMethod::Cancel, 0), later, unchanged],
            received()
        )),
        Utc.with_ymd_and_hms(2026, 11, 9, 16, 0, 0).unwrap()
    );
}

#[test]
fn a_change_uses_the_events_end_else_its_start() {
    let mut no_end = invite(InvitationMethod::Cancel, 0);
    no_end.end = None;
    assert_eq!(
        until(CalendarPart::from_saved(&[no_end], received())),
        Utc.with_ymd_and_hms(2026, 11, 5, 15, 0, 0).unwrap()
    );

    let mut unresolved_end = invite(InvitationMethod::Cancel, 0);
    unresolved_end.end = Some(InvitationDateTime::Unresolved {
        value: "2026-11-05T11:00:00".to_owned(),
        time_zone: None,
    });
    assert_eq!(
        until(CalendarPart::from_saved(&[unresolved_end], received())),
        Utc.with_ymd_and_hms(2026, 11, 5, 15, 0, 0).unwrap()
    );
}

#[test]
fn an_all_day_event_is_over_once_its_day_has_ended_everywhere() {
    // The end date is exclusive: this event lasts the 5th.
    let mut all_day = invite(InvitationMethod::Request, 1);
    all_day.start = date("2026-11-05");
    all_day.end = date("2026-11-06");
    assert_eq!(
        until(CalendarPart::from_saved(&[all_day], received())),
        Utc.with_ymd_and_hms(2026, 11, 6, 12, 0, 0).unwrap()
    );

    let mut start_only = invite(InvitationMethod::Request, 1);
    start_only.start = date("2026-11-05");
    start_only.end = None;
    assert_eq!(
        until(CalendarPart::from_saved(&[start_only], received())),
        Utc.with_ymd_and_hms(2026, 11, 6, 12, 0, 0).unwrap()
    );
}

#[test]
fn a_change_with_no_single_end_holds_for_the_fallback() {
    let mut recurring = invite(InvitationMethod::Request, 1);
    recurring.recurrence = Some(vec!["RRULE:FREQ=WEEKLY".to_owned()]);
    let mut from_before_recurrence_was_saved = invite(InvitationMethod::Request, 1);
    from_before_recurrence_was_saved.recurrence = None;
    let mut unresolved = invite(InvitationMethod::Request, 1);
    let wall_time = InvitationDateTime::Unresolved {
        value: "2026-11-05T11:00:00".to_owned(),
        time_zone: Some("Mars/Olympus".to_owned()),
    };
    unresolved.start = Some(wall_time.clone());
    unresolved.end = Some(wall_time);
    let mut no_times = invite(InvitationMethod::Cancel, 0);
    no_times.start = None;
    no_times.end = None;
    let mut unreadable = invite(InvitationMethod::Cancel, 0);
    unreadable.start = zoned("not a time");
    unreadable.end = date("not a date");
    for change in [
        recurring,
        from_before_recurrence_was_saved,
        unresolved,
        no_times,
        unreadable,
    ] {
        assert_eq!(
            until(CalendarPart::from_saved(&[change], received())),
            fallback()
        );
    }

    // One occurrence of a series has its own end.
    let mut occurrence = invite(InvitationMethod::Cancel, 0);
    occurrence.recurrence_id = zoned("2026-11-05T10:00:00-05:00");
    assert_eq!(
        until(CalendarPart::from_saved(&[occurrence], received())),
        Utc.with_ymd_and_hms(2026, 11, 5, 16, 0, 0).unwrap()
    );
}

#[test]
fn the_sweeps_pattern_matches_every_change_prefix_and_nothing_else() {
    let pattern = change_subject_pattern();
    assert!(pattern.starts_with("^("));
    assert!(pattern.ends_with(r")\s*:"));
    for prefix in CHANGE_PREFIXES {
        assert!(pattern.contains(prefix), "{prefix}");
    }
    for prefix in NEW_INVITE_PREFIXES.iter().chain(&RSVP_PREFIXES) {
        assert!(
            !pattern.split(['(', '|', ')']).any(|form| form == *prefix),
            "{prefix}"
        );
    }
}
