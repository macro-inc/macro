use std::sync::Mutex;

use chrono::{TimeZone, Utc};

use super::*;
use crate::domain::models::{
    AttendeeResponseStatus, CalendarAttendee, EventReminders, EventStatus, EventTime,
    EventTransparency, EventType, EventVisibility,
};

const VIEWER: &str = "macro|viewer@example.com";
const LINK_A: Uuid = Uuid::from_u128(0xa);
const LINK_B: Uuid = Uuid::from_u128(0xb);

#[derive(Default)]
struct FakeChanges {
    logs: Vec<CalendarLinkLog>,
    events: HashMap<Uuid, CalendarEventChange>,
    calendars: Vec<VisibleCalendar>,
    occurrence_cap_events: Option<usize>,
    owned_inboxes: Vec<String>,
    loads: Mutex<Vec<Vec<Uuid>>>,
}

impl CalendarChangeRepository for FakeChanges {
    async fn current_watermark(&self, _viewer: &str) -> Result<CalendarWatermark, Report> {
        Ok(CalendarWatermark::from_links(self.logs.iter().map(|log| {
            CalendarLinkWatermark {
                link_id: log.link_id,
                seq: log.counter,
            }
        })))
    }

    async fn link_logs(
        &self,
        _viewer: &str,
        since: &CalendarWatermark,
        limit: usize,
    ) -> Result<Vec<CalendarLinkLog>, Report> {
        Ok(self
            .logs
            .iter()
            .map(|log| CalendarLinkLog {
                changes: match since.seq(log.link_id) {
                    Some(seq) => log
                        .changes
                        .iter()
                        .filter(|change| change.seq > seq)
                        .take(limit)
                        .copied()
                        .collect(),
                    None => Vec::new(),
                },
                ..log.clone()
            })
            .collect())
    }

    async fn load_event_changes(
        &self,
        _viewer: &str,
        event_ids: &[Uuid],
        _max_occurrences: usize,
    ) -> Result<EventChangeLoad, Report> {
        self.loads.lock().unwrap().push(event_ids.to_vec());
        let considered = self
            .occurrence_cap_events
            .unwrap_or(event_ids.len())
            .min(event_ids.len());
        Ok(EventChangeLoad {
            events: event_ids[..considered]
                .iter()
                .filter_map(|id| self.events.get(id).cloned())
                .collect(),
            considered,
        })
    }

    async fn list_calendars_by_ids(
        &self,
        _viewer: &str,
        calendar_ids: &[Uuid],
    ) -> Result<Vec<VisibleCalendar>, Report> {
        Ok(self
            .calendars
            .iter()
            .filter(|calendar| calendar_ids.contains(&calendar.id))
            .cloned()
            .collect())
    }

    async fn owned_inbox_emails(&self, _viewer: &str) -> Result<Vec<String>, Report> {
        Ok(self.owned_inboxes.clone())
    }
}

fn log(link_id: Uuid, floor: i64, ops: Vec<CalendarChangeOp>) -> CalendarLinkLog {
    let changes: Vec<CalendarChange> = ops
        .into_iter()
        .zip(floor + 1..)
        .map(|(op, seq)| CalendarChange { seq, op })
        .collect();
    CalendarLinkLog {
        link_id,
        counter: changes.last().map_or(floor, |change| change.seq),
        floor,
        changes,
    }
}

fn since(positions: &[(Uuid, i64)]) -> CalendarWatermark {
    CalendarWatermark::from_links(
        positions
            .iter()
            .map(|&(link_id, seq)| CalendarLinkWatermark { link_id, seq }),
    )
}

