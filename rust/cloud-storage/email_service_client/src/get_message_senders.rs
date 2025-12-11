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
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<MessageSendersResponse>().await?;
                Ok(result)
            }
            status_code => {
                let body: String = res.text().await?;
                anyhow::bail!(format!(
                    "unexpected response from email service status code {}: {}",
                    status_code, body
                ))
            }
        }
    }
}
