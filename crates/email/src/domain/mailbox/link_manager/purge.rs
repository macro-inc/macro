//! Incremental mailbox-purge policy, with transaction-scoped persistence ports.

mod ports;
#[cfg(test)]
mod test;
pub use ports::*;

use std::num::NonZeroU32;
use std::time::Duration;
use uuid::Uuid;

/// How fast [`LinkPurgeService::purge_link`] removes a link's data. Every batch commits on its own, so no
/// single transaction holds locks, WAL or the xmin horizon for a whole mailbox, and the
/// pause between batches caps how much write I/O one purge generates, so several purges
/// running at once can't saturate the database.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PurgePacing {
    /// Messages per transaction, deleted together with their labels, recipients,
    /// attachments and scheduled sends, and with the threads the batch finishes. Message
    /// bodies are most of a mailbox's bytes (TOAST), so this is the knob that bounds a
    /// transaction's WAL.
    pub messages: NonZeroU32,
    /// Threads per transaction for threads left once every message is gone.
    pub threads: NonZeroU32,
    /// Contacts per transaction.
    pub contacts: NonZeroU32,
    /// Wait after a full batch before the next one starts.
    pub pause: Duration,
}

impl Default for PurgePacing {
    fn default() -> Self {
        Self {
            messages: NonZeroU32::new(500).expect("non-zero"),
            threads: NonZeroU32::new(2_000).expect("non-zero"),
            contacts: NonZeroU32::new(5_000).expect("non-zero"),
            pause: Duration::from_secs(2),
        }
    }
}

/// Rows removed by one [`LinkPurgeService::purge_link`] call. A rerun reports only what it removed itself.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PurgeSummary {
    /// Messages deleted.
    pub messages: u64,
    /// Threads deleted.
    pub threads: u64,
    /// Contacts deleted.
    pub contacts: u64,
    /// Whether this call deleted the `email_links` row; `false` when it was already gone.
    pub link_deleted: bool,
}

/// Deletes one mailbox incrementally without owning database transport.
pub struct LinkPurgeService<R> {
    /// Transaction-scoped facts and effects for the existing purge SQL.
    pub repository: R,
}

impl<R: LinkPurgeRepository> LinkPurgeService<R> {
    /// Deletes a link and all of its email data incrementally: messages (deepest children
    /// first) with the threads they belong to, then any remaining threads, then contacts,
    /// each in bounded short transactions paced by `pacing`, and finally the `email_links`
    /// row, whose cascade only has small per-link tables left to clear.
    ///
    /// Marks the link via [the repository mark](LinkPurgeRepository::mark_link_deleting) first, so it can be called on its own. Safe to
    /// rerun after a crash (it resumes from whatever is left) and to run concurrently for the
    /// same link: batches for one link are serialized by an advisory lock.
    #[tracing::instrument(skip(self), err)]
    pub async fn purge_link(
        &self,
        link_id: Uuid,
        pacing: PurgePacing,
    ) -> anyhow::Result<PurgeSummary> {
        self.repository.mark_link_deleting(link_id).await?;

        let mut summary = PurgeSummary::default();
        (summary.messages, summary.threads) = self.purge_messages(link_id, pacing).await?;
        summary.threads += self.purge_threads(link_id, pacing).await?;
        summary.contacts = self.purge_contacts(link_id, pacing).await?;
        summary.link_deleted = self.delete_marked_link(link_id).await?;

        tracing::info!(?summary, "Purged email link");
        Ok(summary)
    }

