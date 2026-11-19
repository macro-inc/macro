use crate::domain::backfill_gate::BackfillGate;
use std::{
    collections::VecDeque,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use models_properties::EntityType;
use sqs_client::search::{SearchQueueMessage, call::CallRecordMessage};
use tokio_util::sync::CancellationToken;

use super::*;
use crate::domain::jobs::JobProgress;
use crate::domain::models::{CallBackfillRequest, PropertySourcePage, SourcePage};
use crate::domain::ports::{PropertyBackfillIndexer, SearchEventPublisher};

/// Programmable fake fetch closure. `drain_source` takes any
/// `Fn(usize) -> Future<SourcePage>`, so the test fakes don't need to
/// implement `BackfillSource` — we just give them a method that matches
/// the closure shape and avoid stubbing 4 unrelated trait methods.
struct FakeSource {
    pages: Mutex<std::collections::VecDeque<SourcePage>>,
    /// Records the offsets `fetch_page` was called with, in order.
    offsets: Mutex<Vec<usize>>,
}

impl FakeSource {
    fn new(pages: Vec<SourcePage>) -> Self {
        Self {
            pages: Mutex::new(pages.into_iter().collect()),
            offsets: Mutex::new(Vec::new()),
        }
    }

    async fn fetch_page(
        &self,
        _req: &CallBackfillRequest,
        offset: usize,
    ) -> Result<SourcePage, BackfillError> {
        self.offsets.lock().unwrap().push(offset);
        Ok(self
            .pages
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(SourcePage::empty))
    }

    fn observed_offsets(&self) -> Vec<usize> {
        self.offsets.lock().unwrap().clone()
    }
}

/// Source that always errors. Verifies error propagation through the loop.
struct ExplodingSource;

impl ExplodingSource {
    async fn fetch_page(
        &self,
        _req: &CallBackfillRequest,
        _offset: usize,
    ) -> Result<SourcePage, BackfillError> {
        Err(BackfillError::Source(anyhow::anyhow!("source down")))
    }
}

/// Records publisher activity. `SearchQueueMessage` doesn't impl `Clone`, so
/// instead of holding the messages we just count batches + total messages.
#[derive(Default)]
struct RecordingPublisher {
    batch_sizes: Mutex<Vec<usize>>,
}

impl RecordingPublisher {
    fn batch_count(&self) -> usize {
        self.batch_sizes.lock().unwrap().len()
    }

    fn total_messages(&self) -> usize {
        self.batch_sizes.lock().unwrap().iter().sum()
    }

    fn batch_sizes(&self) -> Vec<usize> {
        self.batch_sizes.lock().unwrap().clone()
    }
}

impl SearchEventPublisher for RecordingPublisher {
    async fn publish(&self, messages: Vec<SearchQueueMessage>) -> Result<usize, BackfillError> {
        self.batch_sizes.lock().unwrap().push(messages.len());
        Ok(0)
    }
}

/// Publisher that always errors. Verifies error propagation.
struct ExplodingPublisher;

impl SearchEventPublisher for ExplodingPublisher {
    async fn publish(&self, _messages: Vec<SearchQueueMessage>) -> Result<usize, BackfillError> {
        Err(BackfillError::Publish(anyhow::anyhow!("publish down")))
    }
}

fn msg(id: &str) -> SearchQueueMessage {
    SearchQueueMessage::CallRecord(CallRecordMessage {
        call_id: id.to_string(),
        index_override: None,
    })
}

/// Build a 1:1 page where messages.len() == rows_consumed (the typical case
/// for non-batching sources like calls/chats/channels/documents).
fn page(messages: Vec<SearchQueueMessage>) -> SourcePage {
    let rows_consumed = messages.len();
    SourcePage {
        messages,
        rows_consumed,
    }
}

fn detached() -> (JobProgress, CancellationToken) {
    (JobProgress::detached(), CancellationToken::new())
}

#[tokio::test]
async fn drains_source_across_full_pages() {
    // Three full pages of 5; loop terminates on the empty fourth fetch.
    let source = FakeSource::new(vec![
        page((0..5).map(|i| msg(&format!("p1-{i}"))).collect()),
        page((0..5).map(|i| msg(&format!("p2-{i}"))).collect()),
        page((0..5).map(|i| msg(&format!("p3-{i}"))).collect()),
    ]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();

    let receipt = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 15);
    assert_eq!(progress.local_count(), 15);
    assert_eq!(publisher.batch_count(), 3);
    assert_eq!(publisher.total_messages(), 15);
    assert_eq!(publisher.batch_sizes(), vec![5, 5, 5]);
    // Probed at offsets 0, 5, 10, 15 — last returns empty.
    assert_eq!(source.observed_offsets(), vec![0, 5, 10, 15]);
}

/// Publisher that reports some messages of one page as not queued.
#[derive(Default)]
struct PartlyRefusingPublisher {
    pages: Mutex<usize>,
}

impl SearchEventPublisher for PartlyRefusingPublisher {
    async fn publish(&self, _messages: Vec<SearchQueueMessage>) -> Result<usize, BackfillError> {
        let mut pages = self.pages.lock().unwrap();
        *pages += 1;
        Ok(if *pages == 2 { 2 } else { 0 })
    }
}

#[tokio::test]
async fn messages_the_queue_would_not_take_are_counted() {
    let source = FakeSource::new(vec![
        page((0..5).map(|i| msg(&format!("p1-{i}"))).collect()),
        page((0..5).map(|i| msg(&format!("p2-{i}"))).collect()),
        page((0..5).map(|i| msg(&format!("p3-{i}"))).collect()),
    ]);
    let publisher = PartlyRefusingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();

    let receipt = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap();

    assert_eq!((receipt.enqueued, receipt.not_queued), (15, 2));
    assert_eq!(progress.local_progress().not_queued, 2);
}

#[tokio::test]
async fn messages_a_cursor_drain_could_not_queue_are_counted() {
    let publisher = PartlyRefusingPublisher::default();
    let (progress, cancel) = detached();
    let pages = Mutex::new(vec![
        (vec![msg("a"), msg("b")], Some(2u32)),
        (vec![msg("c"), msg("d")], Some(4u32)),
        (vec![], None),
    ]);

    let receipt = drain_source_with_cursor(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |_cursor| {
            let (messages, next) = pages.lock().unwrap().remove(0);
            let rows_consumed = messages.len();
            async move {
                Ok((
                    SourcePage {
                        messages,
                        rows_consumed,
                    },
                    next,
                ))
            }
        },
    )
    .await
    .unwrap();

    assert_eq!((receipt.enqueued, receipt.not_queued), (4, 2));
    assert_eq!(progress.local_progress().not_queued, 2);
}

#[tokio::test]
async fn short_final_page_short_circuits() {
    // Pages of 5, 5, 2. The 2-row page advances offset to 12; the next fetch
    // returns empty and the loop stops.
    let source = FakeSource::new(vec![
        page((0..5).map(|i| msg(&format!("a{i}"))).collect()),
        page((0..5).map(|i| msg(&format!("b{i}"))).collect()),
        page((0..2).map(|i| msg(&format!("c{i}"))).collect()),
    ]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();

    let receipt = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 12);
    assert_eq!(publisher.batch_sizes(), vec![5, 5, 2]);
    assert_eq!(source.observed_offsets(), vec![0, 5, 10, 12]);
}

#[tokio::test]
async fn batched_source_advances_by_rows_not_messages() {
    // Mimics the email source: each page consumes 100 source rows but
    // produces only 3 batched messages. The loop must advance offset by
    // `rows_consumed` (100), not by `messages.len()` (3) — otherwise the
    // next fetch would re-read 97 rows we just processed.
    let source = FakeSource::new(vec![
        SourcePage {
            messages: (0..3).map(|i| msg(&format!("p1-{i}"))).collect(),
            rows_consumed: 100,
        },
        SourcePage {
            messages: (0..3).map(|i| msg(&format!("p2-{i}"))).collect(),
            rows_consumed: 100,
        },
        SourcePage {
            messages: (0..2).map(|i| msg(&format!("p3-{i}"))).collect(),
            rows_consumed: 40,
        },
    ]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();

    let receipt = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap();

    // enqueued = sum of rows_consumed (the meaningful unit), not message count.
    assert_eq!(receipt.enqueued, 240);
    // The publisher saw the message-count-shaped batches: 3, 3, 2.
    assert_eq!(publisher.batch_sizes(), vec![3, 3, 2]);
    // Offsets advance by rows_consumed: 0 → 100 → 200 → 240 → empty.
    assert_eq!(source.observed_offsets(), vec![0, 100, 200, 240]);
}

#[tokio::test]
async fn empty_source_publishes_nothing() {
    let source = FakeSource::new(vec![]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();

    let receipt = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 0);
    assert_eq!(publisher.batch_count(), 0);
    assert_eq!(source.observed_offsets(), vec![0]);
}

#[tokio::test]
async fn source_error_propagates_without_partial_publish() {
    let source = ExplodingSource;
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();

    let err = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap_err();

    assert!(matches!(err, BackfillError::Source(_)));
    assert_eq!(publisher.batch_count(), 0);
}

#[tokio::test]
async fn publish_error_propagates_after_first_fetch() {
    let source = FakeSource::new(vec![page(vec![msg("only")])]);
    let publisher = ExplodingPublisher;
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();

    let err = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap_err();

    assert!(matches!(err, BackfillError::Publish(_)));
    // Source hit once with offset=0; publish failure stops the loop.
    assert_eq!(source.observed_offsets(), vec![0]);
}

#[tokio::test]
async fn cancel_before_first_fetch_returns_empty_receipt() {
    let source = FakeSource::new(vec![page(vec![msg("never-read")])]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();
    cancel.cancel();

    let receipt = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 0);
    assert_eq!(publisher.batch_count(), 0);
    // Loop bailed before the first fetch.
    assert!(source.observed_offsets().is_empty());
}

/// Fake source for the cursor-based loop. Pages out a programmed
/// sequence and records the cursor it was called with each time so
/// tests can assert the cursor advances correctly.
struct CursorFakeSource {
    pages: Mutex<std::collections::VecDeque<(SourcePage, Option<usize>)>>,
    cursors: Mutex<Vec<Option<usize>>>,
}

impl CursorFakeSource {
    fn new(pages: Vec<(SourcePage, Option<usize>)>) -> Self {
        Self {
            pages: Mutex::new(pages.into_iter().collect()),
            cursors: Mutex::new(Vec::new()),
        }
    }

    async fn fetch_page(
        &self,
        cursor: Option<usize>,
    ) -> Result<(SourcePage, Option<usize>), BackfillError> {
        self.cursors.lock().unwrap().push(cursor);
        Ok(self
            .pages
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| (SourcePage::empty(), None)))
    }

    fn observed_cursors(&self) -> Vec<Option<usize>> {
        self.cursors.lock().unwrap().clone()
    }
}

#[tokio::test]
async fn cursor_drain_threads_cursor_through_pages() {
    // Three pages: first call passes None; subsequent calls pass the
    // cursor each previous page returned. Loop stops on empty page.
    let source = CursorFakeSource::new(vec![
        (
            page((0..5).map(|i| msg(&format!("p1-{i}"))).collect()),
            Some(10),
        ),
        (
            page((0..5).map(|i| msg(&format!("p2-{i}"))).collect()),
            Some(20),
        ),
        (
            page((0..3).map(|i| msg(&format!("p3-{i}"))).collect()),
            Some(30),
        ),
    ]);
    let publisher = RecordingPublisher::default();
    let (progress, cancel) = detached();

    let receipt = drain_source_with_cursor(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |cursor| source.fetch_page(cursor),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 13);
    assert_eq!(publisher.batch_sizes(), vec![5, 5, 3]);
    // Cursors: None (first), Some(10), Some(20), Some(30) (empty terminator).
    assert_eq!(
        source.observed_cursors(),
        vec![None, Some(10), Some(20), Some(30)]
    );
}

#[tokio::test]
async fn cursor_drain_stops_when_non_empty_page_returns_no_cursor() {
    // Defensive path: source returns a non-empty page but `None` for the
    // next cursor (e.g. the last row's sort-key column came back NULL).
    // The loop must treat this as terminator — passing `None` back into
    // `fetch` would restart pagination from page one.
    let source = CursorFakeSource::new(vec![
        (
            page((0..3).map(|i| msg(&format!("p1-{i}"))).collect()),
            None,
        ),
        (
            page((0..3).map(|i| msg(&format!("never-{i}"))).collect()),
            Some(99),
        ),
    ]);
    let publisher = RecordingPublisher::default();
    let (progress, cancel) = detached();

    let receipt = drain_source_with_cursor(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |cursor| source.fetch_page(cursor),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 3);
    assert_eq!(publisher.batch_sizes(), vec![3]);
    // Only the first fetch happens; the loop bails before re-entering with `None`.
    assert_eq!(source.observed_cursors(), vec![None]);
}

#[tokio::test]
async fn cursor_drain_publish_failure_counts_only_completed_pages() {
    struct FailSecondPublish(AtomicUsize);
    impl SearchEventPublisher for FailSecondPublish {
        async fn publish(&self, _: Vec<SearchQueueMessage>) -> Result<usize, BackfillError> {
            if self.0.fetch_add(1, Ordering::Relaxed) == 1 {
                return Err(BackfillError::Publish(anyhow::anyhow!("queue unavailable")));
            }
            Ok(0)
        }
    }
    let source = CursorFakeSource::new(vec![
        (page(vec![msg("first")]), Some(1)),
        (page(vec![msg("failed")]), Some(2)),
        (page(vec![msg("not-fetched")]), Some(3)),
    ]);
    let publisher = FailSecondPublish(AtomicUsize::new(0));
    let (progress, cancel) = detached();
    let error = drain_source_with_cursor(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |cursor| source.fetch_page(cursor),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, BackfillError::Publish(_)));
    assert_eq!(progress.local_count(), 1);
    assert_eq!(source.observed_cursors(), vec![None, Some(1)]);
}

