use std::sync::{Arc, Mutex};

use chrono::TimeZone;
use chrono_tz::America::New_York;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Reminder, ReminderCron, ReminderSchedule};
use crate::domain::ports::RawDispatchMessage;

const OWNER: &str = "macro|reminders-owner@macro.com";
const DAILY_9AM: &str = "0 0 9 * * *";

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0)
        .single()
        .expect("unambiguous instant")
}

/// A clock frozen at [`now`].
#[derive(Debug, Clone, Copy)]
struct FixedClock(DateTime<Utc>);

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        self.0
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER)
        .expect("valid user id")
        .into_owned()
}

fn reminder(id: Uuid, schedule: ReminderSchedule) -> Reminder {
    Reminder {
        id,
        description: "Follow up".to_string(),
        entity_type: Some(EntityType::Document),
        entity_id: Some("doc-1".to_string()),
        next_run_at: now(),
        schedule,
        enabled: true,
        completed_at: None,
        created_at: now(),
        updated_at: now(),
    }
}

fn uuid(n: u8) -> Uuid {
    Uuid::from_bytes([n; 16])
}

fn firing(n: u8) -> DueFiring {
    DueFiring {
        reminder_id: uuid(n),
        scheduled_for: now(),
    }
}

fn due_once(n: u8) -> DueReminder {
    DueReminder {
        reminder: reminder(uuid(n), ReminderSchedule::Once { remind_at: now() }),
        owner_id: owner(),
        scheduled_for: now(),
    }
}

fn due_recurring(n: u8) -> DueReminder {
    let schedule = ReminderSchedule::Recurring {
        cron: ReminderCron::parse(DAILY_9AM).expect("valid cron"),
        timezone: New_York,
    };
    DueReminder {
        reminder: reminder(uuid(n), schedule),
        owner_id: owner(),
        scheduled_for: now(),
    }
}

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
struct FakeErr;

#[derive(Default)]
struct FakeRepoState {
    due: Vec<DueReminder>,
    /// Reminder ids whose claim should be refused, as if a peer won the race.
    unclaimable: Vec<Uuid>,
    claim_fails: bool,
    list_fails: bool,
    claimed: Vec<Uuid>,
    released: Vec<Uuid>,
    completed: Vec<Uuid>,
}

#[derive(Clone, Default)]
struct FakeRepo(Arc<Mutex<FakeRepoState>>);

impl FakeRepo {
    fn with_due(due: Vec<DueReminder>) -> Self {
        Self(Arc::new(Mutex::new(FakeRepoState {
            due,
            ..Default::default()
        })))
    }

    fn refusing_claim(self, id: Uuid) -> Self {
        self.0.lock().unwrap().unclaimable.push(id);
        self
    }

    fn failing_claim(self) -> Self {
        self.0.lock().unwrap().claim_fails = true;
        self
    }

    fn failing_list(self) -> Self {
        self.0.lock().unwrap().list_fails = true;
        self
    }

    fn claimed(&self) -> Vec<Uuid> {
        self.0.lock().unwrap().claimed.clone()
    }

    fn released(&self) -> Vec<Uuid> {
        self.0.lock().unwrap().released.clone()
    }

    fn completed(&self) -> Vec<Uuid> {
        self.0.lock().unwrap().completed.clone()
    }
}

impl ReminderDispatchRepo for FakeRepo {
    type Err = FakeErr;

    async fn due_firings(&self, _now: DateTime<Utc>) -> Result<Vec<DueFiring>, Self::Err> {
        let state = self.0.lock().unwrap();
        if state.list_fails {
            return Err(FakeErr);
        }
        Ok(state
            .due
            .iter()
            .map(|due| DueFiring {
                reminder_id: due.reminder.id,
                scheduled_for: due.scheduled_for,
            })
            .collect())
    }

