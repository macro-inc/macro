//! Calendar reminder dispatch: delivers event alarms that have come due.
//!
//! Modeled on the generic reminders dispatcher: a minutely queue tick sweeps
//! the materialized firing schedule and fans one message out per due firing;
//! each of those delivers a single firing through claim → notify → complete,
//! so a pool of workers delivers in parallel and never double-sends.
//!
//! No authorization: a firing only ever notifies the event's owner, who set
//! (or synced) the reminder in the first place.

#[cfg(test)]
mod test;

use chrono::{DateTime, Duration, Utc};
use rootcause::Report;

use super::models::{
    CalendarReminderDeliveryOutcome, CalendarReminderDispatchMessage, CalendarReminderFiring,
    CalendarReminderSweepSummary, DueCalendarReminder,
};
use super::ports::{
    CalendarReminderDispatch, CalendarReminderDispatchQueue, CalendarReminderDispatchRepo,
    CalendarReminderNotifier,
};

/// How long a claimed but undelivered firing is left alone before another
/// worker may take it over. Only a crash net: an ordinary delivery failure
/// releases its own claim.
const RETRY_AFTER: Duration = Duration::minutes(5);

/// How many due firings one sweep page loads. The sweep drains page by page
/// so a backlog (dispatcher outage, round-hour spike) costs bounded memory
/// per iteration instead of one unbounded scan.
const SWEEP_PAGE: i64 = 500;

/// Delivers due calendar reminders to their event owners.
#[derive(Debug, Clone)]
pub struct CalendarReminderDispatchService<R, N, Q> {
    repo: R,
    notifier: N,
    queue: Q,
}

impl<R, N, Q> CalendarReminderDispatchService<R, N, Q>
where
    R: CalendarReminderDispatchRepo,
    N: CalendarReminderNotifier,
    Q: CalendarReminderDispatchQueue,
{
    /// Construct the dispatcher from its ports.
    pub fn new(repo: R, notifier: N, queue: Q) -> Self {
        Self {
            repo,
            notifier,
            queue,
        }
    }

    /// Claim, notify, complete — in that order. Claiming first stops two
    /// workers double-sending; completing last makes a failed delivery
    /// retryable rather than lost.
    async fn deliver_claimed(
        &self,
        due: &DueCalendarReminder,
        now: DateTime<Utc>,
    ) -> Result<CalendarReminderDeliveryOutcome, Report> {
        let claimed = self
            .repo
            .claim_reminder_delivery(&due.firing, now - RETRY_AFTER)
            .await?;
        if !claimed {
            return Ok(CalendarReminderDeliveryOutcome::AlreadyClaimed);
        }

        if let Err(error) = self.notifier.notify(due).await {
            tracing::error!(
                error = ?error,
                event_id = %due.firing.event_id,
                "failed to deliver calendar reminder notification; releasing claim for retry",
            );
            // Hand the claim back before the message is redelivered, or the
            // retry would race a claim it owns itself and wait out
            // RETRY_AFTER. A failure here only makes the retry slower.
            if let Err(release_error) = self.repo.release_reminder_delivery(&due.firing).await {
                tracing::error!(
                    error = ?release_error,
                    event_id = %due.firing.event_id,
                    "failed to release calendar reminder claim after a failed delivery",
                );
            }
            return Err(error);
        }

        self.repo.complete_reminder_delivery(&due.firing).await?;
        Ok(CalendarReminderDeliveryOutcome::Delivered)
    }
}

impl<R, N, Q> CalendarReminderDispatch for CalendarReminderDispatchService<R, N, Q>
where
    R: CalendarReminderDispatchRepo,
    N: CalendarReminderNotifier,
    Q: CalendarReminderDispatchQueue,
{
    #[tracing::instrument(err, skip(self))]
    async fn sweep(&self) -> Result<CalendarReminderSweepSummary, Report> {
        let now = Utc::now();
        let mut dispatched = 0;
        let mut after: Option<CalendarReminderFiring> = None;

        loop {
            let firings = self
                .repo
                .due_reminder_firings(now, after.as_ref(), SWEEP_PAGE)
                .await?;
            let Some(last) = firings.last().cloned() else {
                break;
            };
            let page_len = firings.len();

            let messages: Vec<CalendarReminderDispatchMessage> = firings
                .into_iter()
                .map(CalendarReminderDispatchMessage::deliver)
                .collect();

            // One failed publish fails the whole sweep, so the tick is
            // redelivered and the fan-out repeats. Firings that already went
            // out lose the claim race the second time, so a repeat costs
            // messages rather than duplicate notifications.
            self.queue.publish_batch(&messages).await?;
            dispatched += page_len;

            if (page_len as i64) < SWEEP_PAGE {
                break;
            }
            after = Some(last);
        }

        Ok(CalendarReminderSweepSummary { dispatched })
    }

    #[tracing::instrument(err, skip(self))]
    async fn deliver(
        &self,
        firing: CalendarReminderFiring,
    ) -> Result<CalendarReminderDeliveryOutcome, Report> {
        let now = Utc::now();

        // Re-read rather than trusting the sweep: between fan-out and here
        // the event may have moved, been cancelled, or lost its account, and
        // none of those should still alert.
        let Some(due) = self.repo.find_due_reminder(&firing).await? else {
            return Ok(CalendarReminderDeliveryOutcome::Gone);
        };

        if due.declined {
            return Ok(CalendarReminderDeliveryOutcome::SkippedDeclined);
        }

        self.deliver_claimed(&due, now).await
    }
}
