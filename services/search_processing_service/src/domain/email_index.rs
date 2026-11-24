//! Fenced email search indexing.
//!
//! Every writer of an email thread's search documents (live events, imports
//! and reindexes, queue batches, property changes, deletes) takes the thread's
//! lease before it reads the source and holds it until its last write
//! returns, and every write and delete it sends carries the lease's grant
//! time as its version. Writers of one thread therefore run one at a time,
//! and one that lost its lease cannot undo a later writer's work: the index
//! refuses its older version. Events are hints to reread: what a writer
//! writes comes from the source as it reads it under the lease, never from
//! the event.

use std::{
    collections::{BTreeSet, HashMap},
    time::Duration,
};

use models_email::service::message::ParsedSearchMessage;
use rootcause::{Report, report};
use uuid::Uuid;

use super::fence::ProjectionVersion;

#[cfg(test)]
mod test;

/// Longest a writer may work under its lease. Past it the writer stops,
/// releases the lease and fails the attempt, which retries under a new one.
/// The emails index remembers a delete's version for 15 minutes
/// (`gc_deletes`): enough for this deadline and a request's 5-minute timeout,
/// so a request sent before the deadline cannot undelete a message after the
/// index forgot the delete. It also bounds how long a writer makes the next
/// one wait.
pub const LEASE_DEADLINE: Duration = Duration::from_secs(120);

/// Messages read and written per page of a single thread.
const THREAD_PAGE_MESSAGES: i64 = 100;

/// Which lock connections a writer leases with, so bulk work never takes the
/// connections live writers need.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum LeasePool {
    /// Kafka workers: live events, and the imports and reindex requests that
    /// still share their lane.
    Live,
    /// Queue batches and direct backfills.
    Bulk,
}

/// The kind of work a write is, as refused writes and lease waits are
/// counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum EmailWriter {
    /// A live change: a message received, drafted or sent, or a thread read,
    /// starred, archived, trashed, marked as spam or relabeled.
    Live,
    /// An import, a reindex request or a queued batch.
    Bulk,
    /// A thread property change.
    Property,
    /// A message deleted, or received into spam or trash.
    Delete,
}

/// How long a lease took to get: a lock connection, then the locks.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct LeaseWait {
    pub connection: Duration,
    pub lock: Duration,
}

impl std::ops::AddAssign for LeaseWait {
    fn add_assign(&mut self, other: Self) {
        self.connection += other.connection;
        self.lock += other.lock;
    }
}

/// Leases on a set of threads and the version their writes carry.
pub struct GrantedThreads<L> {
    /// Held until the writer's last request returns; dropping it releases
    /// every thread.
    pub lease: L,
    /// The database time of the grant. Leases on a thread never overlap and
    /// one clock serves every worker, so each grant is later than the last.
    pub version: ProjectionVersion,
    pub waited: LeaseWait,
}

/// Cross-process leases on email threads.
pub trait EmailThreadLeases: Send + Sync + 'static {
    /// Released when dropped.
    type Lease: Send;

    /// Lease every thread in `thread_ids` at once. Every writer takes its
    /// threads in the same order, so two writers never deadlock.
    fn lease(
        &self,
        thread_ids: &[Uuid],
        pool: LeasePool,
        writer: EmailWriter,
    ) -> impl Future<Output = Result<GrantedThreads<Self::Lease>, Report>> + Send;
}

/// A thread's indexed property, as every one of its message documents
/// carries it.
#[derive(Debug, Clone, PartialEq)]
pub struct ThreadProperty {
    pub definition_id: String,
    pub values: Vec<String>,
    pub number_value: Option<f64>,
    pub date_value: Option<i64>,
}

/// What every document of a thread carries besides its message.
#[derive(Debug, Clone, PartialEq)]
pub struct ThreadFacts {
    /// The mailbox owner, as search scopes by.
    pub owner: String,
    pub properties: Vec<ThreadProperty>,
}

