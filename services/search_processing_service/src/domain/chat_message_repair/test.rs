use std::sync::Mutex;

use super::*;
use crate::domain::jobs::DetachedProgress;

fn message(chat_id: &str, message_id: &str) -> IndexedChatMessage {
    IndexedChatMessage {
        chat_id: chat_id.to_owned(),
        message_id: message_id.to_owned(),
    }
}

/// Indexed messages in message id order, paged as the chats index pages
/// them. Records the cursor of each page and each batch it was asked to
/// delete.
#[derive(Default)]
struct FakeIndex {
    messages: Vec<IndexedChatMessage>,
    pages_after: Mutex<Vec<Option<String>>>,
    deletes: Mutex<Vec<Vec<IndexedChatMessage>>>,
    reply: Option<fn(usize) -> Result<MessageDelete, MessageIndexError>>,
    refuse_reads: bool,
}

impl FakeIndex {
    fn holding(messages: &[(&str, &str)]) -> Self {
        Self {
            messages: messages
                .iter()
                .map(|(chat_id, message_id)| message(chat_id, message_id))
                .collect(),
            ..Self::default()
        }
    }

    fn replying(self, reply: fn(usize) -> Result<MessageDelete, MessageIndexError>) -> Self {
        Self {
            reply: Some(reply),
            ..self
        }
    }

    fn deletes(&self) -> Vec<Vec<IndexedChatMessage>> {
        self.deletes.lock().unwrap().clone()
    }

    fn pages_after(&self) -> Vec<Option<String>> {
        self.pages_after.lock().unwrap().clone()
    }
}

impl ChatMessageIndex for FakeIndex {
    async fn page_after(
        &self,
        after_message_id: Option<&str>,
        limit: PageSize,
    ) -> Result<Vec<IndexedChatMessage>, MessageIndexError> {
        if self.refuse_reads {
            return Err(MessageIndexError::Refused(
                "es_rejected_execution_exception".to_owned(),
            ));
        }
        self.pages_after
            .lock()
            .unwrap()
            .push(after_message_id.map(str::to_owned));
        Ok(self
            .messages
            .iter()
            .filter(|message| {
                after_message_id.is_none_or(|after| message.message_id.as_str() > after)
            })
            .take(usize::from(limit.get()))
            .cloned()
            .collect())
    }

    async fn delete(
        &self,
        messages: &[IndexedChatMessage],
    ) -> Result<MessageDelete, MessageIndexError> {
        self.deletes.lock().unwrap().push(messages.to_vec());
        match self.reply {
            Some(reply) => reply(messages.len()),
            None => Ok(MessageDelete {
                deleted: messages.len(),
                ..MessageDelete::default()
            }),
        }
    }
}

/// The chat and message rows a database holds.
struct FakeRows {
    messages: HashSet<String>,
    chats: HashSet<String>,
    message_lookups: Mutex<Vec<Vec<String>>>,
    chat_lookups_fail: bool,
}

impl FakeRows {
    fn holding(chats: &[&str], messages: &[&str]) -> Self {
        Self {
            messages: messages.iter().map(|id| id.to_string()).collect(),
            chats: chats.iter().map(|id| id.to_string()).collect(),
            message_lookups: Mutex::new(Vec::new()),
            chat_lookups_fail: false,
        }
    }

    fn message_lookups(&self) -> Vec<Vec<String>> {
        self.message_lookups.lock().unwrap().clone()
    }
}

impl ChatRows for FakeRows {
    async fn existing_messages(&self, message_ids: &[String]) -> Result<HashSet<String>, Report> {
        self.message_lookups
            .lock()
            .unwrap()
            .push(message_ids.to_vec());
        Ok(message_ids
            .iter()
            .filter(|id| self.messages.contains(*id))
            .cloned()
            .collect())
    }

    async fn existing_chats(&self, chat_ids: &[String]) -> Result<HashSet<String>, Report> {
        if self.chat_lookups_fail {
            return Err(Report::new(std::io::Error::other("connection reset")).into_dynamic());
        }
        Ok(chat_ids
            .iter()
            .filter(|id| self.chats.contains(*id))
            .cloned()
            .collect())
    }
}

/// Five indexed messages of two chats. `message-b` was deleted from a live
/// chat, and `chat-gone` was deleted with its message `message-d`.
const INDEXED: [(&str, &str); 5] = [
    ("chat-live", "message-a"),
    ("chat-live", "message-b"),
    ("chat-live", "message-c"),
    ("chat-gone", "message-d"),
    ("chat-live", "message-e"),
];

fn rows() -> FakeRows {
    FakeRows::holding(&["chat-live"], &["message-a", "message-c", "message-e"])
}

fn repair(
    index: FakeIndex,
    replica: FakeRows,
    primary: FakeRows,
) -> DeletedChatMessageRepair<FakeIndex, FakeRows> {
    DeletedChatMessageRepair::new(index, replica, primary, BackfillGate::open(1))
}

