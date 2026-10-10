use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{Duration, Utc};
use frecency::domain::ports::FrecencyQueryService;
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{EmailServiceImpl, draft::resolve_target_link};
use crate::domain::{
    events::{
        EmailMacroEvent, MessageSendCancelledMetadata, MessageSendQueuedMetadata, SendCancelReason,
    },
    models::EmailErr,
    ports::{EmailMessageEnqueuer, EmailRepo},
    send_attempt::{
        EmailSendRepo, EmailSendService, PreparedSend, SendAttempt, SendAttemptId,
        SendAttemptStatus, SendSnapshot,
    },
};

impl<T, U, E, CS, Eam, B> EmailSendService for EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo + EmailSendRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    Eam: Send + Sync,
    B: MacroEventBroker,
    anyhow::Error: From<T::Err> + From<E::Err>,
{
    #[tracing::instrument(skip_all, err)]
    async fn send_email(
        &self,
        actor: MacroUserIdStr<'static>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
        snapshot: SendSnapshot,
    ) -> Result<SendAttempt, EmailErr> {
        let inboxes = self
            .email_repo
            .inboxes_for_macro_id(actor.clone())
            .await
            .map_err(anyhow::Error::from)?;
        let link = resolve_target_link(&inboxes, Some(link_id), &actor)?;
        if let Some(attempt) = self
            .email_repo
            .read_send_attempt(&actor, link_id, attempt_id, Some(&snapshot))
            .await?
        {
            return self.hydrate_send_attempt(link_id, attempt).await;
        }
        let prepare = async {
            if snapshot.message.db_id.is_none()
                || snapshot.message.to.is_empty()
                    && snapshot.message.cc.is_empty()
                    && snapshot.message.bcc.is_empty()
            {
                return Err(EmailErr::InvalidSendSnapshot(
                    "a draft handle and recipients are required".into(),
                ));
            }
            let mut input = snapshot.message.clone();
            let accessible_ids: Vec<_> = inboxes.iter().map(|link| link.id).collect();
            self.resolve_client_handles(&mut input, &accessible_ids)
                .await?;
            input.actor = Some(actor.clone());
            input.send_time =
                Some(Utc::now() + Duration::seconds(self.sent_undo_delay_secs.into()));
            let (message, contacts, new_thread, source_inbox) = self
                .prepare_message(link, &inboxes, input, false, true)
                .await?;
            if source_inbox.is_some() && !snapshot.forwarded_attachment_ids.is_empty() {
                return Err(EmailErr::InvalidSendSnapshot(
                    "forwarded attachments belong to the original inbox; select that inbox or upload the files before sending".into(),
                ));
            }
            let restore_html = snapshot
                .restore_body_html
                .as_ref()
                .or(snapshot.message.body_html.as_ref())
                .map(|html| {
                    let html = String::from_utf8(URL_SAFE_NO_PAD.decode(html)?)?;
                    Ok::<_, EmailErr>(email_utils::sanitize_authored_html(&html))
                })
                .transpose()?;
            Ok(PreparedSend {
                source_inbox,
                undo_delay_secs: self.sent_undo_delay_secs,
                snapshot: snapshot.clone(),
                message,
                contacts,
                new_thread,
                restore_html,
                restore_text: snapshot
                    .restore_body_text
                    .clone()
                    .or_else(|| snapshot.message.body_text.clone()),
                restore_macro: snapshot
                    .restore_body_macro
                    .clone()
                    .or_else(|| snapshot.message.body_macro.clone()),
            })
        }
        .await;
        let prepared = match prepare {
            Ok(prepared) => prepared,
            Err(error) => {
                // Another invocation can admit while this one is validating the draft.
                return match self
                    .email_repo
                    .read_send_attempt(&actor, link_id, attempt_id, Some(&snapshot))
                    .await?
                {
                    Some(attempt) => self.hydrate_send_attempt(link_id, attempt).await,
                    None => Err(error),
                };
            }
        };
        let attempt = self
            .email_repo
            .admit_send(&actor, link_id, attempt_id, prepared)
            .await?;
        if let (SendAttemptStatus::Accepted, Some(message_id), Some(thread_id), Some(send_time)) = (
            attempt.status,
            attempt.message_id,
            attempt.thread_id,
            attempt.send_time,
        ) && attempt.transitioned
        {
            // The database is the durable handoff. The scheduled scanner repairs a
            // failed notification; returning failure here would misstate admission.
            let delay = (send_time - Utc::now()).num_seconds().max(0) + 2;
            let _ = self.enqueuer.enqueue_scheduled_message(link_id, message_id, Some(delay.min(900) as i32)).await.map_err(anyhow::Error::from).inspect_err(|error| {
                tracing::warn!(error=?error, %message_id, "send admitted; scanner will recover notification");
            });
            self.publish_email_event(&EmailMacroEvent::message_send_queued(
                MessageSendQueuedMetadata {
                    link_id,
                    owner: link.macro_id.clone(),
                    actor: Some(actor),
                    message_id,
                    thread_id,
                    scheduled_send_at: send_time,
                    is_scheduled: false,
                },
            ));
        }
        self.hydrate_send_attempt(link_id, attempt).await
    }

    #[tracing::instrument(skip_all, err)]
    async fn cancel_email_send(
        &self,
        actor: MacroUserIdStr<'static>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
    ) -> Result<SendAttempt, EmailErr> {
        let inboxes = self
            .email_repo
            .inboxes_for_macro_id(actor.clone())
            .await
            .map_err(anyhow::Error::from)?;
        let link = resolve_target_link(&inboxes, Some(link_id), &actor)?;
        let attempt = self
            .email_repo
            .cancel_send(&actor, link_id, attempt_id)
            .await?;
        if let (SendAttemptStatus::Cancelled, Some(message_id), Some(thread_id)) =
            (attempt.status, attempt.message_id, attempt.thread_id)
            && attempt.transitioned
        {
            self.publish_email_event(&EmailMacroEvent::message_send_cancelled(
                MessageSendCancelledMetadata {
                    link_id,
                    owner: link.macro_id.clone(),
                    actor: Some(actor),
                    message_id,
                    thread_id,
                    reason: SendCancelReason::Undo,
                },
            ));
        }
        self.hydrate_send_attempt(link_id, attempt).await
    }

    #[tracing::instrument(skip_all, err)]
    async fn email_send_status(
        &self,
        actor: MacroUserIdStr<'static>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
    ) -> Result<Option<SendAttempt>, EmailErr> {
        let inboxes = self
            .email_repo
            .inboxes_for_macro_id(actor.clone())
            .await
            .map_err(anyhow::Error::from)?;
        resolve_target_link(&inboxes, Some(link_id), &actor)?;
        match self
            .email_repo
            .read_send_attempt(&actor, link_id, attempt_id, None)
            .await?
        {
            Some(attempt) => self.hydrate_send_attempt(link_id, attempt).await.map(Some),
            None => Ok(None),
        }
    }
}

