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
    ) -> Result<Vec<IndexedChatMessage>, Report> {
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
}

impl FakeRows {
    fn holding(chats: &[&str], messages: &[&str]) -> Self {
        Self {
            messages: messages.iter().map(|id| id.to_string()).collect(),
            chats: chats.iter().map(|id| id.to_string()).collect(),
            message_lookups: Mutex::new(Vec::new()),
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
        Ok(MessageDelete {
            failed: count,
            ..MessageDelete::default()
        })
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
