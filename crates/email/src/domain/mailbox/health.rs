//! Authorized inbox health checks and provider-specific maintenance scheduling.

use super::*;
use email_api_client::domain::models::{AccessToken, TokenFreshness};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::link::{Link, UserProvider};

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
    fn refresh_gmail(&self, link: &Link) -> impl Future<Output = Result<(), MailboxError>> + Send;
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
        match self.gateway.acquire(&binding, freshness).await {
            Ok(_) if refresh => match binding.link.provider {
                UserProvider::Gmail => self.gateway.refresh_gmail(&binding.link).await,
                UserProvider::Outlook => self.repository.wake_streams(&binding).await,
            },
            Ok(_) => Ok(()),
            Err(EmailApiError::AuthRequired) => {
                // The queue item is terminal only after the credential owner
                // persisted its reconnect state. Infrastructure failures retry.
                match self.repository.binding(link_id).await? {
                    None => Ok(()),
                    Some(current)
                        if !current.link.is_sync_active
                            || current.link.needs_reauth
                            || current.grant_generation != binding.grant_generation
                            || current.sync_generation != binding.sync_generation =>
                    {
                        Ok(())
                    }
                    _ => Err(MailboxError::Persistence),
                }
            }
            Err(error) => Err(error.into()),
        }
    }
}
