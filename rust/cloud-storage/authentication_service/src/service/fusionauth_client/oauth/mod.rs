use std::borrow::Cow;

use crate::service::fusionauth_client::{
    FusionAuthClient, Result, UnauthedClient,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
struct AuthorizationCodeGrantCompleteRequest<'a> {
    /// The client id
    pub client_id: Cow<'a, str>,
    /// The client secret
    pub client_secret: Cow<'a, str>,
    /// The authorization code
    pub code: Cow<'a, str>,
    /// The redirect uri
    pub redirect_uri: Cow<'a, str>,
    /// The grant type (should always be authorization_code)
    pub grant_type: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
struct AuthorizationCodeGrantCompleteResponse<'a> {
    /// The access token
    pub access_token: Cow<'a, str>,
    /// The refresh token
    pub refresh_token: Cow<'a, str>,
    /// The expiration time of the access token
    pub expires_in: u64,
    // TODO: add other fields if we start to need them
}

/// Completes the authorization code grant
/// https://fusionauth.io/docs/lifecycle/authenticate-users/oauth/endpoints#complete-the-authorization-code-grant-request
/// Valid respones: 200, 400, 401, 500, 503
async fn complete(
    client: &UnauthedClient,
    base_url: &str,
    request: AuthorizationCodeGrantCompleteRequest<'_>,
) -> Result<(String, String)> {
    let body = serde_urlencoded::to_string(&request).map_err(|e| {
        FusionAuthClientError::Generic(GenericErrorResponse {
            message: e.to_string(),
        })
    })?;

    let res = client
        .client()
        .post(format!("{base_url}/oauth2/token"))
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    tracing::trace!("request sent");

    match res.status() {
        reqwest::StatusCode::OK => {
            tracing::info!("authorization code grant complete");
            let body = res
                .json::<AuthorizationCodeGrantCompleteResponse>()
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to decode successful oauth2 token response");
                    FusionAuthClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

            Ok((body.access_token.into(), body.refresh_token.into()))
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

impl FusionAuthClient {
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn complete_authorization_code_grant(&self, code: &str) -> Result<(String, String)> {
        complete(
            &self.unauth_client,
            &self.fusion_auth_base_url,
            AuthorizationCodeGrantCompleteRequest {
                client_id: Cow::Borrowed(&self.client_id),
                client_secret: Cow::Borrowed(&self.client_secret),
                code: Cow::Borrowed(code),
                redirect_uri: Cow::Borrowed(&self.oauth_redirect_uri),
                grant_type: Cow::Borrowed("authorization_code"),
            },
        )
        .await
    }
}