/// Current email state, read from the primary under the lease.
pub trait EmailIndexSource: Send + Sync + 'static {
    /// `None` once the message is deleted.
    fn message(
        &self,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<ParsedSearchMessage>, Report>> + Send;

    /// One page of a thread's messages.
    fn thread_page(
        &self,
        thread_id: Uuid,
        offset: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<ParsedSearchMessage>, Report>> + Send;

    /// Every message of `thread_ids`.
    fn threads_messages(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ParsedSearchMessage>, Report>> + Send;

    /// The facts of each thread that still exists; a deleted one is absent.
    fn threads(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, ThreadFacts>, Report>> + Send;
}

/// One message's searchable document under its thread.
#[derive(Debug, Clone)]
pub struct EmailDocument {
    /// The message as read, without its body.
    pub message: ParsedSearchMessage,
    pub content: String,
    pub thread: ThreadFacts,
}

/// An email document, named by the thread it is indexed under and its
/// message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct EmailDocumentKey {
    pub thread_id: Uuid,
    pub message_id: Uuid,
}

/// What a reconcile's writes did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct EmailWrites {
    pub indexed: usize,
    /// Deleted, or already absent.
    pub deleted: usize,
    /// Refused by the index because a later writer already wrote or deleted
    /// the document: neither a failure nor a write.
    pub refused_stale: usize,
}

impl std::ops::AddAssign for EmailWrites {
    fn add_assign(&mut self, other: Self) {
        self.indexed += other.indexed;
        self.deleted += other.deleted;
        self.refused_stale += other.refused_stale;
    }
}

/// Why an index write failed.
#[derive(Debug)]
pub enum IndexWriteError {
    /// The index applied the request but failed some of its items, such as a
    /// mapping error: the thread's later pages can still be written.
    ItemsFailed(Report),
    /// Nothing can be told to have applied: an outage, or the index refusing
    /// writes to protect itself. The reconcile stops.
    Failed(Report),
}

impl IndexWriteError {
    fn into_report(self) -> Report {
        match self {
            Self::ItemsFailed(report) | Self::Failed(report) => report,
        }
    }
}

/// The email search index. Every write and delete carries a version the
/// index enforces.
pub trait EmailSearchIndex: Send + Sync + 'static {
    fn write(
        &self,
        version: ProjectionVersion,
        documents: Vec<EmailDocument>,
        deletes: Vec<EmailDocumentKey>,
        index_override: Option<&str>,
        writer: EmailWriter,
    ) -> impl Future<Output = Result<EmailWrites, IndexWriteError>> + Send;

    /// The documents of `message_ids` under any thread but `keep_thread_ids`,
    /// as of the index's last refresh.
    fn message_documents(
        &self,
        message_ids: &[Uuid],
        keep_thread_ids: &[Uuid],
        index_override: Option<&str>,
    ) -> impl Future<Output = Result<Vec<EmailDocumentKey>, Report>> + Send;
}

/// What an email event asks of one message: bring its documents in line with
/// the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageReconcile {
    pub message_id: Uuid,
    /// The thread the event names; the message may have moved since.
    pub thread_id: Uuid,
    /// Delete the message's documents under other threads as well: a send
    /// from Macro can move a draft to another thread, and nothing else removes
    /// its old copy.
    pub remove_moved_copies: bool,
    pub writer: EmailWriter,
    pub pool: LeasePool,
}

/// What a reconcile did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct EmailReconciled {
    pub writes: EmailWrites,
    pub waited: LeaseWait,
}

/// Where a message reconcile got to under its lease.
enum MessageStep {
    Written(EmailWrites),
    /// The message is in a thread the lease does not hold.
    Moved(Uuid),
}

/// The writes one batch of messages needs.
#[derive(Default)]
struct PagePlan {
    documents: Vec<EmailDocument>,
    deletes: BTreeSet<EmailDocumentKey>,
    /// Messages whose every copy, under any thread, goes.
    removed: Vec<Uuid>,
}

impl PagePlan {
    fn remove(&mut self, key: EmailDocumentKey) {
        self.deletes.insert(key);
        self.removed.push(key.message_id);
    }

