//! Email attachments released before the queue existed.
//!
//! Until migration `20261116200143`, nothing recorded a document whose
//! `document_email` links went with its mail, so those documents still list as
//! plain files. They are found by the Source property the import gave them: a
//! live document whose Source names an email thread, with no link left.
//!
//! A thread Source the import did not write, set by hand from the properties
//! panel, the SDK or an agent tool, does not make a document an orphan: those
//! are counted apart and left alone.
//!
//! [`OrphanedAttachmentScan`] walks the property rows in pages and counts the
//! orphans by why their links went. A dry run (the default) also asks what the
//! drain would do with them, through the drain's own checks; an applied run
//! queues them for the drain instead, which trashes or keeps each one as it
//! does a document released today. Progress is saved after every page, so a
//! stopped scan resumes where it left off.

use super::{QUEUE_DEPTH_CAP, RELEASE_BATCH_SIZE, ReleasedBatch};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::num::NonZeroU32;
use std::time::Duration;
use tokio::time::Instant;

#[cfg(test)]
mod test;

/// Property rows a page reads by default.
pub const DEFAULT_PAGE_SIZE: NonZeroU32 = NonZeroU32::new(500).expect("500 is not zero");

/// Most property rows a page may read. A page probes every entity in it
/// within one statement timeout, so its size bounds that statement's reads
/// when they come from disk.
pub const MAX_PAGE_SIZE: u32 = 2_000;

/// Orphans queued per second by default. One drain round takes 20 batches of
/// 500, and the drain runs one round per notification and one a minute
/// without any: 10,000 documents a minute, about 166 a second, even if every
/// notification were lost. 100 a second stays under that, leaving the rest of
/// each round to documents released by mail being deleted now. Each drained
/// batch publishes one event that Soup realtime turns into a removal per
/// trashed document, so this is also the rate open Drive lists lose rows.
pub const DEFAULT_PER_SECOND: NonZeroU32 = NonZeroU32::new(100).expect("100 is not zero");

/// Queue depth above which an applied scan waits by default: one drain round.
/// More than that waiting means the drain is behind or not running, or a
/// mailbox purge just released a large batch, and either should go first.
pub const DEFAULT_MAX_QUEUE_DEPTH: u32 = 10_000;

/// How often an applied scan reads the queue's depth.
const QUEUE_CHECK_INTERVAL: Duration = Duration::from_secs(10);

/// How long an applied scan waits before reading a deep queue again.
const HOLD_BACK_INTERVAL: Duration = Duration::from_secs(30);

/// How often the scan logs its progress.
const PROGRESS_LOG_INTERVAL: Duration = Duration::from_secs(30);

/// Why an orphan lost its link, decided in this order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrphanCause {
    /// Its owner has no mailbox connected.
    MailboxGone,
    /// Every mailbox its owner has was connected after the document was
    /// imported, so the one it came from was removed and connected again.
    MailboxRecreated,
    /// A mailbox from before the import remains, but the thread is gone.
    ThreadGone,
    /// The thread remains, but the message is gone.
    MessageGone,
    /// The message remains, but not its attachment: a draft saved again.
    AttachmentReplaced,
}

/// A live document with an email thread Source and no link, and what is left
/// of its mail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Orphan {
    /// The document.
    pub document_id: String,
    /// The email import wrote its Source, and nobody changed it since. Only
    /// then is the document an attachment whose mail is gone; anyone who can
    /// edit a document can point its Source at a thread by hand.
    pub source_from_import: bool,
    /// Its owner has a mailbox connected.
    pub mailbox_kept: bool,
    /// One of its owner's mailboxes was connected before the document was
    /// created.
    pub mailbox_predates_document: bool,
    /// The Source's thread exists.
    pub thread_kept: bool,
    /// The Source's message exists.
    pub message_kept: bool,
}

impl Orphan {
    /// Why the document lost its link.
    pub fn cause(&self) -> OrphanCause {
        if !self.mailbox_kept {
            OrphanCause::MailboxGone
        } else if !self.mailbox_predates_document {
            OrphanCause::MailboxRecreated
        } else if !self.thread_kept {
            OrphanCause::ThreadGone
        } else if !self.message_kept {
            OrphanCause::MessageGone
        } else {
            OrphanCause::AttachmentReplaced
        }
    }
}

