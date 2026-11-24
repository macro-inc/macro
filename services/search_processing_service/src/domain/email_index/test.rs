use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use tokio::sync::{Notify, OwnedMutexGuard, oneshot};

use super::*;

const LINK: Uuid = Uuid::from_u128(0x10);
const THREAD: Uuid = Uuid::from_u128(0x20);
const OTHER_THREAD: Uuid = Uuid::from_u128(0x21);
const MESSAGE: Uuid = Uuid::from_u128(0x30);
const SECOND_MESSAGE: Uuid = Uuid::from_u128(0x31);
const OWNER: &str = "macro|owner@example.com";

fn message(id: Uuid, thread: Uuid, content: Option<&str>) -> ParsedSearchMessage {
    ParsedSearchMessage {
        db_id: id,
        link_id: LINK,
        thread_db_id: thread,
        subject: None,
        from: None,
        reply_to: None,
        to: Vec::new(),
        cc: Vec::new(),
        bcc: Vec::new(),
        labels: Vec::new(),
        body_parsed_linkless: content.map(str::to_string),
        internal_date_ts: None,
        excluded_from_search: false,
    }
}

fn excluded(id: Uuid, thread: Uuid) -> ParsedSearchMessage {
    ParsedSearchMessage {
        excluded_from_search: true,
        ..message(id, thread, Some("in the trash"))
    }
}

fn key(thread_id: Uuid, message_id: Uuid) -> EmailDocumentKey {
    EmailDocumentKey {
        thread_id,
        message_id,
    }
}

/// A thread read the test holds between its read and its return: the writer
/// has read the source, and has not written yet.
struct HeldRead {
    read: oneshot::Sender<()>,
    resume: Arc<Notify>,
}

#[derive(Default)]
struct FakeSource {
    messages: Mutex<BTreeMap<Uuid, ParsedSearchMessage>>,
    held: Mutex<Option<HeldRead>>,
}

impl FakeSource {
    fn put(&self, message: ParsedSearchMessage) {
        self.messages.lock().unwrap().insert(message.db_id, message);
    }

    fn delete(&self, id: Uuid) {
        self.messages.lock().unwrap().remove(&id);
    }

    /// Hold the next thread read after it reads, until `resume` is notified.
    fn hold_next_read(&self) -> (oneshot::Receiver<()>, Arc<Notify>) {
        let (read, read_done) = oneshot::channel();
        let resume = Arc::new(Notify::new());
        *self.held.lock().unwrap() = Some(HeldRead {
            read,
            resume: resume.clone(),
        });
        (read_done, resume)
    }

    fn in_threads(&self, threads: &[Uuid]) -> Vec<ParsedSearchMessage> {
        self.messages
            .lock()
            .unwrap()
            .values()
            .filter(|message| threads.contains(&message.thread_db_id))
            .cloned()
            .collect()
    }

    async fn release_held(&self) {
        let held = self.held.lock().unwrap().take();
        if let Some(held) = held {
            held.read.send(()).unwrap();
            held.resume.notified().await;
        }
    }
}

impl EmailIndexSource for Arc<FakeSource> {
    async fn message(&self, message_id: Uuid) -> Result<Option<ParsedSearchMessage>, Report> {
        Ok(self.messages.lock().unwrap().get(&message_id).cloned())
    }

    async fn thread_page(
        &self,
        thread_id: Uuid,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<ParsedSearchMessage>, Report> {
        let page: Vec<_> = self
            .in_threads(&[thread_id])
            .into_iter()
            .skip(usize::try_from(offset).unwrap())
            .take(usize::try_from(limit).unwrap())
            .collect();
        self.release_held().await;
        Ok(page)
    }

    async fn threads_messages(
        &self,
        thread_ids: &[Uuid],
    ) -> Result<Vec<ParsedSearchMessage>, Report> {
        let messages = self.in_threads(thread_ids);
        self.release_held().await;
        Ok(messages)
    }

    async fn threads(&self, thread_ids: &[Uuid]) -> Result<HashMap<Uuid, ThreadFacts>, Report> {
        Ok(thread_ids
            .iter()
            .map(|thread_id| {
                (
                    *thread_id,
                    ThreadFacts {
                        owner: OWNER.to_owned(),
                        properties: Vec::new(),
                    },
                )
            })
            .collect())
    }
}

/// Leases from one clock. Exclusive leases wait for each other per thread; a
/// non-exclusive one stands for a lease its holder lost without knowing.
struct FakeLeases {
    exclusive: bool,
    clock: AtomicU64,
    locks: Mutex<HashMap<Uuid, Arc<tokio::sync::Mutex<()>>>>,
    /// Notified each time a writer asks for a lease.
    requested: Notify,
    taken: Mutex<Vec<Vec<Uuid>>>,
}

impl FakeLeases {
    fn new(exclusive: bool) -> Self {
        Self {
            exclusive,
            clock: AtomicU64::new(1_000),
            locks: Mutex::default(),
            requested: Notify::new(),
            taken: Mutex::default(),
        }
    }
}

impl EmailThreadLeases for Arc<FakeLeases> {
    type Lease = Vec<OwnedMutexGuard<()>>;