#[tokio::test]
async fn cursor_drain_stops_on_empty_page() {
    let source = CursorFakeSource::new(vec![]);
    let publisher = RecordingPublisher::default();
    let (progress, cancel) = detached();

    let receipt = drain_source_with_cursor(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |cursor| source.fetch_page(cursor),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 0);
    assert_eq!(publisher.batch_count(), 0);
    // Probed once with no cursor, got empty, terminated.
    assert_eq!(source.observed_cursors(), vec![None]);
}

#[tokio::test]
async fn cursor_drain_cancellation_stops_between_pages() {
    let source = CursorFakeSource::new(vec![
        (
            page((0..3).map(|i| msg(&format!("a{i}"))).collect()),
            Some(7),
        ),
        (
            page((0..3).map(|i| msg(&format!("never-{i}"))).collect()),
            Some(99),
        ),
    ]);
    let (progress, cancel) = detached();
    let cancel_clone = cancel.clone();
    struct CancellingPublisher {
        cancel: CancellationToken,
        seen: Mutex<Vec<usize>>,
    }
    impl SearchEventPublisher for CancellingPublisher {
        async fn publish(&self, messages: Vec<SearchQueueMessage>) -> Result<usize, BackfillError> {
            self.seen.lock().unwrap().push(messages.len());
            self.cancel.cancel();
            Ok(0)
        }
    }
    let publisher = CancellingPublisher {
        cancel: cancel_clone,
        seen: Mutex::new(Vec::new()),
    };

    let receipt = drain_source_with_cursor(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |cursor| source.fetch_page(cursor),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 3);
    // First page fetched + published; cancellation stops the second fetch.
    assert_eq!(source.observed_cursors(), vec![None]);
}

