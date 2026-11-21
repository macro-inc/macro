//! Which registered client an access token was issued to.
//!
//! The upstream access token names the user but not the client, so the broker
//! records the client at every token exchange and the MCP route reads it back
//! to label what the client writes ("Claude Code · Agent"). The record goes
//! through the same binding store as refresh tokens, under a digest no refresh
//! token can produce, so every store backend answers both without a new port.

#[cfg(test)]
mod test;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::sync::Arc;

use super::{
    client_name::ClientName,
    models::RefreshTokenBinding,
    ports::{ClientRegistrationStore, RefreshTokenBindingStore},
};

/// Prefixed to an access token before hashing, so its digest can never match
/// a refresh token's and be honored by the refresh exchange.
const ACCESS_TOKEN_DIGEST_DOMAIN: &str = "mcp_auth_proxy:access_token:";

/// Records and reads the client behind each access token the broker issues.
#[derive(Clone)]
pub struct AccessTokenClients {
    bindings: Arc<dyn RefreshTokenBindingStore>,
    clients: Arc<dyn ClientRegistrationStore>,
}

impl AccessTokenClients {
    /// Build over the broker's binding and registration stores.
    pub fn new(
        bindings: Arc<dyn RefreshTokenBindingStore>,
        clients: Arc<dyn ClientRegistrationStore>,
    ) -> Self {
        Self { bindings, clients }
    }

    /// Record that `access_token` was issued under `binding`.
    pub async fn bind(
        &self,
        access_token: &str,
        binding: &RefreshTokenBinding,
    ) -> anyhow::Result<()> {
        self.bindings
            .bind(&access_token_digest(access_token), binding)
            .await
    }

    /// The client `access_token` was issued to: its opaque id, and its
    /// registered name as a label. `None` when the broker never recorded one
    /// (a token issued before it did). The name is `None` when the client's
    /// registration has lapsed, or when the stored name fails
    /// [`ClientName::parse`] (registered before it was enforced).
    pub async fn issued_client(&self, access_token: &str) -> anyhow::Result<Option<IssuedClient>> {
        let Some(binding) = self
            .bindings
            .binding(&access_token_digest(access_token))
            .await?
        else {
            return Ok(None);
        };
        let name = self
            .clients
            .find_client(&binding.client_id)
            .await?
            .and_then(|client| client_label(&client.client_name));
        Ok(Some(IssuedClient {
            id: binding.client_id,
            name,
        }))
    }
}

/// The registered client an access token was issued to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IssuedClient {
    /// The id the broker minted at registration; opaque, safe to trace.
    pub id: String,
    /// The client's registered name, as a label.
    pub name: Option<String>,
}

/// A registered client name as the label on what the client writes, or
/// `None` when it fails [`ClientName::parse`].
pub(crate) fn client_label(client_name: &str) -> Option<String> {
    ClientName::parse(client_name)
        .ok()
        .flatten()
        .map(String::from)
}

fn access_token_digest(access_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(ACCESS_TOKEN_DIGEST_DOMAIN.as_bytes());
    hasher.update(access_token.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}