    /// Index `message` under its thread, or remove it when it is excluded
    /// from search or its thread is gone. A message with no parsed body yet
    /// is left alone: a later event brings its body.
    fn place(&mut self, mut message: ParsedSearchMessage, threads: &HashMap<Uuid, ThreadFacts>) {
        let key = EmailDocumentKey {
            thread_id: message.thread_db_id,
            message_id: message.db_id,
        };
        let thread = threads.get(&message.thread_db_id);
        if message.excluded_from_search || thread.is_none() {
            self.remove(key);
            return;
        }
        let (Some(content), Some(thread)) = (message.body_parsed_linkless.take(), thread) else {
            tracing::warn!(message_id = %message.db_id, "no content found for email message");
            return;
        };
        self.documents.push(EmailDocument {
            message,
            content,
            thread: thread.clone(),
        });
    }
}

/// Owns the leases, the authoritative rereads and the fenced writes of every
/// email search writer.
pub struct EmailIndexService<S, L, I> {
    source: S,
    leases: L,
    index: I,
}

impl<S, L, I> EmailIndexService<S, L, I> {
    pub fn new(source: S, leases: L, index: I) -> Self {
        Self {
            source,
            leases,
            index,
        }
    }
}

fn deadline_passed() -> Report {
    report!("the email reconcile passed its lease deadline")
}

