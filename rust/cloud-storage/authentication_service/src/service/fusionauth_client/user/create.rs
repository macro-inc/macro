use std::borrow::Cow;

use crate::service::fusionauth_client::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct User<'a> {
    /// The email address of the user
    pub email: Cow<'a, str>,
    /// The password of the user.
    /// This is mandatory in fusionauth but we do not use it. As such, it's randomly generated at
    /// creation time and thrown away immediately.
    pub password: Cow<'a, str>,
    /// The username of the user.
    pub username: Option<Cow<'a, str>>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(in crate::service::fusionauth_client) struct CreateUserRequest<'a> {
    /// The fusionauth application id
    pub application_id: Cow<'a, str>,
    /// Whether to skip verification of a user
    /// Defaults to false
    pub skip_verification: bool,
    /// The user to create
    pub user: User<'a>,
}

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
pub(in crate::service::fusionauth_client) struct CreateUserResponse<'a> {
    /// The user
    pub user: UserResponse<'a>,
}

/// Creates a user in fusionauth
/// https://fusionauth.io/docs/apis/users#create-a-user
/// Valid respones: 200, 400, 401, 500, 503, 504
pub(in crate::service::fusionauth_client) async fn create_user(
    client: &AuthedClient,
    base_url: &str,
    request: CreateUserRequest<'_>,
) -> Result<String> {
    let res = client
        .client()
        .post(format!("{base_url}/api/user"))
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
            tracing::trace!("user created");
            let body = res.json::<CreateUserResponse>().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            Ok(body.user.id.into())
        }
        reqwest::StatusCode::BAD_REQUEST => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            if body.contains("[duplicate]") {
                Err(FusionAuthClientError::UserAlreadyExists)
            } else {
                tracing::error!(body=%body, "unexpected response from fusionauth");
                Err(FusionAuthClientError::Generic(GenericErrorResponse {
                    message: body,
                }))
            }
        }
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            if body.contains("[duplicate]user.email") {
                tracing::error!("user already exists");
                return Err(FusionAuthClientError::UserAlreadyExists);
            }

            tracing::error!(body=%body, "unexpected response from fusionauth");

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: body,
            }))
        }
    }
}
