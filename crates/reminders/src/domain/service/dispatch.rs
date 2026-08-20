//! Dispatch service: delivers reminders that have come due.
//!
//! Kept apart from [`RemindersServiceImpl`](super::RemindersServiceImpl) — that
//! is the caller-facing CRUD use case, scoped to one user; this one sweeps
//! every user's reminders on a schedule and needs no authorization, because a
//! reminder only ever notifies the owner who was authorized to create it.
//!
//! Two use cases, arriving as two different queue messages. A sweep finds what
//! is due and fans out one message per firing; each of those delivers a single
//! firing. Splitting them is what lets a pool of workers deliver in parallel
//! instead of one process walking a list.

#[cfg(test)]
mod test;

use chrono::{DateTime, Duration, Utc};

use uuid::Uuid;

use crate::domain::models::{
    Advance, Completion, DeliveryOutcome, DueFiring, DueReminder, MAX_RECURRING_LATENESS,
    ReminderDispatchMessage, ReminderError, ReminderSchedule, SweepSummary,
};
use crate::domain::ports::{
    Clock, ReminderDispatch, ReminderDispatchQueue, ReminderDispatchRepo, ReminderNotifier,
    SystemClock,
};

/// How long a claimed but undelivered firing is left alone before another
/// worker may take it over.
///
/// Only a crash net now: an ordinary delivery failure releases its own claim,
/// so this covers the case where the process died between claiming and
/// releasing. Long enough that a slow delivery is not raced, short enough that
/// a dead worker does not strand the firing.
const RETRY_AFTER: Duration = Duration::minutes(5);

/// What to do with a firing once it has been claimed.
enum Delivery {
    /// Notify the owner.
    Notify,
    /// Skip the notification and only move the series on.
    RollForward,
}

/// Whether a recurring firing is too far gone to be worth delivering.
///
/// Two ways to be past it, and the first is the one that matters:
///
/// - **Superseded.** The firing after this one has itself come due, so
///   delivering would announce yesterday's reminder while today's waits behind
///   it. This scales with the schedule on its own — a daily reminder tolerates
///   most of a day's delay, a five-minute one tolerates five minutes — which is
///   why the rule is expressed this way rather than as a flat duration that
///   would be far too tight for one and far too loose for the other.
/// - **Beyond the outside limit.** The backstop for long periods, where the
///   first rule alone would let a monthly reminder arrive three weeks late.
///
/// A firing merely waiting its turn behind a backlog fails both, and is
/// delivered. That is the point: an hour of queue delay must not cost someone
/// their daily reminder.
fn is_stale_firing(
    schedule: &ReminderSchedule,
    scheduled_for: DateTime<Utc>,
    now: DateTime<Utc>,
) -> bool {
    let ReminderSchedule::Recurring { cron, timezone } = schedule else {
        // One-shots are exempt. An overdue one-shot staying overdue until its
        // owner deals with it is the whole point of one.
        return false;
    };

    if now - scheduled_for > MAX_RECURRING_LATENESS {
        return true;
    }

    cron.next_run_after(scheduled_for, *timezone)
        .is_some_and(|following| now >= following)
}

/// Delivers due reminders to their owners.
#[derive(Debug, Clone)]
pub struct ReminderDispatchService<R, N, Q, C = SystemClock> {
    repo: R,
    notifier: N,
    queue: Q,
    clock: C,
}

impl<R, N, Q> ReminderDispatchService<R, N, Q, SystemClock>
where
    R: ReminderDispatchRepo,
    N: ReminderNotifier,
    Q: ReminderDispatchQueue,
{
    /// Create a dispatch service reading the current time from the system clock.
    pub fn new(repo: R, notifier: N, queue: Q) -> Self {
        Self {
            repo,
            notifier,
            queue,
            clock: SystemClock,
        }
    }
}

