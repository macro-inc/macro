use super::*;
use crate::domain::{
    models::{
        AttendeeResponseStatus, CalendarAttendee, CalendarEvent, CalendarEventOverride,
        CalendarOccurrence, EventReminders, EventStart, EventStatus, EventTransparency, EventType,
        EventVisibility,
    },
    team::{TeamCalendarMember, TeamCalendarSharing},
};
use chrono::Duration;
use uuid::Uuid;

fn instant(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

fn range(start: &str, end: &str) -> OccurrenceRange {
    let starts_at = instant(start);
    let ends_at = instant(end);
    OccurrenceRange {
        starts_at,
        ends_at,
        start_date: starts_at.date_naive(),
        end_date: ends_at.date_naive().succ_opt().unwrap(),
    }
}

fn window() -> OccurrenceRange {
    range("2026-10-07T09:00:00Z", "2026-10-07T17:00:00Z")
}

fn timed(start: &str, end: &str) -> EventTime {
    EventTime::Timed {
        starts_at: instant(start),
        ends_at: instant(end),
        time_zone: None,
    }
}

fn all_day(start: &str, end: &str) -> EventTime {
    EventTime::AllDay {
        start_date: start.parse().unwrap(),
        end_date: end.parse().unwrap(),
    }
}

fn span(start: &str, end: &str) -> AvailabilityInterval {
    AvailabilityInterval {
        start: instant(start),
        end: instant(end),
    }
}

fn member(user_id: &str) -> TeamCalendarMember {
    TeamCalendarMember {
        user_id: user_id.to_string(),
        sharing: TeamCalendarSharing::BusyOnly,
        coverage: TeamCalendarCoverage::Ready,
    }
}

fn source(user_id: &str, uid: &str, time: EventTime) -> TeamSourceOccurrence {
    let id = Uuid::now_v7();
    let calendar_id = Uuid::now_v7();
    let event = CalendarEvent {
        id,
        owner_id: user_id.into(),
        ical_uid: uid.into(),
        calendar_id: Some(calendar_id),
        sources: vec![],
        title: "Sensitive title that availability must not expose".into(),
        description: Some("Sensitive description".into()),
        location: Some("Sensitive location".into()),
        status: EventStatus::Confirmed,
        visibility: EventVisibility::Private,
        transparency: EventTransparency::Opaque,
        event_type: EventType::Default,
        time: time.clone(),
        recurrence_lines: vec![],
        organizer_email: None,
        organizer_name: None,
        creator_email: None,
        creator_name: None,
        conference_url: None,
        conference_provider: None,
        sequence: 0,
        is_read_only: false,
        attendees: vec![],
        reminders: EventReminders::default(),
        created_at: instant("2026-10-01T00:00:00Z"),
        updated_at: instant("2026-10-01T00:00:00Z"),
    };
    TeamSourceOccurrence {
        shared_by: user_id.into(),
        source_id: Uuid::now_v7(),
        calendar_id,
        calendar_name: "Source name must not escape".into(),
        calendar_time_zone: Some("UTC".into()),
        contributes_to_availability: true,
        owner_emails: vec![format!("{user_id}@example.com")],
        occurrence: CalendarOccurrence {
            event_id: id,
            occurrence_key: time.occurrence_key(),
            recurrence_id: None,
            time,
            is_cancelled: false,
        },
        event,
        overrides: vec![],
    }
}

fn attendee(email: &str, response_status: AttendeeResponseStatus) -> CalendarAttendee {
    CalendarAttendee {
        email: email.into(),
        display_name: None,
        response_status,
        is_organizer: false,
        is_optional: false,
        is_self: true,
        comment: None,
    }
}

fn inputs(
    members: Vec<TeamCalendarMember>,
    sources: Vec<TeamSourceOccurrence>,
) -> TeamAvailabilitySources {
    TeamAvailabilitySources {
        members,
        sources,
        complete: true,
        unknown_user_ids: vec![],
    }
}

#[test]
fn skipped_all_day_date_is_unknown_instead_of_becoming_a_timed_point() {
    let mut row = source("a", "skipped-day", all_day("2011-12-30", "2011-12-31"));
    row.calendar_time_zone = Some("Pacific/Apia".to_owned());
    let result = calculate(
        range("2011-12-29T00:00:00Z", "2012-01-01T00:00:00Z"),
        inputs(vec![member("a")], vec![row]),
    );
    assert!(!result.complete);
    assert!(result.free_windows.is_none());
    assert_eq!(
        result.members[0].unknown_reasons,
        vec![AvailabilityUnknownReason::InvalidInterval]
    );
}

#[test]
fn points_add_no_busy_duration_but_cannot_erase_a_conflicting_positive_copy() {
    let point = source(
        "a",
        "same-identity",
        timed("2026-10-07T09:00:00Z", "2026-10-07T09:00:00Z"),
    );
    let only_points = calculate(
        window(),
        inputs(vec![member("a")], vec![point.clone(), point.clone()]),
    );
    assert!(only_points.complete);
    assert!(only_points.members[0].busy.is_empty());
    assert_eq!(
        only_points.free_windows.unwrap(),
        vec![span("2026-10-07T09:00:00Z", "2026-10-07T17:00:00Z")]
    );

    let positive = source(
        "a",
        "same-identity",
        timed("2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z"),
    );
    for copies in [vec![point.clone(), positive.clone()], vec![positive, point]] {
        let conflict = calculate(window(), inputs(vec![member("a")], copies));
        assert!(!conflict.complete);
        assert!(conflict.free_windows.is_none());
        assert_eq!(
            conflict.members[0].busy,
            vec![span("2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z")]
        );
        assert_eq!(
            conflict.members[0].unknown_reasons,
            vec![AvailabilityUnknownReason::ConflictingCopies]
        );
    }
}

#[test]
fn point_series_master_does_not_hide_a_positive_occurrence() {
    let mut row = source(
        "a",
        "series",
        timed("2026-10-07T10:00:00Z", "2026-10-07T11:00:00Z"),
    );
    row.event.time = timed("2026-10-07T09:00:00Z", "2026-10-07T09:00:00Z");
    row.event.recurrence_lines = vec!["RRULE:FREQ=DAILY".into()];
    row.occurrence.recurrence_id = Some("2026-10-07T09:00:00Z".into());
    let result = calculate(window(), inputs(vec![member("a")], vec![row]));
    assert!(result.complete);
    assert_eq!(
        result.members[0].busy,
        vec![span("2026-10-07T10:00:00Z", "2026-10-07T11:00:00Z")]
    );
}

#[test]
fn merges_busy_copies_and_clips_common_free_to_requested_range() {
    let first = source(
        "a",
        "one",
        timed("2026-10-07T08:00:00Z", "2026-10-07T10:00:00Z"),
    );
    let duplicate = first.clone();
    let second = source(
        "b",
        "two",
        timed("2026-10-07T10:00:00Z", "2026-10-07T11:00:00Z"),
    );
    let last = source(
        "a",
        "three",
        timed("2026-10-07T16:00:00Z", "2026-10-07T18:00:00Z"),
    );
    let result = calculate(
        window(),
        inputs(
            vec![member("a"), member("b")],
            vec![first, duplicate, second, last],
        ),
    );
    assert!(result.complete);
    assert_eq!(
        result.members[0].busy,
        vec![
            span("2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z"),
            span("2026-10-07T16:00:00Z", "2026-10-07T17:00:00Z")
        ]
    );
    assert_eq!(
        result.free_windows,
        Some(vec![span("2026-10-07T11:00:00Z", "2026-10-07T16:00:00Z")])
    );
    let serialized = serde_json::to_string(&result).unwrap();
    assert!(!serialized.contains("Sensitive"));
    assert!(!serialized.contains("Source name"));
}

#[test]
fn subscriptions_do_not_block_owner_but_owned_attendance_does() {
    let mut subscribed = source(
        "a",
        "coworker",
        timed("2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z"),
    );
    subscribed.contributes_to_availability = false;
    // Provider self refers to the subscribed calendar, not necessarily its
    // Macro viewer. Only an owned address establishes personal attendance.
    subscribed.event.attendees = vec![attendee(
        "coworker@example.com",
        AttendeeResponseStatus::Accepted,
    )];
    let mut attending = subscribed.clone();
    attending.event.ical_uid = "attending".into();
    attending.event.attendees = vec![attendee("A@EXAMPLE.COM", AttendeeResponseStatus::Accepted)];
    attending.occurrence.time = timed("2026-10-07T12:00:00Z", "2026-10-07T13:00:00Z");
    let result = calculate(
        window(),
        inputs(vec![member("a")], vec![subscribed, attending]),
    );
    assert_eq!(
        result.members[0].busy,
        vec![span("2026-10-07T12:00:00Z", "2026-10-07T13:00:00Z")]
    );
}

#[test]
fn declined_cancelled_transparent_and_informational_events_do_not_block() {
    let base = source(
        "a",
        "event",
        timed("2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z"),
    );
    let mut declined = base.clone();
    declined.event.attendees = vec![attendee("a@example.com", AttendeeResponseStatus::Declined)];
    let mut cancelled = base.clone();
    cancelled.occurrence.is_cancelled = true;
    let mut transparent = base.clone();
    transparent.event.transparency = EventTransparency::Transparent;
    let mut working_location = base.clone();
    working_location.event.event_type = EventType::WorkingLocation;
    let mut birthday = base;
    birthday.event.event_type = EventType::Birthday;
    let result = calculate(
        window(),
        inputs(
            vec![member("a")],
            vec![declined, cancelled, transparent, working_location, birthday],
        ),
    );
    assert!(result.members[0].busy.is_empty());
    assert_eq!(
        result.free_windows,
        Some(vec![span("2026-10-07T09:00:00Z", "2026-10-07T17:00:00Z")])
    );
}

#[test]
fn occurrence_response_overrides_master_response() {
    let mut row = source(
        "a",
        "series",
        timed("2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z"),
    );
    row.event.attendees = vec![attendee("a@example.com", AttendeeResponseStatus::Accepted)];
    row.occurrence.recurrence_id = Some("2026-10-07T09:00:00+00:00".into());
    row.overrides = vec![CalendarEventOverride {
        visibility: None,
        transparency: None,
        sequence: None,
        source_updated_at: None,
        recurrence_id: row.occurrence.recurrence_id.clone().unwrap(),
        original_time: EventStart::Timed(instant("2026-10-07T09:00:00Z")),
        time: row.occurrence.time.clone(),
        title: None,
        description: None,
        location: None,
        status: None,
        attendees: Some(vec![attendee(
            "a@example.com",
            AttendeeResponseStatus::Declined,
        )]),
    }];
    let result = calculate(window(), inputs(vec![member("a")], vec![row]));
    assert!(result.complete);
    assert!(result.members[0].busy.is_empty());
}

#[test]
fn instance_transparency_controls_busy_time_and_private_series_stays_private() {
    let mut row = source(
        "a",
        "series",
        timed("2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z"),
    );
    let original = EventStart::Timed(instant("2026-10-07T09:00:00Z"));
    row.occurrence.recurrence_id = Some(original.occurrence_key());
    row.overrides = vec![CalendarEventOverride {
        sequence: None,
        source_updated_at: None,
        recurrence_id: original.occurrence_key(),
        original_time: original,
        time: row.occurrence.time.clone(),
        title: None,
        description: None,
        location: None,
        status: None,
        visibility: Some(EventVisibility::Public),
        transparency: Some(EventTransparency::Transparent),
        attendees: None,
    }];
    assert_eq!(row.visibility(), EventVisibility::Private);
    let result = calculate(window(), inputs(vec![member("a")], vec![row.clone()]));
    assert!(result.complete);
    assert!(result.members[0].busy.is_empty());
    row.event.transparency = EventTransparency::Transparent;
    row.overrides[0].transparency = Some(EventTransparency::Opaque);
    let result = calculate(window(), inputs(vec![member("a")], vec![row]));
    assert_eq!(result.members[0].busy.len(), 1);
}

#[test]
fn all_day_uses_each_sources_zone_and_dst_duration() {
    let range = range("2026-03-07T00:00:00Z", "2026-03-10T00:00:00Z");
    let mut la = source("a", "la", all_day("2026-03-08", "2026-03-09"));
    la.calendar_time_zone = Some("America/Los_Angeles".into());
    let mut tokyo = source("b", "tokyo", all_day("2026-03-08", "2026-03-09"));
    tokyo.calendar_time_zone = Some("Asia/Tokyo".into());
    let result = calculate(
        range,
        inputs(vec![member("a"), member("b")], vec![la, tokyo]),
    );
    assert_eq!(
        result.members[0].busy,
        vec![span("2026-03-08T08:00:00Z", "2026-03-09T07:00:00Z")]
    );
    assert_eq!(
        result.members[1].busy,
        vec![span("2026-03-07T15:00:00Z", "2026-03-08T15:00:00Z")]
    );
}

#[test]
fn civil_midnight_gap_and_fall_back_are_exact() {
    let gap = interval(
        &all_day("2018-11-04", "2018-11-05"),
        Some("America/Sao_Paulo"),
    )
    .unwrap();
    assert_eq!(gap, span("2018-11-04T03:00:00Z", "2018-11-05T02:00:00Z"));
    let fall = interval(
        &all_day("2026-11-01", "2026-11-02"),
        Some("America/Los_Angeles"),
    )
    .unwrap();
    assert_eq!(fall, span("2026-11-01T07:00:00Z", "2026-11-02T08:00:00Z"));
}

#[test]
fn missing_or_invalid_source_zones_prevent_free_claims() {
    for (zone, reason) in [
        (None, AvailabilityUnknownReason::MissingTimeZone),
        (
            Some("not/a-zone"),
            AvailabilityUnknownReason::InvalidTimeZone,
        ),
    ] {
        let mut row = source("a", "all-day", all_day("2026-10-07", "2026-10-08"));
        row.calendar_time_zone = zone.map(str::to_string);
        let result = calculate(window(), inputs(vec![member("a")], vec![row]));
        assert!(!result.complete);
        assert_eq!(result.free_windows, None);
        assert_eq!(result.members[0].unknown_reasons, vec![reason]);
        assert!(
            !serde_json::to_value(&result)
                .unwrap()
                .as_object()
                .unwrap()
                .contains_key("freeWindows")
        );
    }
}

#[test]
fn hidden_unavailable_unknown_and_truncated_never_produce_free_windows() {
    for coverage in [
        TeamCalendarCoverage::Hidden,
        TeamCalendarCoverage::Unavailable,
    ] {
        let mut person = member("a");
        person.coverage = coverage;
        let result = calculate(window(), inputs(vec![person], vec![]));
        assert!(!result.complete);
        assert!(result.free_windows.is_none());
    }
    let mut unknown = inputs(vec![member("a")], vec![]);
    unknown.unknown_user_ids = vec!["outside-team".into()];
    let result = calculate(window(), unknown);
    assert!(result.free_windows.is_none());
    assert!(result.members[0].unknown_reasons.is_empty());
    let mut truncated = inputs(vec![member("a")], vec![]);
    truncated.complete = false;
    let result = calculate(window(), truncated);
    assert!(result.free_windows.is_none());
    assert_eq!(
        result.members[0].unknown_reasons,
        vec![AvailabilityUnknownReason::Truncated]
    );
    assert!(
        calculate(window(), inputs(vec![], vec![]))
            .free_windows
            .is_none()
    );
}

#[test]
fn self_sharing_none_does_not_hide_a_direct_ready_source() {
    let mut person = member("a");
    person.sharing = TeamCalendarSharing::None;
    let row = source(
        "a",
        "event",
        timed("2026-10-07T12:00:00Z", "2026-10-07T13:00:00Z"),
    );
    let result = calculate(window(), inputs(vec![person], vec![row]));
    assert!(result.complete);
    assert_eq!(result.members[0].busy.len(), 1);
}

#[test]
fn source_rows_cannot_expand_the_authorized_member_set() {
    let row = source(
        "outsider",
        "secret",
        timed("2026-10-07T09:00:00Z", "2026-10-07T17:00:00Z"),
    );
    let result = calculate(window(), inputs(vec![member("a")], vec![row]));
    assert_eq!(result.members.len(), 1);
    assert!(result.members[0].busy.is_empty());
}

#[test]
fn moved_copies_deduplicate_by_original_occurrence_and_conflicts_are_unknown() {
    let mut first = source(
        "a",
        "series",
        timed("2026-10-07T12:00:00Z", "2026-10-07T13:00:00Z"),
    );
    first.event.recurrence_lines = vec!["RRULE:FREQ=DAILY".into()];
    first.occurrence.occurrence_key = "2026-10-07T09:00:00+00:00".into();
    first.occurrence.recurrence_id = Some(first.occurrence.occurrence_key.clone());
    let second = first.clone();
    let result = calculate(
        window(),
        inputs(vec![member("a")], vec![first.clone(), second]),
    );
    assert!(result.complete);
    assert_eq!(result.members[0].busy.len(), 1);
    let mut conflicting = first.clone();
    conflicting.occurrence.time = timed("2026-10-07T14:00:00Z", "2026-10-07T15:00:00Z");
    let result = calculate(
        window(),
        inputs(vec![member("a")], vec![first, conflicting]),
    );
    assert_eq!(result.members[0].busy.len(), 2);
    assert_eq!(
        result.members[0].unknown_reasons,
        vec![AvailabilityUnknownReason::ConflictingCopies]
    );
    assert!(result.free_windows.is_none());
}

#[test]
fn output_truncation_preserves_known_busy_but_never_claims_free() {
    let range = range("2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z");
    let rows = (0..=BUSY_INTERVALS_MAX)
        .map(|index| {
            let start = range.starts_at + Duration::minutes(index as i64 * 2);
            source(
                "a",
                &format!("event-{index}"),
                EventTime::Timed {
                    starts_at: start,
                    ends_at: start + Duration::minutes(1),
                    time_zone: None,
                },
            )
        })
        .collect();
    let result = calculate(range, inputs(vec![member("a")], rows));
    assert_eq!(result.members[0].busy.len(), BUSY_INTERVALS_MAX);
    assert_eq!(
        result.members[0].unknown_reasons,
        vec![AvailabilityUnknownReason::Truncated]
    );
    assert!(result.free_windows.is_none());
}
