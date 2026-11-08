//! Authorized inbox health checks and provider-specific maintenance scheduling.

use super::*;
use email_api_client_core::models::{AccessToken, TokenFreshness};
use email_types::service::link::{Link, UserProvider};
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

pub struct InboxHealthBinding {
    pub link: Link,
    pub grant_generation: i64,
    pub sync_generation: i64,
}
pub trait InboxHealthRepository: Send + Sync + 'static {
    fn accessible(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Link>, MailboxError>> + Send;
    fn binding(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<Option<InboxHealthBinding>, MailboxError>> + Send;
    fn begin_probe(&self, link: Uuid) -> impl Future<Output = bool> + Send;
    fn enqueue_probe(&self, link: Uuid) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn wake_streams(
        &self,
        binding: &InboxHealthBinding,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}
pub trait InboxHealthGateway: Send + Sync + 'static {
    fn acquire(
        &self,
        binding: &InboxHealthBinding,
        freshness: TokenFreshness,
    ) -> impl Future<Output = Result<AccessToken, EmailApiError>> + Send;
    fn renew_gmail_watch(
        &self,
        link: &Link,
        freshness: TokenFreshness,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
    fn sync_gmail_contacts(
        &self,
        link: &Link,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}
pub struct InboxHealthService<R, G> {
    repository: R,
    gateway: G,
}
impl<R, G> InboxHealthService<R, G> {
    pub fn new(repository: R, gateway: G) -> Self {
        Self {
            repository,
            gateway,
        }
    }
}
impl<R: InboxHealthRepository, G: InboxHealthGateway> InboxHealthService<R, G> {
    pub async fn request(&self, actor: &MacroUserIdStr<'_>) -> Result<(), MailboxError> {
        for link in self.repository.accessible(actor).await? {
            if link.is_sync_active && self.repository.begin_probe(link.id).await {
                self.repository.enqueue_probe(link.id).await?;
            }
        }
        Ok(())
    }
    pub async fn probe(&self, link_id: Uuid, refresh: bool) -> Result<(), MailboxError> {
        let Some(binding) = self
            .repository
            .binding(link_id)
            .await?
            .filter(|binding| binding.link.is_sync_active)
        else {
            return Ok(());
        };
        let freshness = if refresh {
            TokenFreshness::Cached
        } else {
            TokenFreshness::Fresh
        };
        let result = match self.gateway.acquire(&binding, freshness).await {
            Ok(_) if refresh => self.refresh(&binding).await,
            Ok(_) => Ok(()),
            Err(error) => Err(error.into()),
        };
        // An error requeues the probe, so only failures that may succeed later
        // are returned.
        match result {
            Err(MailboxError::Provider(EmailApiError::AuthRequired)) => {
                self.settle_auth_required(&binding).await
            }
            Err(MailboxError::Provider(error)) if !error.is_transient() => {
                tracing::warn!(%link_id, %error, "Inbox health probe failed permanently");
                Ok(())
            }
            result => result,
        }
    }

    async fn refresh(&self, binding: &InboxHealthBinding) -> Result<(), MailboxError> {
        match binding.link.provider {
            UserProvider::Gmail => {
                self.renew_gmail_watch(&binding.link).await?;
                self.gateway.sync_gmail_contacts(&binding.link).await
            }
            UserProvider::Outlook => self.repository.wake_streams(binding).await,
        }
    }

    /// Renews the Gmail watch, then lets contacts sync even when Gmail rejects
    /// the watch for good. Only a revoked grant or a transient failure stops
    /// the refresh.
    async fn renew_gmail_watch(&self, link: &Link) -> Result<(), EmailApiError> {
        let result = match self
            .gateway
            .renew_gmail_watch(link, TokenFreshness::Cached)
            .await
        {
            // A cached token can outlive its grant. Only a fresh fetch lets the
            // token source mark the link for reauthorization.
            Err(EmailApiError::AuthRequired) => {
                self.gateway
                    .renew_gmail_watch(link, TokenFreshness::Fresh)
                    .await
            }
            result => result,
        };
        match result {
            Err(error) if error != EmailApiError::AuthRequired && !error.is_transient() => {
                tracing::warn!(link_id = %link.id, %error, "Gmail watch renewal was rejected");
                Ok(())
            }
            result => result,
        }
    }

    /// The probe is terminal only after the credential owner persisted the
    /// link's reconnect state. Infrastructure failures retry.
    async fn settle_auth_required(&self, probed: &InboxHealthBinding) -> Result<(), MailboxError> {
        match self.repository.binding(probed.link.id).await? {
            None => Ok(()),
            Some(current)
                if !current.link.is_sync_active
                    || current.grant_generation != probed.grant_generation
                    || current.sync_generation != probed.sync_generation =>
            {
                Ok(())
            }
            Some(current) if current.link.needs_reauth => {
                tracing::info!(link_id = %probed.link.id, "Inbox needs reauthorization; skipping health probe");
                Ok(())
            }
            Some(_) => Err(MailboxError::Persistence),
        }
    }
}
