use std::sync::Mutex;

use sqs_client::search::{SearchQueueMessage, call::CallRecordMessage};

use super::*;
use crate::domain::models::CallBackfillRequest;
use crate::domain::ports::{CallBackfillSource, SearchEventPublisher};

/// Programmable source. Each `fetch_page` call returns the next entry from
/// `pages`; after that, returns empty (so the orchestrator stops).
struct FakeSource {
    pages: Mutex<std::collections::VecDeque<Vec<SearchQueueMessage>>>,
    /// Records the offsets `fetch_page` was called with, in order.
    offsets: Mutex<Vec<usize>>,
}

impl FakeSource {
    fn new(pages: Vec<Vec<SearchQueueMessage>>) -> Self {
        Self {
            pages: Mutex::new(pages.into_iter().collect()),
            offsets: Mutex::new(Vec::new()),
        }
    }

    fn observed_offsets(&self) -> Vec<usize> {
        self.offsets.lock().unwrap().clone()
    }
}

impl CallBackfillSource for FakeSource {
    async fn fetch_page(
        &self,
        _req: &CallBackfillRequest,
        offset: usize,
    ) -> Result<Vec<SearchQueueMessage>, BackfillError> {
        self.offsets.lock().unwrap().push(offset);
        Ok(self.pages.lock().unwrap().pop_front().unwrap_or_default())
    }
}

/// Source that always errors. Verifies error propagation through the loop.
struct ExplodingSource;

impl CallBackfillSource for ExplodingSource {
    async fn fetch_page(
        &self,
        _req: &CallBackfillRequest,
        _offset: usize,
    ) -> Result<Vec<SearchQueueMessage>, BackfillError> {
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

#[tokio::test]
async fn drains_source_across_full_pages() {
    // Three full pages of 5; loop terminates on the empty fourth fetch.
    let source = FakeSource::new(vec![
        (0..5).map(|i| msg(&format!("p1-{i}"))).collect(),
        (0..5).map(|i| msg(&format!("p2-{i}"))).collect(),
        (0..5).map(|i| msg(&format!("p3-{i}"))).collect(),
    ]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();

    let receipt = drain_source(&publisher, |offset| source.fetch_page(&req, offset))
        .await
        .unwrap();

    assert_eq!(receipt.enqueued, 15);
    assert_eq!(publisher.batch_count(), 3);
    assert_eq!(publisher.total_messages(), 15);
    assert_eq!(publisher.batch_sizes(), vec![5, 5, 5]);
    // Source probed at offsets 0, 5, 10, 15 — last returns empty.
    assert_eq!(source.observed_offsets(), vec![0, 5, 10, 15]);
}

#[tokio::test]
async fn short_final_page_short_circuits() {
    // Pages of 5, 5, 2. After the 2-item page the loop continues with offset
    // 12 and gets empty, then stops. We don't try to short-circuit on
    // partial pages — the loop just trusts the source's emptiness signal.
    let source = FakeSource::new(vec![
        (0..5).map(|i| msg(&format!("a{i}"))).collect(),
        (0..5).map(|i| msg(&format!("b{i}"))).collect(),
        (0..2).map(|i| msg(&format!("c{i}"))).collect(),
    ]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();

    let receipt = drain_source(&publisher, |offset| source.fetch_page(&req, offset))
        .await
        .unwrap();

    assert_eq!(receipt.enqueued, 12);
    assert_eq!(publisher.batch_sizes(), vec![5, 5, 2]);
    assert_eq!(source.observed_offsets(), vec![0, 5, 10, 12]);
}

#[tokio::test]
async fn empty_source_publishes_nothing() {
    let source = FakeSource::new(vec![]);
    let publisher = RecordingPublisher::default();
    let req = CallBackfillRequest::default();

    let receipt = drain_source(&publisher, |offset| source.fetch_page(&req, offset))
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

    let err = drain_source(&publisher, |offset| source.fetch_page(&req, offset))
        .await
        .unwrap_err();

    assert!(matches!(err, BackfillError::Source(_)));
    assert_eq!(publisher.batch_count(), 0);
}

#[tokio::test]
async fn publish_error_propagates_after_first_fetch() {
    let source = FakeSource::new(vec![vec![msg("only")]]);
    let publisher = ExplodingPublisher;
    let req = CallBackfillRequest::default();

    let err = drain_source(&publisher, |offset| source.fetch_page(&req, offset))
        .await
        .unwrap_err();

    assert!(matches!(err, BackfillError::Publish(_)));
    // Source hit once with offset=0; publish failure stops the loop.
    assert_eq!(source.observed_offsets(), vec![0]);
}
