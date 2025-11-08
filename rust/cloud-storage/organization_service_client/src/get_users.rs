use macro_client_errors::{GenericErrorResponse, MacroClientError};

use super::OrganizationServiceClient;

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct GetUsersInternalResponse {
    pub users: Vec<String>,
    pub total: i64,
    pub next_offset: Option<i64>,
}

impl OrganizationServiceClient {
    /// Gets a paginated list of users in an organization
    pub async fn get_organization_users(
        &self,
        organization_id: i32,
        limit: i64, // max limit of 100
        offset: i64,
    ) -> Result<GetUsersInternalResponse, MacroClientError> {
        let url = format!(
            "{}/internal/organization/{}/users?limit={}&offset={}",
            self.url, organization_id, limit, offset
        );
        let res =
            self.client
                .get(url)
                .send()
                .await
                .map_err(|e| MacroClientError::RequestBuildError {
                    details: e.to_string(),
                })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<GetUsersInternalResponse>().await.map_err(|e| {
                    MacroClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Ok(result)
            }
            reqwest::StatusCode::UNAUTHORIZED => Err(MacroClientError::Unauthorized),
            _ => {
                let body = res.text().await.map_err(|e| {
                    MacroClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(MacroClientError::Generic(GenericErrorResponse {
                    message: body,
                }))
            }
        }
    }
}
