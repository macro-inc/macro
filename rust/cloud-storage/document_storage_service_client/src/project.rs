use anyhow::Result;
use model::project::response::GetProjectContentResponse;

use super::DocumentStorageServiceClient;

impl DocumentStorageServiceClient {
    #[tracing::instrument(skip(self), err)]
    pub async fn get_project(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<GetProjectContentResponse> {
        let path = format!("/projects/{}/content", project_id);
        let json = self
            .external_request(reqwest::Method::GET, path.as_str(), jwt)
            .send()
            .await?
            .json()
            .await?;

        serde_json::from_value(json).map_err(Into::into)
    }
}
