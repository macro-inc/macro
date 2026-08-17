use std::sync::{Arc, Mutex};

use chrono::TimeZone;
use uuid::Uuid;

use super::*;
use crate::domain::models::{CalendarReminderDispatchOperation, EventTime};
use crate::domain::ports::RawCalendarDispatchMessage;

fn instant() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 10, 12, 0, 0)
        .single()
        .expect("unambiguous instant")
}

fn uuid(n: u8) -> Uuid {
    Uuid::from_bytes([n; 16])
}

fn firing(n: u8) -> CalendarReminderFiring {
    CalendarReminderFiring {
        event_id: uuid(n),
        occurrence_key: "2026-08-10T12:10:00+00:00".to_string(),
        minutes_before: 10,
        fire_at: instant(),
    }
}

fn due(n: u8, declined: bool) -> DueCalendarReminder {
    DueCalendarReminder {
        firing: firing(n),
        owner_id: "macro|owner@macro.com".to_string(),
        title: "Team sync".to_string(),
        time: EventTime::Timed {
            starts_at: instant() + Duration::minutes(10),
            ends_at: instant() + Duration::minutes(40),
            time_zone: Some("America/New_York".to_string()),
        },
        display_time_zone: Some("America/New_York".to_string()),
        declined,
    }
}

#[derive(Default)]
struct FakeRepoState {
    scheduled: Vec<CalendarReminderFiring>,
    due: Vec<DueCalendarReminder>,
    refuse_claims: bool,
    claimed: Vec<Uuid>,
    released: Vec<Uuid>,
    completed: Vec<Uuid>,
}

#[derive(Clone, Default)]
struct FakeRepo(Arc<Mutex<FakeRepoState>>);

impl CalendarReminderDispatchRepo for FakeRepo {
    async fn due_reminder_firings(
        &self,
        _now: DateTime<Utc>,
        after: Option<&CalendarReminderFiring>,
        limit: i64,
    ) -> Result<Vec<CalendarReminderFiring>, Report> {
        let key = |firing: &CalendarReminderFiring| {
            (
                firing.fire_at,
                firing.event_id,
                firing.minutes_before,
                firing.occurrence_key.clone(),
            )
        };
        let mut scheduled = self.0.lock().unwrap().scheduled.clone();
        scheduled.sort_by_key(&key);
        Ok(scheduled
            .into_iter()
            .filter(|firing| after.is_none_or(|after| key(firing) > key(after)))
            .take(usize::try_from(limit).unwrap())
            .collect())
    }

