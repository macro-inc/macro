use std::borrow::Cow;

use crate::service::fusionauth_client::{
    AuthedClient, FusionAuthClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
struct PasswordlessLoginStateRequest<'a> {
    /// The client id
    pub client_id: Cow<'a, str>,
    /// The response type (should always be code)
    pub response_type: Cow<'a, str>,
    /// The scope (should always be offline_access)
    pub scope: Cow<'a, str>,
    /// The uri to redirect to after login
    pub redirect_uri: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct PasswordlessLoginStartRequest<'a> {
    /// The email address of the user
    pub login_id: Cow<'a, str>,
    /// The application id
    pub application_id: Cow<'a, str>,
    pub state: PasswordlessLoginStateRequest<'a>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct PasswordlessLoginStartResponse<'a> {
    /// The code to be used to complete the login
    pub code: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct PasswordlessLoginCompleteRequest<'a> {
    /// The application id
    pub application_id: Cow<'a, str>,
    /// The code for the passwordless login
    pub code: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PasswordlessLoginStateResponse {
    pub redirect_uri: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PasswordlessLoginCompleteResponse {
    /// The access token
    pub token: String,
    /// The refresh token
    pub refresh_token: String,
    /// The user
    pub user: User,
    /// The state of the passwordless login
    pub state: PasswordlessLoginStateResponse,
}

/// Starts the passwordless login flow, generating a code to be used
/// https://fusionauth.io/docs/apis/passwordless#start-passwordless-login
/// Valid respones: 200, 400, 401, 404, 500
async fn start(
    client: &AuthedClient,
    base_url: &str,
    request: PasswordlessLoginStartRequest<'_>,
) -> Result<String> {
    let res = client
        .client()
        .post(format!("{base_url}/api/passwordless/start"))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK => {
            tracing::trace!("code generated");
            let body = res
                .json::<PasswordlessLoginStartResponse>()
                .await
                .map_err(|e| {
                    FusionAuthClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

            Ok(body.code.to_string())
        }
        reqwest::StatusCode::NOT_FOUND => {
            tracing::trace!("no user with loginId {} found", request.login_id);
            Err(FusionAuthClientError::UserDoesNotExist)
        }
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            tracing::error!(body=%body, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}

/// Sends the passwordless login, using the code generated from start
/// https://fusionauth.io/docs/apis/passwordless#send-passwordless-login
/// Valid respones: 200, 400, 500
async fn send(
    client: &AuthedClient,
    base_url: &str,
    request: PasswordlessLoginStartResponse<'_>,
) -> Result<()> {
    let res = client
        .client()
        .post(format!("{base_url}/api/passwordless/send"))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK => {
            tracing::trace!("code generated");
            Ok(())
        }
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            tracing::error!(body=%body, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}

/// Completes the passwordless login flow, using the code generated from start.
/// Returns the access token, refresh token, and redirect uri
/// https://fusionauth.io/docs/apis/passwordless#complete-a-passwordless-login
/// Valid respones: 200, 202, 203, 212, 213, 242, 400, 404, 409, 410, 423, 500, 503, 504
#[tracing::instrument(ret, err)]
async fn complete(
    client: &AuthedClient,
    base_url: &str,
    request: PasswordlessLoginCompleteRequest<'_>,
) -> Result<PasswordlessLoginCompleteResponse> {
    let res = client
        .client()
        .post(format!("{}/api/passwordless/login", base_url))
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
            let body = res
                .json::<PasswordlessLoginCompleteResponse>()
                .await
                .map_err(|e| {
                    FusionAuthClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

            Ok(body)
        }
        _ => {
            if status == reqwest::StatusCode::NOT_FOUND {
                return Err(FusionAuthClientError::IncorrectCode);
            }

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
    pub async fn start_passwordless_login(
        &self,
        email: &str,
        redirect_uri: &str,
    ) -> Result<String> {
        start(
            &self.auth_client,
            &self.fusion_auth_base_url,
            PasswordlessLoginStartRequest {
                login_id: Cow::Borrowed(email),
                application_id: Cow::Borrowed(&self.application_id),
                state: PasswordlessLoginStateRequest {
                    client_id: Cow::Borrowed(&self.client_id),
                    response_type: Cow::Borrowed("code"),
                    scope: Cow::Borrowed("openid offline_access"),
                    redirect_uri: Cow::Borrowed(redirect_uri),
                },
            },
        )
        .await
    }

    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn send_passwordless_login(&self, code: &str) -> Result<()> {
        send(
            &self.auth_client,
            &self.fusion_auth_base_url,
            PasswordlessLoginStartResponse {
                code: Cow::Borrowed(code),
            },
        )
        .await
    }

    #[tracing::instrument(skip_all)]
    pub async fn complete_passwordless_login(
        &self,
        code: &str,
    ) -> Result<PasswordlessLoginCompleteResponse> {
        complete(
            &self.auth_client,
            &self.fusion_auth_base_url,
            PasswordlessLoginCompleteRequest {
                application_id: Cow::Borrowed(&self.application_id),
                code: Cow::Borrowed(code),
            },
        )
        .await
    }
}
