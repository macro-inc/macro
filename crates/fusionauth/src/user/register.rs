use std::borrow::Cow;

use crate::{AuthedClient, Result, error::FusionAuthClientError};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Registration<'a> {
    /// The application id
    pub application_id: Cow<'a, str>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterUserRequest<'a> {
    /// The registration object
    pub registration: Registration<'a>,
}

/// Registers a user to a given application in fusionauth
/// https://fusionauth.io/docs/apis/registrations#create-a-user-registration-for-an-existing-user
/// Valid respones: 200, 400, 401, 404, 500, 503
pub(crate) async fn register_user<'a>(
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
        .map_err(FusionAuthClientError::transport)?;

    let status_code = res.status();
    match status_code {
        reqwest::StatusCode::OK => {
            tracing::trace!("user registered");
            Ok(())
        }
        _ => {
            let headers = res.headers().clone();
            let body = res.text().await.map_err(FusionAuthClientError::transport)?;

            if status_code == reqwest::StatusCode::BAD_REQUEST
                && body.contains("[duplicate]registration")
            {
                return Err(FusionAuthClientError::UserAlreadyRegistered);
            }

            if status_code == reqwest::StatusCode::NOT_FOUND {
                return Err(FusionAuthClientError::UserDoesNotExist);
            }

            Err(FusionAuthClientError::unexpected(
                status_code,
                &headers,
                body,
            ))
        }
    }
}
