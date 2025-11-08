use std::borrow::Cow;

use crate::service::fusionauth_client::{
    FusionAuthClient, Result, UnauthedClient,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug, Default)]
struct AppleLoginRequestData<'a> {
    pub id_token: Cow<'a, str>,
    pub code: Cow<'a, str>,
    pub redirect_uri: Cow<'a, str>,
    #[serde(rename = "isNativeApp")]
    pub is_native_app: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct AppleLoginRequest<'a> {
    /// The application id
    #[serde(rename = "applicationId")]
    pub application_id: Cow<'a, str>,
    pub data: AppleLoginRequestData<'a>,
    #[serde(rename = "identityProviderId")]
    pub identity_provider_id: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct AppleLoginResponse {
    refresh_token: String,
    refresh_token_id: String,
    token: String,
}

/// Performs an apple login
/// https://fusionauth.io/docs/apis/identity-providers/apple#complete-the-apple-login
/// Valid respones: 200, 202, 203, 204, 212, 213, 242, 400, 401, 404, 409, 410, 500, 503, 504
async fn login(
    client: &UnauthedClient,
    base_url: &str,
    request: AppleLoginRequest<'_>,
) -> Result<(String, String)> {
    let res = client
        .client()
        .post(format!("{}/api/identity-provider/login", base_url))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    let status = res.status();
    match status {
        reqwest::StatusCode::OK => {
            tracing::trace!("apple login complete");
            let body = res.json::<AppleLoginResponse>().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            Ok((body.token, body.refresh_token))
        }
        reqwest::StatusCode::NOT_FOUND => Err(FusionAuthClientError::IncorrectCode),
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            tracing::error!(status=%status, body=%body, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}

impl FusionAuthClient {
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn apple_login(
        &self,
        apple_identity_provider_id: &str,
        id_token: &str,
        code: &str,
    ) -> Result<(String, String)> {
        login(
            &self.unauth_client,
            &self.fusion_auth_base_url,
            AppleLoginRequest {
                application_id: Cow::Borrowed(&self.application_id),
                data: AppleLoginRequestData {
                    id_token: Cow::Borrowed(id_token),
                    code: Cow::Borrowed(code),
                    redirect_uri: Cow::Borrowed(""),
                    is_native_app: true,
                },
                identity_provider_id: Cow::Borrowed(apple_identity_provider_id),
            },
        )
        .await
    }
}