/// One page of the walk.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct OrphanPage {
    /// The entity id of the last property row the page read; the next page
    /// starts after that entity. `None` when no row was left to read.
    pub last_entity_id: Option<String>,
    /// The orphans among the page's rows, in id order.
    pub orphans: Vec<Orphan>,
}

/// Storage the scan reads and, when applied, queues into.
pub trait OrphanedAttachmentRepo: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Read the `page_size` property rows after `after` and find the orphans
    /// among the entities they belong to.
    fn orphan_page(
        &self,
        after: &str,
        page_size: NonZeroU32,
    ) -> impl Future<Output = Result<OrphanPage, Self::Err>> + Send;

    /// What a drain batch would do with these documents now, without claiming
    /// or writing anything.
    fn preview_drain(
        &self,
        document_ids: &[String],
    ) -> impl Future<Output = Result<ReleasedBatch, Self::Err>> + Send;

    /// Queue documents for the drain. Returns how many the queue did not
    /// hold already.
    fn enqueue(
        &self,
        document_ids: &[String],
    ) -> impl Future<Output = Result<usize, Self::Err>> + Send;

    /// Wake the drain.
    fn notify_drain(&self) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Documents waiting in the queue, counted up to [`QUEUE_DEPTH_CAP`].
    fn queue_depth(&self) -> impl Future<Output = Result<i64, Self::Err>> + Send;
}

/// Where the scan keeps its progress between runs.
pub trait ScanProgressStore: Send + Sync {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Replace the saved progress.
    fn save(&self, progress: &ScanProgress) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Running totals of a scan.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScanCounts {
    /// Orphans found, not counting [`Self::source_not_from_import`].
    pub orphans: usize,
    /// Live, unlinked documents whose thread Source was set by hand rather
    /// than by the import. Skipped: never previewed or queued.
    pub source_not_from_import: usize,
    /// Orphans whose owner has no mailbox.
    pub mailbox_gone: usize,
    /// Orphans whose owner's mailboxes all came after them.
    pub mailbox_recreated: usize,
    /// Orphans whose thread is gone.
    pub thread_gone: usize,
    /// Orphans whose message is gone.
    pub message_gone: usize,
    /// Orphans whose message remains.
    pub attachment_replaced: usize,
    /// Dry run: orphans the drain would move to the Trash.
    pub would_trash: usize,
    /// Dry run: orphans the drain would keep because their owner adopted them.
    pub would_keep_adopted: usize,
    /// Dry run: orphans the drain would keep because they are in the Trash.
    pub would_keep_in_trash: usize,
    /// Dry run: orphans linked again or purged since their page was read.
    pub would_skip: usize,
    /// Applied: orphans queued.
    pub enqueued: usize,
    /// Applied: orphans the queue held already.
    pub already_queued: usize,
}

impl ScanCounts {
    fn add(&mut self, page: &ScanCounts) {
        self.orphans += page.orphans;
        self.source_not_from_import += page.source_not_from_import;
        self.mailbox_gone += page.mailbox_gone;
        self.mailbox_recreated += page.mailbox_recreated;
        self.thread_gone += page.thread_gone;
        self.message_gone += page.message_gone;
        self.attachment_replaced += page.attachment_replaced;
        self.would_trash += page.would_trash;
        self.would_keep_adopted += page.would_keep_adopted;
        self.would_keep_in_trash += page.would_keep_in_trash;
        self.would_skip += page.would_skip;
        self.enqueued += page.enqueued;
        self.already_queued += page.already_queued;
    }
}

/// Where a scan is, as saved after every page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScanProgress {
    /// The scan queues what it finds. Progress resumes only in its own mode:
    /// a dry run's cursor says nothing about what was queued.
    pub apply: bool,
    /// The entity id the next page starts after; `None` starts at the
    /// beginning.
    pub after: Option<String>,
    /// Pages read.
    pub pages: usize,
    /// The walk read the last property row.
    pub finished: bool,
    /// Totals over the pages read.
    pub counts: ScanCounts,
}