    async fn lease(
        &self,
        thread_ids: &[Uuid],
        _pool: LeasePool,
        _writer: EmailWriter,
    ) -> Result<GrantedThreads<Self::Lease>, Report> {
        assert!(
            thread_ids.windows(2).all(|pair| pair[0] < pair[1]),
            "threads leased out of order: {thread_ids:?}"
        );
        self.taken.lock().unwrap().push(thread_ids.to_vec());
        self.requested.notify_one();
        let mut guards = Vec::new();
        if self.exclusive {
            for thread_id in thread_ids {
                let lock = self
                    .locks
                    .lock()
                    .unwrap()
                    .entry(*thread_id)
                    .or_default()
                    .clone();
                guards.push(lock.lock_owned().await);
            }
        }
        let micros = self.clock.fetch_add(1, Ordering::SeqCst);
        Ok(GrantedThreads {
            lease: guards,
            version: ProjectionVersion::from_grant(
                chrono::DateTime::from_timestamp_micros(i64::try_from(micros).unwrap()).unwrap(),
            )
            .unwrap(),
            waited: LeaseWait::default(),
        })
    }
}

/// OpenSearch's `external_gte` versioning: a write or delete applies only at
/// a version at least the one the document holds, and a delete's version is
/// remembered, as the 15-minute `gc_deletes` does for any writer within its
/// deadline. The copy search sees only documents that exist.
#[derive(Default)]
struct FakeIndex {
    documents: Mutex<BTreeMap<EmailDocumentKey, (u64, Option<String>)>>,
    failures: Mutex<VecDeque<IndexWriteError>>,
}

impl FakeIndex {
    fn holds(&self, key: EmailDocumentKey, content: &str) {
        self.documents
            .lock()
            .unwrap()
            .insert(key, (0, Some(content.to_owned())));
    }

    fn live(&self) -> BTreeMap<EmailDocumentKey, String> {
        self.documents
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(key, (_, content))| Some((*key, content.clone()?)))
            .collect()
    }

    fn apply(&self, key: EmailDocumentKey, version: u64, content: Option<String>) -> bool {
        let mut documents = self.documents.lock().unwrap();
        if documents.get(&key).is_some_and(|(held, _)| *held > version) {
            return false;
        }
        documents.insert(key, (version, content));
        true
    }
}

impl EmailSearchIndex for Arc<FakeIndex> {
    async fn write(
        &self,
        version: ProjectionVersion,
        documents: Vec<EmailDocument>,
        deletes: Vec<EmailDocumentKey>,
        _index_override: Option<&str>,
        _writer: EmailWriter,
    ) -> Result<EmailWrites, IndexWriteError> {
        if let Some(failure) = self.failures.lock().unwrap().pop_front() {
            return Err(failure);
        }
        let mut writes = EmailWrites::default();
        for document in documents {
            let key = key(document.message.thread_db_id, document.message.db_id);
            if self.apply(key, version.get(), Some(document.content)) {
                writes.indexed += 1;
            } else {
                writes.refused_stale += 1;
            }
        }
        for key in deletes {
            if self.apply(key, version.get(), None) {
                writes.deleted += 1;
            } else {
                writes.refused_stale += 1;
            }
        }
        Ok(writes)
    }

    async fn message_documents(
        &self,
        message_ids: &[Uuid],
        keep_thread_ids: &[Uuid],
        _index_override: Option<&str>,
    ) -> Result<Vec<EmailDocumentKey>, Report> {
        Ok(self
            .live()
            .into_keys()
            .filter(|key| {
                message_ids.contains(&key.message_id) && !keep_thread_ids.contains(&key.thread_id)
            })
            .collect())
    }
}

type Service = EmailIndexService<Arc<FakeSource>, Arc<FakeLeases>, Arc<FakeIndex>>;

