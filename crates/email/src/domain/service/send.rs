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
    /// Queue a Support reply once per canonical message id. A retry repairs a
    /// failed enqueue of the existing scheduled row instead of inserting again.
    pub async fn send_support_reply(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        request_id: uuid::Uuid,
        mut input: CreateDraftInput,
    ) -> Result<(), EmailErr> {
        let link_ids = [link.id];
        if let Some(id) = self
            .email_repo
            .message_id_for_client_draft_id(request_id, &link_ids)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))?
        {
            let message = self
                .email_repo
                .get_simple_message(id, &link_ids)
                .await
                .map_err(|e| EmailErr::RepoErr(e.into()))?
                .ok_or(EmailErr::MessageDeliveryConflict(request_id))?;
            if Some(message.thread_db_id) != input.thread_db_id {
                return Err(EmailErr::MessageDeliveryConflict(request_id));
            }
            if message.is_sent {
                return Ok(());
            }
            let scheduled = self
                .email_repo
                .scheduled_send_times_by_message_ids(&[id])
                .await
                .map_err(|e| EmailErr::RepoErr(e.into()))?;
            let at = scheduled
                .get(&id)
                .ok_or(EmailErr::MessageDeliveryConflict(request_id))?;
            let delay = (*at - chrono::Utc::now()).num_seconds().clamp(0, 900) as i32;
            self.enqueuer
                .enqueue_scheduled_message(link.id, id, Some(delay))
                .await
                .map_err(|e| EmailErr::RepoErr(e.into()))?;
            return Ok(());
        }
        input.db_id = None;
        input.draft_client_binding = Some(request_id);
        self.send_message_impl(link, accessible_inboxes, input)
            .await?;
        Ok(())
    }
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
        self.enqueuer
            .enqueue_scheduled_message(link.id, created.db_id, Some(sqs_delay))
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;

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
