use crate::{
    SQS,
    search::{
        calendar_event::UpsertCalendarEvent,
        call::{CallRecordMessage, RemoveCallRecord},
        channel::ChannelMessageUpdate,
        chat::ChatMessage,
        document::SearchExtractorMessage,
        email::EmailThreadBatchMessage,
        project::UpsertProject,
        replay::ReplayBrokerEvent,
    },
};
use anyhow::Context;
use aws_sdk_sqs::{self as sqs, types::SendMessageBatchRequestEntry};
use futures::StreamExt;
use strum::Display;

pub mod calendar_event;
pub mod call;
pub mod channel;
pub mod chat;
pub mod document;
pub mod email;
pub mod project;
pub mod replay;

use crate::{MAX_BATCH_SIZE, PrimaryId};

impl SQS {
    pub fn search_event_queue(mut self, search_event_queue: &str) -> Self {
        self.search_event_queue = Some(search_event_queue.to_string());
        self
    }

    pub async fn send_message_to_search_event_queue(
        &self,
        message: SearchQueueMessage,
    ) -> anyhow::Result<String> {
        if let Some(search_event_queue) = &self.search_event_queue {
            enqueue_search_text_extractor(&self.inner, search_event_queue, message).await
        } else {
            Err(anyhow::anyhow!("search_event_queue is not configured"))
        }
    }

    /// Send `message` to the search event queue, invisible to workers until
    /// `delay` has passed. SQS caps the delay at 15 minutes.
    pub async fn send_message_to_search_event_queue_after(
        &self,
        message: SearchQueueMessage,
        delay: std::time::Duration,
    ) -> anyhow::Result<String> {
        let Some(search_event_queue) = &self.search_event_queue else {
            anyhow::bail!("search_event_queue is not configured");
        };
        let delay_seconds = i32::try_from(delay.as_secs())
            .unwrap_or(i32::MAX)
            .min(MAX_DELAY_SECONDS);
        let result = self
            .inner
            .send_message()
            .queue_url(search_event_queue)
            .message_body(serde_json::to_string(&message)?)
            .delay_seconds(delay_seconds)
            .send()
            .await?;
        Ok(result
            .message_id
            .context("expected a message id")?
            .to_string())
    }

    /// Send `items` in batches. SQS can accept a batch and refuse some of its
    /// entries; those it refused for a reason on its side are sent again, and
    /// the entries it still refused come back.
    pub async fn bulk_send_message_to_search_event_queue(
        &self,
        items: Vec<SearchQueueMessage>,
    ) -> Result<Vec<UnqueuedEntry>, anyhow::Error> {
        if let Some(search_event_queue) = &self.search_event_queue {
            bulk_enqueue_search_text_extractor(&self.inner, search_event_queue, items).await
        } else {
            Err(anyhow::anyhow!("search_event_queue is not configured"))
        }
    }
}

#[derive(serde::Serialize, Debug, Display, strum::EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Operation {
    /// Extract text from a particular source to be processed into OpenSearch
    ExtractText,
    /// Updates the metadata for a given item
    UpdateMetadata,
    /// Remove an item from the search index
    Remove,
    /// Extract text from live collab documents to be processed into OpenSearch
    ExtractSync,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub enum SearchQueueMessage {
    // Document
    ExtractDocumentText(SearchExtractorMessage),
    ExtractSync(SearchExtractorMessage),
    // Chat
    /// SQS backfill work-queue contract for reconciling a chat message.
    ChatMessage(ChatMessage),
    // Email backfills, and the threads of a renamed label
    ExtractEmailThreadBatch(EmailThreadBatchMessage),
    // Channel
    ChannelMessageUpdate(ChannelMessageUpdate),
    // Call
    CallRecord(CallRecordMessage),
    RemoveCallRecord(RemoveCallRecord),
    // Project
    UpsertProject(UpsertProject),
    // Calendar
    UpsertCalendarEvent(UpsertCalendarEvent),

    // User
    RemoveUserProfile(String),

    // Broker events whose indexing failed
    ReplayBrokerEvent(ReplayBrokerEvent),
}

impl PrimaryId for SearchQueueMessage {
    fn id(&self) -> String {
        match self {
            SearchQueueMessage::ExtractDocumentText(message) => message.document_id.clone(),
            SearchQueueMessage::ExtractSync(message) => message.document_id.clone(),
            // The message id keeps entries unique within an SQS batch.
            SearchQueueMessage::ChatMessage(message) => message.message_id.clone(),
            SearchQueueMessage::ExtractEmailThreadBatch(message) => {
                message.thread_ids.first().cloned().unwrap_or_default()
            }
            SearchQueueMessage::ChannelMessageUpdate(message) => message.message_id.clone(),
            SearchQueueMessage::CallRecord(message) => message.call_id.clone(),
            SearchQueueMessage::RemoveCallRecord(message) => format!(
                "{}{}",
                message.channel_id,
                message.call_id.clone().unwrap_or_default()
            ),
            SearchQueueMessage::UpsertProject(message) => message.project_id.clone(),
            SearchQueueMessage::UpsertCalendarEvent(message) => message.event_id.clone(),

            SearchQueueMessage::RemoveUserProfile(message) => message.clone(),
            SearchQueueMessage::ReplayBrokerEvent(message) => message.event_id.clone(),
        }
    }
}

