use crate::service::fusionauth_client::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

/// Deletes a user in fusionauth
/// https://fusionauth.io/docs/apis/users#delete-a-user
/// Valid respones: 200, 400, 401, 404, 500, 503, 504
pub(in crate::service::fusionauth_client) async fn delete_user(
    client: &AuthedClient,
    base_url: &str,
    user_id: &str,
) -> Result<()> {
    let res = client
        .client()
        .delete(format!("{base_url}/api/user/{user_id}?hardDelete=true"))
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK => {
            tracing::trace!("user deleted");
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
