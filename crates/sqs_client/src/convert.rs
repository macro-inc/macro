use std::collections::HashMap;

use anyhow::Context;
use model::convert::ConvertQueueMessage;

use crate::{SQS, message_attribute::build_string_message_attribute};

#[tracing::instrument]
fn construct_message_attributes(
    job_id: &str,
) -> anyhow::Result<HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>> {
    let mut message_attributes = HashMap::new();

    message_attributes.insert(
        "job_id".to_string(),
        build_string_message_attribute(job_id)?,
    );

    Ok(message_attributes)
}

impl SQS {
    /// Sets the convert_queue.
    pub fn convert_queue(mut self, convert_queue: &str) -> Self {
        self.convert_queue = Some(convert_queue.to_string());
        self
    }

    /// Sends a message to the convert queue to trigger conversion of the provided item
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_convert_queue_message(
        &self,
        convert_queue_message: ConvertQueueMessage,
    ) -> anyhow::Result<()> {
        if let Some(convert_queue) = &self.convert_queue {
            return enqueue_convert_job(&self.inner, convert_queue, convert_queue_message).await;
        }
        Err(anyhow::anyhow!("convert_queue is not configured"))
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_convert_job(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: ConvertQueueMessage,
) -> anyhow::Result<()> {
    let message_attributes = construct_message_attributes(&message.job_id)
        .context("unable to construct message attributes")?;

    let message_str = serde_json::to_string(&message).context("unable to serialize message")?;

    sqs_client
        .send_message()
        .queue_url(queue_url)
        .set_message_attributes(Some(message_attributes))
        .message_body(message_str)
        .send()
        .await?;
    Ok(())
}