fn service(
    exclusive: bool,
) -> (
    Arc<Service>,
    Arc<FakeSource>,
    Arc<FakeLeases>,
    Arc<FakeIndex>,
) {
    let source = Arc::new(FakeSource::default());
    let leases = Arc::new(FakeLeases::new(exclusive));
    let index = Arc::new(FakeIndex::default());
    (
        Arc::new(EmailIndexService::new(
            source.clone(),
            leases.clone(),
            index.clone(),
        )),
        source,
        leases,
        index,
    )
}

fn delete_event(message_id: Uuid, thread_id: Uuid) -> MessageReconcile {
    MessageReconcile {
        message_id,
        thread_id,
        remove_moved_copies: false,
        writer: EmailWriter::Delete,
        pool: LeasePool::Live,
    }
}

/// A bulk reindex reads a thread holding a message, the message is deleted
/// and its live delete arrives, then the reindex writes what it read. The
/// delete waits for the reindex's lease, rereads after it, and the message
/// stays out of the index.
#[tokio::test]
async fn a_live_delete_waits_for_a_reindex_that_read_before_it() {
    let (service, source, leases, index) = service(true);
    source.put(message(MESSAGE, THREAD, Some("hello")));
    let (read, resume) = source.hold_next_read();

    let reindex = tokio::spawn({
        let service = service.clone();
        async move {
            service
                .reconcile_threads(&[THREAD], None, EmailWriter::Bulk, LeasePool::Bulk)
                .await
        }
    });
    read.await.unwrap();
    leases.requested.notified().await;

    source.delete(MESSAGE);
    let delete = tokio::spawn({
        let service = service.clone();
        async move {
            service
                .reconcile_message(delete_event(MESSAGE, THREAD))
                .await
        }
    });
    leases.requested.notified().await;
    assert!(
        !delete.is_finished(),
        "the delete ran under the reindex's lease"
    );

    resume.notify_one();
    let reindexed = reindex.await.unwrap().unwrap();
    let deleted = delete.await.unwrap().unwrap();

    assert_eq!(reindexed.writes.indexed, 1);
    assert_eq!(deleted.writes.deleted, 1);
    assert!(index.live().is_empty(), "the deleted message came back");
}

/// The same race when the reindex lost its lease without knowing: the delete
/// runs at once with a later version, and the index refuses the reindex's
/// stale write, which counts as refused, not as written or failed.
#[tokio::test]
async fn a_reindex_that_lost_its_lease_cannot_bring_back_a_deleted_message() {
    let (service, source, leases, index) = service(false);
    source.put(message(MESSAGE, THREAD, Some("hello")));
    let (read, resume) = source.hold_next_read();

    let reindex = tokio::spawn({
        let service = service.clone();
        async move {
            service
                .reconcile_threads(&[THREAD], None, EmailWriter::Bulk, LeasePool::Bulk)
                .await
        }
    });
    read.await.unwrap();
    leases.requested.notified().await;

    source.delete(MESSAGE);
    let deleted = service
        .reconcile_message(delete_event(MESSAGE, THREAD))
        .await
        .unwrap();
    resume.notify_one();
    let reindexed = reindex.await.unwrap().unwrap();

    assert_eq!(deleted.writes.deleted, 1);
    assert_eq!(
        reindexed.writes,
        EmailWrites {
            indexed: 0,
            deleted: 0,
            refused_stale: 1,
        }
    );
    assert!(index.live().is_empty(), "the deleted message came back");
}

/// A delete event is a hint to reread: a message the source still holds,
/// back out of the trash say, is indexed rather than deleted.
#[tokio::test]
async fn a_delete_event_for_a_message_still_searchable_indexes_it() {
    let (service, source, _, index) = service(true);
    source.put(message(MESSAGE, THREAD, Some("restored")));

    let reconciled = service
        .reconcile_message(delete_event(MESSAGE, THREAD))
        .await
        .unwrap();

    assert_eq!(reconciled.writes.indexed, 1);
    assert_eq!(
        index.live(),
        BTreeMap::from([(key(THREAD, MESSAGE), "restored".to_owned())])
    );
}

/// A deleted message goes under every thread it was indexed under, including
/// a thread it moved away from.
#[tokio::test]
async fn a_deleted_message_goes_under_every_thread() {
    let (service, _, _, index) = service(true);
    index.holds(key(THREAD, MESSAGE), "current copy");
    index.holds(key(OTHER_THREAD, MESSAGE), "old copy");
    index.holds(key(THREAD, SECOND_MESSAGE), "another message");

    let reconciled = service
        .reconcile_message(delete_event(MESSAGE, THREAD))
        .await
        .unwrap();

    assert_eq!(reconciled.writes.deleted, 2);
    assert_eq!(
        index.live(),
        BTreeMap::from([(key(THREAD, SECOND_MESSAGE), "another message".to_owned())])
    );
}

