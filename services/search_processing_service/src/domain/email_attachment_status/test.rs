use crate::domain::backfill_gate::BackfillGate;
use std::{collections::VecDeque, sync::Mutex};

use super::*;
use crate::domain::jobs::DetachedProgress;

/// Linked documents in `document_id` order, paged the way the Postgres
/// source pages them. Records the cursor each page started after.
struct FakeSource {
    documents: Vec<LinkedDocument>,
    pages_after: Mutex<Vec<Option<String>>>,
}

impl FakeSource {
    fn new(documents: &[(&str, bool)]) -> Self {
        Self {
            documents: documents
                .iter()
                .map(|(document_id, is_live)| LinkedDocument {
                    document_id: document_id.to_string(),
                    is_live: *is_live,
                })
                .collect(),
            pages_after: Mutex::new(Vec::new()),
        }
    }

    fn pages_after(&self) -> Vec<Option<String>> {
        self.pages_after.lock().unwrap().clone()
    }
}

impl LinkedDocumentSource for FakeSource {
    async fn page_after(
        &self,
        after_document_id: Option<&str>,
        limit: PageSize,
    ) -> Result<Vec<LinkedDocument>, Report> {
        self.pages_after
            .lock()
            .unwrap()
            .push(after_document_id.map(str::to_owned));
        Ok(self
            .documents
            .iter()
            .filter(|document| {
                after_document_id.is_none_or(|after| document.document_id.as_str() > after)
            })
            .take(usize::from(limit.get()))
            .cloned()
            .collect())
    }
}

/// What the fake index does with one batch.
enum Reply {
    /// Report the first `missing` documents of the batch as not indexed.
    Missing(usize),
    /// Report the first `failed` documents of the batch as failed.
    Fail(usize),
    Refuse,
    /// Cancel the job while the batch is in flight.
    CancelJob(CancellationToken),
}

/// Records each batch it is sent and answers from a script, then updates
/// every document once the script runs out.
#[derive(Default)]
struct FakeIndex {
    replies: Mutex<VecDeque<Reply>>,
    batches: Mutex<Vec<(Vec<String>, bool)>>,
}

impl FakeIndex {
    fn replying(replies: Vec<Reply>) -> Self {
        Self {
            replies: Mutex::new(replies.into()),
            ..Default::default()
        }
    }

    fn batches(&self) -> Vec<(Vec<String>, bool)> {
        self.batches.lock().unwrap().clone()
    }
}

impl EmailAttachmentFlagIndex for FakeIndex {
    async fn set_email_attachment(
        &self,
        document_ids: &[String],
        is_email_attachment: bool,
    ) -> Result<FlagUpdate, FlagIndexError> {
        self.batches
            .lock()
            .unwrap()
            .push((document_ids.to_vec(), is_email_attachment));
        let (missing, failed) = match self.replies.lock().unwrap().pop_front() {
            None => (0, 0),
            Some(Reply::Missing(missing)) => (missing, 0),
            Some(Reply::Fail(failed)) => (0, failed),
            Some(Reply::Refuse) => {
                return Err(FlagIndexError::Refused(
                    "disk usage exceeded flood-stage watermark".to_owned(),
                ));
            }
            Some(Reply::CancelJob(cancel)) => {
                cancel.cancel();
                (0, 0)
            }
        };
        Ok(FlagUpdate {
            updated: document_ids.len() - missing - failed,
            missing,
            failed,
        })
    }
}

fn request(
    after_document_id: Option<&str>,
    page_size: u16,
) -> EmailAttachmentStatusBackfillRequest {
    EmailAttachmentStatusBackfillRequest {
        after_document_id: after_document_id.map(str::to_owned),
        page_size: Some(PageSize::try_from(page_size).unwrap()),
        docs_per_second: Some(NonZeroU32::new(1000).unwrap()),
    }
}

