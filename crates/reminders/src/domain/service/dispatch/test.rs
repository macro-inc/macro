use std::sync::{Arc, Mutex};

use chrono::TimeZone;
use chrono_tz::America::New_York;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Advance, Reminder, ReminderCron, ReminderSchedule};
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

/// The same recurring reminder, with its current firing moved to
/// `scheduled_for`.
fn due_recurring_at(n: u8, scheduled_for: DateTime<Utc>) -> DueReminder {
    let mut due = due_recurring(n);
    due.reminder.next_run_at = scheduled_for;
    due.scheduled_for = scheduled_for;
    due
}

/// A recurring reminder on an arbitrary cron, due at `scheduled_for`.
///
/// Staleness depends on how far apart a schedule's firings are, so the tests
/// covering it need periods other than the daily default.
fn due_with_cron(n: u8, cron: &str, scheduled_for: DateTime<Utc>) -> DueReminder {
    let mut due = due_recurring_at(n, scheduled_for);
    due.reminder.schedule = ReminderSchedule::Recurring {
        cron: ReminderCron::parse(cron).expect("valid cron"),
        timezone: New_York,
    };
    due
}

/// Where `DAILY_9AM` in New York lands next, measured from [`now`].
///
/// [`now`] is 12:00 UTC, which is 08:00 in New York on this date, so the next
/// 09:00 there is an hour later — 13:00 UTC the same day.
fn next_daily_9am() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, 1, 13, 0, 0)
        .single()
        .expect("unambiguous instant")
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
    /// Completed firings, each with how it moved the series on.
    completed: Vec<(Uuid, Option<Advance>)>,
    /// Retractions, each with the firing they were bounded by.
    retracted: Vec<(Uuid, DateTime<Utc>)>,
    retract_fails: bool,
    /// Report every advance as declined, standing in for the reminder having
    /// moved off this firing while the delivery was in flight.
    advance_declined: bool,
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
        self.0
            .lock()
            .unwrap()
            .completed
            .iter()
            .map(|(id, _)| *id)
            .collect()
    }

    /// Where each completed firing moved its series to, `None` for one that
    /// does not repeat.
    fn advanced(&self) -> Vec<(Uuid, Option<DateTime<Utc>>)> {
        self.0
            .lock()
            .unwrap()
            .completed
            .iter()
            .map(|(id, advance)| (*id, advance.map(|a| a.next_run_at)))
            .collect()
    }

    /// Whether each completed firing cleared the owner's "done", which only a
    /// delivery they were told about should.
    fn cleared_completion(&self) -> Vec<bool> {
        self.0
            .lock()
            .unwrap()
            .completed
            .iter()
            .filter_map(|(_, advance)| advance.map(|a| a.clear_completion))
            .collect()
    }

    fn retracted(&self) -> Vec<(Uuid, DateTime<Utc>)> {
        self.0.lock().unwrap().retracted.clone()
    }

    fn failing_retract(self) -> Self {
        self.0.lock().unwrap().retract_fails = true;
        self
    }

    fn declining_advance(self) -> Self {
        self.0.lock().unwrap().advance_declined = true;
        self
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

    async fn complete_occurrence_and_advance(
        &self,
        reminder_id: Uuid,
        _scheduled_for: DateTime<Utc>,
        advance: Option<Advance>,
    ) -> Result<Completion, Self::Err> {
        let mut state = self.0.lock().unwrap();
        state.completed.push((reminder_id, advance));
        Ok(match (advance, state.advance_declined) {
            (None, _) => Completion::NoAdvance,
            (Some(_), true) => Completion::NotAdvanced,
            (Some(_), false) => Completion::Advanced,
        })
    }

    async fn retract_notifications(
        &self,
        reminder_id: Uuid,
        before: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        let mut state = self.0.lock().unwrap();
        if state.retract_fails {
            return Err(FakeErr);
        }
        state.retracted.push((reminder_id, before));
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
    // The sweep does not read schedules: whatever the repo reports as due is
    // fanned out, and delivery decides what each firing means.
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
async fn delivers_a_recurring_reminder_and_advances_it_to_the_next_firing() {
    let repo = FakeRepo::with_due(vec![due_recurring(1)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::Delivered);
    assert_eq!(notifier.notified(), vec![uuid(1)]);
    // The advance rides along with completion. Without it the reminder would be
    // excluded by its own sent occurrence and never come due again.
    assert_eq!(repo.advanced(), vec![(uuid(1), Some(next_daily_9am()))]);
    assert!(repo.released().is_empty());
}

#[tokio::test]
async fn delivering_a_recurring_firing_clears_an_earlier_done() {
    // Completion settles one firing, not the series. A firing the owner can now
    // see supersedes their "done" on the previous one, so the reminder reads as
    // outstanding again rather than sitting under Done with a fresh nudge in
    // the inbox.
    let repo = FakeRepo::with_due(vec![due_recurring(1)]);

    service(repo.clone(), FakeNotifier::default(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    assert_eq!(repo.cleared_completion(), vec![true]);
}

#[tokio::test]
async fn rolling_a_firing_forward_silently_leaves_done_alone() {
    // Nothing reached the owner, so nothing supersedes what they already dealt
    // with — returning the reminder to their attention here would be a state
    // change with no notification to explain it.
    let stale_at = now() - Duration::days(2);
    let repo = FakeRepo::with_due(vec![due_recurring_at(1, stale_at)]);

    service(repo.clone(), FakeNotifier::default(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: stale_at,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(repo.cleared_completion(), vec![false]);
}

#[tokio::test]
async fn a_recurring_delivery_retracts_the_earlier_firings_notification() {
    let repo = FakeRepo::with_due(vec![due_recurring(1)]);
    let notifier = FakeNotifier::default();

    service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    // A daily reminder should leave one thing in the inbox, not one per day
    // since its owner last looked. Bounded by this firing, so the notification
    // just created is not swept up with the ones it replaces.
    assert_eq!(repo.retracted(), vec![(uuid(1), now())]);
}

#[tokio::test]
async fn a_recurring_delivery_retracts_only_after_the_replacement_exists() {
    // Ordering matters more than it looks. Retracting first and then failing to
    // notify would take away the one notification the owner could still see and
    // put nothing in its place.
    let repo = FakeRepo::with_due(vec![due_recurring(1)]);
    let notifier = FakeNotifier::failing_for(uuid(1));

    let result = service(repo.clone(), notifier, FakeQueue::default())
        .deliver(firing(1))
        .await;

    assert!(matches!(result, Err(ReminderError::Internal(_))));
    assert!(
        repo.retracted().is_empty(),
        "a failed delivery must leave the previous firing's notification alone"
    );
}

#[tokio::test]
async fn a_failed_retraction_does_not_fail_a_delivered_firing() {
    // The notification has already gone out. Failing here would leave the
    // firing uncompleted and redeliver it, notifying a second time to tidy up
    // an inbox — which is worse than the untidy inbox.
    let repo = FakeRepo::with_due(vec![due_recurring(1)]).failing_retract();
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds despite the failed retraction");

    assert_eq!(outcome, DeliveryOutcome::Delivered);
    assert_eq!(notifier.notified(), vec![uuid(1)]);
    assert_eq!(repo.advanced(), vec![(uuid(1), Some(next_daily_9am()))]);
}

#[tokio::test]
async fn a_delivery_whose_advance_was_declined_still_counts_as_delivered() {
    // The owner rescheduled while this was in flight, so the advance was
    // declined and their time stands. The notification still went out, so the
    // message is done with — leaving it for redelivery would notify twice.
    let repo = FakeRepo::with_due(vec![due_recurring(1)]).declining_advance();
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::Delivered);
    assert_eq!(notifier.notified(), vec![uuid(1)]);
}

#[tokio::test]
async fn a_one_shot_neither_advances_nor_retracts() {
    let repo = FakeRepo::with_due(vec![due_once(1)]);

    service(repo.clone(), FakeNotifier::default(), FakeQueue::default())
        .deliver(firing(1))
        .await
        .expect("delivery succeeds");

    assert_eq!(repo.advanced(), vec![(uuid(1), None)]);
    // Nothing came before it, so there is nothing to take back.
    assert!(repo.retracted().is_empty());
}

#[tokio::test]
async fn a_stale_recurring_firing_rolls_forward_instead_of_notifying() {
    // Two days late: a dispatcher outage, or a series whose next_run_at was
    // frozen before recurring dispatch existed. Announcing it now would be
    // reporting history.
    let stale_at = now() - Duration::days(2);
    let repo = FakeRepo::with_due(vec![due_recurring_at(1, stale_at)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: stale_at,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::RolledForward);
    assert!(notifier.notified().is_empty());
    // Nothing was sent, so the previous firing's notification is still the most
    // recent thing the owner has — it must survive.
    assert!(repo.retracted().is_empty());
    // Measured from now, not from the firing being skipped: advancing one day
    // from a two-day-old firing would land in the past and come straight back.
    assert_eq!(repo.advanced(), vec![(uuid(1), Some(next_daily_9am()))]);
}

#[tokio::test]
async fn a_recurring_firing_merely_delayed_is_still_delivered() {
    // The case a flat one-hour threshold got wrong. A daily reminder held up by
    // an hour of queue backlog or a short outage is late, not abandoned, and
    // dropping it silently would cost someone their reminder for that day.
    let delayed = now() - Duration::hours(3);
    let repo = FakeRepo::with_due(vec![due_recurring_at(1, delayed)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: delayed,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::Delivered);
    assert_eq!(notifier.notified(), vec![uuid(1)]);
}

#[tokio::test]
async fn a_recurring_firing_the_next_one_has_overtaken_is_rolled_forward() {
    // Staleness scales with the schedule rather than a fixed duration: once the
    // firing *after* this one has itself come due, delivering would announce
    // the previous occurrence while the current one waits behind it.
    //
    // Hourly, two hours late — so the following firing has been and gone while
    // this one is still well inside the 24-hour outside limit. That is what
    // isolates this rule from the backstop.
    let overtaken = now() - Duration::hours(2);
    let repo = FakeRepo::with_due(vec![due_with_cron(1, "0 0 * * * *", overtaken)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: overtaken,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::RolledForward);
    assert!(notifier.notified().is_empty());
}

#[tokio::test]
async fn a_firing_is_stale_the_instant_its_successor_comes_due() {
    // The boundary is `>=`, deliberately: at the exact moment the next firing
    // is due, the previous one has been superseded and delivering it would put
    // two of the same reminder in front of the owner at once. Pinned because it
    // decides real notifications, and `>` versus `>=` here is invisible.
    let hourly = "0 0 * * * *";
    // `now` is 12:00 exactly, so this firing's successor falls precisely on it.
    let previous = now() - Duration::hours(1);
    let repo = FakeRepo::with_due(vec![due_with_cron(1, hourly, previous)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: previous,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::RolledForward);
    assert!(notifier.notified().is_empty());
}

#[tokio::test]
async fn a_firing_whose_successor_is_still_ahead_is_delivered() {
    // The other side of that boundary, so the assertion above is pinning a
    // line rather than a direction.
    //
    // On the half hour, so `now` falls between two firings rather than on one:
    // with an on-the-hour cron every past firing's successor has already landed
    // at 12:00, and there is no "not yet superseded" case to express.
    let hourly = "0 30 * * * *";
    let previous = now() - Duration::minutes(30);
    let repo = FakeRepo::with_due(vec![due_with_cron(1, hourly, previous)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: previous,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::Delivered);
    assert_eq!(notifier.notified(), vec![uuid(1)]);
}

#[tokio::test]
async fn a_long_period_firing_past_the_outside_limit_is_rolled_forward() {
    // The backstop, isolated from the rule above. A monthly reminder a month
    // late has not been overtaken — its successor is still weeks away — but
    // delivering it now would be reporting history.
    let long_ago = now() - Duration::days(30);
    let repo = FakeRepo::with_due(vec![due_with_cron(1, "0 0 9 1 * *", long_ago)]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: long_ago,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::RolledForward);
    assert!(notifier.notified().is_empty());
}

#[tokio::test]
async fn a_stale_series_with_no_firing_left_is_completed_without_advancing() {
    // A year-qualified cron that has run out. `advance_to` is None, so the
    // reminder stays where it is and stops coming due because its own
    // occurrence is marked sent — subtle enough to be worth pinning, since
    // nothing else would notice if it started coming due forever.
    let schedule = ReminderSchedule::Recurring {
        cron: ReminderCron::parse("0 0 9 * * * 2020").expect("valid cron"),
        timezone: New_York,
    };
    let stale_at = now() - Duration::days(2);
    let mut due = due_recurring_at(1, stale_at);
    due.reminder.schedule = schedule;
    let repo = FakeRepo::with_due(vec![due]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: stale_at,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::RolledForward);
    assert!(notifier.notified().is_empty());
    assert_eq!(repo.advanced(), vec![(uuid(1), None)]);
}

#[tokio::test]
async fn a_stale_one_shot_is_still_delivered() {
    // The staleness valve is recurring-only. An overdue one-shot staying
    // overdue until its owner deals with it is the point of one.
    let stale_at = now() - Duration::days(2);
    let mut due = due_once(1);
    due.reminder.next_run_at = stale_at;
    due.scheduled_for = stale_at;
    let repo = FakeRepo::with_due(vec![due]);
    let notifier = FakeNotifier::default();

    let outcome = service(repo.clone(), notifier.clone(), FakeQueue::default())
        .deliver(DueFiring {
            reminder_id: uuid(1),
            scheduled_for: stale_at,
        })
        .await
        .expect("delivery succeeds");

    assert_eq!(outcome, DeliveryOutcome::Delivered);
    assert_eq!(notifier.notified(), vec![uuid(1)]);
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
