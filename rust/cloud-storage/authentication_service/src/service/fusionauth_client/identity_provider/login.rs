use std::borrow::Cow;

use crate::service::fusionauth_client::{
    Result, UnauthedClient,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub struct IdentityProviderLoginRequestData<'a> {
    /// The code
    pub code: Cow<'a, str>,
    /// The redirect uri
    pub redirect_uri: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IdentityProviderLoginRequest<'a> {
    /// The application id
    pub application_id: Cow<'a, str>,
    /// The identity provider id
    pub identity_provider_id: Cow<'a, str>,
    ///  When this value is set to true, if a link does not yet exist to a FusionAuth user, a 404 status code will be returned instead of using the requested linking strategy.
    pub no_link: bool,
    /// The data
    pub data: IdentityProviderLoginRequestData<'a>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IdentityProviderLoginResponse {
    /// The access token
    pub refresh_token: String,
    /// The refresh token id
    pub refresh_token_id: String,
    /// The access token
    pub token: String,
}

/// This API allows you to complete a OpenID Connect login after authenticating a user using the OpenID Connect API. If you are using the FusionAuth login UI with the OpenID Connect button you will not utilize this API directly.
/// https://fusionauth.io/docs/apis/identity-providers/openid-connect#complete-an-openid-connect-login
/// Valid respones: 200, 202, 203, 204, 212, 213, 242, 400, 401, 409, 410, 500, 503, 504
pub(in crate::service::fusionauth_client) async fn complete_identity_provider_login(
    client: &UnauthedClient,
    base_url: &str,
    request: IdentityProviderLoginRequest<'_>,
) -> Result<(String, String)> {
    let res = client
        .client()
        .post(format!("{base_url}/api/identity-provider/login",))
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
            // all is good
            let response = res
                .json::<IdentityProviderLoginResponse>()
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to parse response");
                    FusionAuthClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

            Ok((response.token, response.refresh_token))
        }
        reqwest::StatusCode::ACCEPTED => {
            tracing::trace!("user not registered to application");
            // TODO: need to handle linking the user to the application
            Err(FusionAuthClientError::UserNotRegistered)
        }
        reqwest::StatusCode::NOT_FOUND => {
            tracing::trace!("user does not exist");
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
