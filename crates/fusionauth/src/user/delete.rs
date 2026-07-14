use crate::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

/// Deletes a user in fusionauth
/// https://fusionauth.io/docs/apis/users#delete-a-user
/// Valid respones: 200, 400, 401, 404, 500, 503, 504
pub(crate) async fn delete_user(
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
        reqwest::StatusCode::NOT_FOUND => Err(FusionAuthClientError::UserDoesNotExist),
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

/// Deactivates (soft-deletes) a user in fusionauth. The user can no longer authenticate,
/// but their identity provider links remain readable via the Link API.
/// https://fusionauth.io/docs/apis/users#delete-a-user
pub(crate) async fn deactivate_user(
    client: &AuthedClient,
    base_url: &str,
    user_id: &str,
) -> Result<()> {
    let res = client
        .client()
        .delete(format!("{base_url}/api/user/{user_id}"))
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK => {
            tracing::trace!("user deactivated");
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

/// Reactivates a previously deactivated user.
/// https://fusionauth.io/docs/apis/users#reactivate-a-user
pub(crate) async fn reactivate_user(
    client: &AuthedClient,
    base_url: &str,
    user_id: &str,
) -> Result<()> {
    let res = client
        .client()
        .put(format!("{base_url}/api/user/{user_id}?reactivate=true"))
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK => {
            tracing::trace!("user reactivated");
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
