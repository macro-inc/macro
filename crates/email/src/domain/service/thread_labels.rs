use crate::domain::{
    events::{
        EmailEventOrigin, EmailMacroEvent, LabelRef, MessageSendCancelledMetadata, SendCancelReason,
    },
    models::{EmailErr, Link, LinkLabel, UpdateThreadLabelsResult, label::system_labels},
    ports::{EmailMessageEnqueuer, EmailRepo},
};
use frecency::domain::ports::FrecencyQueryService;
use macro_event_broker::MacroEventBroker;
use uuid::Uuid;

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
    #[tracing::instrument(err, skip(self, _access_token, link))]
    pub(crate) async fn update_thread_labels_impl(
        &self,
        _access_token: &str,
        link: &Link,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        let label = self
            .email_repo
            .get_label_by_id(label_id, link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::LabelNotFound)?;

        let messages = self
            .email_repo
            .get_thread_label_messages(thread_id, link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;

        if messages.is_empty() {
            return Err(EmailErr::ThreadEmpty);
        }

        let provider_label_id = label.provider_label_id.clone();

        if provider_label_id.is_empty() {
            return Err(EmailErr::EmptyProviderLabelId);
        }

        let all_ids: Vec<Uuid> = messages.iter().map(|m| m.db_id).collect();

        // Optimistic DB update: update all messages first
        let db_result = if add {
            self.email_repo
                .insert_message_labels_batch(&all_ids, &provider_label_id, link.id)
                .await
        } else {
            self.email_repo
                .delete_message_labels_batch(&all_ids, &provider_label_id, link.id)
                .await
        };

        if let Err(e) = db_result {
            let err = anyhow::Error::from(e);
            tracing::error!(error=?err, "failed to update message labels in database");
            return Err(EmailErr::RepoErr(err));
        }

        // Side effects for system labels
        if provider_label_id == system_labels::UNREAD {
            if let Err(e) = self
                .email_repo
                .update_message_read_status_batch(&all_ids, link.id, !add)
                .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to update message read status");
            }
        } else if provider_label_id == system_labels::STARRED
            && let Err(e) = self
                .email_repo
                .update_message_starred_status_batch(&all_ids, link.id, add)
                .await
        {
            let err = anyhow::Error::from(e);
            tracing::error!(error=?err, "failed to update message starred status");
        }

        // When trashing a thread, cancel any pending scheduled sends for drafts
        let mut cancelled_send_ids: Vec<Uuid> = Vec::new();
        if add && provider_label_id == system_labels::TRASH {
            let draft_message_ids: Vec<_> = messages
                .iter()
                .filter(|m| m.is_draft)
                .map(|m| m.db_id)
                .collect();

            if !draft_message_ids.is_empty() {
                match self
                    .email_repo
                    .delete_scheduled_messages_batch(&draft_message_ids, link.id)
                    .await
                {
                    Ok(deleted) => cancelled_send_ids = deleted,
                    Err(e) => {
                        let err = anyhow::Error::from(e);
                        tracing::error!(error=?err, "failed to cancel scheduled sends for trashed drafts");
                    }
                }
            }
        }

        // Publish semantic macro.email events now that the optimistic DB
        // writes are committed. The provider echo of this change finds no
        // label diff during inbox sync, so each change publishes only once.
        self.publish_thread_label_events(link, thread_id, &label, add, &cancelled_send_ids)
            .await;

        // Enqueue Gmail API calls via the gmail_ops worker (provider messages only)
        let provider_messages: Vec<(Uuid, String)> = messages
            .iter()
            .filter_map(|msg| {
                msg.provider_id
                    .as_ref()
                    .filter(|pid| !pid.is_empty())
                    .map(|pid| (msg.db_id, pid.clone()))
            })
            .collect();

        if !provider_messages.is_empty() {
            let (labels_to_add, labels_to_remove) = if add {
                (vec![provider_label_id.clone()], vec![])
            } else {
                (vec![], vec![provider_label_id.clone()])
            };

            self.enqueuer
                .enqueue_gmail_ops_modify_labels_batch(
                    link.id,
                    provider_messages,
                    labels_to_add,
                    labels_to_remove,
                )
                .await
                .map_err(|e| EmailErr::EnqueueErr(anyhow::Error::from(e)))?;
        }

        Ok(UpdateThreadLabelsResult {
            successful_ids: all_ids,
            failed_ids: vec![],
        })
    }

    /// Map a user-initiated thread label change onto the semantic
    /// macro.email event for that label (see
    /// [`EmailMacroEvent::thread_label_change`]). Scheduled sends cancelled
    /// by trashing publish `message_send_cancelled`. Actor is not tracked on
    /// this path — the inbox owner is on `link`.
    async fn publish_thread_label_events(
        &self,
        link: &Link,
        thread_id: Uuid,
        label: &LinkLabel,
        add: bool,
        cancelled_send_ids: &[Uuid],
    ) {
        let event = EmailMacroEvent::thread_label_change(
            link.id,
            link.macro_id.clone(),
            None,
            thread_id,
            LabelRef {
                label_id: Some(label.id),
                provider_label_id: label.provider_label_id.clone(),
                name: Some(label.name.clone()),
            },
            add,
            EmailEventOrigin::UserAction,
        );

        if let Some(event) = event {
            self.publish_email_event(&event).await;
        }

        for message_id in cancelled_send_ids {
            self.publish_email_event(&EmailMacroEvent::message_send_cancelled(
                MessageSendCancelledMetadata {
                    link_id: link.id,
                    owner: link.macro_id.clone(),
                    actor: None,
                    message_id: *message_id,
                    thread_id,
                    reason: SendCancelReason::ThreadTrashed,
                },
            ))
            .await;
        }
    }
}