#[tokio::test]
async fn cancel_between_pages_stops_drain_after_current_page() {
    // Cancel the token from inside the publisher: the page that triggered
    // the cancel still publishes (we already paid for the fetch), but the
    // next iteration sees the flag and bails before the second fetch.
    struct CancellingPublisher {
        cancel: CancellationToken,
        seen: Mutex<Vec<usize>>,
    }
    impl SearchEventPublisher for CancellingPublisher {
        async fn publish(&self, messages: Vec<SearchQueueMessage>) -> Result<usize, BackfillError> {
            self.seen.lock().unwrap().push(messages.len());
            self.cancel.cancel();
            Ok(0)
        }
    }

    let source = FakeSource::new(vec![
        page((0..5).map(|i| msg(&format!("first-{i}"))).collect()),
        page((0..5).map(|i| msg(&format!("never-{i}"))).collect()),
    ]);
    let (progress, cancel) = detached();
    let publisher = CancellingPublisher {
        cancel: cancel.clone(),
        seen: Mutex::new(Vec::new()),
    };
    let req = CallBackfillRequest::default();

    let receipt = drain_source(
        &publisher,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(&req, offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 5);
    assert_eq!(progress.local_count(), 5);
    // First page fetched + published; cancellation prevents the second fetch.
    assert_eq!(source.observed_offsets(), vec![0]);
    assert_eq!(*publisher.seen.lock().unwrap(), vec![5]);
}

struct FakePropertySource {
    pages: Mutex<VecDeque<PropertySourcePage>>,
    offsets: Mutex<Vec<usize>>,
    entity_type: EntityType,
}

impl FakePropertySource {
    fn new(entity_type: EntityType, pages: Vec<PropertySourcePage>) -> Self {
        Self {
            pages: Mutex::new(pages.into_iter().collect()),
            offsets: Mutex::new(Vec::new()),
            entity_type,
        }
    }

    async fn fetch_page(&self, offset: usize) -> Result<PropertySourcePage, BackfillError> {
        self.offsets.lock().unwrap().push(offset);
        Ok(self
            .pages
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| PropertySourcePage::empty(self.entity_type)))
    }

    fn observed_offsets(&self) -> Vec<usize> {
        self.offsets.lock().unwrap().clone()
    }
}