impl ScanProgress {
    /// A scan that has read nothing yet, starting after `after`.
    pub fn start(apply: bool, after: Option<String>) -> Self {
        Self {
            apply,
            after,
            pages: 0,
            finished: false,
            counts: ScanCounts::default(),
        }
    }
}

/// How a scan runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanOptions {
    /// Property rows read per page.
    pub page_size: NonZeroU32,
    /// Most orphans queued per second.
    pub per_second: NonZeroU32,
    /// Queue depth above which an applied scan waits for the drain. Under
    /// [`QUEUE_DEPTH_CAP`], which the depth is counted up to.
    pub max_queue_depth: u32,
}

/// A scan stopped by an error. Nothing is retried: the saved progress is the
/// last page that finished, and a rerun resumes after it.
#[derive(Debug, thiserror::Error)]
#[error("orphaned attachment scan stopped after {:?}: {error}", .progress.after)]
pub struct ScanStopped {
    /// Progress up to the last page that finished.
    pub progress: ScanProgress,
    /// What stopped it.
    pub error: rootcause::Report,
}

/// Finds email attachments that lost their links before the queue existed,
/// and previews or queues them.
pub struct OrphanedAttachmentScan<R, S> {
    repo: R,
    store: S,
}

impl<R: OrphanedAttachmentRepo, S: ScanProgressStore> OrphanedAttachmentScan<R, S> {
    /// Build the scan over its storage and its progress store.
    pub fn new(repo: R, store: S) -> Self {
        Self { repo, store }
    }

    /// Walk from `progress` to the end, saving progress after every page, and
    /// return the final totals.
    pub async fn run(
        &self,
        options: ScanOptions,
        mut progress: ScanProgress,
    ) -> Result<ScanProgress, ScanStopped> {
        let mut pace = Pace::new(options.per_second);
        let mut queue: Option<QueueReading> = None;
        let mut logged = LoggedProgress::new(&progress);
        // The drain is woken once a full batch waits, so each round it runs
        // for the scan drains whole batches and publishes one event per 500
        // documents. Rows queued since then wait for the drain's own sweep.
        let mut unannounced = 0usize;

        while !progress.finished {
            if progress.apply {
                self.hold_back(options.max_queue_depth, &mut queue)
                    .await
                    .map_err(|error| stopped(&progress, error))?;
            }

            let after = progress.after.clone().unwrap_or_default();
            let page = self
                .page(&after, options.page_size, progress.apply)
                .await
                .map_err(|error| stopped(&progress, error))?;

            // Advance only once the store holds the new cursor, so a failed
            // save reports the cursor a rerun resumes after.
            let mut next = progress.clone();
            next.pages += 1;
            next.counts.add(&page.counts);
            match page.last_entity_id {
                Some(last) => next.after = Some(last),
                None => next.finished = true,
            }
            self.store.save(&next).await.map_err(|error| {
                stopped(&progress, rootcause::Report::new(error).into_dynamic())
            })?;
            progress = next;

            if progress.apply {
                unannounced += page.counts.enqueued;
                let batch_waits =
                    usize::try_from(RELEASE_BATCH_SIZE).is_ok_and(|batch| unannounced >= batch);
                if batch_waits || (progress.finished && unannounced > 0) {
                    self.repo.notify_drain().await.map_err(|error| {
                        stopped(&progress, rootcause::Report::new(error).into_dynamic())
                    })?;
                    unannounced = 0;
                }
                pace.wait_for(page.counts.enqueued).await;
            }

            if progress.finished || logged.at.elapsed() >= PROGRESS_LOG_INTERVAL {
                log_progress(&progress, &logged, queue.as_ref());
                logged = LoggedProgress::new(&progress);
            }
        }

        Ok(progress)
    }

