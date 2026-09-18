use chrono::Duration;

use crate::domain::{
    events::{EmailMacroEvent, MessageSendQueuedMetadata},
    models::{CreateDraftInput, CreatedDraft, EmailErr, Link},
    ports::{EmailMessageEnqueuer, EmailRepo},
};
use frecency::domain::ports::FrecencyQueryService;
use macro_event_broker::MacroEventBroker;

use super::EmailServiceImpl;

impl<T, U, E, CS, Eam, B> EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    B: MacroEventBroker,
    anyhow::Error: From<T::Err>,
    anyhow::Error: From<E::Err>,
{
    #[tracing::instrument(err, skip(self, link, accessible_inboxes, input))]
    pub(crate) async fn send_message_impl(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        mut input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        let delay_secs = self.sent_undo_delay_secs;
        let send_time = chrono::Utc::now() + Duration::seconds(delay_secs as i64);
        input.send_time = Some(send_time);
        let actor = input.actor.clone();

        let created = self
            .prepare_and_insert_db_message(link, accessible_inboxes, input, false)
            .await?;

        // FE displays "Undo" button for delay_secs. Give extra time for round trip of cancel request
        let sqs_delay = delay_secs as i32 + 2;
        // The insert above already committed the message as non-draft with a
        // pending scheduled row. The queue message is the only thing that will
        // ever deliver it — nothing re-derives the send from the row — so an
        // enqueue failure leaves a message that is no longer a draft, was never
        // sent, and has no worker coming for it. Put it back to an unsent draft
        // so the body survives and the caller can retry, and fail loudly.
        if let Err(e) = self
            .enqueuer
            .enqueue_scheduled_message(link.id, created.db_id, Some(sqs_delay))
            .await
        {
            let err = anyhow::Error::from(e);
            tracing::error!(error=?err, "failed to enqueue scheduled send, reverting the message to a draft");
            if let Err(revert_err) = self
                .email_repo
                .revert_sent_message_to_draft(created.db_id, link.id)
                .await
            {
                // Both writes failed, so the row is still a non-draft unsent
                // send with a pending scheduled row. That is what the
                // email_scheduled_handler sweep re-enqueues once the row is
                // past its grace period.
                tracing::error!(
                    error=?anyhow::Error::from(revert_err),
                    link_id=%link.id,
                    message_id=%created.db_id,
                    "failed to revert the message after a failed enqueue; leaving it for the scheduled sweep",
                );
            }
            return Err(EmailErr::EnqueueErr(err));
        }

        // The undo-window send is now committed and queued; the matching
        // message_sent / message_send_cancelled event resolves it later,
        // reading the actor back off the scheduled row.
        self.publish_email_event(&EmailMacroEvent::message_send_queued(
            MessageSendQueuedMetadata {
                link_id: link.id,
                owner: link.macro_id.clone(),
                actor,
                message_id: created.db_id,
                thread_id: created.thread_db_id,
                scheduled_send_at: send_time,
                is_scheduled: false,
            },
        ));

        Ok(created)
    }
}