#[derive(Default)]
struct RecordingPropertyIndexer {
    entities: Mutex<Vec<(String, EntityType)>>,
}

impl RecordingPropertyIndexer {
    fn indexed_count(&self) -> usize {
        self.entities.lock().unwrap().len()
    }

    fn indexed_entities(&self) -> Vec<(String, EntityType)> {
        self.entities.lock().unwrap().clone()
    }
}

impl PropertyBackfillIndexer for RecordingPropertyIndexer {
    async fn reindex(&self, entity_id: &str, entity_type: EntityType) -> Result<(), BackfillError> {
        self.entities
            .lock()
            .unwrap()
            .push((entity_id.to_owned(), entity_type));
        Ok(())
    }
}

fn property_page(
    entity_type: EntityType,
    entity_ids: impl IntoIterator<Item = impl Into<String>>,
    rows_consumed: usize,
) -> PropertySourcePage {
    PropertySourcePage {
        entity_ids: entity_ids.into_iter().map(Into::into).collect(),
        entity_type,
        rows_consumed,
    }
}

#[tokio::test]
async fn property_backfill_drains_multiple_pages() {
    let entity_type = EntityType::Document;
    let source = FakePropertySource::new(
        entity_type,
        vec![
            property_page(entity_type, ["one", "two"], 2),
            property_page(entity_type, ["three"], 1),
        ],
    );
    let indexer = RecordingPropertyIndexer::default();
    let (progress, cancel) = detached();

    let receipt = drain_property_source(
        &indexer,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 3);
    assert_eq!(
        indexer.indexed_entities(),
        vec![
            ("one".to_owned(), EntityType::Document),
            ("two".to_owned(), EntityType::Document),
            ("three".to_owned(), EntityType::Document),
        ]
    );
    assert_eq!(source.observed_offsets(), vec![0, 2, 3]);
}