    /// Deletes the link's messages with the threads each batch finishes, returning how many
    /// of each it deleted.
    #[tracing::instrument(
    name = "email.purge_link.messages",
    skip_all,
    fields(
        batches = tracing::field::Empty,
        paused_ms = tracing::field::Empty,
        messages = tracing::field::Empty,
        threads = tracing::field::Empty,
    ),
    err
)]
    async fn purge_messages(
        &self,
        link_id: Uuid,
        pacing: PurgePacing,
    ) -> anyhow::Result<(u64, u64)> {
        let (mut batches, mut messages, mut threads) = (0, 0, 0);
        let mut thread_cursor = Uuid::nil();
        loop {
            let batch = self
                .purge_message_batch(link_id, thread_cursor, pacing.messages)
                .await?;
            batches += 1;
            messages += batch.messages;
            threads += batch.threads;
            let Some(next_cursor) = batch.next_cursor else {
                break;
            };
            thread_cursor = next_cursor;
            tokio::time::sleep(pacing.pause).await;
        }

        let span = record_phase(batches, pacing);
        span.record("messages", messages);
        span.record("threads", threads);
        Ok((messages, threads))
    }

    /// Deletes the threads left once every message is gone.
    #[tracing::instrument(
    name = "email.purge_link.threads",
    skip_all,
    fields(
        batches = tracing::field::Empty,
        paused_ms = tracing::field::Empty,
        deleted = tracing::field::Empty,
    ),
    err
)]
    async fn purge_threads(&self, link_id: Uuid, pacing: PurgePacing) -> anyhow::Result<u64> {
        let (mut batches, mut deleted) = (0, 0);
        loop {
            let batch = self.purge_thread_batch(link_id, pacing.threads).await?;
            batches += 1;
            deleted += batch.deleted;
            if !batch.full {
                break;
            }
            tokio::time::sleep(pacing.pause).await;
        }

        record_phase(batches, pacing).record("deleted", deleted);
        Ok(deleted)
    }

    /// Deletes the link's contacts.
    #[tracing::instrument(
    name = "email.purge_link.contacts",
    skip_all,
    fields(
        batches = tracing::field::Empty,
        paused_ms = tracing::field::Empty,
        deleted = tracing::field::Empty,
    ),
    err
)]
    async fn purge_contacts(&self, link_id: Uuid, pacing: PurgePacing) -> anyhow::Result<u64> {
        let (mut batches, mut deleted) = (0, 0);
        let mut contact_cursor = String::new();
        loop {
            let batch = self
                .purge_contact_batch(link_id, &contact_cursor, pacing.contacts)
                .await?;
            batches += 1;
            deleted += batch.deleted;
            let Some(next_cursor) = batch.next_cursor else {
                break;
            };
            contact_cursor = next_cursor;
            tokio::time::sleep(pacing.pause).await;
        }

        record_phase(batches, pacing).record("deleted", deleted);
        Ok(deleted)
    }

    pub(crate) async fn purge_message_batch(
        &self,
        link_id: Uuid,
        thread_cursor: Uuid,
        limit: NonZeroU32,
    ) -> anyhow::Result<MessageBatch> {
        let mut tx = self.repository.begin_batch(link_id).await?;
        let rows = tx.messages(link_id, thread_cursor, limit).await?;
        let Some(last_thread_id) = rows.last().map(|row| row.thread_id) else {
            tx.commit().await?;
            return Ok(MessageBatch {
                messages: 0,
                threads: 0,
                next_cursor: None,
            });
        };
        let full = rows.len() as u64 == u64::from(limit.get());
        let message_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        // Rows come back in thread order, so every thread before the last one is exhausted.
        // The last thread may continue past this batch unless the batch came back short.
        let mut finished_thread_ids: Vec<Uuid> = rows
            .iter()
            .map(|row| row.thread_id)
            .filter(|thread_id| !full || *thread_id != last_thread_id)
            .collect();
        finished_thread_ids.dedup();
        tx.delete_message_labels(&message_ids).await?;
        tx.delete_message_recipients(&message_ids).await?;
        // Detached rather than deleted: email_sfs_delete_handler removes the stored file for
        // every row whose attachment_id is NULL, then deletes the row itself.
        tx.detach_message_files(&message_ids).await?;
        tx.delete_message_attachments(&message_ids).await?;
        tx.delete_scheduled_messages(&message_ids).await?;
        let messages = tx.delete_message_rows(&message_ids).await?;
        let threads = Self::delete_threads(&mut tx, link_id, &finished_thread_ids).await?;
        tx.commit().await?;
        Ok(MessageBatch {
            messages,
            threads,
            next_cursor: full.then_some(last_thread_id),
        })
    }

    async fn delete_threads(
        tx: &mut R::Transaction,
        link_id: Uuid,
        thread_ids: &[Uuid],
    ) -> anyhow::Result<u64> {
        if thread_ids.is_empty() {
            return Ok(0);
        }
        tx.delete_thread_history(link_id, thread_ids).await?;
        tx.delete_thread_rows(link_id, thread_ids).await
    }

    async fn purge_thread_batch(
        &self,
        link_id: Uuid,
        limit: NonZeroU32,
    ) -> anyhow::Result<ThreadBatch> {
        let mut tx = self.repository.begin_batch(link_id).await?;
        let thread_ids = tx.threads(link_id, limit).await?;
        let full = thread_ids.len() as u64 == u64::from(limit.get());
        let deleted = Self::delete_threads(&mut tx, link_id, &thread_ids).await?;
        tx.commit().await?;
        Ok(ThreadBatch { deleted, full })
    }

    async fn purge_contact_batch(
        &self,
        link_id: Uuid,
        email_cursor: &str,
        limit: NonZeroU32,
    ) -> anyhow::Result<ContactBatch> {
        let mut tx = self.repository.begin_batch(link_id).await?;
        let rows = tx.contacts(link_id, email_cursor, limit).await?;
        let full = rows.len() as u64 == u64::from(limit.get());
        let contact_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let deleted = tx.delete_contact_rows(&contact_ids).await?;
        tx.commit().await?;
        Ok(ContactBatch {
            deleted,
            next_cursor: full
                .then(|| rows.last().map(|row| row.email_address.clone()))
                .flatten(),
        })
    }

    async fn delete_marked_link(&self, link_id: Uuid) -> anyhow::Result<bool> {
        let mut tx = self.repository.begin_batch(link_id).await?;
        let deleted = tx.delete_marked_link(link_id).await?;
        tx.commit().await?;
        Ok(deleted > 0)
    }
}

pub(crate) struct MessageBatch {
    pub(crate) messages: u64,
    pub(crate) threads: u64,
    pub(crate) next_cursor: Option<Uuid>,
}
struct ThreadBatch {
    deleted: u64,
    full: bool,
}
struct ContactBatch {
    deleted: u64,
    next_cursor: Option<String>,
}

/// Records a finished phase's batch count and pause time on its span. Every batch but the
/// last came back full and was followed by a pause.
fn record_phase(batches: u32, pacing: PurgePacing) -> tracing::Span {
    let span = tracing::Span::current();
    span.record("batches", batches);
    span.record(
        "paused_ms",
        (pacing.pause * batches.saturating_sub(1)).as_millis(),
    );
    span
}
