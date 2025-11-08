use crate::EmailServiceClient;
use models_email::service::message::{ThreadHistoryRequest, ThreadHistoryResponse};

impl EmailServiceClient {
    pub async fn get_thread_histories(
        &self,
        request: ThreadHistoryRequest,
    ) -> anyhow::Result<ThreadHistoryResponse> {
        let res = self
            .client
            .post(format!("{}/internal/threads/histories", self.url))
            .json(&request)
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<ThreadHistoryResponse>().await?;
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
