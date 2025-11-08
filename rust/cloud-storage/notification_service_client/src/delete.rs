use super::NotificationServiceClient;
use anyhow::Result;

impl NotificationServiceClient {
    /// Deletes all notifications for a user
    #[tracing::instrument(skip(self))]
    pub async fn delete_user_notifications(&self, user_id: &str) -> Result<()> {
        let res = self
            .client
            .delete(format!("{}/notifications/user/{}", self.url, user_id))
            .send()
            .await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from document storage service"
            );
            return Err(anyhow::anyhow!(body));
        }

        Ok(())
    }
}
