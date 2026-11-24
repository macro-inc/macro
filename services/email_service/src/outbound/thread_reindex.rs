//! Search event queue adapter for bulk thread reindexing.

#[cfg(test)]
mod test;

use futures::{StreamExt as _, TryStreamExt as _};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::types::Uuid;
use sqs_client::SQS;
use sqs_client::search::{SearchQueueMessage, email::EmailThreadBatchMessage};
use std::time::Duration;

/// Threads per queued message, as the email reindex events use.
const THREADS_PER_MESSAGE: usize = 50;
/// How long workers do not see a queued message, so they read a change the
/// caller stores right after queueing it.
const REINDEX_DELAY: Duration = Duration::from_secs(60);
const CONCURRENT_SENDS: usize = 8;

/// Queue `threads` for search-processing's bulk workers, which the search
/// event queue keeps off the Kafka lane live mail uses.
#[tracing::instrument(skip_all, fields(email.thread_count = threads.len()), err)]
pub(crate) async fn enqueue(
    sqs: &SQS,
    owner: &MacroUserIdStr<'static>,
    threads: Vec<Uuid>,
) -> anyhow::Result<()> {
    let messages: Vec<SearchQueueMessage> = threads
        .chunks(THREADS_PER_MESSAGE)
        .map(|threads| {
            SearchQueueMessage::ExtractEmailThreadBatch(EmailThreadBatchMessage {
                thread_ids: threads.iter().map(Uuid::to_string).collect(),
                macro_user_id: owner.to_string(),
                index_override: None,
            })
        })
        .collect();

    futures::stream::iter(messages)
        .map(Ok)
        .try_for_each_concurrent(CONCURRENT_SENDS, |message| async move {
            sqs.send_message_to_search_event_queue_after(message, REINDEX_DELAY)
                .await
                .map(|_| ())
        })
        .await
}
