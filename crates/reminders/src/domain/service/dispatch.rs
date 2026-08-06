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

use crate::domain::models::{
    DeliveryOutcome, DueFiring, DueReminder, ReminderDispatchMessage, ReminderError, SweepSummary,
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
    async fn deliver_claimed(
        &self,
        due: &DueReminder,
        now: DateTime<Utc>,
    ) -> Result<DeliveryOutcome, ReminderError> {
        let reminder_id = due.reminder.id;
        let scheduled_for = due.scheduled_for;

        let claimed = self
            .repo
            .claim_occurrence(reminder_id, scheduled_for, now - RETRY_AFTER)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        if !claimed {
            return Ok(DeliveryOutcome::AlreadyClaimed);
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

        self.repo
            .complete_occurrence(reminder_id, scheduled_for)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;

        Ok(DeliveryOutcome::Delivered)
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

        // Recurring reminders are modelled but not dispatched yet. Guarded here
        // rather than in the query because this is the only place that could
        // actually send one — and completing it would retire the series.
        if due.reminder.schedule.repeats() {
            tracing::warn!(
                reminder_id = %due.reminder.id,
                "skipped a due recurring reminder; recurring dispatch is not implemented",
            );
            return Ok(DeliveryOutcome::SkippedRecurring);
        }

        self.deliver_claimed(&due, now).await
    }
}