impl EmailSendService for crate::domain::ports::NoOpEmailService {
    async fn send_email(
        &self,
        _: MacroUserIdStr<'static>,
        _: Uuid,
        _: SendAttemptId,
        _: SendSnapshot,
    ) -> Result<SendAttempt, EmailErr> {
        Err(EmailErr::Unauthorized)
    }
    async fn cancel_email_send(
        &self,
        _: MacroUserIdStr<'static>,
        _: Uuid,
        _: SendAttemptId,
    ) -> Result<SendAttempt, EmailErr> {
        Err(EmailErr::Unauthorized)
    }
    async fn email_send_status(
        &self,
        _: MacroUserIdStr<'static>,
        _: Uuid,
        _: SendAttemptId,
    ) -> Result<Option<SendAttempt>, EmailErr> {
        Err(EmailErr::Unauthorized)
    }
}

impl<T, U, E, CS, Eam, B> EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo + EmailSendRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    anyhow::Error: From<T::Err>,
{
    async fn hydrate_send_attempt(
        &self,
        link: Uuid,
        mut attempt: SendAttempt,
    ) -> Result<SendAttempt, EmailErr> {
        let Some(message_id) = attempt.message_id else {
            return Ok(attempt);
        };
        let Some(row) = self.email_repo.send_message_row(link, message_id).await? else {
            return Ok(attempt);
        };
        let ids = [message_id];
        let (senders, recipients, labels) = tokio::try_join!(
            self.email_repo.senders_by_message_ids(&ids),
            self.email_repo.recipients_by_message_ids(&ids),
            self.email_repo.labels_by_message_ids(&ids),
        )
        .map_err(anyhow::Error::from)?;
        attempt.message = self
            .hydrate_full_messages(vec![row], senders, recipients, labels, true)
            .await?
            .pop();
        Ok(attempt)
    }
}