fn event_change(id: Uuid, link_id: Uuid, occurrences: i64) -> CalendarEventChange {
    let starts_at = Utc.with_ymd_and_hms(2026, 10, 6, 15, 0, 0).unwrap();
    let time = EventTime::Timed {
        starts_at,
        ends_at: starts_at + chrono::Duration::hours(1),
        time_zone: None,
    };
    CalendarEventChange {
        event: CalendarEvent {
            id,
            owner_id: VIEWER.to_owned(),
            ical_uid: format!("{id}@example.com"),
            calendar_id: None,
            sources: Vec::new(),
            title: "Event".to_owned(),
            description: None,
            location: None,
            status: EventStatus::Confirmed,
            visibility: EventVisibility::Default,
            transparency: EventTransparency::Opaque,
            event_type: EventType::Default,
            time,
            recurrence_lines: Vec::new(),
            organizer_email: None,
            organizer_name: None,
            creator_email: None,
            creator_name: None,
            conference_url: None,
            conference_provider: None,
            sequence: 0,
            is_read_only: false,
            attendees: vec![CalendarAttendee {
                email: "Viewer@Example.com".to_owned(),
                display_name: None,
                response_status: AttendeeResponseStatus::Accepted,
                is_organizer: false,
                is_optional: false,
                is_self: false,
                comment: None,
            }],
            reminders: EventReminders::default(),
            created_at: starts_at,
            updated_at: starts_at,
        },
        link_id,
        occurrences: (0..occurrences)
            .map(|day| {
                let starts_at = starts_at + chrono::Duration::days(day);
                let time = EventTime::Timed {
                    starts_at,
                    ends_at: starts_at + chrono::Duration::hours(1),
                    time_zone: None,
                };
                EventOccurrence {
                    occurrence: CalendarOccurrence {
                        event_id: id,
                        occurrence_key: time.occurrence_key(),
                        recurrence_id: None,
                        time,
                        is_cancelled: false,
                    },
                    exception: OccurrenceException::default(),
                }
            })
            .collect(),
    }
}

fn calendar(id: Uuid, link_id: Uuid) -> VisibleCalendar {
    VisibleCalendar {
        id,
        email_link_id: link_id,
        email_address: "viewer@example.com".to_owned(),
        name: "Work".to_owned(),
        color: None,
        is_primary: true,
        is_writable: true,
        is_subscription: false,
        sync_error: None,
        default_reminders: Vec::new(),
    }
}

fn id(n: u128) -> Uuid {
    Uuid::from_u128(0x1000 + n)
}

fn budget() -> i64 {
    i64::try_from(MAX_DELTA_EVENTS).unwrap()
}

#[tokio::test]
async fn an_empty_watermark_bootstraps_with_the_current_positions_only() {
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![
            log(LINK_A, 0, vec![CalendarChangeOp::UpsertEvent(id(1))]),
            log(LINK_B, 4, Vec::new()),
        ],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, CalendarWatermark::default())
        .await
        .unwrap();

    assert_eq!(
        page,
        CalendarChangesPage {
            new_watermark: since(&[(LINK_A, 1), (LINK_B, 4)]),
            ..Default::default()
        }
    );
}

#[tokio::test]
async fn a_watermark_behind_retention_requires_a_reset() {
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![log(LINK_A, 10, vec![CalendarChangeOp::UpsertEvent(id(1))])],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 9)]))
        .await
        .unwrap();

    assert!(page.reset_required);
    assert!(page.events.is_empty() && page.deleted_event_ids.is_empty());
    assert_eq!(page.new_watermark, since(&[(LINK_A, 11)]));

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 10)]))
        .await
        .unwrap();
    assert!(!page.reset_required);
}

#[tokio::test]
async fn a_newly_visible_link_requires_a_reset_and_a_removed_one_drops_out() {
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![log(LINK_B, 0, Vec::new())],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 3)]))
        .await
        .unwrap();

    assert!(page.reset_required);
    assert_eq!(page.new_watermark, since(&[(LINK_B, 0)]));
}

