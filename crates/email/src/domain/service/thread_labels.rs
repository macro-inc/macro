use crate::domain::{
    events::{
        EmailEventOrigin, EmailMacroEvent, LabelRef, MessageSendCancelledMetadata, SendCancelReason,
    },
    models::{
        EmailErr, Link, LinkLabel, MAX_BULK_ARCHIVE_THREADS, SetThreadsArchivedResult,
        SimpleMessage, UpdateThreadLabelsResult, label::system_labels,
    },
    ports::{EmailMessageEnqueuer, EmailRepo},
};
use frecency::domain::ports::FrecencyQueryService;
use macro_event_broker::MacroEventBroker;
use std::collections::HashSet;
use uuid::Uuid;

use super::EmailServiceImpl;
use crate::domain::models::{UserProvider, mailbox_action::MailboxAction};

/// One thread's label change, committed to the DB but not yet sent to Gmail.
struct StagedThreadLabels {
    thread_id: Uuid,
    messages: Vec<SimpleMessage>,
    all_ids: Vec<Uuid>,
    /// Messages that gain or lose the label; only these go to Gmail or revert.
    changed_ids: Vec<Uuid>,
    /// The thread's inbox visibility before an INBOX change.
    inbox_visible: Option<bool>,
}

impl StagedThreadLabels {
    /// Changed messages Gmail knows about; Macro-only drafts have no provider id.
    fn changed_provider_messages(&self) -> impl Iterator<Item = (Uuid, String)> + '_ {
        self.messages
            .iter()
            .filter(|msg| self.changed_ids.contains(&msg.db_id))
            .filter_map(|msg| {
                msg.provider_id
                    .as_ref()
                    .filter(|pid| !pid.is_empty())
                    .map(|pid| (msg.db_id, pid.clone()))
            })
    }
}

