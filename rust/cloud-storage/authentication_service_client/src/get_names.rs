use std::collections::HashSet;

use crate::AuthServiceClient;
use crate::error::{AuthServiceClientError, GenericErrorResponse};
use anyhow::Result;
use model::comms::ChannelWithParticipants;
use model::user::UserNames;

// HACK: duplicate code, should probably move this to model at some point
#[derive(Default, Debug, serde::Serialize, serde::Deserialize)]
pub struct PostGetNamesRequestBody {
    pub user_ids: Vec<String>,
}

impl AuthServiceClient {
    pub async fn get_names(&self, user_ids: Vec<String>) -> Result<UserNames> {
        let body = PostGetNamesRequestBody { user_ids };

        let res = self
            .client
            .post(format!("{}/internal/get_names", self.url))
            .json(&body)
            .send()
            .await
            .map_err(|e| AuthServiceClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<UserNames>().await.map_err(|e| {
                    AuthServiceClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;
                Ok(result)
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

    #[tracing::instrument(err, skip(self))]
    pub async fn get_names_from_channels(
        &self,
        channels: &Vec<ChannelWithParticipants>,
    ) -> Result<UserNames> {
        let mut user_ids: HashSet<String> = HashSet::new();
        for channel in channels {
            for p in &channel.participants {
                user_ids.insert(p.user_id.clone());
            }
        }

        self.get_names(user_ids.into_iter().collect()).await
    }
}
