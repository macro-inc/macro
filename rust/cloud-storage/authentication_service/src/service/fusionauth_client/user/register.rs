use std::borrow::Cow;

use crate::service::fusionauth_client::{
    AuthedClient, Result,
    error::{FusionAuthClientError, GenericErrorResponse},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(in crate::service::fusionauth_client) struct Registration<'a> {
    /// The application id
    pub application_id: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(in crate::service::fusionauth_client) struct RegisterUserRequest<'a> {
    /// The registration object
    pub registration: Registration<'a>,
}

/// Registers a user to a given application in fusionauth
/// https://fusionauth.io/docs/apis/registrations#create-a-user-registration-for-an-existing-user
/// Valid respones: 200, 400, 401, 404, 500, 503
pub(in crate::service::fusionauth_client) async fn register_user<'a>(
    client: &AuthedClient,
    base_url: &str,
    user_id: &str,
    register_user_request: RegisterUserRequest<'a>,
) -> Result<()> {
    let url_user_id = urlencoding::encode(user_id);
    let res = client
        .client()
        .post(format!("{base_url}/api/user/registration/{url_user_id}"))
        .json(&register_user_request)
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
            tracing::trace!("user registered");
            Ok(())
        }
        _ => {
            let body = res.text().await.map_err(|e| {
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            if status_code == reqwest::StatusCode::BAD_REQUEST
                && body.contains("[duplicate]registration")
            {
                return Err(FusionAuthClientError::UserAlreadyRegistered);
            }

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