impl<S: EmailIndexSource, L: EmailThreadLeases, I: EmailSearchIndex> EmailIndexService<S, L, I> {
    /// Bring one message's documents in line with the source: indexed under
    /// its current thread, or removed under every thread once it is deleted
    /// or excluded from search.
    #[tracing::instrument(
        name = "search.email.reconcile_message",
        err,
        skip_all,
        fields(
            message_id = %request.message_id,
            thread_id = %request.thread_id,
            writer = <&'static str>::from(request.writer),
            moved = tracing::field::Empty,
            indexed = tracing::field::Empty,
            deleted = tracing::field::Empty,
            refused_stale = tracing::field::Empty,
        )
    )]
    pub async fn reconcile_message(
        &self,
        request: MessageReconcile,
    ) -> Result<EmailReconciled, Report> {
        let mut threads = vec![request.thread_id];
        let mut waited = LeaseWait::default();
        loop {
            let granted = self
                .leases
                .lease(&threads, request.pool, request.writer)
                .await?;
            waited += granted.waited;
            let step = tokio::time::timeout(
                LEASE_DEADLINE,
                self.message_under_lease(&request, &threads, granted.version),
            )
            .await
            .map_err(|_| deadline_passed())??;
            drop(granted.lease);

            match step {
                MessageStep::Written(writes) => {
                    record_writes(writes);
                    return Ok(EmailReconciled { writes, waited });
                }
                // A draft moved to another thread since its event: lease both
                // threads, in the order every writer takes them, and reread.
                MessageStep::Moved(current) if threads.len() == 1 => {
                    tracing::Span::current().record("moved", true);
                    threads.push(current);
                    threads.sort_unstable();
                }
                MessageStep::Moved(_) => {
                    return Err(report!(
                        "the email message moved again while its threads were leased"
                    ));
                }
            }
        }
    }

    async fn message_under_lease(
        &self,
        request: &MessageReconcile,
        leased: &[Uuid],
        version: ProjectionVersion,
    ) -> Result<MessageStep, Report> {
        let message = self.source.message(request.message_id).await?;
        let thread_id = message
            .as_ref()
            .map_or(request.thread_id, |message| message.thread_db_id);
        if !leased.contains(&thread_id) {
            return Ok(MessageStep::Moved(thread_id));
        }

        let threads = self.source.threads(&[thread_id]).await?;
        let mut plan = PagePlan::default();
        let mut keep_copies_under = None;
        match message {
            None => plan.remove(EmailDocumentKey {
                thread_id,
                message_id: request.message_id,
            }),
            Some(message) => {
                plan.place(message, &threads);
                if request.remove_moved_copies && plan.removed.is_empty() {
                    keep_copies_under = Some(thread_id);
                }
            }
        }

        if let Some(thread_id) = keep_copies_under {
            plan.deletes.extend(
                self.index
                    .message_documents(&[request.message_id], &[thread_id], None)
                    .await?,
            );
        }
        let writes = self
            .write_plan(version, plan, None, request.writer)
            .await
            .map_err(IndexWriteError::into_report)?;
        Ok(MessageStep::Written(writes))
    }

    /// Bring every document of `thread_ids` in line with the source: each
    /// searchable message indexed, each excluded one removed under every
    /// thread. One thread is read and written a page at a time; several are
    /// read and written together.
    #[tracing::instrument(
        name = "search.email.reconcile_threads",
        err,
        skip_all,
        fields(
            threads = thread_ids.len(),
            thread_id = tracing::field::Empty,
            writer = <&'static str>::from(writer),
            indexed = tracing::field::Empty,
            deleted = tracing::field::Empty,
            refused_stale = tracing::field::Empty,
        )
    )]
    pub async fn reconcile_threads(
        &self,
        thread_ids: &[Uuid],
        index_override: Option<&str>,
        writer: EmailWriter,
        pool: LeasePool,
    ) -> Result<EmailReconciled, Report> {
        let mut threads = thread_ids.to_vec();
        threads.sort_unstable();
        threads.dedup();
        if let [thread_id] = threads.as_slice() {
            tracing::Span::current().record("thread_id", tracing::field::display(thread_id));
        }

        let granted = self.leases.lease(&threads, pool, writer).await?;
        let writes = tokio::time::timeout(
            LEASE_DEADLINE,
            self.threads_under_lease(&threads, granted.version, index_override, writer),
        )
        .await
        .map_err(|_| deadline_passed())??;
        drop(granted.lease);

        record_writes(writes);
        Ok(EmailReconciled {
            writes,
            waited: granted.waited,
        })
    }

    async fn threads_under_lease(
        &self,
        threads: &[Uuid],
        version: ProjectionVersion,
        index_override: Option<&str>,
        writer: EmailWriter,
    ) -> Result<EmailWrites, Report> {
        let facts = self.source.threads(threads).await?;
        let [thread_id] = threads else {
            let messages = self.source.threads_messages(threads).await?;
            return self
                .write_messages(version, messages, &facts, index_override, writer)
                .await
                .map_err(IndexWriteError::into_report);
        };

        // Items one page failed must not keep the later pages out of the
        // index; a failure of a whole request stops the thread, since the
        // later pages would meet the same trouble.
        let mut writes = EmailWrites::default();
        let mut items_failed = None;
        let mut offset = 0;
        loop {
            let messages = self
                .source
                .thread_page(*thread_id, offset, THREAD_PAGE_MESSAGES)
                .await?;
            if messages.is_empty() {
                break;
            }
            match self
                .write_messages(version, messages, &facts, index_override, writer)
                .await
            {
                Ok(page) => writes += page,
                Err(IndexWriteError::ItemsFailed(report)) => {
                    items_failed.get_or_insert(report);
                }
                Err(IndexWriteError::Failed(report)) => return Err(report),
            }
            offset += THREAD_PAGE_MESSAGES;
        }
        items_failed.map_or(Ok(writes), Err)
    }

    async fn write_messages(
        &self,
        version: ProjectionVersion,
        messages: Vec<ParsedSearchMessage>,
        threads: &HashMap<Uuid, ThreadFacts>,
        index_override: Option<&str>,
        writer: EmailWriter,
    ) -> Result<EmailWrites, IndexWriteError> {
        let mut plan = PagePlan::default();
        for message in messages {
            plan.place(message, threads);
        }
        self.write_plan(version, plan, index_override, writer).await
    }

    /// Send a plan's writes: its documents, its deletes, and every copy of
    /// its removed messages that the index can find under other threads.
    async fn write_plan(
        &self,
        version: ProjectionVersion,
        mut plan: PagePlan,
        index_override: Option<&str>,
        writer: EmailWriter,
    ) -> Result<EmailWrites, IndexWriteError> {
        if !plan.removed.is_empty() {
            let copies = self
                .index
                .message_documents(&plan.removed, &[], index_override)
                .await
                .map_err(IndexWriteError::Failed)?;
            plan.deletes.extend(copies);
        }
        if plan.documents.is_empty() && plan.deletes.is_empty() {
            return Ok(EmailWrites::default());
        }
        self.index
            .write(
                version,
                plan.documents,
                plan.deletes.into_iter().collect(),
                index_override,
                writer,
            )
            .await
    }
}

fn record_writes(writes: EmailWrites) {
    let span = tracing::Span::current();
    span.record("indexed", writes.indexed);
    span.record("deleted", writes.deleted);
    span.record("refused_stale", writes.refused_stale);
}
