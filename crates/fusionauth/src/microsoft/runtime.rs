//! Microsoft OAuth operations used after the interactive account-linking flow.

use std::time::Duration;

use crate::FusionAuthClient;

/// Sanitized refresh failures. Provider response bodies and tokens are never errors.
#[derive(Debug, thiserror::Error)]
pub enum MicrosoftRuntimeError {
    /// The user must grant access again.
    #[error("Microsoft authorization requires reconnecting")]
    ReauthorizationRequired,
    /// The provider or network is temporarily unavailable.
    #[error("Microsoft authorization is temporarily unavailable")]
    Unavailable,
    /// Configuration, permissions, or an unexpected provider response prevented access.
    #[error("Microsoft authorization could not be completed")]
    InvalidResponse,
}

/// Refreshed delegated credentials. Intentionally does not implement Debug.
#[derive(serde::Deserialize)]
pub struct MicrosoftRefreshedTokens {
    /// Bearer token for Graph; never persist in plaintext or log it.
    pub access_token: String,
    /// Replacement refresh token, when Microsoft rotates it.
    pub refresh_token: Option<String>,
    /// Access-token lifetime in seconds.
    pub expires_in: u64,
    /// Granted scopes, which may differ from those originally requested.
    #[serde(default)]
    pub scope: String,
}

/// Mailbox identity verified by calling Graph with the exchanged access token.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrosoftMailboxIdentity {
    /// Stable Graph identity of the current user.
    pub id: String,
    /// Mailbox's primary SMTP address, when configured.
    pub mail: Option<String>,
    /// Directory login name; may only be used if it is a valid email address.
    pub user_principal_name: Option<String>,
}

pub(super) fn client() -> Result<reqwest::Client, MicrosoftRuntimeError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| MicrosoftRuntimeError::Unavailable)
}

impl FusionAuthClient {
    /// Refresh delegated access. The caller must serialize rotation and persist a
    /// replacement token before exposing the access token to other services.
    pub async fn refresh_microsoft_tokens(
        &self,
        refresh_token: &str,
    ) -> Result<MicrosoftRefreshedTokens, MicrosoftRuntimeError> {
        let credentials = self
            .microsoft_credentials()
            .map_err(|_| MicrosoftRuntimeError::InvalidResponse)?;
        let endpoint = super::oauth::endpoint_url(&credentials.tenant_id, "token")
            .map_err(|_| MicrosoftRuntimeError::InvalidResponse)?;
        refresh(
            &client()?,
            endpoint,
            &credentials.client_id,
            &credentials.client_secret,
            refresh_token,
        )
        .await
    }

    /// Resolve the mailbox from the same grant being linked, rather than trusting
    /// an unverified email hint supplied by the browser.
    pub async fn microsoft_mailbox_identity(
        &self,
        access_token: &str,
    ) -> Result<MicrosoftMailboxIdentity, MicrosoftRuntimeError> {
        let response = client()?
            .get("https://graph.microsoft.com/v1.0/me")
            .query(&[("$select", "id,mail,userPrincipalName")])
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| MicrosoftRuntimeError::Unavailable)?;
        if !response.status().is_success() {
            return Err(MicrosoftRuntimeError::InvalidResponse);
        }
        let identity: MicrosoftMailboxIdentity = response
            .json()
            .await
            .map_err(|_| MicrosoftRuntimeError::InvalidResponse)?;
        if identity.id.is_empty() {
            return Err(MicrosoftRuntimeError::InvalidResponse);
        }
        Ok(identity)
    }
}

async fn refresh(
    client: &reqwest::Client,
    endpoint: reqwest::Url,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<MicrosoftRefreshedTokens, MicrosoftRuntimeError> {
    let response = client
        .post(endpoint)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|_| MicrosoftRuntimeError::Unavailable)?;
    if !response.status().is_success() {
        if response.status().is_server_error() || response.status().as_u16() == 429 {
            return Err(MicrosoftRuntimeError::Unavailable);
        }
        #[derive(serde::Deserialize)]
        struct ErrorCode {
            error: String,
        }
        let code = response.json::<ErrorCode>().await.ok();
        return Err(match code.as_ref().map(|code| code.error.as_str()) {
            Some("invalid_grant" | "interaction_required" | "consent_required") => {
                MicrosoftRuntimeError::ReauthorizationRequired
            }
            _ => MicrosoftRuntimeError::InvalidResponse,
        });
    }
    let tokens: MicrosoftRefreshedTokens = response
        .json()
        .await
        .map_err(|_| MicrosoftRuntimeError::InvalidResponse)?;
    if tokens.access_token.is_empty()
        || tokens.expires_in == 0
        || tokens.refresh_token.as_ref().is_some_and(String::is_empty)
    {
        return Err(MicrosoftRuntimeError::InvalidResponse);
    }
    Ok(tokens)
}

#[cfg(test)]
mod test;
