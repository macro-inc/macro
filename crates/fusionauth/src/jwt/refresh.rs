use std::borrow::Cow;

use crate::{Result, UnauthedClient, error::FusionAuthClientError};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RefreshJwtRequest<'a> {
    /// The refresh token
    pub refresh_token: Cow<'a, str>,
    /// The access token
    pub token: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RefreshJwtResponse<'a> {
    /// The refresh token
    pub refresh_token: Cow<'a, str>,
    /// The refresh token id, this can be used for session invalidation
    pub refresh_token_id: Cow<'a, str>,
    /// The access token
    pub token: Cow<'a, str>,
}

/// Refreshes a jwt token
/// https://fusionauth.io/docs/apis/jwt#request-3
/// Valid respones: 200, 400, 404, 500, 503
pub async fn refresh_token(
    client: &UnauthedClient,
    base_url: &str,
    access_token: &str,
    refresh_token: &str,
) -> Result<(String, String)> {
    let request = RefreshJwtRequest {
        refresh_token: Cow::Borrowed(refresh_token),
        token: Cow::Borrowed(access_token),
    };

    let res = client
        .client()
        .post(format!("{base_url}/api/jwt/refresh"))
        .json(&request)
        .send()
        .await
        .map_err(FusionAuthClientError::transport)?;

    match res.status() {
        reqwest::StatusCode::OK => {
            tracing::trace!("token refreshed");
            let body = res
                .json::<RefreshJwtResponse>()
                .await
                .map_err(FusionAuthClientError::transport)?;

            Ok((body.token.into(), body.refresh_token.into()))
        }
        _ => {
            let status = res.status();
            let headers = res.headers().clone();
            let body = res.text().await.map_err(FusionAuthClientError::transport)?;

            if body.contains("The refresh token was not found or has expired") {
                Err(FusionAuthClientError::InvalidRefreshToken)
            } else {
                Err(FusionAuthClientError::unexpected(status, &headers, body))
            }
        }
    }
}
