use std::sync::Arc;

use notification::domain::models::queue_message::{QueueMessage, RawQueueMessage};
use notification::domain::ports::NotificationQueue;
use rootcause::Report;
use serde::Serialize;
use tokio::sync::Mutex;
use tokio::sync::mpsc;

/// In-process notification queue backed by a tokio mpsc channel.
///
/// Both the ingress (publish) and egress (receive) sides share the same channel.
/// Messages are serialized to JSON on publish and deserialized on receive,
/// matching the behavior of the SQS/FileQueue adapters.
pub struct MpscQueue {
    tx: mpsc::UnboundedSender<RawQueueMessage>,
    rx: Arc<Mutex<mpsc::UnboundedReceiver<RawQueueMessage>>>,
}

impl MpscQueue {
    /// Create a new mpsc-backed queue.
    pub fn new() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            tx,
            rx: Arc::new(Mutex::new(rx)),
        }
    }
}

impl Clone for MpscQueue {
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
            rx: self.rx.clone(),
        }
    }
}

impl NotificationQueue for MpscQueue {
    async fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        messages: impl Iterator<Item = QueueMessage<'a, T, U>> + Send,
    ) -> Result<(), Report> {
        for message in messages {
            let json = serde_json::to_value(&message)?;
            let body = serde_json::from_value(json)?;
            let raw = RawQueueMessage {
                body,
                receipt_handle: uuid::Uuid::new_v4().to_string(),
            };
            self.tx.send(raw)?;
        }
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        let mut rx = self.rx.lock().await;
        let mut messages = Vec::new();
        while messages.len() < 10 {
            match rx.try_recv() {
                Ok(msg) => messages.push(msg),
                Err(mpsc::error::TryRecvError::Empty | mpsc::error::TryRecvError::Disconnected) => {
                    break;
                }
            }
        }
        Ok(messages)
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        // No-op: messages are consumed from the channel on receive.
        Ok(())
    }
}