#[tokio::test]
async fn property_backfill_advances_offset_by_rows_consumed() {
    let entity_type = EntityType::Thread;
    let source = FakePropertySource::new(
        entity_type,
        vec![
            property_page(entity_type, ["one", "two"], 100),
            property_page(entity_type, ["three"], 40),
        ],
    );
    let indexer = RecordingPropertyIndexer::default();
    let (progress, cancel) = detached();

    let receipt = drain_property_source(
        &indexer,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 140);
    assert_eq!(indexer.indexed_count(), 3);
    assert_eq!(source.observed_offsets(), vec![0, 100, 140]);
}

#[tokio::test]
async fn property_backfill_updates_progress_after_successful_page() {
    let entity_type = EntityType::Project;
    let source = FakePropertySource::new(
        entity_type,
        vec![property_page(entity_type, ["one", "two"], 7)],
    );
    let indexer = RecordingPropertyIndexer::default();
    let (progress, cancel) = detached();

    let receipt = drain_property_source(
        &indexer,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 7);
    assert_eq!(progress.local_count(), 7);
}

#[tokio::test]
async fn property_backfill_empty_page_indexes_nothing() {
    let entity_type = EntityType::Task;
    let source = FakePropertySource::new(entity_type, Vec::new());
    let indexer = RecordingPropertyIndexer::default();
    let (progress, cancel) = detached();

    let receipt = drain_property_source(
        &indexer,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 0);
    assert_eq!(progress.local_count(), 0);
    assert_eq!(indexer.indexed_count(), 0);
    assert_eq!(source.observed_offsets(), vec![0]);
}

