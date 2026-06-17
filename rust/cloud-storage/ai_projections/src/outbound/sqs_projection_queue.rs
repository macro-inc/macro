//! SQS-backed projection generation queue adapter.

use std::future::Future;

use aws_sdk_sqs::Client as SqsClient;

use crate::domain::models::{AiProjectionGenerationRequested, RawProjectionGenerationMessage};
use crate::domain::ports::{AiProjectionGenerationPublisher, AiProjectionGenerationQueue};

/// SQS adapter for publishing and consuming AI projection generation requests.
#[derive(Clone)]
pub struct SqsProjectionQueue {
    client: SqsClient,
    queue_url: String,
    max_messages: i32,
    wait_time_seconds: i32,
}

impl SqsProjectionQueue {
    /// Create an SQS projection queue adapter.
    pub fn new(
        client: SqsClient,
        queue_url: String,
        max_messages: i32,
        wait_time_seconds: i32,
    ) -> Self {
        Self {
            client,
            queue_url,
            max_messages,
            wait_time_seconds,
        }
    }
}

impl AiProjectionGenerationPublisher for SqsProjectionQueue {
    type Err = anyhow::Error;

    fn publish_generation_requested(
        &self,
        event: AiProjectionGenerationRequested,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send {
        let client = self.client.clone();
        let queue_url = self.queue_url.clone();

        async move {
            let body = serde_json::to_string(&event)?;
            client
                .send_message()
                .queue_url(queue_url)
                .message_body(body)
                .send()
                .await?;

            Ok(())
        }
    }
}

impl AiProjectionGenerationQueue for SqsProjectionQueue {
    fn receive_generation_messages(
        &self,
    ) -> impl Future<Output = Result<Vec<RawProjectionGenerationMessage>, Self::Err>> + Send {
        let client = self.client.clone();
        let queue_url = self.queue_url.clone();
        let max_messages = self.max_messages;
        let wait_time_seconds = self.wait_time_seconds;

        async move {
            let output = client
                .receive_message()
                .queue_url(queue_url)
                .max_number_of_messages(max_messages)
                .wait_time_seconds(wait_time_seconds)
                .set_message_attribute_names(Some(vec!["*".to_string()]))
                .send()
                .await?;

            let messages = output
                .messages
                .unwrap_or_default()
                .into_iter()
                .map(|message| RawProjectionGenerationMessage {
                    message_id: message.message_id,
                    body: message.body,
                    receipt_handle: message.receipt_handle,
                })
                .collect();

            Ok(messages)
        }
    }

    fn delete_generation_message(
        &self,
        receipt_handle: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send {
        let client = self.client.clone();
        let queue_url = self.queue_url.clone();

        async move {
            client
                .delete_message()
                .queue_url(queue_url)
                .receipt_handle(receipt_handle)
                .send()
                .await?;

            Ok(())
        }
    }
}

#[cfg(test)]
mod test {
    use chrono::{TimeZone, Utc};
    use macro_user_id::user_id::MacroUserIdStr;

    use super::*;
    use crate::domain::models::{AiProjectionCacheKey, ScheduleGenerationReason, Target};

    #[test]
    fn sqs_generation_message_serializes_retry_safe_payload() {
        let user_id = MacroUserIdStr::try_from("macro|projection@example.com".to_string())
            .expect("valid user id");
        let event = AiProjectionGenerationRequested {
            cache_key: AiProjectionCacheKey {
                projection_id: "inbox/important".to_string(),
                target: Target::user(user_id.to_string()),
                prompt_hash: "hash".to_string(),
            },
            reason: ScheduleGenerationReason::ForceRefresh,
            requested_by: user_id.clone(),
            generation_user_id: user_id,
            enqueued_at: Utc
                .with_ymd_and_hms(2026, 6, 17, 16, 30, 0)
                .single()
                .expect("valid timestamp"),
        };

        let body = serde_json::to_value(&event).expect("serialize event");

        assert_eq!(body["reason"], "force_refresh");
        assert_eq!(body["cacheKey"]["projectionId"], "inbox/important");
        assert_eq!(body["generationUserId"], "macro|projection@example.com");
    }
}