    async fn find_due_reminder(
        &self,
        firing: &CalendarReminderFiring,
    ) -> Result<Option<DueCalendarReminder>, Report> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .due
            .iter()
            .find(|due| due.firing == *firing)
            .cloned())
    }

    async fn claim_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
        _retry_before: DateTime<Utc>,
    ) -> Result<bool, Report> {
        let mut state = self.0.lock().unwrap();
        if state.refuse_claims {
            return Ok(false);
        }
        state.claimed.push(firing.event_id);
        Ok(true)
    }

    async fn release_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
    ) -> Result<(), Report> {
        self.0.lock().unwrap().released.push(firing.event_id);
        Ok(())
    }

    async fn complete_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
    ) -> Result<(), Report> {
        self.0.lock().unwrap().completed.push(firing.event_id);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeNotifier {
    fail: bool,
    notified: Arc<Mutex<Vec<Uuid>>>,
}

impl CalendarReminderNotifier for FakeNotifier {
    async fn notify(&self, due: &DueCalendarReminder) -> Result<(), Report> {
        if self.fail {
            return Err(rootcause::report!("notification rejected").into_dynamic());
        }
        self.notified.lock().unwrap().push(due.firing.event_id);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeQueue {
    published: Arc<Mutex<Vec<CalendarReminderDispatchMessage>>>,
}

impl CalendarReminderDispatchQueue for FakeQueue {
    async fn publish_batch(
        &self,
        messages: &[CalendarReminderDispatchMessage],
    ) -> Result<(), Report> {
        self.published.lock().unwrap().extend_from_slice(messages);
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawCalendarDispatchMessage>, Report> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        Ok(())
    }
}

fn service(
    repo: FakeRepo,
    notifier: FakeNotifier,
    queue: FakeQueue,
) -> CalendarReminderDispatchService<FakeRepo, FakeNotifier, FakeQueue> {
    CalendarReminderDispatchService::new(repo, notifier, queue)
}

#[tokio::test]
async fn sweep_fans_out_one_message_per_due_firing() {
    let repo = FakeRepo::default();
    repo.0.lock().unwrap().scheduled = vec![firing(1), firing(2)];
    let queue = FakeQueue::default();
    let dispatch = service(repo, FakeNotifier::default(), queue.clone());

    let summary = dispatch.sweep().await.expect("sweep succeeds");

    assert_eq!(summary.dispatched, 2);
    let published = queue.published.lock().unwrap();
    assert_eq!(published.len(), 2);
    assert!(matches!(
        &published[0].operation,
        CalendarReminderDispatchOperation::Deliver(delivered) if *delivered == firing(1)
    ));
}

/// A backlog wider than one sweep page drains fully across keyset pages
/// instead of stopping at the first page or re-reading it forever.
#[tokio::test]
async fn sweep_drains_a_backlog_larger_than_one_page() {
    let count = 501;
    let repo = FakeRepo::default();
    repo.0.lock().unwrap().scheduled = (0..count)
        .map(|n| CalendarReminderFiring {
            event_id: uuid(u8::try_from(n % 251).unwrap()),
            occurrence_key: format!("2026-08-10T12:{:02}:00+00:00[{n}]", n % 60),
            minutes_before: i32::try_from(n).unwrap(),
            fire_at: instant(),
        })
        .collect();
    let queue = FakeQueue::default();
    let dispatch = service(repo, FakeNotifier::default(), queue.clone());

    let summary = dispatch.sweep().await.expect("sweep succeeds");

    assert_eq!(summary.dispatched, count);
    let published = queue.published.lock().unwrap();
    assert_eq!(published.len(), count);
}

#[tokio::test]
async fn quiet_sweep_publishes_nothing() {
    let queue = FakeQueue::default();
    let dispatch = service(FakeRepo::default(), FakeNotifier::default(), queue.clone());

    let summary = dispatch.sweep().await.expect("sweep succeeds");

    assert_eq!(summary, CalendarReminderSweepSummary::default());
    assert!(queue.published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deliver_reports_gone_when_the_schedule_moved_on() {
    let dispatch = service(
        FakeRepo::default(),
        FakeNotifier::default(),
        FakeQueue::default(),
    );

    let outcome = dispatch.deliver(firing(1)).await.expect("deliver runs");

    assert_eq!(outcome, CalendarReminderDeliveryOutcome::Gone);
}

#[tokio::test]
async fn deliver_skips_declined_occurrences_without_claiming() {
    let repo = FakeRepo::default();
    repo.0.lock().unwrap().due = vec![due(1, true)];
    let dispatch = service(repo.clone(), FakeNotifier::default(), FakeQueue::default());

    let outcome = dispatch.deliver(firing(1)).await.expect("deliver runs");

    assert_eq!(outcome, CalendarReminderDeliveryOutcome::SkippedDeclined);
    assert!(repo.0.lock().unwrap().claimed.is_empty());
}

#[tokio::test]
async fn deliver_claims_notifies_and_completes() {
    let repo = FakeRepo::default();
    repo.0.lock().unwrap().due = vec![due(1, false)];
    let notifier = FakeNotifier::default();
    let dispatch = service(repo.clone(), notifier.clone(), FakeQueue::default());

    let outcome = dispatch.deliver(firing(1)).await.expect("deliver runs");

    assert_eq!(outcome, CalendarReminderDeliveryOutcome::Delivered);
    let state = repo.0.lock().unwrap();
    assert_eq!(state.claimed, vec![uuid(1)]);
    assert_eq!(state.completed, vec![uuid(1)]);
    assert!(state.released.is_empty());
    assert_eq!(*notifier.notified.lock().unwrap(), vec![uuid(1)]);
}

#[tokio::test]
async fn deliver_backs_off_when_the_claim_is_held() {
    let repo = FakeRepo::default();
    {
        let mut state = repo.0.lock().unwrap();
        state.due = vec![due(1, false)];
        state.refuse_claims = true;
    }
    let notifier = FakeNotifier::default();
    let dispatch = service(repo.clone(), notifier.clone(), FakeQueue::default());

    let outcome = dispatch.deliver(firing(1)).await.expect("deliver runs");

    assert_eq!(outcome, CalendarReminderDeliveryOutcome::AlreadyClaimed);
    assert!(notifier.notified.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_notification_releases_the_claim_and_errors() {
    let repo = FakeRepo::default();
    repo.0.lock().unwrap().due = vec![due(1, false)];
    let notifier = FakeNotifier {
        fail: true,
        ..Default::default()
    };
    let dispatch = service(repo.clone(), notifier, FakeQueue::default());

    let result = dispatch.deliver(firing(1)).await;

    assert!(result.is_err());
    let state = repo.0.lock().unwrap();
    assert_eq!(state.claimed, vec![uuid(1)]);
    assert_eq!(state.released, vec![uuid(1)]);
    assert!(state.completed.is_empty());
}
