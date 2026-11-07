use super::*;
use serde_json::json;
fn booking(status: &str, attendance: &str, start: &str) -> Booking {
    serde_json::from_value(json!({
        "id": Uuid::nil(), "eventTypeId": Uuid::nil(), "title": "Meeting", "name": "Guest", "email": "guest@example.com",
        "startsAt": start, "endsAt": "2026-11-01T07:00:00Z", "timeZone": "UTC", "hosts": ["host", "host"],
        "status": status, "attendance": attendance, "rescheduleCount": 2, "location": "Office", "answers": {}
    })).unwrap()
}
fn query() -> InsightQuery {
    InsightQuery {
        from: "2026-11-01".parse().unwrap(),
        to: "2026-11-02".parse().unwrap(),
        time_zone: chrono_tz::America::New_York,
        event_type_id: None,
        host_id: None,
    }
}
#[test]
fn matches_ui_definitions_and_dst_local_dates() {
    let q = query();
    let records = vec![
        booking("confirmed", "unknown", "2026-11-01T05:30:00Z"),
        booking("confirmed", "guestNoShow", "2026-11-01T06:30:00Z"),
        booking("cancelled", "unknown", "2026-11-01T06:30:00Z"),
        booking("failed", "unknown", "2026-11-01T06:30:00Z"),
        booking("processing", "unknown", "2026-11-01T06:30:00Z"),
        booking("confirmed", "unknown", "2026-11-01T03:30:00Z"),
    ];
    let p = period(
        &records,
        &q,
        q.from,
        q.to,
        "2026-11-03T00:00:00Z".parse().unwrap(),
    );
    assert_eq!(p.counts.total, 3);
    assert_eq!(p.counts.completed, 1);
    assert_eq!(p.counts.rescheduled, 3);
    assert_eq!(p.counts.cancelled, 1);
    assert_eq!(p.counts.guest_no_show, 1);
    assert_eq!(p.meeting_minutes, 90.);
    assert_eq!(p.average_minutes, 60.);
    assert_eq!(p.hours[1], 3); // Both instances of the repeated DST hour.
    assert_eq!(p.host_counts["host"], 3); // Duplicate host IDs cannot inflate counts.
    assert_eq!(p.days[&q.to].total, 0);
}
#[test]
fn filters_and_future_meetings_do_not_invent_completion() {
    let mut q = query();
    let records = vec![booking("confirmed", "unknown", "2026-11-01T05:30:00Z")];
    let now = "2026-11-01T00:00:00Z".parse().unwrap();
    assert_eq!(period(&records, &q, q.from, q.to, now).counts.completed, 0);
    q.host_id = Some("other".into());
    assert_eq!(period(&records, &q, q.from, q.to, now).counts.total, 0);
    q.host_id = None;
    q.event_type_id = Some(Uuid::now_v7());
    assert_eq!(period(&records, &q, q.from, q.to, now).counts.total, 0);
}
