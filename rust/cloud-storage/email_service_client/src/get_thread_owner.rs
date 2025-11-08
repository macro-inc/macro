use crate::EmailServiceClient;
use models_email::service::thread;

impl EmailServiceClient {
    pub async fn get_thread_owner(
        &self,
        thread_id: &str,
    ) -> anyhow::Result<thread::GetThreadOwnerResponse> {
        let res = self
            .client
            .get(format!("{}/internal/threads/{}/owner", self.url, thread_id))
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<thread::GetThreadOwnerResponse>().await?;
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
