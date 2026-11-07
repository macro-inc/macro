use std::collections::HashSet;
use std::fmt::{Debug, Display};

use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};
use anyhow::Result;

// HACK: duplicate code, should probably move this to a model crate at some point
#[derive(Default, Debug, serde::Serialize)]
pub struct PostGetExistingUsersRequestBody {
    pub user_ids: Vec<String>,
}

#[derive(Default, Debug, serde::Deserialize)]
pub struct PostGetExistingUsersResponse {
    pub existing_user_ids: Vec<String>,
}

impl AuthServiceClient {
    #[tracing::instrument(err, skip(self))]
    pub async fn get_existing_users(
        &self,
        user_ids: &[impl ToString + Display + Debug],
    ) -> Result<HashSet<String>> {
        let body = PostGetExistingUsersRequestBody {
            user_ids: user_ids.iter().map(|u| u.to_string()).collect(),
        };

        let res = self
            .client
            .post(format!("{}/internal/get_existing_users", self.url))
            .json(&body)
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res
                    .json::<PostGetExistingUsersResponse>()
                    .await
                    .map_err(|e| {
                        AuthServiceClientError::Generic(GenericErrorResponse {
                            message: e.to_string(),
                        })
                    })?;

                Ok(result.existing_user_ids.into_iter().collect())
            }
            status_code => {
                let body: String = res.text().await?;
                tracing::error!(
                    body=%body,
                    status=%status_code,
                    "unexpected response from authentication service"
                );
                Err(anyhow::anyhow!(body))
            }
        }
    }
}
