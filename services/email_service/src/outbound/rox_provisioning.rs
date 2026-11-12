//! Client for the existing Rox mail-host provisioning contract.
//!
//! The caller must supply a real Rox broker access token. This repository has
//! no such token source yet, so production initialization intentionally stops
//! at the domain model rather than inventing one.

use zeroize::Zeroizing;

#[cfg(test)]
mod test;

/// The existing mail-host endpoint. Tests inject a loopback URL instead.
pub const ROX_MAIL_PROVISION_URL: &str = "https://mail.rox.one/api/provision";

/// A mailbox returned by the Rox mail host. The one-time password is held only
/// for a downstream JMAP handshake and is zeroized when this value is dropped.
pub struct ProvisionedRoxMailbox {
    /// The mailbox address.
    pub address: String,
    /// The JMAP username.
    pub username: String,
    /// The JMAP origin.
    pub jmap_url: String,
    password: Zeroizing<String>,
}

impl ProvisionedRoxMailbox {
    /// Exposes the one-time secret only to the immediate JMAP authentication
    /// adapter. It must never be persisted, logged, or serialized.
    pub fn password(&self) -> &str {
        &self.password
    }
}

/// A sanitized provisioning failure. Provider response bodies are never
/// included because they may reflect credentials or account details.
#[derive(Debug, thiserror::Error)]
pub enum RoxProvisioningError {
    /// The mail host rejected the broker token.
    #[error("Rox broker token was rejected")]
    Unauthorized,
    /// The requested handle belongs to another account.
    #[error("mailbox handle is already taken")]
    HandleTaken,
    /// The host was unreachable or returned an unsuccessful response.
    #[error("Rox mailbox provisioning is unavailable")]
    Unavailable,
    /// The successful response did not satisfy the provisioning contract.
    #[error("Rox mailbox provisioning returned an invalid response")]
    InvalidResponse,
}

/// Server-side HTTP adapter for `POST /api/provision`.
#[derive(Clone)]
pub struct RoxMailboxProvisioner {
    http: reqwest::Client,
    endpoint: reqwest::Url,
}

impl RoxMailboxProvisioner {
    /// Creates an adapter for a specific endpoint. Production uses
    /// [`ROX_MAIL_PROVISION_URL`]; tests use their own loopback server.
    pub fn new(endpoint: reqwest::Url) -> Self {
        Self {
            http: reqwest::Client::new(),
            endpoint,
        }
    }

    /// Creates an adapter for the existing public mail host without supplying
    /// or assuming a broker token.
    pub fn production() -> Result<Self, RoxProvisioningError> {
        let endpoint = reqwest::Url::parse(ROX_MAIL_PROVISION_URL)
            .map_err(|_| RoxProvisioningError::Unavailable)?;
        Ok(Self::new(endpoint))
    }

    /// Provisions the mailbox belonging to the Rox broker access token.
    pub async fn provision(
        &self,
        access_token: &str,
    ) -> Result<ProvisionedRoxMailbox, RoxProvisioningError> {
        let response = self
            .http
            .post(self.endpoint.clone())
            .bearer_auth(access_token)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| RoxProvisioningError::Unavailable)?;
        match response.status() {
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
                return Err(RoxProvisioningError::Unauthorized);
            }
            reqwest::StatusCode::CONFLICT => return Err(RoxProvisioningError::HandleTaken),
            status if !status.is_success() => return Err(RoxProvisioningError::Unavailable),
            _ => {}
        }

        let mut payload = response
            .json::<ProvisionResponse>()
            .await
            .map_err(|_| RoxProvisioningError::InvalidResponse)?;
        let password = Zeroizing::new(std::mem::take(&mut payload.password));
        if payload.address.is_empty()
            || payload.username.is_empty()
            || payload.jmap_url.is_empty()
            || password.is_empty()
        {
            return Err(RoxProvisioningError::InvalidResponse);
        }

        Ok(ProvisionedRoxMailbox {
            address: payload.address,
            username: payload.username,
            jmap_url: payload.jmap_url,
            password,
        })
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionResponse {
    address: String,
    username: String,
    password: String,
    jmap_url: String,
}