fn ids(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

const LINKED: [(&str, bool); 5] = [
    ("doc-a", true),
    ("doc-b", true),
    ("doc-c", false),
    ("doc-d", true),
    ("doc-e", true),
];

#[tokio::test(start_paused = true)]
async fn sets_the_flag_on_every_live_linked_document_and_records_each_page() {
    let backfill = EmailAttachmentStatusBackfill::new(
        FakeSource::new(&LINKED),
        FakeIndex::replying(vec![Reply::Missing(0), Reply::Missing(1)]),
        BackfillGate::open(1),
    );
    let progress = Arc::new(JobProgress::detached());

    let receipt = backfill
        .backfill(request(None, 2), progress.clone(), CancellationToken::new())
        .await
        .unwrap();

    // The trashed document is read, so the walk moves past it, but not sent.
    assert_eq!(
        backfill.index.batches(),
        vec![
            (ids(&["doc-a", "doc-b"]), true),
            (ids(&["doc-d"]), true),
            (ids(&["doc-e"]), true),
        ]
    );
    assert_eq!(
        backfill.source.pages_after(),
        vec![
            None,
            Some("doc-b".to_owned()),
            Some("doc-d".to_owned()),
            Some("doc-e".to_owned()),
        ]
    );
    assert_eq!(receipt.enqueued, 5);
    assert_eq!(
        progress.local_progress(),
        DetachedProgress {
            enqueued: 5,
            cursor: Some("doc-e".to_owned()),
            updated: 3,
            missing: 1,
            failed: 0,
            not_queued: 0,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn resumes_after_the_given_document() {
    let backfill = EmailAttachmentStatusBackfill::new(
        FakeSource::new(&LINKED),
        FakeIndex::default(),
        BackfillGate::open(1),
    );

    backfill
        .backfill(
            request(Some("doc-c"), 500),
            Arc::new(JobProgress::detached()),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(backfill.source.pages_after()[0].as_deref(), Some("doc-c"));
    assert_eq!(
        backfill.index.batches(),
        vec![(ids(&["doc-d", "doc-e"]), true)]
    );
}

#[tokio::test(start_paused = true)]
async fn a_page_with_no_live_document_sends_nothing_and_moves_on() {
    let backfill = EmailAttachmentStatusBackfill::new(
        FakeSource::new(&[("doc-a", false), ("doc-b", false), ("doc-c", true)]),
        FakeIndex::default(),
        BackfillGate::open(1),
    );
    let progress = Arc::new(JobProgress::detached());

    backfill
        .backfill(request(None, 2), progress.clone(), CancellationToken::new())
        .await
        .unwrap();

    assert_eq!(backfill.index.batches(), vec![(ids(&["doc-c"]), true)]);
    assert_eq!(progress.local_progress().cursor.as_deref(), Some("doc-c"));
}

#[tokio::test(start_paused = true)]
async fn a_refusal_stops_the_job_at_the_last_finished_page() {
    let backfill = EmailAttachmentStatusBackfill::new(
        FakeSource::new(&LINKED),
        FakeIndex::replying(vec![Reply::Missing(0), Reply::Refuse]),
        BackfillGate::open(1),
    );
    let progress = Arc::new(JobProgress::detached());

    let error = backfill
        .backfill(request(None, 2), progress.clone(), CancellationToken::new())
        .await
        .unwrap_err();

    let BackfillError::Stopped { reason, cursor } = error else {
        panic!("expected the job to stop, got {error:?}");
    };
    assert!(reason.contains("flood-stage"), "{reason}");
    assert_eq!(cursor.as_deref(), Some("doc-b"));
    // Nothing is sent or read after the refusal.
    assert_eq!(backfill.index.batches().len(), 2);
    assert_eq!(backfill.source.pages_after().len(), 2);
    assert_eq!(progress.local_progress().cursor.as_deref(), Some("doc-b"));
}

#[tokio::test(start_paused = true)]
async fn a_page_with_failed_updates_stops_without_moving_the_cursor_past_it() {
    let backfill = EmailAttachmentStatusBackfill::new(
        FakeSource::new(&LINKED),
        FakeIndex::replying(vec![Reply::Missing(0), Reply::Fail(1)]),
        BackfillGate::open(1),
    );
    let progress = Arc::new(JobProgress::detached());

    let error = backfill
        .backfill(request(None, 2), progress.clone(), CancellationToken::new())
        .await
        .unwrap_err();

    let BackfillError::Stopped { reason, cursor } = error else {
        panic!("expected the job to stop, got {error:?}");
    };
    assert!(reason.contains("1 documents failed"), "{reason}");
    // A resume from here repeats the page holding the failed document.
    assert_eq!(cursor.as_deref(), Some("doc-b"));
    assert_eq!(progress.local_progress().cursor.as_deref(), Some("doc-b"));
}

#[tokio::test(start_paused = true)]
async fn a_refusal_on_the_first_page_keeps_the_requested_cursor() {
    let backfill = EmailAttachmentStatusBackfill::new(
        FakeSource::new(&LINKED),
        FakeIndex::replying(vec![Reply::Refuse]),
        BackfillGate::open(1),
    );

    let error = backfill
        .backfill(
            request(Some("doc-a"), 2),
            Arc::new(JobProgress::detached()),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();

    assert!(
        matches!(&error, BackfillError::Stopped { cursor, .. } if cursor.as_deref() == Some("doc-a")),
        "{error:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn cancellation_stops_after_the_page_in_flight_without_waiting_out_its_pause() {
    let cancel = CancellationToken::new();
    let backfill = EmailAttachmentStatusBackfill::new(
        FakeSource::new(&LINKED),
        FakeIndex::replying(vec![Reply::CancelJob(cancel.clone())]),
        BackfillGate::open(1),
    );
    let progress = Arc::new(JobProgress::detached());
    let started = Instant::now();

    let receipt = backfill
        .backfill(
            EmailAttachmentStatusBackfillRequest {
                page_size: Some(PageSize::try_from(2).unwrap()),
                docs_per_second: Some(NonZeroU32::new(1).unwrap()),
                ..Default::default()
            },
            progress.clone(),
            cancel,
        )
        .await
        .unwrap();

    assert_eq!(receipt.enqueued, 2);
    assert_eq!(backfill.source.pages_after().len(), 1);
    assert_eq!(progress.local_progress().cursor.as_deref(), Some("doc-b"));
    // At one document a second, the page's pause would have been 2 s.
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn the_rate_bounds_documents_sent_per_second() {
    let backfill = EmailAttachmentStatusBackfill::new(
        FakeSource::new(&LINKED),
        FakeIndex::default(),
        BackfillGate::open(1),
    );
    let started = Instant::now();

    backfill
        .backfill(
            EmailAttachmentStatusBackfillRequest {
                page_size: Some(PageSize::try_from(2).unwrap()),
                docs_per_second: Some(NonZeroU32::new(4).unwrap()),
                ..Default::default()
            },
            Arc::new(JobProgress::detached()),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    // Four live documents at four a second; the trashed one costs nothing.
    assert_eq!(started.elapsed(), Duration::from_secs(1));
}

#[test]
fn the_request_defaults_to_conservative_pages_and_rate() {
    let request: EmailAttachmentStatusBackfillRequest = serde_json::from_str("{}").unwrap();

    assert_eq!(request.page_size.unwrap_or_default().get(), 500);
    assert_eq!(
        request
            .docs_per_second
            .unwrap_or(DEFAULT_DOCS_PER_SECOND)
            .get(),
        100
    );
    assert_eq!(request.after_document_id, None);
}

#[test]
fn the_request_rejects_out_of_range_pages_and_a_zero_rate() {
    for body in [
        r#"{"page_size": 0}"#,
        r#"{"page_size": 1001}"#,
        r#"{"docs_per_second": 0}"#,
        r#"{"after": "doc-a"}"#,
    ] {
        assert!(
            serde_json::from_str::<EmailAttachmentStatusBackfillRequest>(body).is_err(),
            "{body}"
        );
    }

    let request: EmailAttachmentStatusBackfillRequest = serde_json::from_str(
        r#"{"after_document_id": "doc-a", "page_size": 1000, "docs_per_second": 25}"#,
    )
    .unwrap();
    assert_eq!(request.after_document_id.as_deref(), Some("doc-a"));
    assert_eq!(request.page_size.map(PageSize::get), Some(1000));
    assert_eq!(request.docs_per_second.map(NonZeroU32::get), Some(25));
}