#[tokio::test]
async fn changes_coalesce_to_each_targets_latest_state() {
    let calendar_kept = Uuid::from_u128(0xc1);
    let calendar_gone = Uuid::from_u128(0xc2);
    let calendar_deleted = Uuid::from_u128(0xc3);
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![log(
            LINK_A,
            0,
            vec![
                CalendarChangeOp::UpsertEvent(id(1)),
                CalendarChangeOp::DeleteEvent(id(1)),
                CalendarChangeOp::DeleteEvent(id(2)),
                CalendarChangeOp::UpsertEvent(id(2)),
                CalendarChangeOp::UpsertEvent(id(3)),
                CalendarChangeOp::UpsertCalendar(calendar_kept),
                CalendarChangeOp::UpsertCalendar(calendar_gone),
                CalendarChangeOp::DeleteCalendar(calendar_deleted),
            ],
        )],
        events: HashMap::from([(id(2), event_change(id(2), LINK_A, 2))]),
        calendars: vec![calendar(calendar_kept, LINK_A)],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 0)]))
        .await
        .unwrap();

    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].event.id, id(2));
    assert_eq!(page.events[0].occurrences.len(), 2);
    assert_eq!(page.deleted_event_ids, vec![id(1), id(3)]);
    assert_eq!(page.calendars, vec![calendar(calendar_kept, LINK_A)]);
    assert_eq!(
        page.deleted_calendar_ids,
        vec![calendar_gone, calendar_deleted]
    );
    assert_eq!(page.new_watermark, since(&[(LINK_A, 8)]));
    assert!(!page.has_more && !page.reset_required);
}

#[tokio::test]
async fn a_client_ahead_of_a_lagging_replica_gets_nothing_and_the_counter() {
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![log(LINK_A, 0, vec![CalendarChangeOp::UpsertEvent(id(1))])],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 5)]))
        .await
        .unwrap();

    assert!(page.events.is_empty() && page.deleted_event_ids.is_empty());
    assert_eq!(page.new_watermark, since(&[(LINK_A, 1)]));
    assert!(!page.has_more && !page.reset_required);
}

#[tokio::test]
async fn untouched_links_keep_their_counter() {
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![
            log(LINK_A, 0, vec![CalendarChangeOp::DeleteEvent(id(1))]),
            log(LINK_B, 0, vec![CalendarChangeOp::DeleteEvent(id(2))]),
        ],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 0), (LINK_B, 1)]))
        .await
        .unwrap();

    assert_eq!(page.deleted_event_ids, vec![id(1)]);
    assert_eq!(page.new_watermark, since(&[(LINK_A, 1), (LINK_B, 1)]));
}

#[tokio::test]
async fn the_event_budget_cuts_on_a_sequence_boundary() {
    let ops: Vec<CalendarChangeOp> = (0..MAX_DELTA_EVENTS as u128 + 5)
        .map(|n| CalendarChangeOp::DeleteEvent(id(n)))
        .collect();
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![
            log(LINK_A, 0, ops),
            log(LINK_B, 0, vec![CalendarChangeOp::DeleteEvent(id(9999))]),
        ],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 0), (LINK_B, 0)]))
        .await
        .unwrap();

    assert_eq!(page.deleted_event_ids.len(), MAX_DELTA_EVENTS);
    assert!(page.has_more);
    assert_eq!(
        page.new_watermark,
        since(&[(LINK_A, budget()), (LINK_B, 0)])
    );

    let rest = service
        .changes_since(VIEWER, page.new_watermark)
        .await
        .unwrap();
    assert_eq!(rest.deleted_event_ids.len(), 6);
    assert!(!rest.has_more);
    assert_eq!(
        rest.new_watermark,
        since(&[(LINK_A, budget() + 5), (LINK_B, 1)])
    );
}

#[tokio::test]
async fn repeated_changes_to_one_event_count_once_against_the_budget() {
    let ops: Vec<CalendarChangeOp> = (0..MAX_DELTA_ROWS_PER_LINK + 3)
        .map(|_| CalendarChangeOp::DeleteEvent(id(1)))
        .collect();
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![log(LINK_A, 0, ops)],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 0)]))
        .await
        .unwrap();

    assert_eq!(page.deleted_event_ids, vec![id(1)]);
    assert!(page.has_more, "the per-link row cap truncates the page");
    assert_eq!(
        page.new_watermark,
        since(&[(LINK_A, i64::try_from(MAX_DELTA_ROWS_PER_LINK).unwrap())])
    );
}