    async fn find_due_reminder(&self, firing: DueFiring) -> Result<Option<DueReminder>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .due
            .iter()
            .find(|due| {
                due.reminder.id == firing.reminder_id && due.scheduled_for == firing.scheduled_for
            })
            .cloned())
    }

    async fn claim_occurrence(
        &self,
        reminder_id: Uuid,
        _scheduled_for: DateTime<Utc>,
        _retry_before: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let mut state = self.0.lock().unwrap();
        if state.claim_fails {
            return Err(FakeErr);
        }
        if state.unclaimable.contains(&reminder_id) {
            return Ok(false);
        }
        state.claimed.push(reminder_id);
        Ok(true)
    }

    async fn release_occurrence(
        &self,
        reminder_id: Uuid,
        _scheduled_for: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        self.0.lock().unwrap().released.push(reminder_id);
        Ok(())
    }

    async fn complete_occurrence(
        &self,
        reminder_id: Uuid,
        _scheduled_for: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        self.0.lock().unwrap().completed.push(reminder_id);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeNotifier {
    notified: Arc<Mutex<Vec<Uuid>>>,
    /// Reminder ids whose delivery should fail.
    failing: Arc<Mutex<Vec<Uuid>>>,
}

impl FakeNotifier {
    fn failing_for(id: Uuid) -> Self {
        Self {
            notified: Arc::default(),
            failing: Arc::new(Mutex::new(vec![id])),
        }
    }

    fn notified(&self) -> Vec<Uuid> {
        self.notified.lock().unwrap().clone()
    }
}

impl ReminderNotifier for FakeNotifier {
    type Err = FakeErr;

    async fn notify(&self, due: &DueReminder) -> Result<(), Self::Err> {
        if self.failing.lock().unwrap().contains(&due.reminder.id) {
            return Err(FakeErr);
        }
        self.notified.lock().unwrap().push(due.reminder.id);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeQueue {
    published: Arc<Mutex<Vec<ReminderDispatchMessage>>>,
    publish_fails: Arc<Mutex<bool>>,
}

impl FakeQueue {
    fn failing_publish() -> Self {
        Self {
            published: Arc::default(),
            publish_fails: Arc::new(Mutex::new(true)),
        }
    }

    fn published(&self) -> Vec<ReminderDispatchMessage> {
        self.published.lock().unwrap().clone()
    }
}

impl ReminderDispatchQueue for FakeQueue {
    type Err = FakeErr;

    async fn publish_batch(&self, messages: &[ReminderDispatchMessage]) -> Result<(), Self::Err> {
        if *self.publish_fails.lock().unwrap() {
            return Err(FakeErr);
        }
        self.published.lock().unwrap().extend_from_slice(messages);
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawDispatchMessage>, Self::Err> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Self::Err> {
        Ok(())
    }
}

fn service(
    repo: FakeRepo,
    notifier: FakeNotifier,
    queue: FakeQueue,
) -> ReminderDispatchService<FakeRepo, FakeNotifier, FakeQueue, FixedClock> {
    ReminderDispatchService::with_clock(repo, notifier, queue, FixedClock(now()))
}

// ---------------------------------------------------------------- sweep

#[tokio::test]
async fn a_sweep_fans_out_one_message_per_due_firing() {
    let repo = FakeRepo::with_due(vec![due_once(1), due_once(2), due_once(3)]);
    let queue = FakeQueue::default();

    let summary = service(repo, FakeNotifier::default(), queue.clone())
        .sweep()
        .await
        .expect("sweep succeeds");

    assert_eq!(summary.dispatched, 3);
    assert_eq!(
        queue.published(),
        vec![
            ReminderDispatchMessage::deliver(firing(1)),
            ReminderDispatchMessage::deliver(firing(2)),
            ReminderDispatchMessage::deliver(firing(3)),
        ]
    );
}

#[tokio::test]
async fn a_sweep_fans_out_recurring_reminders_it_is_given() {
    // The exclusion lives in the query, not the sweep: whatever the repo
    // reports as due is fanned out, and `deliver` is what refuses to send it.
    let repo = FakeRepo::with_due(vec![due_recurring(1)]);
    let queue = FakeQueue::default();

    let summary = service(repo, FakeNotifier::default(), queue.clone())
        .sweep()
        .await
        .expect("sweep succeeds");

    assert_eq!(summary.dispatched, 1);
    assert_eq!(queue.published().len(), 1);
}

#[tokio::test]
async fn an_empty_sweep_publishes_nothing() {
    let queue = FakeQueue::default();

    let summary = service(FakeRepo::default(), FakeNotifier::default(), queue.clone())
        .sweep()
        .await
        .expect("sweep succeeds");

    assert_eq!(summary, SweepSummary::default());
    assert!(queue.published().is_empty());
}

#[tokio::test]
async fn a_failed_publish_fails_the_sweep() {
    // The sweep message must not be acked: it is redelivered and the fan-out
    // repeats, which the claim makes harmless.
    let repo = FakeRepo::with_due(vec![due_once(1)]);

    let result = service(repo, FakeNotifier::default(), FakeQueue::failing_publish())
        .sweep()
        .await;

    assert!(matches!(result, Err(ReminderError::Internal(_))));
}

#[tokio::test]
async fn a_failed_listing_fails_the_sweep() {
    let repo = FakeRepo::default().failing_list();

    let result = service(repo, FakeNotifier::default(), FakeQueue::default())
        .sweep()
        .await;

    assert!(matches!(result, Err(ReminderError::Internal(_))));
}

// -------------------------------------------------------------- deliver

#[tokio::test]
async fn delivers_and_completes_a_due_one_shot() {
    let repo = FakeRepo::with_due(vec![due_once(1)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::Delivered);
    assert_eq!(notifier.notified(), vec![uuid(1)]);
    assert_eq!(repo.claimed(), vec![uuid(1)]);
    assert_eq!(repo.completed(), vec![uuid(1)]);
    assert!(repo.released().is_empty());
}

#[tokio::test]
async fn skips_a_recurring_reminder_without_claiming_it() {
    let repo = FakeRepo::with_due(vec![due_recurring(1)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::SkippedRecurring);
    // Nothing claimed: a recurring reminder must stay untouched for whenever
    // recurring dispatch lands, not burn its occurrence row.
    assert!(repo.claimed().is_empty());
    assert!(notifier.notified().is_empty());
}

#[tokio::test]
async fn a_firing_that_no_longer_exists_is_acked_not_delivered() {
    let repo = FakeRepo::default();
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::Gone);
    assert!(repo.claimed().is_empty());
    assert!(notifier.notified().is_empty());
}

#[tokio::test]
async fn a_rescheduled_firing_is_acked_not_delivered() {
    // Same reminder, different firing: the message is stale and must not send.
    let repo = FakeRepo::with_due(vec![due_once(1)]);
    let stale = DueFiring {
        reminder_id: uuid(1),
        scheduled_for: now() - Duration::hours(1),
    };

    let outcome = service(repo.clone(), FakeNotifier::default(), FakeQueue::default())
        .deliver(stale)
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::Gone);
    assert!(repo.claimed().is_empty());
}

#[tokio::test]
async fn does_not_notify_a_firing_another_worker_claimed() {
    let repo = FakeRepo::with_due(vec![due_once(1)]).refusing_claim(uuid(1));
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::AlreadyClaimed);
    assert!(notifier.notified().is_empty());
    assert!(repo.completed().is_empty());
}

#[tokio::test]
async fn releases_the_claim_when_delivery_fails() {
    let repo = FakeRepo::with_due(vec![due_once(1)]);
    let notifier = FakeNotifier::failing_for(uuid(1));

    let result = service(repo.clone(), notifier, FakeQueue::default())
        .deliver(firing(1))
        .await;

    // Errors so the message is redelivered rather than acked, and the claim is
    // handed back so that redelivery can actually take it.
    assert!(matches!(result, Err(ReminderError::Internal(_))));
    assert_eq!(repo.claimed(), vec![uuid(1)]);
    assert_eq!(repo.released(), vec![uuid(1)]);
    assert!(repo.completed().is_empty());
}

#[tokio::test]
async fn a_storage_failure_while_claiming_is_retryable() {
    let repo = FakeRepo::with_due(vec![due_once(1)]).failing_claim();
    let notifier = FakeNotifier::default();

    let result = service(repo, notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await;

    assert!(matches!(result, Err(ReminderError::Internal(_))));
    assert!(notifier.notified().is_empty());
}
