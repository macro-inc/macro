use std::{collections::HashMap, time::Duration};

use crate::service::fusionauth_client::{
    Result, UnauthedClient,
    error::{FusionAuthClientError, GenericErrorResponse},
};
use base64::{
    Engine,
    engine::general_purpose::{self},
};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct GoogleTokenRequest {
    client_id: String,
    client_secret: String,
    refresh_token: String,
    grant_type: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct GoogleTokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub scope: String,
    pub token_type: String,
    pub id_token: String,
}

/// Refreshes a Google OAuth2 access token using a refresh token.
/// See https://developers.google.com/identity/protocols/oauth2/web-server#offline
pub(in crate::service::fusionauth_client) async fn refresh_google_token(
    client: &UnauthedClient,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<GoogleTokenResponse> {
    let token_request = GoogleTokenRequest {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
        refresh_token: refresh_token.to_string(),
        grant_type: "refresh_token".to_string(),
    };

    let res = client
        .client()
        .post("https://oauth2.googleapis.com/token")
        .json(&token_request)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to send google access token request");
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    match res.status() {
        reqwest::StatusCode::OK => {
            let response = res.json::<GoogleTokenResponse>().await.map_err(|e| {
                tracing::error!(error=?e, "unable to parse token response");
                FusionAuthClientError::Generic(GenericErrorResponse {
                    message: e.to_string(),
                })
            })?;

            tracing::debug!(
                expires_in=?response.expires_in,
                scope=?response.scope,
                token_type=?response.token_type,
                "successfully refreshed Google access token"
            );

            Ok(response)
        }
        status => {
            let error_text = res
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read error response".to_string());
            tracing::error!(
                status=?status,
                error=?error_text,
                "failed to refresh Google access token"
            );

            Err(FusionAuthClientError::Generic(GenericErrorResponse {
                message: format!(
                    "Google token refresh failed with status {}: {}",
                    status, error_text
                ),
            }))
        }
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct GoogleExchangeTokenResponse {
    pub refresh_token: String,
    pub id_token: String,
}

#[derive(Debug, serde::Serialize)]
struct TokenExchangeRequest {
    client_id: String,
    client_secret: String,
    code: String,
    grant_type: String,
    redirect_uri: String,
}

pub(in crate::service::fusionauth_client) async fn exchange_code_for_tokens(
    client: &UnauthedClient,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
) -> Result<GoogleExchangeTokenResponse> {
    let token_request = TokenExchangeRequest {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
        code: code.to_string(),
        grant_type: "authorization_code".to_string(),
        redirect_uri: redirect_uri.to_string(),
    };

    let response = client
        .client()
        .post("https://oauth2.googleapis.com/token")
        .form(&token_request)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to send google token request");
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

    let status = response.status();

    if !status.is_success() {
        let error_body = response.text().await.map_err(|e| {
            tracing::error!(error=?e, "failed to get error body");
            FusionAuthClientError::Generic(GenericErrorResponse {
                message: e.to_string(),
            })
        })?;

        tracing::error!(status=?status, body=?error_body, "token exchange failed");
        return Err(FusionAuthClientError::Generic(GenericErrorResponse {
            message: format!(
                "token exchange failed with status {}: {}",
                status, error_body
            ),
        }));
    }

    let token_response: GoogleExchangeTokenResponse = response.json().await.map_err(|e| {
        tracing::error!(error=?e, "failed to parse token response");
        FusionAuthClientError::Generic(GenericErrorResponse {
            message: e.to_string(),
        })
    })?;

    Ok(token_response)
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct GoogleUserInfo {
    pub sub: String, // Google user ID
    pub email: String,
    #[serde(flatten)]
    pub other: HashMap<String, serde_json::Value>,
}

pub(in crate::service::fusionauth_client) fn decode_google_id_token(
    id_token: &str,
) -> anyhow::Result<GoogleUserInfo> {
    // Split the JWT into its three parts
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        anyhow::bail!("invalid jwt format")
    }

    // The payload is the second part (index 1)
    let payload = parts[1];

    // Decode from base64
    let decoded_bytes = general_purpose::URL_SAFE_NO_PAD.decode(payload)?;
    let decoded_str = String::from_utf8(decoded_bytes)?;

    // Parse JSON into your struct
    let claims: GoogleUserInfo = serde_json::from_str(&decoded_str)?;

    Ok(claims)
}
