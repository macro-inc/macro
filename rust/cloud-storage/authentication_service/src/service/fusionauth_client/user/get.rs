use std::borrow::Cow;

use crate::service::fusionauth_client::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(in crate::service::fusionauth_client) struct UserResponse<'a> {
    /// The id of the user
    pub id: Cow<'a, str>,
    /// The email address of the user
    pub email: Cow<'a, str>,
    /// The additional data associated with the user
    pub data: Option<serde_json::Value>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(in crate::service::fusionauth_client) struct GetUserResponse<'a> {
    /// The user
    pub user: UserResponse<'a>,
}

/// Retreives a user by email in fusionauth
/// https://fusionauth.io/docs/apis/users#retrieve-a-user
/// Valid respones: 200, 400, 401, 500, 503
pub(in crate::service::fusionauth_client) async fn get_user_id_by_email(
    client: &AuthedClient,
    base_url: &str,
    email: &str,
) -> Result<String> {
    let url_email = urlencoding::encode(email);
    let res = client
        .client()
        .get(format!("{base_url}/api/user?email={url_email}"))
        .send()
        .await
        .map_err(|e| {
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    let status_code = res.status();
    match status_code {
        reqwest::StatusCode::OK => {
            tracing::trace!("user found");
            let body = res.json::<GetUserResponse>().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            Ok(body.user.id.into())
        }
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            if status_code == reqwest::StatusCode::NOT_FOUND {
                return Err(FusionAuthClientError::UserDoesNotExist);
            }

            tracing::error!(body=%body, status=%status_code, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}
