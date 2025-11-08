use model::{
    folder::{FolderItem, UploadFolderRequest, UploadFolderResponseData},
    response::TypedSuccessResponse,
};
use models_bulk_upload::{MarkProjectUploadedRequest, MarkProjectUploadedResponse};

use crate::constants::MACRO_INTERNAL_USER_ID_HEADER_KEY;

use super::DocumentStorageServiceClient;

impl DocumentStorageServiceClient {
    #[tracing::instrument(skip(self))]
    pub async fn upload_unnested_folder(
        &self,
        user_id: String,
        root_folder_name: String,
        content: Vec<FolderItem>,
        upload_request_id: String,
        parent_id: Option<String>,
    ) -> anyhow::Result<UploadFolderResponseData> {
        let url = format!("{}/internal/projects/upload", self.url);

        let request = UploadFolderRequest {
            content,
            root_folder_name,
            upload_request_id,
            parent_id,
        };

        let response = self
            .client
            .post(&url)
            .header(MACRO_INTERNAL_USER_ID_HEADER_KEY, user_id)
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".into());

            return Err(anyhow::anyhow!(
                "upload unnested failed: {} - {}",
                status,
                text
            ));
        }

        let data = match response
            .json::<TypedSuccessResponse<UploadFolderResponseData>>()
            .await
        {
            Ok(upload_response_data) => upload_response_data.data,
            Err(_) => {
                return Err(anyhow::anyhow!("unable to parse response"));
            }
        };

        Ok(data)
    }

    #[tracing::instrument(skip(self))]
    pub async fn mark_projects_uploaded(
        &self,
        user_id: &str,
        root_project_id: &str,
    ) -> anyhow::Result<MarkProjectUploadedResponse> {
        let url = format!("{}/internal/projects/mark_uploaded", self.url);

        let request = MarkProjectUploadedRequest {
            project_id: root_project_id.to_string(),
        };

        let response = self
            .client
            .post(&url)
            .header(MACRO_INTERNAL_USER_ID_HEADER_KEY, user_id)
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".into());

            return Err(anyhow::anyhow!(
                "mark uploaded failed: {} - {}",
                status,
                text
            ));
        }

        let data = match response.json::<MarkProjectUploadedResponse>().await {
            Ok(data) => data,
            Err(_) => {
                return Err(anyhow::anyhow!("unable to parse response"));
            }
        };

        Ok(data)
    }
}
