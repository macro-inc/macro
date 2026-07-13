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

        let created = self
            .prepare_and_insert_db_message(link, accessible_inboxes, input, false)
            .await?;

        // FE displays "Undo" button for delay_secs. Give extra time for round trip of cancel request
        let sqs_delay = delay_secs as i32 + 2;
        self.enqueuer
            .enqueue_scheduled_message(link.id, created.db_id, Some(sqs_delay))
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;

        // The undo-window send is now committed and queued; the matching
        // message_sent / message_send_cancelled event resolves it later.
        // Actor is not tracked on this path — the inbox owner is on `link`.
        self.publish_email_event(&EmailMacroEvent::message_send_queued(
            MessageSendQueuedMetadata {
                link_id: link.id,
                owner: link.macro_id.clone(),
                actor: None,
                message_id: created.db_id,
                thread_id: created.thread_db_id,
                scheduled_send_at: send_time,
                is_scheduled: false,
            },
        ))
        .await;

        Ok(created)
    }
}
