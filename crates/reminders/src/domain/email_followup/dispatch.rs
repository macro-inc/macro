//! Serialize email dispatch with edits/removal while reusing occurrence alerts.
use super::{EmailFollowupRepo, service::EmailFollowupService};
use crate::domain::{
    models::{DeliveryOutcome, DueFiring, ReminderError, SweepSummary},
    ports::{Clock, ReminderDispatch, ReminderDispatchRepo},
};
use email::domain::followup::EmailFollowupMailbox;

/// Decorates the existing dispatcher with email reconciliation and inbox return.
pub struct EmailReminderDispatch<D, R, E, C> {
    generic: D,
    email: EmailFollowupService<R, E, C>,
}
impl<D, R, E, C> EmailReminderDispatch<D, R, E, C> {
    /// Use the same workflow/repository as the HTTP service.
    pub fn new(generic: D, email: EmailFollowupService<R, E, C>) -> Self {
        Self { generic, email }
    }
}
impl<
    D: ReminderDispatch,
    R: EmailFollowupRepo + ReminderDispatchRepo,
    E: EmailFollowupMailbox,
    C: Clock,
> ReminderDispatch for EmailReminderDispatch<D, R, E, C>
{
    async fn sweep(&self) -> Result<SweepSummary, ReminderError> {
        // Due delivery checks its own email facts. Recovery of unrelated email
        // workflows must not delay delivery of another email reminder.
        let result = self.generic.sweep().await;
        if let Err(error) = self.email.reconcile().await {
            tracing::error!(error = ?error, "email follow-up reconciliation failed; will retry next sweep");
        }
        result
    }
    async fn deliver(&self, firing: DueFiring) -> Result<DeliveryOutcome, ReminderError> {
        let Some(due) = self
            .email
            .repo
            .find_due_reminder(firing)
            .await
            .map_err(|error| {
                ReminderError::Internal(rootcause::Report::new(error).into_dynamic())
            })?
        else {
            return Ok(DeliveryOutcome::Gone);
        };
        let Some(record) = self
            .email
            .repo
            .reminder_followup(&due.owner_id, due.reminder.id)
            .await?
        else {
            return Ok(DeliveryOutcome::Gone);
        };
        let _guard = self
            .email
            .repo
            .lock_followup(&due.owner_id, record.followup.thread_id)
            .await?;
        let Some(mut record) = self
            .email
            .repo
            .reminder_followup(&due.owner_id, due.reminder.id)
            .await?
        else {
            return Ok(DeliveryOutcome::Gone);
        };
        if !self
            .email
            .return_due_locked(&mut record, firing.scheduled_for)
            .await?
        {
            return Ok(DeliveryOutcome::Gone);
        }
        self.generic.deliver(firing).await
    }
}
