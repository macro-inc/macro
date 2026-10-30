use crate::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

/// Revokes a single refresh token. A token FusionAuth does not know (already
/// revoked or expired) counts as revoked, so callers can retry.
/// The token goes in a form-encoded body, which FusionAuth accepts in place of
/// the `token` query parameter, so it stays out of URLs and request logs.
/// FusionAuth does not read a JSON body here.
/// https://fusionauth.io/docs/apis/jwt/revoke-refresh-tokens
/// Valid responses: 200, 400, 401, 404, 500, 503
pub(crate) async fn revoke_refresh_token(
    client: &AuthedClient,
    base_url: &str,
    refresh_token: &str,
) -> Result<()> {
    let res = client
        .client()
        .delete(format!("{base_url}/api/jwt/refresh"))
        .form(&[("token", refresh_token)])
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK | reqwest::StatusCode::NOT_FOUND => {
            tracing::trace!("refresh token revoked");
            Ok(())
        }
        status => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            tracing::error!(body=%body, %status, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}