#[tokio::test]
async fn events_past_the_occurrence_cap_wait_for_the_next_page() {
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![log(
            LINK_A,
            0,
            vec![
                CalendarChangeOp::UpsertEvent(id(1)),
                CalendarChangeOp::DeleteEvent(id(2)),
                CalendarChangeOp::UpsertEvent(id(3)),
                CalendarChangeOp::UpsertEvent(id(4)),
            ],
        )],
        events: HashMap::from([
            (id(1), event_change(id(1), LINK_A, 3)),
            (id(3), event_change(id(3), LINK_A, 3)),
            (id(4), event_change(id(4), LINK_A, 3)),
        ]),
        occurrence_cap_events: Some(1),
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 0)]))
        .await
        .unwrap();

    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].event.id, id(1));
    assert_eq!(
        page.deleted_event_ids,
        vec![id(2)],
        "a delete before the first unread event still lands"
    );
    assert!(page.has_more);
    assert_eq!(page.new_watermark, since(&[(LINK_A, 2)]));
}

#[tokio::test]
async fn attendee_self_flags_follow_the_viewers_inboxes() {
    let mut change = event_change(id(1), LINK_A, 1);
    change.occurrences[0].exception.attendees = Some(change.event.attendees.clone());
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![log(LINK_A, 0, vec![CalendarChangeOp::UpsertEvent(id(1))])],
        events: HashMap::from([(id(1), change)]),
        owned_inboxes: vec!["viewer@example.com".to_owned()],
        ..Default::default()
    });

    let page = service
        .changes_since(VIEWER, since(&[(LINK_A, 0)]))
        .await
        .unwrap();

    let change = &page.events[0];
    assert!(change.event.attendees[0].is_self);
    assert!(change.occurrences[0].exception.attendees.as_ref().unwrap()[0].is_self);
}

#[tokio::test]
async fn nothing_is_hydrated_when_no_event_was_upserted() {
    let service = CalendarChangeService::new(FakeChanges {
        logs: vec![log(LINK_A, 0, vec![CalendarChangeOp::DeleteEvent(id(1))])],
        ..Default::default()
    });

    service
        .changes_since(VIEWER, since(&[(LINK_A, 0)]))
        .await
        .unwrap();

    assert!(service.repository.loads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn one_event_is_read_with_the_viewers_attendee_flags() {
    let service = CalendarChangeService::new(FakeChanges {
        events: HashMap::from([(id(1), event_change(id(1), LINK_A, 2))]),
        owned_inboxes: vec!["viewer@example.com".to_owned()],
        ..Default::default()
    });

    let change = service.event_change(VIEWER, id(1)).await.unwrap().unwrap();
    let missing = service.event_change(VIEWER, id(2)).await.unwrap();

    assert_eq!(change.occurrences.len(), 2);
    assert!(change.event.attendees[0].is_self);
    assert_eq!(missing, None);
}

#[test]
fn a_duplicated_link_keeps_its_lowest_position() {
    let watermark = since(&[(LINK_A, 7), (LINK_A, 3)]);

    assert_eq!(watermark.seq(LINK_A), Some(3));
}

struct FakePruner {
    batches: Mutex<Vec<usize>>,
    cutoffs: Mutex<Vec<DateTime<Utc>>>,
}

impl CalendarChangeLogPruner for FakePruner {
    async fn prune_change_log(
        &self,
        cutoff: DateTime<Utc>,
        _batch: usize,
    ) -> Result<usize, Report> {
        self.cutoffs.lock().unwrap().push(cutoff);
        Ok(self.batches.lock().unwrap().remove(0))
    }
}

#[tokio::test]
async fn retention_prunes_in_batches_until_a_short_one() {
    let retention = CalendarChangeLogRetention::new(FakePruner {
        batches: Mutex::new(vec![CHANGE_LOG_PRUNE_BATCH, CHANGE_LOG_PRUNE_BATCH, 7]),
        cutoffs: Mutex::new(Vec::new()),
    });
    let now = Utc.with_ymd_and_hms(2026, 10, 6, 0, 0, 0).unwrap();

    let removed = retention.run_once(now).await.unwrap();

    assert_eq!(removed, 2 * CHANGE_LOG_PRUNE_BATCH + 7);
    let cutoffs = retention.repository.cutoffs.lock().unwrap();
    assert_eq!(cutoffs.len(), 3);
    assert!(
        cutoffs
            .iter()
            .all(|cutoff| *cutoff == now - CHANGE_LOG_RETENTION)
    );
}
