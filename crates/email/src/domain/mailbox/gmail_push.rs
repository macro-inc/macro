//! Authentication and intake of Gmail push notifications.

mod authentication;
mod ports;

#[cfg(test)]
mod test;

pub use authentication::GooglePushAuthentication;
pub use ports::*;

use super::catalog::InboxAddressLookup;
use models_email::service::link::UserProvider;

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum PushAuthenticationError {
    #[error("unable to get google public keys")]
    PublicKeysUnavailable,
    #[error("Missing Authorization bearer token")]
    MissingBearerToken,
    #[error("Authentication failed and couldn't refresh verification keys")]
    RefreshFailed,
    #[error("Invalid authentication token")]
    InvalidToken,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum GmailPushError {
    #[error(transparent)]
    Authentication(#[from] PushAuthenticationError),
    #[error("unable to enqueue gmail notification")]
    InboxLookupFailed,
    #[error("unable to enqueue gmail notification")]
    EnqueueFailed,
}

pub struct GmailPushService<A, R, Q> {
    pub authentication: A,
    /// Supplied by composition from the host's compile-time feature.
    pub require_authentication: bool,
    pub inboxes: R,
    pub queue: Q,
}

impl<A: PushAuthentication, R: InboxAddressLookup, Q: GmailPushQueue> GmailPushService<A, R, Q> {
    pub async fn receive(
        &self,
        email_address: &str,
        history_id: u64,
        authorization: Option<&str>,
    ) -> Result<(), GmailPushError> {
        if self.require_authentication {
            self.authentication.authenticate(authorization).await?;
        }

        let link = self
            .inboxes
            .by_provider_email(email_address, UserProvider::Gmail)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to enqueue gmail notification");
                GmailPushError::InboxLookupFailed
            })?;

        if let Some(link_id) = link {
            self.queue.notify(link_id, history_id).await.map_err(|e| {
                tracing::error!(error=?e, "unable to enqueue gmail notification");
                GmailPushError::EnqueueFailed
            })?;
        }
        Ok(())
    }
}
