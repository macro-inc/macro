//! Dispatch service: delivers reminders that have come due.
//!
//! Kept apart from [`RemindersServiceImpl`](super::RemindersServiceImpl) — that
//! is the caller-facing CRUD use case, scoped to one user; this one sweeps
//! every user's reminders on a schedule and needs no authorization, because a
//! reminder only ever notifies the owner who was authorized to create it.

#[cfg(test)]
mod test;

use chrono::{DateTime, Duration, Utc};

use crate::domain::models::{DispatchSummary, DueReminder, ReminderError};
use crate::domain::ports::{
    Clock, ReminderDispatch, ReminderDispatchRepo, ReminderNotifier, SystemClock,
};

/// How long a claimed but undelivered firing is left alone before another
/// sweep may take it over.
///
/// Long enough that a slow delivery is not raced by the next tick, short enough
/// that a dispatcher killed mid-flight does not strand the reminder.
const RETRY_AFTER: Duration = Duration::minutes(5);

/// Delivers due reminders to their owners.
#[derive(Debug, Clone)]
pub struct ReminderDispatchService<R, N, C = SystemClock> {
    repo: R,
    notifier: N,
    clock: C,
}

impl<R, N> ReminderDispatchService<R, N, SystemClock>
where
    R: ReminderDispatchRepo,
    N: ReminderNotifier,
    anyhow::Error: From<R::Err>,
{
    /// Create a dispatch service reading the current time from the system clock.
    pub fn new(repo: R, notifier: N) -> Self {
        Self {
            repo,
            notifier,
            clock: SystemClock,
        }
    }
}

impl<R, N, C> ReminderDispatchService<R, N, C>
where
    R: ReminderDispatchRepo,
    N: ReminderNotifier,
    C: Clock,
    anyhow::Error: From<R::Err>,
{
    /// Create a dispatch service with an explicit clock.
    pub fn with_clock(repo: R, notifier: N, clock: C) -> Self {
        Self {
            repo,
            notifier,
            clock,
        }
    }

    /// Deliver one due reminder, returning whether it was delivered.
    ///
    /// Ordering is claim, then notify, then complete. Claiming first is what
    /// stops two dispatchers double-sending; completing last is what makes a
    /// failed delivery retryable rather than lost.
    async fn dispatch_one(
        &self,
        due: &DueReminder,
        now: DateTime<Utc>,
        summary: &mut DispatchSummary,
    ) -> Result<(), R::Err> {
        let reminder_id = due.reminder.id;

        let claimed = self
            .repo
            .claim_occurrence(reminder_id, due.scheduled_for, now - RETRY_AFTER)
            .await?;
        if !claimed {
            return Ok(());
        }
        summary.claimed += 1;

        if let Err(e) = self.notifier.notify(due).await {
            // Left claimed and incomplete on purpose: the reminder stays due,
            // and the stale-claim window above lets a later sweep retry it.
            tracing::error!(
                error = ?e,
                reminder_id = %reminder_id,
                "failed to deliver reminder notification",
            );
            summary.failed += 1;
            return Ok(());
        }

        self.repo
            .complete_occurrence(reminder_id, due.scheduled_for)
            .await?;
        summary.delivered += 1;

        Ok(())
    }
}

impl<R, N, C> ReminderDispatch for ReminderDispatchService<R, N, C>
where
    R: ReminderDispatchRepo,
    N: ReminderNotifier,
    C: Clock,
    anyhow::Error: From<R::Err>,
{
    #[tracing::instrument(err, skip(self))]
    async fn dispatch_due(&self, limit: i64) -> Result<DispatchSummary, ReminderError> {
        let now = self.clock.now();
        let due = self
            .repo
            .due_reminders(now, limit)
            .await
            .map_err(anyhow::Error::from)?;

        let mut summary = DispatchSummary::default();

        for due in &due {
            // Recurring reminders are modelled but not dispatched yet. Skipping
            // them here rather than in the query keeps the gap visible and
            // testable, and leaves the row due for when dispatch lands.
            if due.reminder.schedule.repeats() {
                summary.skipped_recurring += 1;
                continue;
            }

            // One reminder failing must not abandon the rest of the sweep.
            if let Err(e) = self.dispatch_one(due, now, &mut summary).await {
                tracing::error!(
                    error = ?e,
                    reminder_id = %due.reminder.id,
                    "reminder dispatch failed against storage",
                );
                summary.failed += 1;
            }
        }

        if summary.skipped_recurring > 0 {
            tracing::warn!(
                count = summary.skipped_recurring,
                "skipped due recurring reminders; recurring dispatch is not implemented",
            );
        }

        Ok(summary)
    }
}
