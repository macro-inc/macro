use crate::service::fusionauth_client::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

/// Unlinks a user from an identity provider
/// https://fusionauth.io/docs/apis/identity-providers/links#unlink-a-user
/// Valid respones: 200, 400, 401, 404, 500
pub(in crate::service::fusionauth_client) async fn unlink(
    client: &AuthedClient,
    base_url: &str,
    user_id: &str,
    idp_id: &str,
    idp_user_id: &str,
) -> Result<()> {
    // DELETE /api/identity-provider/link?identityProviderId={identityProviderId}&identityProviderUserId={identityProviderUserId}&userId={userId}
    let res = client.client()
        .delete(format!(
            "{base_url}/api/identity-provider/link?identityProviderId={idp_id}&identityProviderUserId={idp_user_id}&userId={user_id}",
        ))
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    let status = res.status();
    let body = res.text().await.map_err(|e| {
        FusionAuthClientError::Generic(GenericErrorResponse {
            message: e.to_string(),
        })
    })?;

    match status {
        reqwest::StatusCode::OK => Ok(()),
        reqwest::StatusCode::NOT_FOUND => Err(FusionAuthClientError::NoIdentityProviderFound), // no idp to unlink
        _ => Err(FusionAuthClientError::Generic(GenericErrorResponse {
            message: body,
        })),
    }
}