impl<R, N, Q, C> ReminderDispatchService<R, N, Q, C>
where
    R: ReminderDispatchRepo,
    N: ReminderNotifier,
    Q: ReminderDispatchQueue,
    C: Clock,
{
    /// Create a dispatch service with an explicit clock.
    pub fn with_clock(repo: R, notifier: N, queue: Q, clock: C) -> Self {
        Self {
            repo,
            notifier,
            queue,
            clock,
        }
    }

    /// Claim, notify, complete — in that order, for one resolved firing.
    ///
    /// Claiming first is what stops two workers double-sending; completing last
    /// is what makes a failed delivery retryable rather than lost.
    ///
    /// `next_run_at` carries a recurring reminder's next firing through to
    /// completion, where it lands in the same write that marks this one sent.
    async fn deliver_claimed(
        &self,
        due: &DueReminder,
        now: DateTime<Utc>,
        next_run_at: Option<DateTime<Utc>>,
        delivery: Delivery,
    ) -> Result<DeliveryOutcome, ReminderError> {
        let reminder_id = due.reminder.id;
        let scheduled_for = due.scheduled_for;
        // Only a delivery the owner can see supersedes their "done" on the
        // previous firing.
        let advance = next_run_at.map(|next_run_at| Advance {
            next_run_at,
            clear_completion: matches!(delivery, Delivery::Notify),
        });

        let claimed = self
            .repo
            .claim_occurrence(reminder_id, scheduled_for, now - RETRY_AFTER)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        if !claimed {
            return Ok(DeliveryOutcome::AlreadyClaimed);
        }

        if let Delivery::RollForward = delivery {
            // No notification, so nothing to retract and nothing to release:
            // completing is the whole job. The previous firing's notification
            // stays — nothing replaced it, so it is still the most recent thing
            // the owner was told.
            self.complete(reminder_id, scheduled_for, advance).await?;

            return Ok(DeliveryOutcome::RolledForward);
        }

        if let Err(e) = self.notifier.notify(due).await {
            tracing::error!(
                error = ?e,
                reminder_id = %reminder_id,
                "failed to deliver reminder notification; releasing claim for retry",
            );

            // Hand the claim back before the message is redelivered, or the
            // retry would race a claim it owns itself and give up until
            // RETRY_AFTER aged it out. A failure here is not fatal: the claim
            // is stale-reclaimable, it just waits longer.
            if let Err(release_err) = self
                .repo
                .release_occurrence(reminder_id, scheduled_for)
                .await
            {
                tracing::error!(
                    error = ?release_err,
                    reminder_id = %reminder_id,
                    "failed to release reminder claim after a failed delivery",
                );
            }

            return Err(ReminderError::Internal(
                rootcause::Report::new(e).into_dynamic(),
            ));
        }

        // Now that the replacement exists, take back what it replaces. After
        // notifying rather than before: a failure here leaves one notification
        // too many, whereas retracting first and then failing to notify would
        // leave the owner with none at all — having silently removed the only
        // reminder they could still see.
        //
        // Bounded by this firing, so it cannot remove the notification just
        // created. Non-fatal: an untidy inbox is no reason to fail a delivery
        // that has already happened.
        if due.reminder.schedule.repeats()
            && let Err(e) = self
                .repo
                .retract_notifications(reminder_id, scheduled_for)
                .await
        {
            tracing::error!(
                error = ?e,
                reminder_id = %reminder_id,
                "failed to retract an earlier reminder notification; leaving it in place",
            );
        }

        self.complete(reminder_id, scheduled_for, advance).await?;

        Ok(DeliveryOutcome::Delivered)
    }

    /// Finish a firing, reporting an advance that was declined rather than
    /// letting it pass unnoticed.
    ///
    /// A declined advance is expected — most often the owner rescheduled
    /// mid-flight — but it is indistinguishable after the fact from an advance
    /// that should have happened and did not, so it is worth a line either way.
    async fn complete(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
        advance: Option<Advance>,
    ) -> Result<Completion, ReminderError> {
        let completion = self
            .repo
            .complete_occurrence_and_advance(reminder_id, scheduled_for, advance)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;

        if completion == Completion::NotAdvanced {
            tracing::info!(
                reminder_id = %reminder_id,
                scheduled_for = %scheduled_for,
                "did not advance a reminder that moved off this firing mid-delivery",
            );
        }

        Ok(completion)
    }
}

impl<R, N, Q, C> ReminderDispatch for ReminderDispatchService<R, N, Q, C>
where
    R: ReminderDispatchRepo,
    N: ReminderNotifier,
    Q: ReminderDispatchQueue,
    C: Clock,
{
    #[tracing::instrument(err, skip(self))]
    async fn sweep(&self) -> Result<SweepSummary, ReminderError> {
        let now = self.clock.now();
        let firings = self
            .repo
            .due_firings(now)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;

        if firings.is_empty() {
            return Ok(SweepSummary::default());
        }

        let messages: Vec<ReminderDispatchMessage> = firings
            .iter()
            .copied()
            .map(ReminderDispatchMessage::deliver)
            .collect();

        // One failed publish fails the whole sweep, so the sweep message is
        // redelivered and the fan-out repeats. Firings that already went out
        // lose the claim race the second time, so the repeat costs messages
        // rather than duplicate notifications.
        self.queue
            .publish_batch(&messages)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;

        Ok(SweepSummary {
            dispatched: messages.len(),
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn deliver(&self, firing: DueFiring) -> Result<DeliveryOutcome, ReminderError> {
        let now = self.clock.now();

        // Re-read rather than trusting the sweep: between fan-out and here the
        // reminder may have been deleted, completed, disabled or rescheduled,
        // and none of those should still fire.
        let Some(due) = self
            .repo
            .find_due_reminder(firing)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?
        else {
            return Ok(DeliveryOutcome::Gone);
        };

        // Where the series goes next, resolved before anything is written so
        // completion can move the reminder on in the same breath as marking
        // this firing sent.
        //
        // Measured from `now` rather than from the firing being delivered, so a
        // backlog collapses into one delivery instead of replaying every
        // occurrence that was missed while nothing was listening. A daily
        // reminder that went undelivered for a week owes its owner one nudge,
        // not seven.
        //
        // `None` means the cron has no further firing — a year-qualified
        // expression that has run out. That reminder then behaves exactly like
        // a delivered one-shot: it stays at its final firing and waits to be
        // dealt with, rather than needing a state of its own.
        let next_run_at = match &due.reminder.schedule {
            ReminderSchedule::Once { .. } => None,
            ReminderSchedule::Recurring { cron, timezone } => cron.next_run_after(now, *timezone),
        };

        let delivery = if is_stale_firing(&due.reminder.schedule, due.scheduled_for, now) {
            tracing::warn!(
                reminder_id = %due.reminder.id,
                scheduled_for = %due.scheduled_for,
                "rolling a stale recurring reminder forward instead of delivering it",
            );
            Delivery::RollForward
        } else {
            Delivery::Notify
        };

        self.deliver_claimed(&due, now, next_run_at, delivery).await
    }
}
