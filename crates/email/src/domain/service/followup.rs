use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::{
    followup::{EmailFollowupMailbox, EmailFollowupRepo, FollowupThread},
    models::{EmailErr, label::system_labels},
    ports::{EmailMessageEnqueuer, EmailRepo},
};
use frecency::domain::ports::FrecencyQueryService;
use macro_event_broker::MacroEventBroker;

use super::EmailServiceImpl;

impl<T, U, E, CS, Eam, B> EmailFollowupMailbox for EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo + EmailFollowupRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    Eam: Send + Sync + 'static,
    B: MacroEventBroker,
    anyhow::Error: From<T::Err> + From<E::Err>,
{
    async fn followup_thread(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Result<Option<FollowupThread>, EmailErr> {
        let Some(link) = self
            .email_repo
            .owned_link_for_thread(thread_id, user.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
        else {
            return Ok(None);
        };
        let Some(thread) = self
            .email_repo
            .thread_by_id(thread_id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
        else {
            return Ok(None);
        };
        let messages = self
            .email_repo
            .followup_messages(user, thread_id, link.id)
            .await?;
        if messages.is_empty() {
            return Ok(None);
        }
        let labels = self
            .email_repo
            .labels_by_thread_ids(&[thread_id])
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        let latest = self
            .email_repo
            .latest_content_message_rows(&[thread_id])
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        Ok(Some(FollowupThread {
            link_id: link.id,
            subject: latest
                .into_iter()
                .next()
                .and_then(|message| message.subject)
                .filter(|subject| !subject.trim().is_empty())
                .unwrap_or_else(|| "Email follow-up".into()),
            inbox_visible: thread.inbox_visible,
            returned_at: self
                .email_repo
                .followup_returned_at(thread_id, link.id)
                .await?,
            unavailable: labels.iter().any(|label| {
                matches!(
                    label.provider_label_id.as_str(),
                    system_labels::TRASH | system_labels::SPAM
                )
            }),
            messages,
        }))
    }

    async fn set_followup_inbox(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        link_id: Uuid,
        visible: bool,
        returned_at: Option<DateTime<Utc>>,
    ) -> Result<(), EmailErr> {
        let facts = self
            .followup_thread(user.clone(), thread_id)
            .await?
            .filter(|facts| facts.link_id == link_id && !facts.unavailable)
            .ok_or(EmailErr::ThreadNotFound)?;
        let link = self
            .email_repo
            .owned_link_for_thread(thread_id, user.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .filter(|link| link.id == facts.link_id)
            .ok_or(EmailErr::ThreadNotFound)?;
        let label = self
            .email_repo
            .list_labels_by_link_id(link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .into_iter()
            .find(|label| label.provider_label_id == system_labels::INBOX)
            .ok_or(EmailErr::LabelNotFound)?;
        // Persist the explicit return before provider work/events can observe
        // INBOX, so sent-only metadata reconciliation sees the same intent.
        // A failed label write leaves a timestamp on an archived thread, which
        // remains excluded by inbox visibility and is retried by the workflow.
        if visible {
            self.email_repo
                .set_followup_returned_at(thread_id, link_id, returned_at)
                .await?;
        }
        self.update_thread_labels_with_actor(&link, thread_id, label.id, visible, Some(user))
            .await?;
        if !visible {
            self.email_repo
                .set_followup_returned_at(thread_id, link_id, None)
                .await?;
        }
        Ok(())
    }
}
