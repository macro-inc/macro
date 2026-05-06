use std::sync::Mutex;

use sqs_client::search::{SearchQueueMessage, call::CallRecordMessage};
use tokio_util::sync::CancellationToken;

use super::*;
use crate::domain::jobs::JobProgress;
use crate::domain::models::{CallBackfillRequest, SourcePage};
use crate::domain::ports::SearchEventPublisher;

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
    async fn publish(&self, messages: Vec<SearchQueueMessage>) -> Result<(), BackfillError> {
        self.batch_sizes.lock().unwrap().push(messages.len());
        Ok(())
    }
}

/// Publisher that always errors. Verifies error propagation.
struct ExplodingPublisher;

impl SearchEventPublisher for ExplodingPublisher {
    async fn publish(&self, _messages: Vec<SearchQueueMessage>) -> Result<(), BackfillError> {
        Err(BackfillError::Publish(anyhow::anyhow!("publish down")))
    }
}

fn msg(id: &str) -> SearchQueueMessage {
    SearchQueueMessage::CallRecord(CallRecordMessage {
        call_id: id.to_string(),
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

    let receipt = drain_source(&publisher, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
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

    let receipt = drain_source(&publisher, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
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

    let receipt = drain_source(&publisher, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
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

    let receipt = drain_source(&publisher, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
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

    let err = drain_source(&publisher, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
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

    let err = drain_source(&publisher, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
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

    let receipt = drain_source(&publisher, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 0);
    assert_eq!(publisher.batch_count(), 0);
    // Loop bailed before the first fetch.
    assert!(source.observed_offsets().is_empty());
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
        async fn publish(&self, messages: Vec<SearchQueueMessage>) -> Result<(), BackfillError> {
            self.seen.lock().unwrap().push(messages.len());
            self.cancel.cancel();
            Ok(())
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

    let receipt = drain_source(&publisher, &progress, &cancel, |offset| {
        source.fetch_page(&req, offset)
    })
    .await
    .unwrap();

    assert_eq!(receipt.enqueued, 5);
    assert_eq!(progress.local_count(), 5);
    // First page fetched + published; cancellation prevents the second fetch.
    assert_eq!(source.observed_offsets(), vec![0]);
    assert_eq!(*publisher.seen.lock().unwrap(), vec![5]);
}