/// A draft that moved to another thread before its send: the send's event
/// names the old thread, so the writer leases both threads in order, writes
/// the message under its current thread and removes the old copy.
#[tokio::test]
async fn a_sent_message_that_moved_threads_is_written_under_its_current_thread() {
    let (service, source, leases, index) = service(true);
    let (old_thread, new_thread) = (OTHER_THREAD, THREAD);
    source.put(message(MESSAGE, new_thread, Some("sent")));
    index.holds(key(old_thread, MESSAGE), "draft");

    service
        .reconcile_message(MessageReconcile {
            message_id: MESSAGE,
            thread_id: old_thread,
            remove_moved_copies: true,
            writer: EmailWriter::Live,
            pool: LeasePool::Live,
        })
        .await
        .unwrap();

    assert_eq!(
        *leases.taken.lock().unwrap(),
        [vec![old_thread], vec![new_thread, old_thread]]
    );
    assert_eq!(
        index.live(),
        BTreeMap::from([(key(new_thread, MESSAGE), "sent".to_owned())])
    );
}

/// A thread reindex indexes its searchable messages and removes its excluded
/// ones under every thread, and leaves a message without a parsed body alone.
#[tokio::test]
async fn a_thread_reindex_removes_excluded_messages_everywhere() {
    let (service, source, _, index) = service(true);
    source.put(message(MESSAGE, THREAD, Some("kept")));
    source.put(excluded(SECOND_MESSAGE, THREAD));
    source.put(message(Uuid::from_u128(0x32), THREAD, None));
    index.holds(key(THREAD, SECOND_MESSAGE), "trashed");
    index.holds(key(OTHER_THREAD, SECOND_MESSAGE), "trashed, old thread");

    let reconciled = service
        .reconcile_threads(&[THREAD], None, EmailWriter::Live, LeasePool::Live)
        .await
        .unwrap();

    assert_eq!(reconciled.writes.indexed, 1);
    assert_eq!(reconciled.writes.deleted, 2);
    assert_eq!(
        index.live(),
        BTreeMap::from([(key(THREAD, MESSAGE), "kept".to_owned())])
    );
}

/// A batch leases its threads once, in order, whatever order they came in.
#[tokio::test]
async fn a_batch_leases_its_threads_once_in_order() {
    let (service, source, leases, index) = service(true);
    source.put(message(MESSAGE, OTHER_THREAD, Some("one")));
    source.put(message(SECOND_MESSAGE, THREAD, Some("two")));

    service
        .reconcile_threads(
            &[OTHER_THREAD, THREAD, OTHER_THREAD],
            None,
            EmailWriter::Bulk,
            LeasePool::Bulk,
        )
        .await
        .unwrap();

    assert_eq!(*leases.taken.lock().unwrap(), [vec![THREAD, OTHER_THREAD]]);
    assert_eq!(index.live().len(), 2);
}

/// Items one page failed do not keep the next pages out of the index, and the
/// thread still fails so it is retried.
#[tokio::test]
async fn a_page_with_failed_items_does_not_stop_the_thread() {
    let (service, source, _, index) = service(true);
    for n in 0..150 {
        source.put(message(Uuid::from_u128(0x1000 + n), THREAD, Some("body")));
    }
    index
        .failures
        .lock()
        .unwrap()
        .push_back(IndexWriteError::ItemsFailed(report!("mapping error")));

    let result = service
        .reconcile_threads(&[THREAD], None, EmailWriter::Live, LeasePool::Live)
        .await;

    assert!(result.is_err());
    assert_eq!(index.live().len(), 50, "the second page was not written");
}

/// A writer still working at its deadline stops and releases its lease, so
/// the next writer of the thread goes ahead.
#[tokio::test(start_paused = true)]
async fn a_writer_past_its_deadline_fails_and_releases_its_lease() {
    let (service, source, _, index) = service(true);
    source.put(message(MESSAGE, THREAD, Some("hello")));
    let (_read, _never_resumed) = source.hold_next_read();

    let stuck = service
        .reconcile_threads(&[THREAD], None, EmailWriter::Bulk, LeasePool::Bulk)
        .await;
    let next = service
        .reconcile_threads(&[THREAD], None, EmailWriter::Live, LeasePool::Live)
        .await
        .unwrap();

    assert!(stuck.is_err());
    assert_eq!(next.writes.indexed, 1);
    assert_eq!(index.live().len(), 1);
}
