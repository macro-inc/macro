use crate::service::fusionauth_client::{
    FusionAuthClient, Result, UnauthedClient,
    error::{FusionAuthClientError, GenericErrorResponse},
};
use std::borrow::Cow;

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct LogoutRequest<'a> {
    /// The fusionauth client id
    pub client_id: Cow<'a, str>,
    /// The fusionauth tenant id
    pub tenant_id: Cow<'a, str>,
}

async fn logout(client: &UnauthedClient, base_url: &str, request: LogoutRequest<'_>) -> Result<()> {
    let res = client
        .client()
        .post(format!("{base_url}/oauth2/logout"))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    let status_code = res.status();
    match status_code {
        reqwest::StatusCode::OK => {
            tracing::trace!("user logged out");
            Ok(())
        }
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            if status_code == reqwest::StatusCode::NOT_FOUND {
                return Err(FusionAuthClientError::UserDoesNotExist);
            }

            tracing::error!(body=%body, status=%status_code, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}

impl FusionAuthClient {
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn logout(&self, tenant_id: &str) -> Result<()> {
        logout(
            &self.unauth_client,
            &self.fusion_auth_base_url,
            LogoutRequest {
                client_id: Cow::Borrowed(&self.client_id),
                tenant_id: Cow::Borrowed(tenant_id),
            },
        )
        .await
    }
}
