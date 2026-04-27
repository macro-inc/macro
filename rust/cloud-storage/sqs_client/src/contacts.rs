use crate::SQS;
use contacts::domain::models::messages::ContactsMessage;

impl SQS {
    pub fn contacts_queue(mut self, contacts_queue: &str) -> Self {
        self.contacts_queue = Some(contacts_queue.to_string());
        self
    }

    #[tracing::instrument(skip(self))]
    pub async fn enqueue_contacts(&self, users: Vec<String>) -> anyhow::Result<()> {
        if let Some(contacts_queue) = &self.contacts_queue {
            let message_str = serde_json::to_string(&ContactsMessage { users })?;
            self.inner
                .send_message()
                .queue_url(contacts_queue)
                .message_body(message_str)
                .send()
                .await?;
            return Ok(());
        }
        Err(anyhow::anyhow!("contacts_queue is not configured"))
    }
}
