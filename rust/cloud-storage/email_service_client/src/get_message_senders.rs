use crate::EmailServiceClient;
use models_email::service::message::{MessageSendersRequest, MessageSendersResponse};

impl EmailServiceClient {
    pub async fn get_message_senders(
        &self,
        request: MessageSendersRequest,
    ) -> anyhow::Result<MessageSendersResponse> {
        let res = self
            .client
            .post(format!("{}/internal/messages/senders", self.url))
            .json(&request)
            .send()
            .await?
            .error_for_status()?;

        let result = res.json::<MessageSendersResponse>().await?;
        Ok(result)
    }
}
