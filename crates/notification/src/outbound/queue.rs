//! SQS queue adapter for notification delivery.

use aws_sdk_sqs::Client as SqsClient;
use rootcause::Report;
use serde::Serialize;

use crate::domain::models::queue_message::{
    IngressQueueMessage, QueueMessage, RawIngressQueueMessage, RawQueueMessage,
};
use crate::domain::ports::{NotificationIngressQueue, NotificationQueue};

/// SQS-backed implementation of the notification queue ports.
///
/// A single type implements both [`NotificationQueue`] (delivery/egress queue)
/// and [`NotificationIngressQueue`] (ingress queue). Callers construct one
/// instance per queue URL.
#[derive(Clone)]
pub struct SqsQueue {
    client: SqsClient,
    queue_url: String,
}

impl SqsQueue {
    /// Create a new SQS queue adapter pointing at `queue_url`.
    pub fn new(client: SqsClient, queue_url: String) -> Self {
        Self { client, queue_url }
    }

    async fn send_json<T: Serialize>(&self, message: &T) -> Result<(), Report> {
        let body = serde_json::to_string(message)?;
        self.client
            .send_message()
            .queue_url(&self.queue_url)
            .message_body(body)
            .send()
            .await?;
        Ok(())
    }

    async fn delete(&self, receipt_handle: &str) -> Result<(), Report> {
        self.client
            .delete_message()
            .queue_url(&self.queue_url)
            .receipt_handle(receipt_handle)
            .send()
            .await?;
        Ok(())
    }
}

impl NotificationQueue for SqsQueue {
    async fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        for message in messages {
            self.send_json(&message).await?;
        }
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        let result = self
            .client
            .receive_message()
            .queue_url(&self.queue_url)
            .max_number_of_messages(10)
            .wait_time_seconds(20)
            .send()
            .await?;

        let messages = result
            .messages
            .unwrap_or_default()
            .into_iter()
            .filter_map(|msg| {
                let body_str = msg.body?;
                let body = serde_json::from_str(&body_str)
                    .inspect_err(|e| tracing::error!(error=?e, body=%body_str, "failed to deserialize queue message"))
                    .ok()?;
                let receipt_handle = msg.receipt_handle?;
                Some(RawQueueMessage {
                    body,
                    receipt_handle,
                })
            })
            .collect();

        Ok(messages)
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        self.delete(receipt_handle).await
    }

    async fn delay_message(
        &self,
        receipt_handle: &str,
        delay: std::time::Duration,
    ) -> Result<(), Report> {
        self.client
            .change_message_visibility()
            .queue_url(&self.queue_url)
            .receipt_handle(receipt_handle)
            .visibility_timeout(delay.as_secs() as i32)
            .send()
            .await?;
        Ok(())
    }
}

impl NotificationIngressQueue for SqsQueue {
    async fn publish(&self, message: IngressQueueMessage) -> Result<(), Report> {
        self.send_json(&message).await
    }

    async fn receive_messages(&self) -> Result<Vec<RawIngressQueueMessage>, Report> {
        let result = self
            .client
            .receive_message()
            .queue_url(&self.queue_url)
            .max_number_of_messages(10)
            .wait_time_seconds(20)
            .send()
            .await?;

        let messages = result
            .messages
            .unwrap_or_default()
            .into_iter()
            .filter_map(|msg| {
                let body_str = msg.body?;
                let body = serde_json::from_str(&body_str)
                    .inspect_err(|e| tracing::error!(error=?e, body=%body_str, "failed to deserialize ingress queue message"))
                    .ok()?;
                let receipt_handle = msg.receipt_handle?;
                Some(RawIngressQueueMessage {
                    body,
                    receipt_handle,
                })
            })
            .collect();

        Ok(messages)
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        self.delete(receipt_handle).await
    }
}

/// File-based queue for local development across multiple processes.
/// Each message is stored as a separate JSON file in a directory.
pub struct FileQueue {
    dir: std::path::PathBuf,
}

impl FileQueue {
    /// Create a new file-based queue at the given directory path.
    /// Creates the directory if it doesn't exist.
    pub fn new(dir: impl Into<std::path::PathBuf>) -> Result<Self, Report> {
        let dir = dir.into();
        std::fs::create_dir_all(&dir)?;
        tracing::info!(path = ?dir, "initialized file queue");
        Ok(Self { dir })
    }

    /// Create a new file-based queue in /tmp.
    pub fn new_in_temp() -> Result<Self, Report> {
        Self::new("/tmp/macro-notification-queue")
    }
}

impl NotificationQueue for FileQueue {
    async fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        for message in messages {
            let id = uuid::Uuid::new_v4();
            let filename = format!("{}.json", id);
            let path = self.dir.join(&filename);
            let content = serde_json::to_string_pretty(&message)?;
            tokio::fs::write(&path, content).await?;
        }
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        let mut messages = Vec::new();
        let mut entries = tokio::fs::read_dir(&self.dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            if messages.len() >= 10 {
                break;
            }

            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                let filename = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_string();

                match tokio::fs::read_to_string(&path).await {
                    Ok(content) => match serde_json::from_str(&content) {
                        Ok(body) => {
                            messages.push(RawQueueMessage {
                                body,
                                receipt_handle: filename,
                            });
                        }
                        Err(e) => {
                            tracing::warn!(error = ?e, path = ?path, "failed to parse queue message");
                        }
                    },
                    Err(e) => {
                        tracing::warn!(error = ?e, path = ?path, "failed to read queue message");
                    }
                }
            }
        }

        Ok(messages)
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        let path = self.dir.join(receipt_handle);
        if path.exists() {
            tokio::fs::remove_file(&path).await?;
        }
        Ok(())
    }

    async fn delay_message(
        &self,
        _receipt_handle: &str,
        _delay: std::time::Duration,
    ) -> Result<(), Report> {
        // No-op for file-based queue.
        Ok(())
    }
}
