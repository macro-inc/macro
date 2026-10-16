//! Mailbox health is part of credential acquisition, so background sync and
//! interactive requests observe the same reconnect state.

use email_api_client::domain::{
    models::{AccessToken, MailboxAccess, TokenError, TokenFreshness},
    ports::MailboxTokenSource,
};
use std::future::Future;

#[derive(Debug, Clone)]
pub enum CredentialHealth {
    Available(Vec<String>),
    ReauthorizationRequired,
}

pub trait MailboxCredentialHealthRepository: Send + Sync + 'static {
    /// Persist the transition and its notification atomically, only if this
    /// exact grant still owns the active mailbox. A stale binding is an error.
    fn record(
        &self,
        mailbox: MailboxAccess,
        health: CredentialHealth,
    ) -> impl Future<Output = Result<(), TokenError>> + Send;
}
pub trait MailboxCredentialGateway: Send + Sync + 'static {
    fn acquire(
        &self,
        mailbox: MailboxAccess,
        freshness: TokenFreshness,
    ) -> impl Future<Output = Result<MailboxCredentialToken, TokenError>> + Send;
}
pub struct MailboxCredentialToken {
    pub token: AccessToken,
    pub scopes: Vec<String>,
}
#[derive(Clone)]
pub struct MailboxCredentials<R, G> {
    repository: R,
    gateway: G,
}
impl<R, G> MailboxCredentials<R, G> {
    pub fn new(repository: R, gateway: G) -> Self {
        Self {
            repository,
            gateway,
        }
    }
}
impl<R: MailboxCredentialHealthRepository, G: MailboxCredentialGateway> MailboxTokenSource
    for MailboxCredentials<R, G>
{
    async fn access_token(
        &self,
        mailbox: MailboxAccess,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        let result = self.gateway.acquire(mailbox, freshness).await;
        match &result {
            Ok(grant) => {
                self.repository
                    .record(mailbox, CredentialHealth::Available(grant.scopes.clone()))
                    .await?
            }
            Err(TokenError::ReauthRequired) => {
                self.repository
                    .record(mailbox, CredentialHealth::ReauthorizationRequired)
                    .await?
            }
            // Busy, quota and transport errors do not revoke a working grant.
            _ => {}
        }
        result.map(|grant| grant.token)
    }
}