struct CancellingPropertyIndexer {
    cancel: CancellationToken,
    indexed: AtomicUsize,
}

impl PropertyBackfillIndexer for CancellingPropertyIndexer {
    async fn reindex(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(), BackfillError> {
        self.indexed.fetch_add(1, Ordering::Relaxed);
        self.cancel.cancel();
        Ok(())
    }
}

#[tokio::test]
async fn property_backfill_cancellation_stops_between_pages() {
    let entity_type = EntityType::Chat;
    let source = FakePropertySource::new(
        entity_type,
        vec![
            property_page(entity_type, ["indexed"], 1),
            property_page(entity_type, ["not-indexed"], 1),
        ],
    );
    let (progress, cancel) = detached();
    let indexer = CancellingPropertyIndexer {
        cancel: cancel.clone(),
        indexed: AtomicUsize::new(0),
    };

    let receipt = drain_property_source(
        &indexer,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 1);
    assert_eq!(progress.local_count(), 1);
    assert_eq!(indexer.indexed.load(Ordering::Relaxed), 1);
    assert_eq!(source.observed_offsets(), vec![0]);
}

struct FailingPropertyIndexer;

impl PropertyBackfillIndexer for FailingPropertyIndexer {
    async fn reindex(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(), BackfillError> {
        Err(BackfillError::Reindex(anyhow::anyhow!("reindex failed")))
    }
}

#[tokio::test]
async fn property_backfill_reindex_failure_propagates_without_progress() {
    let entity_type = EntityType::Channel;
    let source = FakePropertySource::new(
        entity_type,
        vec![property_page(entity_type, ["failure"], 1)],
    );
    let indexer = FailingPropertyIndexer;
    let (progress, cancel) = detached();

    let error = drain_property_source(
        &indexer,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(offset),
    )
    .await
    .unwrap_err();

    assert!(matches!(error, BackfillError::Reindex(_)));
    assert_eq!(progress.local_count(), 0);
    assert_eq!(source.observed_offsets(), vec![0]);
}

#[derive(Default)]
struct ConcurrencyTrackingPropertyIndexer {
    active: AtomicUsize,
    maximum_active: AtomicUsize,
    completed: AtomicUsize,
}

impl PropertyBackfillIndexer for ConcurrencyTrackingPropertyIndexer {
    async fn reindex(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(), BackfillError> {
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.maximum_active.fetch_max(active, Ordering::SeqCst);

        tokio::time::sleep(Duration::from_millis(5)).await;

        self.active.fetch_sub(1, Ordering::SeqCst);
        self.completed.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test]
async fn property_backfill_limits_reindexes_to_twenty_simultaneous_operations() {
    let entity_type = EntityType::Document;
    let entity_ids = (0..45).map(|index| format!("entity-{index}"));
    let source = FakePropertySource::new(
        entity_type,
        vec![property_page(entity_type, entity_ids, 45)],
    );
    let indexer = ConcurrencyTrackingPropertyIndexer::default();
    let (progress, cancel) = detached();

    let receipt = drain_property_source(
        &indexer,
        &BackfillGate::open(20),
        &progress,
        &cancel,
        |offset| source.fetch_page(offset),
    )
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 45);
    assert_eq!(indexer.completed.load(Ordering::SeqCst), 45);
    assert_eq!(indexer.maximum_active.load(Ordering::SeqCst), 20);
}

/// Records the most reindexes it ever ran at once.
#[derive(Default)]
struct ConcurrencyRecordingIndexer {
    running: std::sync::atomic::AtomicUsize,
    most: std::sync::atomic::AtomicUsize,
}

impl PropertyBackfillIndexer for ConcurrencyRecordingIndexer {
    async fn reindex(&self, _: &str, _: EntityType) -> Result<(), BackfillError> {
        use std::sync::atomic::Ordering::SeqCst;
        let now = self.running.fetch_add(1, SeqCst) + 1;
        self.most.fetch_max(now, SeqCst);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        self.running.fetch_sub(1, SeqCst);
        Ok(())
    }
}

#[tokio::test(start_paused = true)]
async fn property_reindexes_share_the_backfill_cap() {
    let entity_type = EntityType::Document;
    let ids: Vec<String> = (0..40).map(|i| format!("doc-{i}")).collect();
    let source = FakePropertySource::new(entity_type, vec![property_page(entity_type, ids, 40)]);
    let indexer = ConcurrencyRecordingIndexer::default();
    let (progress, cancel) = detached();

    drain_property_source(
        &indexer,
        &BackfillGate::open(3),
        &progress,
        &cancel,
        |offset| source.fetch_page(offset),
    )
    .await
    .unwrap();

    assert_eq!(indexer.most.load(std::sync::atomic::Ordering::SeqCst), 3);
}

fn paused_gate() -> (tokio::sync::watch::Sender<bool>, BackfillGate) {
    let (pause, paused) = tokio::sync::watch::channel(true);
    (pause, BackfillGate::new(20, paused))
}

#[tokio::test(start_paused = true)]
async fn a_paused_backfill_enqueues_nothing_until_it_resumes() {
    let source = FakeSource::new(vec![page(vec![msg("a"), msg("b")])]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();
    let (pause, gate) = paused_gate();

    let drain = drain_source(&publisher, &gate, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    });
    tokio::pin!(drain);
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(60), &mut drain)
            .await
            .is_err()
    );
    assert_eq!(
        publisher.total_messages(),
        0,
        "nothing enqueued while paused"
    );

