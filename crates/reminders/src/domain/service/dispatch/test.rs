use std::sync::{Arc, Mutex};

use chrono::TimeZone;
use chrono_tz::America::New_York;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Reminder, ReminderCron, ReminderSchedule};

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
    claimed: Vec<Uuid>,
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

    fn claimed(&self) -> Vec<Uuid> {
        self.0.lock().unwrap().claimed.clone()
    }

    fn completed(&self) -> Vec<Uuid> {
        self.0.lock().unwrap().completed.clone()
    }
}

impl ReminderDispatchRepo for FakeRepo {
    type Err = FakeErr;

    async fn due_reminders(
        &self,
        _now: DateTime<Utc>,
        _limit: i64,
    ) -> Result<Vec<DueReminder>, Self::Err> {
        Ok(self.0.lock().unwrap().due.clone())
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

fn service(
    repo: FakeRepo,
    notifier: FakeNotifier,
) -> ReminderDispatchService<FakeRepo, FakeNotifier, FixedClock> {
    ReminderDispatchService::with_clock(repo, notifier, FixedClock(now()))
}

#[tokio::test]
async fn delivers_and_completes_a_due_one_shot() {
    let repo = FakeRepo::with_due(vec![due_once(1)]);
    let notifier = FakeNotifier::default();

    let summary = service(repo.clone(), notifier.clone())
        .dispatch_due(10)
        .await
        .expect("dispatch succeeds");

    assert_eq!(summary.delivered, 1);
    assert_eq!(summary.claimed, 1);
    assert_eq!(summary.failed, 0);
    assert_eq!(notifier.notified(), vec![uuid(1)]);
    assert_eq!(repo.completed(), vec![uuid(1)]);
}

#[tokio::test]
async fn skips_recurring_reminders_without_claiming_them() {
    let repo = FakeRepo::with_due(vec![due_recurring(1)]);
    let notifier = FakeNotifier::default();

    let summary = service(repo.clone(), notifier.clone())
        .dispatch_due(10)
        .await
        .expect("dispatch succeeds");

    assert_eq!(summary.skipped_recurring, 1);
    assert_eq!(summary.delivered, 0);
    // Nothing claimed: a recurring reminder must stay untouched for whenever
    // recurring dispatch lands, not burn its occurrence row.
    assert!(repo.claimed().is_empty());
    assert!(notifier.notified().is_empty());
}

#[tokio::test]
async fn does_not_notify_a_firing_another_dispatcher_claimed() {
    let repo = FakeRepo::with_due(vec![due_once(1)]).refusing_claim(uuid(1));
    let notifier = FakeNotifier::default();

    let summary = service(repo.clone(), notifier.clone())
        .dispatch_due(10)
        .await
        .expect("dispatch succeeds");

    assert_eq!(summary, DispatchSummary::default());
    assert!(notifier.notified().is_empty());
    assert!(repo.completed().is_empty());
}

#[tokio::test]
async fn leaves_a_reminder_incomplete_when_delivery_fails() {
    let repo = FakeRepo::with_due(vec![due_once(1)]);
    let notifier = FakeNotifier::failing_for(uuid(1));

    let summary = service(repo.clone(), notifier)
        .dispatch_due(10)
        .await
        .expect("dispatch succeeds");

    assert_eq!(summary.failed, 1);
    assert_eq!(summary.delivered, 0);
    // Claimed but never completed, so the reminder stays due and the stale
    // claim window lets a later sweep retry it.
    assert_eq!(repo.claimed(), vec![uuid(1)]);
    assert!(repo.completed().is_empty());
}

#[tokio::test]
async fn one_failure_does_not_abandon_the_rest_of_the_sweep() {
    let repo = FakeRepo::with_due(vec![due_once(1), due_once(2), due_once(3)]);
    let notifier = FakeNotifier::failing_for(uuid(2));

    let summary = service(repo.clone(), notifier.clone())
        .dispatch_due(10)
        .await
        .expect("dispatch succeeds");

    assert_eq!(summary.delivered, 2);
    assert_eq!(summary.failed, 1);
    assert_eq!(notifier.notified(), vec![uuid(1), uuid(3)]);
    assert_eq!(repo.completed(), vec![uuid(1), uuid(3)]);
}

#[tokio::test]
async fn a_storage_failure_is_counted_and_the_sweep_continues() {
    let repo = FakeRepo::with_due(vec![due_once(1), due_once(2)]).failing_claim();
    let notifier = FakeNotifier::default();

    let summary = service(repo, notifier.clone())
        .dispatch_due(10)
        .await
        .expect("a per-reminder storage failure does not fail the sweep");

    assert_eq!(summary.failed, 2);
    assert_eq!(summary.delivered, 0);
    assert!(notifier.notified().is_empty());
}

#[tokio::test]
async fn an_empty_sweep_reports_nothing_done() {
    let summary = service(FakeRepo::default(), FakeNotifier::default())
        .dispatch_due(10)
        .await
        .expect("dispatch succeeds");

    assert_eq!(summary, DispatchSummary::default());
}