    /// Read one page and preview or queue its orphans.
    #[tracing::instrument(
        name = "document.orphaned_attachments.page",
        skip_all,
        fields(
            apply = apply,
            after = %after,
            page_size = page_size.get(),
            last_entity_id = tracing::field::Empty,
            orphans = tracing::field::Empty,
            skipped.source_not_from_import = tracing::field::Empty,
            cause.mailbox_gone = tracing::field::Empty,
            cause.mailbox_recreated = tracing::field::Empty,
            cause.thread_gone = tracing::field::Empty,
            cause.message_gone = tracing::field::Empty,
            cause.attachment_replaced = tracing::field::Empty,
            would_trash = tracing::field::Empty,
            would_keep = tracing::field::Empty,
            enqueued = tracing::field::Empty,
            already_queued = tracing::field::Empty,
            outcome = tracing::field::Empty,
        ),
        err
    )]
    async fn page(
        &self,
        after: &str,
        page_size: NonZeroU32,
        apply: bool,
    ) -> Result<PageResult, rootcause::Report> {
        let span = tracing::Span::current();
        let result = self.read_and_settle(after, page_size, apply).await;
        match &result {
            Ok(page) => {
                if let Some(last) = &page.last_entity_id {
                    span.record("last_entity_id", last.as_str());
                }
                let counts = &page.counts;
                span.record("orphans", counts.orphans);
                span.record(
                    "skipped.source_not_from_import",
                    counts.source_not_from_import,
                );
                span.record("cause.mailbox_gone", counts.mailbox_gone);
                span.record("cause.mailbox_recreated", counts.mailbox_recreated);
                span.record("cause.thread_gone", counts.thread_gone);
                span.record("cause.message_gone", counts.message_gone);
                span.record("cause.attachment_replaced", counts.attachment_replaced);
                if apply {
                    span.record("enqueued", counts.enqueued);
                    span.record("already_queued", counts.already_queued);
                } else {
                    span.record("would_trash", counts.would_trash);
                    span.record(
                        "would_keep",
                        counts.would_keep_adopted + counts.would_keep_in_trash,
                    );
                }
                span.record("outcome", "ok");
            }
            Err(_) => {
                span.record("outcome", "failed");
            }
        }

        result
    }

    async fn read_and_settle(
        &self,
        after: &str,
        page_size: NonZeroU32,
        apply: bool,
    ) -> Result<PageResult, rootcause::Report> {
        let page = self
            .repo
            .orphan_page(after, page_size)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?;

        let (orphans, set_by_hand): (Vec<Orphan>, Vec<Orphan>) = page
            .orphans
            .into_iter()
            .partition(|orphan| orphan.source_from_import);
        let mut counts = ScanCounts {
            orphans: orphans.len(),
            source_not_from_import: set_by_hand.len(),
            ..ScanCounts::default()
        };
        for orphan in &orphans {
            match orphan.cause() {
                OrphanCause::MailboxGone => counts.mailbox_gone += 1,
                OrphanCause::MailboxRecreated => counts.mailbox_recreated += 1,
                OrphanCause::ThreadGone => counts.thread_gone += 1,
                OrphanCause::MessageGone => counts.message_gone += 1,
                OrphanCause::AttachmentReplaced => counts.attachment_replaced += 1,
            }
        }

        if !orphans.is_empty() {
            let document_ids: Vec<String> = orphans
                .into_iter()
                .map(|orphan| orphan.document_id)
                .collect();
            if apply {
                counts.enqueued = self
                    .repo
                    .enqueue(&document_ids)
                    .await
                    .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
                counts.already_queued = document_ids.len().saturating_sub(counts.enqueued);
            } else {
                let preview = self
                    .repo
                    .preview_drain(&document_ids)
                    .await
                    .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
                counts.would_trash = preview.trashed.len();
                counts.would_keep_adopted = preview.adopted;
                counts.would_keep_in_trash = preview.kept.len().saturating_sub(preview.adopted);
                counts.would_skip = preview.relinked + preview.missing;
            }
        }

        Ok(PageResult {
            last_entity_id: page.last_entity_id,
            counts,
        })
    }

    /// Wait while more than `max_queue_depth` documents wait in the queue,
    /// reading its depth at most every [`QUEUE_CHECK_INTERVAL`] into `queue`.
    /// The queue has no signal for having drained, so a deep one is read again
    /// after [`HOLD_BACK_INTERVAL`].
    async fn hold_back(
        &self,
        max_queue_depth: u32,
        queue: &mut Option<QueueReading>,
    ) -> Result<(), rootcause::Report> {
        if queue
            .as_ref()
            .is_some_and(|reading| reading.at.elapsed() < QUEUE_CHECK_INTERVAL)
        {
            return Ok(());
        }

        loop {
            let depth = self
                .repo
                .queue_depth()
                .await
                .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
            *queue = Some(QueueReading {
                at: Instant::now(),
                depth,
            });
            if depth <= i64::from(max_queue_depth) {
                return Ok(());
            }

            tracing::info!(
                queue.depth = depth,
                queue.max_depth = max_queue_depth,
                queue.depth_cap = QUEUE_DEPTH_CAP,
                "holding back until the drain catches up"
            );
            tokio::time::sleep(HOLD_BACK_INTERVAL).await;
        }
    }
}

