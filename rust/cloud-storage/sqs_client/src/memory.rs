use aws_sdk_sqs::types::SendMessageBatchRequestEntry;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::{MAX_BATCH_SIZE, SQS};

/// SQS message payload for memory generation requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateMemoryMessage {
    pub user_id: String,
}

impl SQS {
    pub fn memory_generation_queue(mut self, url: &str) -> Self {
        self.memory_generation_queue = Some(url.to_string());
        self
    }

    /// Enqueues a single memory generation request.
    #[tracing::instrument(skip(self), err)]
    pub async fn enqueue_memory_generation(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> anyhow::Result<()> {
        let queue_url = self
            .memory_generation_queue
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("memory_generation_queue is not configured"))?;

        let message = GenerateMemoryMessage {
            user_id: user_id.as_ref().to_string(),
        };

        self.inner
            .send_message()
            .queue_url(queue_url)
            .message_body(serde_json::to_string(&message)?)
            .send()
            .await?;

        Ok(())
    }

    /// Enqueues memory generation requests in batches of 10.
    #[tracing::instrument(skip(self, user_ids), fields(count = user_ids.len()), err)]
    pub async fn bulk_enqueue_memory_generation(
        &self,
        user_ids: &[MacroUserIdStr<'_>],
    ) -> anyhow::Result<()> {
        let queue_url = self
            .memory_generation_queue
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("memory_generation_queue is not configured"))?;

        for chunk in user_ids.chunks(MAX_BATCH_SIZE) {
            let mut entries = Vec::with_capacity(chunk.len());

            for (i, user_id) in chunk.iter().enumerate() {
                let message = GenerateMemoryMessage {
                    user_id: user_id.as_ref().to_string(),
                };
                let entry = SendMessageBatchRequestEntry::builder()
                    .id(i.to_string())
                    .message_body(serde_json::to_string(&message)?)
                    .build()?;
                entries.push(entry);
            }

            self.inner
                .send_message_batch()
                .queue_url(queue_url)
                .set_entries(Some(entries))
                .send()
                .await?;
        }

        Ok(())
    }
}