fn request(dry_run: bool, page_size: u16) -> DeletedChatMessageRepairRequest {
    DeletedChatMessageRepairRequest {
        dry_run,
        page_size: Some(PageSize::try_from(page_size).unwrap()),
        ..DeletedChatMessageRepairRequest::default()
    }
}

#[test]
fn a_page_names_at_most_ten_of_its_gone_messages() {
    let gone: Vec<_> = (0..12)
        .map(|i| message("chat-1", &format!("message-{i:02}")))
        .collect();

    let sample = gone_sample(&gone);

    assert_eq!(sample.split(',').count(), 10);
    assert!(sample.starts_with("chat-1:message-00,chat-1:message-01,"));
}

#[test]
fn a_request_without_dry_run_is_a_dry_run() {
    let req: DeletedChatMessageRepairRequest = serde_json::from_str("{}").unwrap();
    assert!(req.dry_run);

    let req: DeletedChatMessageRepairRequest =
        serde_json::from_str(r#"{"dry_run": false}"#).unwrap();
    assert!(!req.dry_run);
}

#[tokio::test(start_paused = true)]
async fn a_dry_run_counts_the_messages_whose_row_is_gone_and_deletes_nothing() {
    let repair = repair(FakeIndex::holding(&INDEXED), rows(), rows());
    let progress = Arc::new(JobProgress::detached());

    let receipt = repair
        .repair(request(true, 2), progress.clone(), CancellationToken::new())
        .await
        .unwrap();

    assert!(repair.index.deletes().is_empty());
    assert_eq!(receipt.enqueued, 5);
    assert_eq!(
        progress.local_progress(),
        DetachedProgress {
            enqueued: 5,
            cursor: Some("message-e".to_owned()),
            updated: 0,
            missing: 2,
            failed: 0,
            not_queued: 0,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_run_deletes_the_documents_of_messages_whose_row_is_gone() {
    let repair = repair(FakeIndex::holding(&INDEXED), rows(), rows());
    let progress = Arc::new(JobProgress::detached());

    repair
        .repair(
            request(false, 2),
            progress.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(
        repair.index.deletes(),
        [
            vec![message("chat-live", "message-b")],
            vec![message("chat-gone", "message-d")],
        ]
    );
    assert_eq!(
        repair.index.pages_after(),
        [
            None,
            Some("message-b".to_owned()),
            Some("message-d".to_owned()),
            Some("message-e".to_owned()),
        ]
    );
    let progress = progress.local_progress();
    assert_eq!((progress.updated, progress.missing), (2, 2));
}

#[tokio::test(start_paused = true)]
async fn a_message_the_replica_lacks_is_kept_when_the_primary_has_it() {
    let lagging_replica = FakeRows::holding(&["chat-live"], &["message-a"]);
    let repair = repair(FakeIndex::holding(&INDEXED[..3]), lagging_replica, rows());
    let progress = Arc::new(JobProgress::detached());

    repair
        .repair(
            request(false, 500),
            progress.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(
        repair.index.deletes(),
        [vec![message("chat-live", "message-b")]]
    );
    assert_eq!(
        repair.primary.message_lookups(),
        [vec!["message-b".to_owned(), "message-c".to_owned()]],
        "only what the replica lacks is asked of the primary"
    );
    assert_eq!(progress.local_progress().missing, 1);
}

#[tokio::test(start_paused = true)]
async fn a_page_the_replica_fully_has_asks_nothing_of_the_primary() {
    let repair = repair(
        FakeIndex::holding(&[("chat-live", "message-a"), ("chat-live", "message-c")]),
        rows(),
        rows(),
    );

    repair
        .repair(
            request(false, 500),
            Arc::new(JobProgress::detached()),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert!(repair.primary.message_lookups().is_empty());
    assert!(repair.index.deletes().is_empty());
}

#[tokio::test(start_paused = true)]
async fn resumes_after_the_given_message() {
    let repair = repair(FakeIndex::holding(&INDEXED), rows(), rows());

    repair
        .repair(
            DeletedChatMessageRepairRequest {
                after_message_id: Some("message-c".to_owned()),
                ..request(false, 500)
            },
            Arc::new(JobProgress::detached()),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(repair.index.pages_after()[0].as_deref(), Some("message-c"));
    assert_eq!(
        repair.index.deletes(),
        [vec![message("chat-gone", "message-d")]]
    );
}

#[tokio::test(start_paused = true)]
async fn a_refused_delete_stops_the_job_at_the_page_before() {
    let index = FakeIndex::holding(&INDEXED).replying(|_| {
        Err(MessageIndexError::Refused(
            "cluster_block_exception".to_owned(),
        ))
    });
    let repair = repair(index, rows(), rows());

    let error = repair
        .repair(
            DeletedChatMessageRepairRequest {
                after_message_id: Some("message-a".to_owned()),
                ..request(false, 2)
            },
            Arc::new(JobProgress::detached()),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();

    let BackfillError::Stopped { cursor, .. } = error else {
        panic!("expected a stop, got {error:?}");
    };
    assert_eq!(cursor.as_deref(), Some("message-a"));
}

#[tokio::test(start_paused = true)]
async fn failed_deletes_stop_before_the_cursor_moves_past_them() {
    let index = FakeIndex::holding(&INDEXED).replying(|count| {
        Err(MessageIndexError::ItemsFailed(format!(
            "opensearch failed {count} of {count} bulk items"
        )))
    });
    let repair = repair(index, rows(), rows());
    let progress = Arc::new(JobProgress::detached());

    let error = repair
        .repair(
            request(false, 2),
            progress.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();

    assert!(
        matches!(error, BackfillError::Stopped { cursor: None, .. }),
        "{error:?}"
    );
    assert_eq!(progress.local_progress().cursor, None);
}

#[tokio::test(start_paused = true)]
async fn reads_are_paced_to_the_requested_rate() {
    let repair = repair(FakeIndex::holding(&INDEXED), rows(), rows());
    let started = Instant::now();

    repair
        .repair(
            DeletedChatMessageRepairRequest {
                messages_per_second: Some(NonZeroU32::new(1).unwrap()),
                ..request(true, 2)
            },
            Arc::new(JobProgress::detached()),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(started.elapsed(), Duration::from_secs(5));
}

#[tokio::test(start_paused = true)]
async fn a_failed_chat_lookup_does_not_stop_the_repair() {
    let replica = FakeRows {
        chat_lookups_fail: true,
        ..rows()
    };
    let repair = repair(FakeIndex::holding(&INDEXED), replica, rows());
    let progress = Arc::new(JobProgress::detached());

    repair
        .repair(
            request(false, 2),
            progress.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(repair.index.deletes().len(), 2);
    assert_eq!(progress.local_progress().updated, 2);
}

#[tokio::test(start_paused = true)]
async fn a_refused_read_stops_the_job_at_the_cursor() {
    let index = FakeIndex {
        refuse_reads: true,
        ..FakeIndex::holding(&INDEXED)
    };
    let repair = repair(index, rows(), rows());

    let error = repair
        .repair(
            DeletedChatMessageRepairRequest {
                after_message_id: Some("message-b".to_owned()),
                ..request(false, 2)
            },
            Arc::new(JobProgress::detached()),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();

    let BackfillError::Stopped { cursor, .. } = error else {
        panic!("expected a stop, got {error:?}");
    };
    assert_eq!(cursor.as_deref(), Some("message-b"));
}

/// Records the fields of every event, as text.
#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<(tracing::Level, std::collections::BTreeMap<String, String>)>>>);

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Events {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        struct Fields<'a>(&'a mut std::collections::BTreeMap<String, String>);
        impl tracing::field::Visit for Fields<'_> {
            fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
                self.0.insert(field.name().to_owned(), value.to_owned());
            }
            fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                self.0.insert(field.name().to_owned(), format!("{value:?}"));
            }
        }
        let mut fields = std::collections::BTreeMap::new();
        event.record(&mut Fields(&mut fields));
        self.0
            .lock()
            .unwrap()
            .push((*event.metadata().level(), fields));
    }
}

#[tokio::test(start_paused = true)]
async fn each_page_with_gone_messages_logs_their_sample() {
    use tracing_subscriber::layer::SubscriberExt as _;

    let events = Events::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(events.clone()));
    // A first pass registers the callsites; another test thread may have
    // cached a "never" interest in them before this subscriber existed, so
    // recompute it and measure a second pass.
    for _ in 0..2 {
        tracing::callsite::rebuild_interest_cache();
        events.0.lock().unwrap().clear();
        repair(FakeIndex::holding(&INDEXED), rows(), rows())
            .repair(
                request(true, 2),
                Arc::new(JobProgress::detached()),
                CancellationToken::new(),
            )
            .await
            .unwrap();
    }

    let logged: Vec<_> = events
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, fields)| fields.contains_key("gone_sample"))
        .cloned()
        .collect();
    assert_eq!(
        logged
            .iter()
            .map(|(level, fields)| (
                *level,
                fields["gone"].as_str(),
                fields["gone_sample"].as_str(),
                fields["gone_with_chat"].as_str(),
                fields["dry_run"].as_str(),
            ))
            .collect::<Vec<_>>(),
        [
            (
                tracing::Level::INFO,
                "1",
                "chat-live:message-b",
                "0",
                "true"
            ),
            (
                tracing::Level::INFO,
                "1",
                "chat-gone:message-d",
                "1",
                "true"
            ),
        ],
        "one event per page with gone messages, none for the page without"
    );
}