/// Staged changes of one label on threads of one inbox, sent as one Gmail write.
struct ThreadLabelWrite {
    link: Link,
    label: LinkLabel,
    add: bool,
    threads: Vec<StagedThreadLabels>,
}

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
    pub(super) async fn change_thread_mailbox_state_impl(
        &self,
        actor: macro_user_id::user_id::MacroUserIdStr<'static>,
        thread_id: Uuid,
        action: MailboxAction,
    ) -> Result<(), EmailErr> {
        match action {
            MailboxAction::Read(true) => return self.mark_thread_seen_impl(actor, thread_id).await,
            MailboxAction::Read(false) => {
                return self.mark_thread_unread_impl(actor, thread_id).await;
            }
            MailboxAction::Archived(value) => {
                return self.set_thread_archived_impl(actor, thread_id, value).await;
            }
            _ => (),
        }
        let link = self
            .email_repo
            .owned_link_for_thread(thread_id, actor.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::ThreadNotFound)?;
        if link.provider == UserProvider::Outlook {
            self.queue_outlook_action(&link, thread_id, actor, action)
                .await?;
            return Ok(());
        }
        let (provider_id, value) = match &action {
            MailboxAction::Flagged(value) => (system_labels::STARRED, *value),
            MailboxAction::Trashed(value) => (system_labels::TRASH, *value),
            MailboxAction::Junk(value) => (system_labels::SPAM, *value),
            MailboxAction::Category { name, present } => (name.as_str(), *present),
            _ => unreachable!("read and archive handled above"),
        };
        let label = self.link_label_by_provider_id(link.id, provider_id).await?;
        self.update_thread_labels_with_actor(&link, thread_id, label.id, value, Some(actor))
            .await?;
        Ok(())
    }

    /// The email domain selects a bounded message set; persistence commits the
    /// accepted intent and its pending projection together.
    pub(super) async fn queue_outlook_action(
        &self,
        link: &Link,
        thread_id: Uuid,
        actor: macro_user_id::user_id::MacroUserIdStr<'static>,
        action: MailboxAction,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        let messages = self
            .email_repo
            .mailbox_action_messages(link.id, thread_id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        if messages.is_empty() {
            return Err(EmailErr::ThreadNotFound);
        }
        let targets = action.targets(&messages);
        if !targets.is_empty() {
            self.email_repo
                .enqueue_mailbox_action(link.id, actor, &action, &targets)
                .await
                .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        }
        Ok(UpdateThreadLabelsResult {
            successful_ids: targets.iter().map(|t| t.message_id).collect(),
            failed_ids: vec![],
        })
    }
    #[tracing::instrument(err, skip(self), fields(user_id = %macro_id, %thread_id))]
    pub(crate) async fn mark_thread_seen_impl(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Result<(), EmailErr> {
        let link = self
            .email_repo
            .owned_link_for_thread(thread_id, macro_id.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::ThreadNotFound)?;

        let messages = self
            .email_repo
            .get_thread_label_messages(thread_id, link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        if messages.is_empty() {
            return Err(EmailErr::ThreadNotFound);
        }

        self.email_repo
            .upsert_thread_user_history(link.id, thread_id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;

        if link.provider == UserProvider::Outlook {
            self.queue_outlook_action(&link, thread_id, macro_id, MailboxAction::Read(true))
                .await?;
            return Ok(());
        }

        let message_ids: Vec<Uuid> = messages.iter().map(|message| message.db_id).collect();
        let labels_by_message = self
            .email_repo
            .labels_by_message_ids(&message_ids)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        let unread_label_id = labels_by_message
            .values()
            .flatten()
            .find(|label| label.provider_label_id == system_labels::UNREAD)
            .and_then(|label| label.id);

        let Some(unread_label_id) = unread_label_id else {
            // Preserve the seen endpoint's repair behavior when the UNREAD
            // assignments are already absent but the denormalized flag is stale.
            self.email_repo
                .update_thread_read_status(thread_id, link.id, true)
                .await
                .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
            return Ok(());
        };

        self.update_thread_labels_impl(&link, thread_id, unread_label_id, false)
            .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self), fields(user_id = %macro_id, %thread_id))]
    pub(crate) async fn mark_thread_unread_impl(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Result<(), EmailErr> {
        let link = self
            .email_repo
            .owned_link_for_thread(thread_id, macro_id.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::ThreadNotFound)?;

        // Resolve from the authorized thread's inbox, never the caller's primary
        // inbox: multi-inbox users have a distinct UNREAD label for each link.
        if link.provider == UserProvider::Outlook {
            self.queue_outlook_action(&link, thread_id, macro_id, MailboxAction::Read(false))
                .await?;
            return Ok(());
        }
        let unread_label = self
            .link_label_by_provider_id(link.id, system_labels::UNREAD)
            .await?;

        self.update_thread_labels_impl(&link, thread_id, unread_label.id, true)
            .await?;
        Ok(())
    }

    /// Resolve the owning inbox server-side, including delegated inboxes.
    #[tracing::instrument(err, skip(self), fields(user_id = %macro_id, %thread_id, archived))]
    pub(crate) async fn set_thread_archived_impl(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        thread_id: Uuid,
        archived: bool,
    ) -> Result<(), EmailErr> {
        let link = self
            .email_repo
            .owned_link_for_thread(thread_id, macro_id.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::ThreadNotFound)?;
        if !archived {
            self.ensure_thread_has_received_messages(thread_id, link.id)
                .await?;
        }
        if link.provider == UserProvider::Outlook {
            self.queue_outlook_action(
                &link,
                thread_id,
                macro_id,
                MailboxAction::Archived(archived),
            )
            .await?;
            return Ok(());
        }
        let label = self
            .link_label_by_provider_id(link.id, system_labels::INBOX)
            .await?;
        self.update_thread_labels_with_actor(&link, thread_id, label.id, !archived, Some(macro_id))
            .await?;
        Ok(())
    }

    async fn link_label_by_provider_id(
        &self,
        link_id: Uuid,
        provider_label_id: &str,
    ) -> Result<LinkLabel, EmailErr> {
        self.email_repo
            .list_labels_by_link_id(link_id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .into_iter()
            .find(|label| label.provider_label_id == provider_label_id)
            .ok_or(EmailErr::LabelNotFound)
    }

    /// Inbox sorting timestamps disappear after archive/provider sync. Determine
    /// whether a thread can be restored from its messages, not current labels.
    async fn ensure_thread_has_received_messages(
        &self,
        thread_id: Uuid,
        link_id: Uuid,
    ) -> Result<(), EmailErr> {
        let messages = self
            .email_repo
            .get_thread_label_messages(thread_id, link_id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;
        if messages
            .iter()
            .any(|message| !message.is_draft && !message.is_sent)
        {
            return Ok(());
        }

        // A sent message addressed back to its sender is also received mail.
        // Drafts never establish received-message history, even if self-addressed.
        let sent_ids: Vec<_> = messages
            .iter()
            .filter(|message| message.is_sent && !message.is_draft)
            .map(|message| message.db_id)
            .collect();
        if sent_ids.is_empty() {
            return Err(EmailErr::ThreadHasNoInboundMessages);
        }
        let (senders, recipients) = tokio::try_join!(
            async {
                self.email_repo
                    .senders_by_message_ids(&sent_ids)
                    .await
                    .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))
            },
            async {
                self.email_repo
                    .recipients_by_message_ids(&sent_ids)
                    .await
                    .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))
            },
        )?;
        if sent_ids.iter().any(|id| {
            senders.get(id).is_some_and(|sender| {
                recipients.get(id).is_some_and(|recipients| {
                    recipients
                        .iter()
                        .any(|(recipient, _)| recipient.email.eq_ignore_ascii_case(&sender.email))
                })
            })
        }) {
            return Ok(());
        }
        Err(EmailErr::ThreadHasNoInboundMessages)
    }

    #[tracing::instrument(err, skip(self), fields(user_id = %macro_id, %thread_id, %label_id, add))]
    pub(crate) async fn update_thread_labels_for_user_impl(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        let link = self
            .email_repo
            .owned_link_for_thread(thread_id, macro_id.clone())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::ThreadNotFound)?;

        self.update_thread_labels_with_actor(&link, thread_id, label_id, add, Some(macro_id))
            .await
    }

    #[tracing::instrument(err, skip(self, link))]
    pub(crate) async fn update_thread_labels_impl(
        &self,
        link: &Link,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        self.update_thread_labels_with_actor(link, thread_id, label_id, add, None)
            .await
    }

    #[tracing::instrument(err, skip(self, link))]
    pub(super) async fn update_thread_labels_with_actor(
        &self,
        link: &Link,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
        actor: Option<macro_user_id::user_id::MacroUserIdStr<'static>>,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        let label = self
            .email_repo
            .get_label_by_id(label_id, link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::LabelNotFound)?;

        if link.provider == UserProvider::Outlook {
            return self
                .queue_outlook_action(
                    link,
                    thread_id,
                    actor.unwrap_or_else(|| link.macro_id.clone()),
                    MailboxAction::Category {
                        name: label.provider_label_id,
                        present: add,
                    },
                )
                .await;
        }

        let thread = self
            .stage_thread_labels(link, thread_id, &label.provider_label_id, add)
            .await?;
        let successful_ids = thread.all_ids.clone();
        self.commit_thread_label_write(
            ThreadLabelWrite {
                link: link.clone(),
                label,
                add,
                threads: vec![thread],
            },
            actor,
        )
        .await?;

        Ok(UpdateThreadLabelsResult {
            successful_ids,
            failed_ids: vec![],
        })
    }

    /// Archive or unarchive caller-owned/delegated threads, sending Gmail one
    /// write per inbox. A thread that can't change is reported as failed
    /// without failing the others.
    #[tracing::instrument(
        err,
        skip(self, thread_ids),
        fields(user_id = %macro_id, thread_count = thread_ids.len(), archived)
    )]
    pub(crate) async fn set_threads_archived_impl(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
        archived: bool,
    ) -> Result<SetThreadsArchivedResult, EmailErr> {
        if thread_ids.len() > MAX_BULK_ARCHIVE_THREADS {
            return Err(EmailErr::TooManyThreads(MAX_BULK_ARCHIVE_THREADS));
        }
        let mut result = SetThreadsArchivedResult::default();
        let mut writes: Vec<ThreadLabelWrite> = Vec::new();
        let mut seen = HashSet::new();
        for thread_id in thread_ids.into_iter().filter(|id| seen.insert(*id)) {
            let staged: Result<Option<(usize, StagedThreadLabels)>, EmailErr> = async {
                let link = self
                    .email_repo
                    .owned_link_for_thread(thread_id, macro_id.clone())
                    .await
                    .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
                    .ok_or(EmailErr::ThreadNotFound)?;
                if !archived {
                    self.ensure_thread_has_received_messages(thread_id, link.id)
                        .await?;
                }
                if link.provider == UserProvider::Outlook {
                    self.queue_outlook_action(
                        &link,
                        thread_id,
                        macro_id.clone(),
                        MailboxAction::Archived(archived),
                    )
                    .await?;
                    return Ok(None);
                }
                let index = match writes.iter().position(|write| write.link.id == link.id) {
                    Some(index) => index,
                    None => {
                        let label = self
                            .link_label_by_provider_id(link.id, system_labels::INBOX)
                            .await?;
                        writes.push(ThreadLabelWrite {
                            link,
                            label,
                            add: !archived,
                            threads: Vec::new(),
                        });
                        writes.len() - 1
                    }
                };
                let thread = self
                    .stage_thread_labels(
                        &writes[index].link,
                        thread_id,
                        system_labels::INBOX,
                        !archived,
                    )
                    .await?;
                Ok(Some((index, thread)))
            }
            .await;
            match staged {
                Ok(None) => result.updated_thread_ids.push(thread_id),
                Ok(Some((index, thread))) => writes[index].threads.push(thread),
                Err(error) => {
                    tracing::warn!(error = ?error, %thread_id, "thread left out of bulk archive");
                    result.failed_thread_ids.push(thread_id);
                }
            }
        }

        for write in writes {
            let thread_ids: Vec<Uuid> = write.threads.iter().map(|t| t.thread_id).collect();
            match self
                .commit_thread_label_write(write, Some(macro_id.clone()))
                .await
            {
                Ok(()) => result.updated_thread_ids.extend(thread_ids),
                Err(_) => result.failed_thread_ids.extend(thread_ids),
            }
        }
        Ok(result)
    }

    /// Commit one thread's label change to the DB, capturing what sending it
    /// to Gmail or reverting it needs.
    async fn stage_thread_labels(
        &self,
        link: &Link,
        thread_id: Uuid,
        provider_label_id: &str,
        add: bool,
    ) -> Result<StagedThreadLabels, EmailErr> {
        let messages = self
            .email_repo
            .get_thread_label_messages(thread_id, link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;

        if messages.is_empty() {
            return Err(EmailErr::ThreadEmpty);
        }

        if provider_label_id.is_empty() {
            return Err(EmailErr::EmptyProviderLabelId);
        }

        let all_ids: Vec<Uuid> = messages.iter().map(|m| m.db_id).collect();

        // Snapshot which messages actually gain/lose the label. Only those go
        // to Gmail, and an enqueue-failure revert restores only what this call
        // changed — the batch writes are idempotent, and blindly inverting
        // every message would strip pre-existing state. Best effort: if the
        // snapshot read fails, fall back to treating all messages as changed.
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
                if provider_label_id == system_labels::INBOX {
                    return Err(EmailErr::RepoErr(err));
                }
                tracing::warn!(error=?err, "failed to snapshot message labels; revert would cover all messages");
                all_ids.clone()
            }
        };

        let inbox_visible = if provider_label_id == system_labels::INBOX {
            Some(
                self.email_repo
                    .thread_by_id(thread_id)
                    .await
                    .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
                    .ok_or(EmailErr::ThreadNotFound)?
                    .inbox_visible,
            )
        } else {
            None
        };

        // Optimistic DB update: update all messages first
        self.apply_label_db_changes(link, thread_id, &all_ids, provider_label_id, add)
            .await?;

        Ok(StagedThreadLabels {
            thread_id,
            messages,
            all_ids,
            changed_ids,
            inbox_visible,
        })
    }

    /// Send staged label changes to Gmail as one write through the gmail_ops
    /// worker, then finish each thread. Enqueue failure means Gmail would
    /// never learn about the changes (there is no worker to retry a message
    /// that was never queued), so every thread reverts and the call fails —
    /// mirroring the worker's revert on permanent Gmail errors.
    async fn commit_thread_label_write(
        &self,
        write: ThreadLabelWrite,
        actor: Option<macro_user_id::user_id::MacroUserIdStr<'static>>,
    ) -> Result<(), EmailErr> {
        let ThreadLabelWrite {
            link,
            label,
            add,
            threads,
        } = write;
        let provider_label_id = label.provider_label_id.as_str();
        let provider_messages: Vec<(Uuid, String)> = threads
            .iter()
            .flat_map(StagedThreadLabels::changed_provider_messages)
            .collect();

        if !provider_messages.is_empty() {
            let (labels_to_add, labels_to_remove) = if add {
                (vec![provider_label_id.to_string()], vec![])
            } else {
                (vec![], vec![provider_label_id.to_string()])
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
                for thread in &threads {
                    self.revert_label_db_changes(&link, thread, provider_label_id, add)
                        .await;
                }
                return Err(EmailErr::EnqueueErr(err));
            }
        }

        for thread in &threads {
            // When trashing a thread, cancel any pending scheduled sends for
            // drafts. After the enqueue, so an enqueue failure can't strand
            // cancelled sends (macro drafts have no provider id and are never
            // in the enqueue payload).
            let mut cancelled_send_ids: Vec<Uuid> = Vec::new();
            if add && provider_label_id == system_labels::TRASH {
                let draft_message_ids: Vec<_> = thread
                    .messages
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
            // writes are committed and the provider sync is queued. The
            // provider echo of this change finds no label diff during inbox
            // sync, so each change publishes only once.
            self.publish_thread_label_events(
                &link,
                thread.thread_id,
                &label,
                add,
                &cancelled_send_ids,
                actor.clone(),
            );
        }

        Ok(())
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
        thread: &StagedThreadLabels,
        provider_label_id: &str,
        add: bool,
    ) {
        let StagedThreadLabels {
            thread_id,
            all_ids,
            changed_ids,
            inbox_visible,
            ..
        } = thread;
        let thread_id = *thread_id;
        if let Some(inbox_visible) = *inbox_visible {
            if let Err(e) = self
                .email_repo
                .set_thread_inbox_state(thread_id, link.id, changed_ids, !add, inbox_visible)
                .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to revert thread inbox state after enqueue failure");
            }
            return;
        }
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

    /// Apply a thread label change to the DB. UNREAD/read flags and INBOX/
    /// visibility commit atomically; a failure propagates before provider sync
    /// or events. Other labels retain their best-effort starred side effect.
    async fn apply_label_db_changes(
        &self,
        link: &Link,
        thread_id: Uuid,
        message_ids: &[Uuid],
        provider_label_id: &str,
        add: bool,
    ) -> Result<(), EmailErr> {
        if provider_label_id == system_labels::INBOX {
            return self
                .email_repo
                .set_thread_inbox_state(thread_id, link.id, message_ids, add, add)
                .await
                .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)));
        }
        if provider_label_id == system_labels::UNREAD {
            return self
                .email_repo
                .set_thread_read_state(thread_id, link.id, message_ids, !add)
                .await
                .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)));
        }

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

        if provider_label_id == system_labels::STARRED
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
        actor: Option<macro_user_id::user_id::MacroUserIdStr<'static>>,
    ) {
        let event = EmailMacroEvent::thread_label_change(
            link.id,
            link.macro_id.clone(),
            actor.clone(),
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
                    actor: actor.clone(),
                    message_id: *message_id,
                    thread_id,
                    reason: SendCancelReason::ThreadTrashed,
                },
            ));
        }
    }
}