impl SearchQueueMessage {
    pub fn operation(&self) -> Operation {
        match self {
            // Document
            SearchQueueMessage::ExtractDocumentText(_) => Operation::ExtractText,
            SearchQueueMessage::ExtractSync(_) => Operation::ExtractSync,
            // Chat
            SearchQueueMessage::ChatMessage(_) => Operation::ExtractText,
            // Email backfills
            SearchQueueMessage::ExtractEmailThreadBatch(_) => Operation::ExtractText,
            // Channels
            SearchQueueMessage::ChannelMessageUpdate(_) => Operation::ExtractText,
            // Calls
            SearchQueueMessage::CallRecord(_) => Operation::ExtractText,
            SearchQueueMessage::RemoveCallRecord(_) => Operation::Remove,
            // Projects
            SearchQueueMessage::UpsertProject(_) => Operation::UpdateMetadata,
            // Calendar
            SearchQueueMessage::UpsertCalendarEvent(_) => Operation::UpdateMetadata,
            // Users
            SearchQueueMessage::RemoveUserProfile(_) => Operation::Remove,
            SearchQueueMessage::ReplayBrokerEvent(_) => Operation::ExtractText,
        }
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_search_text_extractor(
    sqs_client: &sqs::Client,
    queue_url: &str,
    message: SearchQueueMessage,
) -> anyhow::Result<String> {
    let message_str = serde_json::to_string(&message)?;

    let result = sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;

    Ok(result
        .message_id
        .context("expected a message id")?
        .to_string())
}

const MAX_CONCURRENT_BATCHES: usize = 20;
/// The longest `DelaySeconds` SQS accepts.
const MAX_DELAY_SECONDS: i32 = 900;
/// Sends of an entry SQS refuses for a reason on its side, the first included.
const ENTRY_ATTEMPTS: u32 = 3;
/// Delay before the first resend of refused entries; each later one doubles.
const ENTRY_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(100);
/// How many ids of the entries SQS would not queue a warning names.
const UNQUEUED_IDS_LOGGED: usize = 10;

/// An entry of a batch SQS would not queue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnqueuedEntry {
    /// The entry's batch id, the message's [`PrimaryId`].
    pub id: String,
    /// SQS's error code, such as `InternalError`.
    pub code: String,
    /// Whether SQS blamed the entry itself, so a resend cannot succeed.
    pub sender_fault: bool,
}

/// Bulk enqueues items to the search text extractor queue, returning the
/// entries SQS would not queue.
#[tracing::instrument(
    err,
    skip(sqs_client, items),
    fields(items = items.len(), resent = tracing::field::Empty, unqueued = tracing::field::Empty)
)]
pub async fn bulk_enqueue_search_text_extractor(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    items: Vec<SearchQueueMessage>,
) -> anyhow::Result<Vec<UnqueuedEntry>> {
    let mut entries: Vec<SendMessageBatchRequestEntry> = vec![];
    for item in items {
        tracing::trace!(item=?item, "enqueueing search text extractor");
        let message_str = serde_json::to_string(&item)?;
        let batch_request = SendMessageBatchRequestEntry::builder()
            .id(item.id())
            .message_body(message_str)
            .build()?;
        entries.push(batch_request);
    }

    if entries.is_empty() {
        tracing::warn!("no entries to enqueue");
        return Ok(Vec::new());
    }

    let results: Vec<_> = futures::stream::iter(
        entries
            .chunks(MAX_BATCH_SIZE)
            .map(|chunk| chunk.to_vec())
            .collect::<Vec<_>>(),
    )
    .map(|chunk| send_batch(sqs_client, queue_url, chunk))
    .buffer_unordered(MAX_CONCURRENT_BATCHES)
    .collect()
    .await;

    let mut unqueued = Vec::new();
    let mut resent = 0;
    for result in results {
        let batch = result?;
        resent += batch.resent;
        unqueued.extend(batch.unqueued);
    }
    let span = tracing::Span::current();
    span.record("resent", resent);
    span.record("unqueued", unqueued.len());
    if !unqueued.is_empty() {
        tracing::warn!(
            unqueued = unqueued.len(),
            codes = ?unqueued.iter().map(|entry| entry.code.as_str()).collect::<std::collections::BTreeSet<_>>(),
            ids = ?unqueued.iter().take(UNQUEUED_IDS_LOGGED).map(|entry| entry.id.as_str()).collect::<Vec<_>>(),
            "SQS would not queue some search event messages"
        );
    }
    Ok(unqueued)
}

/// What sending one batch came to.
struct BatchOutcome {
    /// Entry sends after the first.
    resent: usize,
    /// Entries SQS still would not queue.
    unqueued: Vec<UnqueuedEntry>,
}

/// Send one batch, resending the entries SQS refuses for a reason on its
/// side.
async fn send_batch(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    mut entries: Vec<SendMessageBatchRequestEntry>,
) -> anyhow::Result<BatchOutcome> {
    let mut unqueued = Vec::new();
    let mut resent = 0;
    let mut delay = ENTRY_RETRY_DELAY;
    for attempt in 1..=ENTRY_ATTEMPTS {
        let output = sqs_client
            .send_message_batch()
            .set_entries(Some(entries.clone()))
            .queue_url(queue_url)
            .send()
            .await?;
        let last = attempt == ENTRY_ATTEMPTS;
        let mut resend = std::collections::HashSet::new();
        for failure in output.failed() {
            if failure.sender_fault() || last {
                unqueued.push(UnqueuedEntry {
                    id: failure.id().to_owned(),
                    code: failure.code().to_owned(),
                    sender_fault: failure.sender_fault(),
                });
            } else {
                resend.insert(failure.id().to_owned());
            }
        }
        entries.retain(|entry| resend.contains(entry.id()));
        if entries.is_empty() {
            break;
        }
        resent += entries.len();
        tokio::time::sleep(delay).await;
        delay *= 2;
    }
    Ok(BatchOutcome { resent, unqueued })
}

#[cfg(test)]
mod test;
