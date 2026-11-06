use std::{borrow::Cow, net::IpAddr};

use crate::{AuthedClient, Result, error::FusionAuthClientError};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyEmailRequest<'a> {
    /// The verification id to validate the user's email
    pub verification_id: Cow<'a, str>,
}

/// Verifies a user's email in fusionauth
/// https://fusionauth.io/docs/apis/users#verify-a-users-email
/// Valid respones: 200, 400, 401, 404, 500, 503
pub(crate) async fn verify_email<'a>(
    client: &AuthedClient,
    base_url: &str,
    verify_email_request: VerifyEmailRequest<'a>,
    client_ip: IpAddr,
) -> Result<()> {
    let res = client
        .client()
        .post(format!("{base_url}/api/user/verify-email"))
        .header("X-Forwarded-For", &client_ip.to_string())
        .json(&verify_email_request)
        .send()
        .await
        .map_err(FusionAuthClientError::transport)?;

    let status_code = res.status();
    match status_code {
        reqwest::StatusCode::OK => {
            tracing::trace!("user email verified");
            Ok(())
        }
        _ => {
            let headers = res.headers().clone();
            let body = res.text().await.map_err(FusionAuthClientError::transport)?;

            if status_code == reqwest::StatusCode::BAD_REQUEST {
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

/// Resends a user's email verification in fusionauth
/// https://fusionauth.io/docs/apis/users#resend-verification-email
/// Valid respones: 200, 400, 401, 404, 500, 503
pub async fn resend_verify_email(
    client: &AuthedClient,
    base_url: &str,
    application_id: &str,
    email: &str,
) -> Result<()> {
    let url_encoded_email = urlencoding::encode(email);
    let res = client
        .client()
        .put(format!(
            "{base_url}/api/user/verify-email?applicationId={application_id}&email={url_encoded_email}"
        ))
        .send()
        .await
        .map_err(FusionAuthClientError::transport)?;

    let status_code = res.status();
    match status_code {
        reqwest::StatusCode::OK => {
            tracing::trace!("user email verified");
            Ok(())
        }
        _ => {
            let headers = res.headers().clone();
            let body = res.text().await.map_err(FusionAuthClientError::transport)?;

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
