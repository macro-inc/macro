use anyhow::{Context, Result};
use model::project::response::GetProjectContentResponse;

use super::DocumentStorageServiceClient;

impl DocumentStorageServiceClient {
    #[tracing::instrument(skip(self))]
    pub async fn get_project(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<GetProjectContentResponse> {
        let path = format!("/projects/{}/content", project_id);
        let json = self
            .external_request(reqwest::Method::GET, path.as_str(), jwt)
            .send()
            .await
            .context("failed to fetch head")?
            .json()
            .await
            .context("failed to fetch json")?;

        serde_json::from_value(json)
            .inspect_err(|err| eprintln!("jsonfail {:#?}", err))
            .context("unexpected response")
    }
}
