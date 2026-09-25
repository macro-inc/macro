//! Explicit scheduled-delivery transitions and their persistence boundary.

pub use super::service::signature::SignaturePreparation;
use chrono::{DateTime, Utc};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{
    events::{
        EmailMacroEvent, MessageSendCancelledMetadata, MessageSendQueuedMetadata, SendCancelReason,
    },
    models::EmailErr,
    ports::EmailRepo,
    service::EmailServiceImpl,
};

/// A user-confirmed change to a message's delivery schedule.
#[derive(Debug, Clone, Copy)]
pub enum ScheduleChange {
    /// Commit or update a future delivery time.
    Set(DateTime<Utc>),
    /// Restore an unclaimed, unsent message to an editable draft.
    Cancel,
}

/// Atomic persistence for schedule transitions. Implementations must serialize
/// against claim/finalization and reject sent/processing messages. An absent
/// schedule can only be cancelled idempotently for an unsent editable draft.
pub trait EmailSchedulingRepo: Send + Sync {
    /// Return the changed thread, or `None` for an already-cancelled draft.
    fn change_schedule(
        &self,
        link_id: Uuid,
        message_id: Uuid,
        actor: &MacroUserIdStr<'_>,
        change: ScheduleChange,
        signature: Option<&SignaturePreparation>,
    ) -> impl Future<Output = Result<Option<Uuid>, EmailErr>> + Send;
}

/// Authenticated explicit schedule/update/cancel use case.
pub trait EmailSchedulingService: Send + Sync {
    /// Authorize the actor's selected inbox and apply a guarded transition.
    fn change_schedule(
        &self,
        actor: MacroUserIdStr<'static>,
        link_id: Uuid,
        message_id: Uuid,
        change: ScheduleChange,
        include_signature: Option<bool>,
    ) -> impl Future<Output = Result<(), EmailErr>> + Send;
}

impl<T, U, E, CS, Eam, B> EmailSchedulingService for EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo + EmailSchedulingRepo,
    U: Send + Sync,
    E: Send + Sync,
    CS: Send + Sync,
    Eam: Send + Sync,
    B: MacroEventBroker,
    anyhow::Error: From<T::Err>,
{
    async fn change_schedule(
        &self,
        actor: MacroUserIdStr<'static>,
        link_id: Uuid,
        message_id: Uuid,
        change: ScheduleChange,
        include_signature: Option<bool>,
    ) -> Result<(), EmailErr> {
        let link = self
            .email_repo
            .inboxes_for_macro_id(actor.clone())
            .await
            .map_err(anyhow::Error::from)?
            .into_iter()
            .find(|link| link.id == link_id)
            .ok_or(EmailErr::Unauthorized)?;
        validate_schedule_change(change, Utc::now())?;
        let signature = if matches!(change, ScheduleChange::Set(_)) {
            let settings = self.email_repo.fetch_email_settings(link_id).await
                .inspect_err(|error| tracing::warn!(error=?error, "failed to fetch signature settings; skipping"))
                .ok();
            Some(SignaturePreparation {
                settings,
                include_signature,
            })
        } else {
            None
        };
        let Some(thread_id) = self
            .email_repo
            .change_schedule(link_id, message_id, &actor, change, signature.as_ref())
            .await?
        else {
            return Ok(());
        };
        let event = match change {
            ScheduleChange::Set(send_time) => {
                EmailMacroEvent::message_send_queued(MessageSendQueuedMetadata {
                    link_id,
                    owner: link.macro_id,
                    actor: Some(actor),
                    message_id,
                    thread_id,
                    scheduled_send_at: send_time,
                    is_scheduled: true,
                })
            }
            ScheduleChange::Cancel => {
                EmailMacroEvent::message_send_cancelled(MessageSendCancelledMetadata {
                    link_id,
                    owner: link.macro_id,
                    actor: Some(actor),
                    message_id,
                    thread_id,
                    reason: SendCancelReason::Undo,
                })
            }
        };
        self.publish_email_event(&event);
        Ok(())
    }
}

pub(crate) fn validate_schedule_change(
    change: ScheduleChange,
    now: DateTime<Utc>,
) -> Result<(), EmailErr> {
    if let ScheduleChange::Set(send_time) = change
        && send_time <= now
    {
        return Err(EmailErr::InvalidScheduleTime);
    }
    Ok(())
}

#[cfg(test)]
mod test;
