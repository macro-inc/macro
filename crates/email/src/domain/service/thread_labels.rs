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
use std::ops::Range;
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

    /// Changed Macro-only drafts, which never reach Gmail.
    fn changed_local_messages(&self) -> Vec<Uuid> {
        self.messages
            .iter()
            .filter(|msg| self.changed_ids.contains(&msg.db_id))
            .filter(|msg| msg.provider_id.as_ref().is_none_or(|pid| pid.is_empty()))
            .map(|msg| msg.db_id)
            .collect()
    }
}

/// Staged changes of one label on threads of one inbox, sent to Gmail as one
/// write per group of threads that fits a provider request.
struct ThreadLabelWrite {
    link: Link,
    label: LinkLabel,
    add: bool,
    /// Marks each thread's changed messages as waiting on this write when it
    /// is staged; every group of the write carries it.
    write_id: Uuid,
    threads: Vec<StagedThreadLabels>,
}

/// Threads of a label write that were reverted because their change could not
/// be queued for Gmail.
struct UnsentThreads {
    thread_ids: Vec<Uuid>,
    error: EmailErr,
}

/// Splits threads into consecutive groups whose changed provider messages fit
/// `limit`. A thread with more changed messages than `limit` forms its own
/// group, which the enqueuer splits across several queue messages.
fn label_write_groups(threads: &[StagedThreadLabels], limit: usize) -> Vec<Range<usize>> {
    let mut groups = Vec::new();
    let mut start = 0;
    let mut count = 0;
    for (index, thread) in threads.iter().enumerate() {
        let messages = thread.changed_provider_messages().count();
        if index > start && count + messages > limit {
            groups.push(start..index);
            start = index;
            count = 0;
        }
        count += messages;
    }
    if start < threads.len() {
        groups.push(start..threads.len());
    }
    groups
}

