use super::DocumentStorageServiceClient;
use anyhow::Result;

impl DocumentStorageServiceClient {
    /// Associates GitHub App installations installed by the given GitHub user
    /// with that user's Macro sources. Intended to be called after a github
    /// link is created for the user.
    #[tracing::instrument(skip(self))]
    pub async fn associate_github_installations(&self, github_user_id: &str) -> Result<()> {
        let res = self
            .client
            .post(format!(
                "{}/internal/github/installations/{}/associate",
                self.url, github_user_id
            ))
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
            anyhow::bail!(body);
        }

        Ok(())
    }
}
