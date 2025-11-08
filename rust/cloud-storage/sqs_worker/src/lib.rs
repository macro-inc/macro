mod delete_message;
mod receive_messages;

#[derive(Clone, Debug)]
pub struct SQSWorker {
    inner: aws_sdk_sqs::Client,
    queue_url: String,
    max_messages: i32,
    wait_time_seconds: i32,
}

impl SQSWorker {
    pub fn new(
        inner: aws_sdk_sqs::Client,
        queue_url: String,
        max_messages: i32,
        wait_time_seconds: i32,
    ) -> Self {
        Self {
            inner,
            queue_url,
            max_messages,
            wait_time_seconds,
        }
    }

    /// Receives messages from the queue.
    #[tracing::instrument(skip(self))]
    pub async fn receive_messages(&self) -> anyhow::Result<Vec<aws_sdk_sqs::types::Message>> {
        receive_messages::receive_messages(
            &self.inner,
            &self.queue_url,
            self.max_messages,
            self.wait_time_seconds,
        )
        .await
    }

    /// Deletes the messages from the queue.
    #[tracing::instrument(skip(self))]
    pub async fn cleanup_message(
        &self,
        message: &aws_sdk_sqs::types::Message,
    ) -> anyhow::Result<()> {
        if let Some(receipt_handle) = message.receipt_handle.as_ref() {
            tracing::trace!("deleting message");
            delete_message::delete_message(&self.inner, &self.queue_url, receipt_handle).await?;
        } else {
            tracing::warn!("no receipt handle found for message");
            return Err(anyhow::anyhow!("no receipt handle found for message"));
        }
        Ok(())
    }

    /// Deletes the messages from the queue.
    #[tracing::instrument(skip(self))]
    pub async fn delete_message(&self, receipt_handle: &str) -> anyhow::Result<()> {
        delete_message::delete_message(&self.inner, &self.queue_url, receipt_handle).await
    }
}

#[tracing::instrument(skip(sqs_worker, message), fields(message_id=message.message_id, message_receipt_handle=message.receipt_handle))]
pub async fn cleanup_message(
    sqs_worker: &SQSWorker,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    if let Some(receipt_handle) = message.receipt_handle.as_ref() {
        tracing::trace!("deleting message");
        sqs_worker.delete_message(receipt_handle).await?;
    } else {
        tracing::warn!("no receipt handle found for message");
    }
    Ok(())
}