/// Errors about one thread of a bulk request, rather than the service.
fn rejects_thread(error: &EmailErr) -> bool {
    matches!(
        error,
        EmailErr::ThreadNotFound
            | EmailErr::ThreadEmpty
            | EmailErr::ThreadHasNoInboundMessages
            | EmailErr::LabelNotFound
            | EmailErr::EmptyProviderLabelId
            | EmailErr::Unauthorized
    )
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
        self.set_thread_inbox(&link, thread_id, macro_id, !archived)
            .await
    }

    /// Outlook folders have no INBOX label row; only Gmail stores one.
    pub(super) async fn set_thread_inbox(
        &self,
        link: &Link,
        thread_id: Uuid,
        actor: macro_user_id::user_id::MacroUserIdStr<'static>,
        in_inbox: bool,
    ) -> Result<(), EmailErr> {
        if link.provider == UserProvider::Outlook {
            self.queue_outlook_action(link, thread_id, actor, MailboxAction::Archived(!in_inbox))
                .await?;
            return Ok(());
        }
        let label = self
            .link_label_by_provider_id(link.id, system_labels::INBOX)
            .await?;
        self.update_thread_labels_with_actor(link, thread_id, label.id, in_inbox, Some(actor))
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

        let write_id = macro_uuid::generate_uuid_v7();
        let thread = self
            .stage_thread_labels(link, thread_id, &label.provider_label_id, add, write_id)
            .await?;
        let successful_ids = thread.all_ids.clone();
        self.commit_thread_label_write(
            ThreadLabelWrite {
                link: link.clone(),
                label,
                add,
                write_id,
                threads: vec![thread],
            },
            actor,
        )
        .await
        .map_err(|unsent| unsent.error)?;

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
        let mut seen = HashSet::new();
        let thread_ids: Vec<Uuid> = thread_ids
            .into_iter()
            .filter(|id| seen.insert(*id))
            .collect();
        if thread_ids.len() > MAX_BULK_ARCHIVE_THREADS {
            return Err(EmailErr::TooManyThreads(MAX_BULK_ARCHIVE_THREADS));
        }
        let mut result = SetThreadsArchivedResult::default();
        let mut writes: Vec<ThreadLabelWrite> = Vec::new();
        // Reported instead of per-thread failures when nothing changed, so an
        // outage surfaces as an error rather than a list of failed threads.
        let mut service_error = None;
        for thread_id in thread_ids {
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
                            write_id: macro_uuid::generate_uuid_v7(),
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
                        writes[index].write_id,
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
                    if !rejects_thread(&error) {
                        service_error.get_or_insert(error);
                    }
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
                Err(unsent) => {
                    result.updated_thread_ids.extend(
                        thread_ids
                            .into_iter()
                            .filter(|id| !unsent.thread_ids.contains(id)),
                    );
                    result.failed_thread_ids.extend(unsent.thread_ids);
                    service_error.get_or_insert(unsent.error);
                }
            }
        }
        if result.updated_thread_ids.is_empty()
            && let Some(error) = service_error
        {
            return Err(error);
        }
        Ok(result)
    }

    /// Commit one thread's label change to the DB, capturing what sending it
    /// to Gmail or reverting it needs. The messages that change are read in
    /// the same transaction that changes them and marks them pending for
    /// `write_id`: only those go to Gmail, and an enqueue-failure revert
    /// restores only what this call changed.
    async fn stage_thread_labels(
        &self,
        link: &Link,
        thread_id: Uuid,
        provider_label_id: &str,
        add: bool,
        write_id: Uuid,
    ) -> Result<StagedThreadLabels, EmailErr> {
        if provider_label_id.is_empty() {
            return Err(EmailErr::EmptyProviderLabelId);
        }

        let staged = self
            .email_repo
            .stage_thread_label_change(thread_id, link.id, provider_label_id, add, write_id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::ThreadEmpty)?;

        Ok(StagedThreadLabels {
            thread_id,
            all_ids: staged.messages.iter().map(|m| m.db_id).collect(),
            messages: staged.messages,
            changed_ids: staged.changed_ids,
        })
    }

    /// Send staged label changes to Gmail through the gmail_ops worker, then
    /// finish each sent thread. Threads go out in groups whose changed messages
    /// fit one provider write, so a failed enqueue leaves whole threads unsent.
    /// Gmail would never learn about those (there is no worker to retry a
    /// message that was never queued), so they revert and come back as
    /// unsent — mirroring the worker's revert on permanent Gmail errors.
    async fn commit_thread_label_write(
        &self,
        write: ThreadLabelWrite,
        actor: Option<macro_user_id::user_id::MacroUserIdStr<'static>>,
    ) -> Result<(), UnsentThreads> {
        let ThreadLabelWrite {
            link,
            label,
            add,
            write_id,
            mut threads,
        } = write;
        let provider_label_id = label.provider_label_id.as_str();
        let (labels_to_add, labels_to_remove) = if add {
            (vec![provider_label_id.to_string()], vec![])
        } else {
            (vec![], vec![provider_label_id.to_string()])
        };

        let mut unsent = None;
        for group in label_write_groups(&threads, E::MAX_LABEL_WRITE_MESSAGES) {
            let provider_messages: Vec<(Uuid, String)> = threads[group.clone()]
                .iter()
                .flat_map(StagedThreadLabels::changed_provider_messages)
                .collect();
            if provider_messages.is_empty() {
                continue;
            }
            if let Err(e) = self
                .enqueuer
                .enqueue_gmail_ops_modify_labels_batch(
                    link.id,
                    provider_messages,
                    labels_to_add.clone(),
                    labels_to_remove.clone(),
                    write_id,
                )
                .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to enqueue gmail ops label sync, reverting database changes");
                let unsent_threads = threads.split_off(group.start);
                for thread in &unsent_threads {
                    self.revert_label_db_changes(&link, thread, provider_label_id, add, write_id)
                        .await;
                }
                unsent = Some(UnsentThreads {
                    thread_ids: unsent_threads.iter().map(|t| t.thread_id).collect(),
                    error: EmailErr::EnqueueErr(err),
                });
                break;
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

        unsent.map_or(Ok(()), Err)
    }

    /// Best-effort revert of the optimistic label write after the Gmail sync
    /// could not be enqueued. Only `changed_ids` — the messages that actually
    /// gained/lost the label — go back, and a message a newer write changed
    /// since keeps that write's state. Logs on failure: the caller surfaces
    /// the enqueue error regardless, and a pending marker left behind only
    /// keeps inbox sync off that label until it expires.
    async fn revert_label_db_changes(
        &self,
        link: &Link,
        thread: &StagedThreadLabels,
        provider_label_id: &str,
        add: bool,
        write_id: Uuid,
    ) {
        let provider_ids: Vec<Uuid> = thread
            .changed_provider_messages()
            .map(|(id, _)| id)
            .collect();
        if let Err(e) = self
            .email_repo
            .revert_staged_label_change(
                thread.thread_id,
                link.id,
                provider_label_id,
                add,
                write_id,
                &provider_ids,
                &thread.changed_local_messages(),
            )
            .await
        {
            let err = anyhow::Error::from(e);
            tracing::error!(error=?err, "failed to revert label change after enqueue failure");
        }
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
