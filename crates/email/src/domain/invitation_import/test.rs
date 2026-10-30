use super::*;
use crate::domain::{
    calendar_invitation_parser::parse_invitation_parts, invitation_resolution::ThreadInvitation,
};
use entity_access::domain::models::EntityType;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::sync::Mutex;

fn parse(method: &str, event: &str) -> CalendarInvitation {
    let bytes = format!(
        "BEGIN:VCALENDAR\r\nMETHOD:{method}\r\nBEGIN:VEVENT\r\nUID:meeting@example.com\r\nSEQUENCE:2\r\nSUMMARY:Planning\r\nORGANIZER;CN=Alex:mailto:alex@example.com\r\n{event}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    );
    parse_invitation_parts(&[bytes.as_bytes()]).remove(0)
}

struct Snapshots(Vec<ThreadInvitation>);

impl InvitationSnapshotRepository for Snapshots {
    async fn thread_invitations(
        &self,
        _thread_id: Uuid,
        _limit: i64,
    ) -> Result<Vec<ThreadInvitation>, Report> {
        Ok(self
            .0
            .iter()
            .map(|saved| ThreadInvitation {
                message_id: saved.message_id,
                link_id: saved.link_id,
                invitation: saved.invitation.clone(),
            })
            .collect())
    }
}

#[derive(Default)]
struct Importer {
    imported: Mutex<Vec<(String, EventSnapshot, Option<Uuid>)>>,
}

impl CalendarSnapshotImporter for Importer {
    async fn import_snapshot(
        &self,
        requester_id: &str,
        snapshot: EventSnapshot,
        calendar_id: Option<Uuid>,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        self.imported
            .lock()
            .unwrap()
            .push((requester_id.to_string(), snapshot, calendar_id));
        Err(CalendarMutationError::AlreadyOnCalendar)
    }
}

fn receipt(thread_id: Uuid) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::try_from_email("reader@example.com").unwrap(),
        &thread_id.to_string(),
        EntityType::EmailThread,
    )
}

#[test]
fn a_published_series_keeps_its_zone_recurrence_and_organizer() {
    let invite = parse(
        "PUBLISH",
        "DTSTART;TZID=America/New_York:20261026T090000\r\nDTEND;TZID=America/New_York:20261026T093000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO",
    );

    let snapshot = event_snapshot(&invite).unwrap();

    assert_eq!(snapshot.ical_uid, "meeting@example.com");
    assert_eq!(snapshot.sequence, 2);
    assert_eq!(snapshot.title, "Planning");
    assert_eq!(snapshot.recurrence_lines, ["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
    assert_eq!(
        snapshot.organizer_email.as_deref(),
        Some("alex@example.com")
    );
    assert_eq!(snapshot.organizer_name.as_deref(), Some("Alex"));
    assert_eq!(
        snapshot.time,
        EventTime::Timed {
            starts_at: "2026-10-26T13:00:00Z".parse().unwrap(),
            ends_at: "2026-10-26T13:30:00Z".parse().unwrap(),
            time_zone: Some("America/New_York".to_string()),
        }
    );
}

#[test]
fn a_date_without_an_end_lasts_one_day_and_a_timed_start_without_one_is_a_point() {
    let all_day = event_snapshot(&parse("PUBLISH", "DTSTART;VALUE=DATE:20261026")).unwrap();
    assert_eq!(
        all_day.time,
        EventTime::AllDay {
            start_date: NaiveDate::from_ymd_opt(2026, 10, 26).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 10, 27).unwrap(),
        }
    );
    let point = event_snapshot(&parse("PUBLISH", "DTSTART:20261026T130000Z")).unwrap();
    assert_eq!(
        point.time,
        EventTime::Timed {
            starts_at: "2026-10-26T13:00:00Z".parse().unwrap(),
            ends_at: "2026-10-26T13:00:00Z".parse().unwrap(),
            time_zone: Some("UTC".to_string()),
        }
    );
}

#[test]
fn only_a_whole_published_event_with_a_readable_time_can_be_added() {
    let timed = "DTSTART:20261026T130000Z\r\nDTEND:20261026T140000Z";
    assert!(event_snapshot(&parse("REQUEST", timed)).is_err());
    assert!(event_snapshot(&parse("PUBLISH", &format!("{timed}\r\nSTATUS:CANCELLED"))).is_err());
    assert!(
        event_snapshot(&parse(
            "PUBLISH",
            &format!("{timed}\r\nRECURRENCE-ID:20261026T130000Z")
        ))
        .is_err()
    );
    assert!(event_snapshot(&parse("PUBLISH", "DTSTART:20261026T130000")).is_err());
    assert!(
        event_snapshot(&parse(
            "PUBLISH",
            "DTSTART:20261026T140000Z\r\nDTEND:20261026T130000Z"
        ))
        .is_err()
    );
    // Saved before recurrence was recorded: a series and a single event look alike.
    let mut saved_earlier = parse("PUBLISH", timed);
    saved_earlier.recurrence = None;
    assert!(event_snapshot(&saved_earlier).is_err());
}

#[tokio::test]
async fn adds_the_saved_event_of_the_named_message_as_the_viewer() {
    let thread_id = Uuid::now_v7();
    let message_id = Uuid::now_v7();
    let invite = parse(
        "PUBLISH",
        "DTSTART:20261026T130000Z\r\nDTEND:20261026T140000Z",
    );
    let invitation_id = invite.id.clone();
    let snapshots = Snapshots(vec![
        ThreadInvitation {
            message_id: Uuid::now_v7(),
            link_id: Uuid::now_v7(),
            invitation: invite.clone(),
        },
        ThreadInvitation {
            message_id,
            link_id: Uuid::now_v7(),
            invitation: invite,
        },
    ]);
    let importer = Importer::default();
    let calendar_id = Uuid::now_v7();

    let result = add_to_calendar(
        &importer,
        &snapshots,
        receipt(thread_id),
        message_id,
        &invitation_id,
        Some(calendar_id),
    )
    .await;

    assert!(matches!(
        result,
        Err(CalendarMutationError::AlreadyOnCalendar)
    ));
    let imported = importer.imported.lock().unwrap();
    assert_eq!(imported.len(), 1);
    assert_eq!(imported[0].0, "macro|reader@example.com");
    assert_eq!(imported[0].1.ical_uid, "meeting@example.com");
    assert_eq!(imported[0].2, Some(calendar_id));
}

#[tokio::test]
async fn refuses_an_unknown_event_and_an_invitation_before_the_calendar() {
    let thread_id = Uuid::now_v7();
    let message_id = Uuid::now_v7();
    let invite = parse(
        "REQUEST",
        "DTSTART:20261026T130000Z\r\nDTEND:20261026T140000Z",
    );
    let invitation_id = invite.id.clone();
    let snapshots = Snapshots(vec![ThreadInvitation {
        message_id,
        link_id: Uuid::now_v7(),
        invitation: invite,
    }]);
    let importer = Importer::default();

    let unknown = add_to_calendar(
        &importer,
        &snapshots,
        receipt(thread_id),
        Uuid::now_v7(),
        &invitation_id,
        None,
    )
    .await;
    let invitation = add_to_calendar(
        &importer,
        &snapshots,
        receipt(thread_id),
        message_id,
        &invitation_id,
        None,
    )
    .await;

    assert!(matches!(unknown, Err(CalendarMutationError::NotFound)));
    assert!(matches!(
        invitation,
        Err(CalendarMutationError::InvalidInput(_))
    ));
    assert!(importer.imported.lock().unwrap().is_empty());
}