/// What one page found and did.
struct PageResult {
    last_entity_id: Option<String>,
    counts: ScanCounts,
}

/// The queue's depth as an applied scan last read it.
struct QueueReading {
    at: Instant,
    depth: i64,
}

/// When progress was last logged, and how many orphans had been queued then.
struct LoggedProgress {
    at: Instant,
    enqueued: usize,
}

impl LoggedProgress {
    fn new(progress: &ScanProgress) -> Self {
        Self {
            at: Instant::now(),
            enqueued: progress.counts.enqueued,
        }
    }
}

fn stopped(progress: &ScanProgress, error: rootcause::Report) -> ScanStopped {
    ScanStopped {
        progress: progress.clone(),
        error,
    }
}

/// Log the totals. An applied scan also logs the rate it queued at since the
/// last line and the queue depth it last read, which together say whether
/// `--per-second` keeps the drain ahead.
fn log_progress(progress: &ScanProgress, last: &LoggedProgress, queue: Option<&QueueReading>) {
    let counts = &progress.counts;
    let queued_per_minute = progress.apply.then(|| {
        queued_per_minute(
            counts.enqueued.saturating_sub(last.enqueued),
            last.at.elapsed(),
        )
    });
    tracing::info!(
        apply = progress.apply,
        after = progress.after.as_deref().unwrap_or(""),
        pages = progress.pages,
        finished = progress.finished,
        queued_per_minute,
        queue.depth = queue.map(|reading| reading.depth),
        orphans = counts.orphans,
        skipped.source_not_from_import = counts.source_not_from_import,
        cause.mailbox_gone = counts.mailbox_gone,
        cause.mailbox_recreated = counts.mailbox_recreated,
        cause.thread_gone = counts.thread_gone,
        cause.message_gone = counts.message_gone,
        cause.attachment_replaced = counts.attachment_replaced,
        would_trash = counts.would_trash,
        would_keep_adopted = counts.would_keep_adopted,
        would_keep_in_trash = counts.would_keep_in_trash,
        would_skip = counts.would_skip,
        enqueued = counts.enqueued,
        already_queued = counts.already_queued,
        "orphaned attachment scan progress"
    );
}

/// Documents queued per minute, from `queued` over `elapsed`.
fn queued_per_minute(queued: usize, elapsed: Duration) -> u64 {
    let queued = u128::try_from(queued).unwrap_or(u128::MAX);
    let per_minute = queued.saturating_mul(60_000) / elapsed.as_millis().max(1);
    u64::try_from(per_minute).unwrap_or(u64::MAX)
}

/// Spaces out queued orphans to a rate. Each wait starts when the previous
/// one ended or now, whichever is later, so pages without orphans do not
/// save up time for a burst.
struct Pace {
    per_second: NonZeroU32,
    next: Instant,
}

impl Pace {
    fn new(per_second: NonZeroU32) -> Self {
        Self {
            per_second,
            next: Instant::now(),
        }
    }

    async fn wait_for(&mut self, queued: usize) {
        if queued == 0 {
            return;
        }

        let queued = u32::try_from(queued).unwrap_or(u32::MAX);
        let start = self.next.max(Instant::now());
        self.next = start + Duration::from_secs(1) * queued / self.per_second.get();
        tokio::time::sleep_until(self.next).await;
    }
}
