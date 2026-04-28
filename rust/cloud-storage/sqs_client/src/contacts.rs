use crate::SQS;
use contacts::domain::models::messages::ContactsMessage;
use macro_user_id::user_id::MacroUserIdStr;

impl SQS {
    pub fn contacts_queue(mut self, contacts_queue: &str) -> Self {
        self.contacts_queue = Some(contacts_queue.to_string());
        self
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn enqueue_contacts(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
    ) -> anyhow::Result<()> {
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
        anyhow::bail!("contacts_queue is not configured")
    }
}