    pause.send_replace(false);
    let receipt = drain.await.unwrap();
    assert_eq!(receipt.enqueued, 2);
}

#[tokio::test(start_paused = true)]
async fn a_paused_backfill_still_stops_when_cancelled() {
    let source = FakeSource::new(vec![page(vec![msg("a")])]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();
    let (progress, cancel) = detached();
    let (_pause, gate) = paused_gate();
    let canceller = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        canceller.cancel();
    });

    let receipt = drain_source(&publisher, &gate, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 0);
    assert_eq!(publisher.total_messages(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_property_page_cancelled_while_paused_is_not_counted() {
    let entity_type = EntityType::Document;
    let source = FakePropertySource::new(
        entity_type,
        vec![property_page(entity_type, ["one", "two"], 2)],
    );
    let indexer = RecordingPropertyIndexer::default();
    let (progress, cancel) = detached();
    let (pause, paused) = tokio::sync::watch::channel(false);
    let gate = BackfillGate::new(20, paused);
    let canceller = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        canceller.cancel();
    });

    // The pause arrives while the page is fetched, after the page boundary,
    // so the page's writes wait on it.
    let receipt = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        drain_property_source(&indexer, &gate, &progress, &cancel, |offset| {
            pause.send_replace(true);
            source.fetch_page(offset)
        }),
    )
    .await
    .expect("a cancel ends a paused property backfill")
    .unwrap();

    assert_eq!((receipt.enqueued, indexer.indexed_count()), (0, 0));
    assert_eq!(progress.local_count(), 0);
}
