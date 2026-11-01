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
    #[tracing::instrument(skip_all, err)]
    pub(crate) async fn send_message_for_user_impl(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        link_id: Option<uuid::Uuid>,
        mut input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        let inboxes = self
            .email_repo
            .inboxes_for_macro_id(macro_id.clone())
            .await
            .map_err(anyhow::Error::from)?;
        let link = super::draft::resolve_target_link(&inboxes, link_id, &macro_id)?;
        let link_ids: Vec<_> = inboxes.iter().map(|link| link.id).collect();
        self.resolve_client_handles(&mut input, &link_ids).await?;
        input.actor = Some(macro_id);
        self.send_message_impl(link, &inboxes, input).await
    }

    #[tracing::instrument(err, skip(self, link, accessible_inboxes, input))]
    pub(crate) async fn send_message_impl(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        let delay_secs = self.sent_undo_delay_secs;
        let actor = input.actor.clone();

        let created = self
            .prepare_and_insert_db_message(link, accessible_inboxes, input, false)
            .await?;

        let send_time = created
            .send_time
            .ok_or_else(|| anyhow::anyhow!("prepared delivery has no scheduled send time"))?;

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
