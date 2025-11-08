use std::borrow::Cow;

use crate::service::fusionauth_client::{
    AuthedClient, FusionAuthClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct PasswordLoginRequest<'a> {
    /// The application id
    pub application_id: Cow<'a, str>,
    /// The email or username of the user
    pub login_id: Cow<'a, str>,
    /// The password of the user
    pub password: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct PasswordLoginResponse<'a> {
    /// The access token
    pub token: Cow<'a, str>,
    /// The refresh token
    pub refresh_token: Cow<'a, str>,
}

/// Performs a password login
/// https://fusionauth.io/docs/apis/login
/// Valid respones: 200, 202, 203, 212, 213, 242, 400, 401, 404, 409, 410, 423, 500, 503, 504
async fn login(
    client: &AuthedClient,
    base_url: &str,
    request: PasswordLoginRequest<'_>,
) -> Result<(String, String)> {
    let res = client
        .client()
        .post(format!("{}/api/login", base_url))
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
            tracing::trace!("passwordless login complete");
            let body = res.json::<PasswordLoginResponse>().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            Ok((body.token.into(), body.refresh_token.into()))
        }
        reqwest::StatusCode::ACCEPTED => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            tracing::warn!(body=%body, "user not registered to application");
            Err(FusionAuthClientError::UserNotRegistered)
        }
        reqwest::StatusCode::NOT_FOUND => Err(FusionAuthClientError::IncorrectCode),
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            if status.as_u16() == 212 {
                // Email not verified
                tracing::warn!(status=%status, body=%body, "user not verified");
                return Err(FusionAuthClientError::UserNotVerified);
            }

            tracing::error!(status=%status, body=%body, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}

impl FusionAuthClient {
    #[tracing::instrument(skip(self, password), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn password_login(&self, email: &str, password: &str) -> Result<(String, String)> {
        login(
            &self.auth_client,
            &self.fusion_auth_base_url,
            PasswordLoginRequest {
                application_id: Cow::Borrowed(&self.application_id),
                login_id: Cow::Borrowed(email),
                password: Cow::Borrowed(password),
            },
        )
        .await
    }
}
