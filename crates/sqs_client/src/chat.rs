use crate::SQS;

pub mod enqueue_delete_chat;

impl SQS {
    /// Sets the chat_delete_queue.
    pub fn chat_delete_queue(mut self, chat_delete_queue: &str) -> Self {
        self.chat_delete_queue = Some(chat_delete_queue.to_string());
        self
    }

    /// Bulk enqueues chat delete messages to the chat delete queue
    #[tracing::instrument(skip(self))]
    pub async fn bulk_enqueue_chat_delete(&self, chats: Vec<String>) -> anyhow::Result<()> {
        if let Some(chat_delete_queue) = &self.chat_delete_queue {
            return enqueue_delete_chat::bulk_enqueue_chat_delete(
                &self.inner,
                chat_delete_queue,
                chats,
            )
            .await;
        }

        Err(anyhow::anyhow!("chat_delete_queue is not configured"))
    }

    /// enqueues chat delete messages to the chat delete queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_chat_delete(&self, chat_id: &str) -> anyhow::Result<()> {
        if let Some(chat_delete_queue) = &self.chat_delete_queue {
            return enqueue_delete_chat::enqueue_chat_delete(
                &self.inner,
                chat_delete_queue,
                chat_id,
            )
            .await;
        }

        Err(anyhow::anyhow!("chat_delete_queue is not configured"))
    }
}
