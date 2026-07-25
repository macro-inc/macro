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
    #[tracing::instrument(err, skip(self, link))]
    pub(crate) async fn update_thread_labels_impl(
        &self,
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

        // Snapshot which messages actually gain/lose the label, so an
        // enqueue-failure revert restores only what this call changed — the
        // batch writes are idempotent, and blindly inverting every message
        // would strip pre-existing state. Best effort: if the snapshot read
        // fails, fall back to treating all messages as changed.
        let changed_ids: Vec<Uuid> = match self.email_repo.labels_by_message_ids(&all_ids).await {
            Ok(labels_by_id) => all_ids
                .iter()
                .filter(|id| {
                    let has_label = labels_by_id.get(id).is_some_and(|labels| {
                        labels
                            .iter()
                            .any(|l| l.provider_label_id == provider_label_id)
                    });
                    has_label != add
                })
                .copied()
                .collect(),
            Err(e) => {
                let err = anyhow::Error::from(e);
                tracing::warn!(error=?err, "failed to snapshot message labels; revert would cover all messages");
                all_ids.clone()
            }
        };

        // Optimistic DB update: update all messages first
        self.apply_label_db_changes(link, thread_id, &all_ids, &provider_label_id, add)
            .await?;

        // Enqueue Gmail API calls via the gmail_ops worker (provider messages
        // only). Enqueue failure means Gmail would never learn about this
        // change (there is no worker to retry a message that was never
        // queued), so revert the optimistic DB writes and fail — mirroring
        // the worker's revert on permanent Gmail errors.
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

            if let Err(e) = self
                .enqueuer
                .enqueue_gmail_ops_modify_labels_batch(
                    link.id,
                    provider_messages,
                    labels_to_add,
                    labels_to_remove,
                )
                .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to enqueue gmail ops label sync, reverting database changes");
                self.revert_label_db_changes(
                    link,
                    thread_id,
                    &all_ids,
                    &changed_ids,
                    &provider_label_id,
                    add,
                )
                .await;
                return Err(EmailErr::EnqueueErr(err));
            }
        }

        // When trashing a thread, cancel any pending scheduled sends for
        // drafts. After the enqueue, so an enqueue failure can't strand
        // cancelled sends (macro drafts have no provider id and are never in
        // the enqueue payload).
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
        // writes are committed and the provider sync is queued. The provider
        // echo of this change finds no label diff during inbox sync, so each
        // change publishes only once.
        self.publish_thread_label_events(link, thread_id, &label, add, &cancelled_send_ids);

        Ok(UpdateThreadLabelsResult {
            successful_ids: all_ids,
            failed_ids: vec![],
        })
    }

    /// Best-effort revert of the optimistic label write after the Gmail sync
    /// could not be enqueued. Only `changed_ids` — the messages that actually
    /// gained/lost the label — are inverted, so messages that already held
    /// the requested state keep it; the denormalized thread read flag is
    /// restored to its derived pre-op value. Every step logs and continues on
    /// failure: the caller surfaces the enqueue error regardless.
    async fn revert_label_db_changes(
        &self,
        link: &Link,
        thread_id: Uuid,
        all_ids: &[Uuid],
        changed_ids: &[Uuid],
        provider_label_id: &str,
        add: bool,
    ) {
        if !changed_ids.is_empty() {
            let db_result = if add {
                self.email_repo
                    .delete_message_labels_batch(changed_ids, provider_label_id, link.id)
                    .await
            } else {
                self.email_repo
                    .insert_message_labels_batch(changed_ids, provider_label_id, link.id)
                    .await
            };
            if let Err(e) = db_result {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to revert message labels after enqueue failure");
            }
        }

        if provider_label_id == system_labels::UNREAD {
            // Restore is_read on the flipped messages: they were read before
            // an UNREAD add (`add` == true) and unread before a removal.
            if !changed_ids.is_empty()
                && let Err(e) = self
                    .email_repo
                    .update_message_read_status_batch(changed_ids, link.id, add)
                    .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to revert message read status after enqueue failure");
            }
            // Pre-op unread set: everything outside `changed_ids` for an add,
            // `changed_ids` itself for a removal — the thread was read iff
            // that set was empty.
            let original_is_read = if add {
                changed_ids.len() == all_ids.len()
            } else {
                changed_ids.is_empty()
            };
            if let Err(e) = self
                .email_repo
                .update_thread_read_status(thread_id, link.id, original_is_read)
                .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to revert thread read status after enqueue failure");
            }
        } else if provider_label_id == system_labels::STARRED
            && !changed_ids.is_empty()
            && let Err(e) = self
                .email_repo
                .update_message_starred_status_batch(changed_ids, link.id, !add)
                .await
        {
            let err = anyhow::Error::from(e);
            tracing::error!(error=?err, "failed to revert message starred status after enqueue failure");
        }
    }

    /// Apply a thread label change to the DB: the label rows plus the
    /// denormalized read/starred state for system labels. The label write is
    /// a hard error; the denormalized side effects are logged and skipped.
    async fn apply_label_db_changes(
        &self,
        link: &Link,
        thread_id: Uuid,
        message_ids: &[Uuid],
        provider_label_id: &str,
        add: bool,
    ) -> Result<(), EmailErr> {
        let db_result = if add {
            self.email_repo
                .insert_message_labels_batch(message_ids, provider_label_id, link.id)
                .await
        } else {
            self.email_repo
                .delete_message_labels_batch(message_ids, provider_label_id, link.id)
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
                .update_message_read_status_batch(message_ids, link.id, !add)
                .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to update message read status");
            }
            // Keep the denormalized thread flag in sync — soup previews read it.
            if let Err(e) = self
                .email_repo
                .update_thread_read_status(thread_id, link.id, !add)
                .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to update thread read status");
            }
        } else if provider_label_id == system_labels::STARRED
            && let Err(e) = self
                .email_repo
                .update_message_starred_status_batch(message_ids, link.id, add)
                .await
        {
            let err = anyhow::Error::from(e);
            tracing::error!(error=?err, "failed to update message starred status");
        }

        Ok(())
    }

    /// Map a user-initiated thread label change onto the semantic
    /// macro.email event for that label (see
    /// [`EmailMacroEvent::thread_label_change`]). Scheduled sends cancelled
    /// by trashing publish `message_send_cancelled`. Actor is not tracked on
    /// this path — the inbox owner is on `link`.
    fn publish_thread_label_events(
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
            self.publish_email_event(&event);
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
            ));
        }
    }
}
