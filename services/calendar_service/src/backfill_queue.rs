//! Calendar's own backfill queue: message type and SQS enqueue client.
//!
//! Calendar keeps a queue and message type separate from the shared email
//! backfill queue so its sync deploy lifecycle is independent of email.

use uuid::Uuid;

/// A delivery on the calendar backfill queue. The `kind` tag mirrors the
/// `calendar_backfill_jobs.kind` column so new provider kinds slot in without
/// changing the transport.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CalendarBackfillMessage {
    /// Run a Google Calendar backfill for a connected inbox.
    GoogleCalendar {
        /// Connected inbox whose grant authorizes the sync.
        link_id: Uuid,
        /// Durable calendar backfill job id.
        calendar_job_id: Uuid,
    },
}

/// SQS client scoped to the calendar backfill queue.
#[derive(Clone)]
pub struct CalendarBackfillQueueClient {
    client: aws_sdk_sqs::Client,
    queue_url: String,
}

impl CalendarBackfillQueueClient {
    /// Construct the client over an SQS client and the resolved queue name/URL.
    pub fn new(client: aws_sdk_sqs::Client, queue_url: impl Into<String>) -> Self {
        Self {
            client,
            queue_url: queue_url.into(),
        }
    }

    /// Publish one calendar backfill message.
    #[tracing::instrument(skip(self))]
    pub async fn enqueue(&self, message: &CalendarBackfillMessage) -> anyhow::Result<()> {
        let body = serde_json::to_string(message)?;
        self.client
            .send_message()
            .queue_url(&self.queue_url)
            .message_body(body)
            .send()
            .await?;
        Ok(())
    }
}
