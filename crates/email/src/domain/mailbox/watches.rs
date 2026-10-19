//! Push notifications are authenticated hints for the durable sync journal.

use super::*;
use chrono::{DateTime, Duration, Utc};
use email_api_client::domain::models::{MailboxSubscription, MailboxWatchDetails};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub struct WatchLease {
    pub mailbox: MailboxKey,
    pub lease_id: Uuid,
    pub revision: i64,
}
pub struct WatchAttempt {
    pub id: Uuid,
    pub generation: i64,
    pub provider_id: Option<ProviderId>,
    pub verifier: Vec<u8>,
    pub expires_at: DateTime<Utc>,
}
pub enum WatchHint {
    Changed,
    Missed,
    Removed,
    Reauthorize,
}
pub struct WatchNotification {
    pub subscription_id: String,
    pub client_state: String,
    pub hint: WatchHint,
}

pub trait MailboxWatchRepository: Send + Sync + 'static {
    fn claim_watch(
        &self,
        lease: Uuid,
    ) -> impl Future<Output = Result<Option<WatchLease>, MailboxError>> + Send;
    fn renew_watch_lease(
        &self,
        lease: &WatchLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn watch_attempts(
        &self,
        lease: &WatchLease,
    ) -> impl Future<Output = Result<Vec<WatchAttempt>, MailboxError>> + Send;
    fn reserve_watch(
        &self,
        lease: &WatchLease,
        id: Uuid,
        verifier: &[u8],
        expires: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn bind_watch(
        &self,
        lease: &WatchLease,
        id: Uuid,
        subscription: &MailboxSubscription,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn forget_watch(
        &self,
        lease: &WatchLease,
        id: Uuid,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn release_watch(
        &self,
        lease: &WatchLease,
        delay: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn notification_binding(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<WatchAttempt>, MailboxError>> + Send;
    fn accept_notification(
        &self,
        id: Uuid,
        expected: &WatchAttempt,
        subscription: &str,
        hint: &WatchHint,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}
pub trait MailboxWatchGateway: Send + Sync + 'static {
    fn watches(
        &self,
        key: MailboxKey,
    ) -> impl Future<Output = Result<Vec<MailboxWatchDetails>, EmailApiError>> + Send;
    fn create_watch(
        &self,
        key: MailboxKey,
        url: &str,
        state: &str,
        expires: DateTime<Utc>,
    ) -> impl Future<Output = Result<MailboxSubscription, EmailApiError>> + Send;
    fn renew_watch(
        &self,
        key: MailboxKey,
        id: &ProviderId,
        expires: DateTime<Utc>,
    ) -> impl Future<Output = Result<MailboxSubscription, EmailApiError>> + Send;
    fn remove_watch(
        &self,
        key: MailboxKey,
        id: &ProviderId,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}
pub struct MailboxWatchNotifications<R>(pub R);
impl<R: MailboxWatchRepository> MailboxWatchNotifications<R> {
    pub async fn receive(
        &self,
        id: Uuid,
        notifications: Vec<WatchNotification>,
    ) -> Result<(), MailboxError> {
        let Some(binding) = self.0.notification_binding(id).await? else {
            return Ok(());
        };
        for notification in notifications {
            let hash = Sha256::digest(notification.client_state.as_bytes());
            if hash[..].ct_eq(&binding.verifier).unwrap_u8() != 1
                || binding
                    .provider_id
                    .as_ref()
                    .is_some_and(|p| p.as_str() != notification.subscription_id)
            {
                continue;
            }
            self.0
                .accept_notification(
                    id,
                    &binding,
                    &notification.subscription_id,
                    &notification.hint,
                )
                .await?;
        }
        Ok(())
    }
}
pub struct MailboxWatchService<R, G> {
    repository: R,
    gateway: G,
    callback_base: String,
}
impl<R, G> MailboxWatchService<R, G> {
    pub fn new(repository: R, gateway: G, callback_base: String) -> Self {
        Self {
            repository,
            gateway,
            callback_base: callback_base.trim_end_matches('/').to_owned(),
        }
    }
    fn callback(&self, id: Uuid) -> String {
        format!("{}/outlook/webhook/{id}", self.callback_base)
    }
}
impl<R: MailboxWatchRepository, G: MailboxWatchGateway> MailboxWatchService<R, G> {
    pub async fn execute_once(&self) -> Result<bool, MailboxError> {
        // A local development stack requires a reachable HTTPS tunnel. Polling
        // remains active while that callback address is not configured.
        if !self.callback_base.starts_with("https://") {
            return Ok(false);
        }
        let Some(lease) = self.repository.claim_watch(Uuid::new_v4()).await? else {
            return Ok(false);
        };
        let result = super::maintain_lease(self.execute(&lease), || {
            self.repository.renew_watch_lease(&lease)
        })
        .await;
        let delay = match &result {
            Ok(()) => 12 * 60 * 60,
            Err(MailboxError::Provider(e)) => super::retry_seconds(e),
            _ => 30,
        };
        self.repository.release_watch(&lease, delay).await?;
        result.map(|()| true)
    }
    async fn execute(&self, lease: &WatchLease) -> Result<(), MailboxError> {
        let remote = self.gateway.watches(lease.mailbox).await?;
        let attempts = self.repository.watch_attempts(lease).await?;
        let mut keep = None;
        for attempt in attempts {
            let callback = self.callback(attempt.id);
            let found = remote.iter().find(|r| {
                r.notification_url == callback
                    && r.lifecycle_url.as_deref() == Some(callback.as_str())
            });
            let Some(found) = found else {
                // Retain unknown attempts until their requested lifetime ends;
                // a timed-out create may still appear on the next listing.
                if attempt.provider_id.is_some() || attempt.expires_at < Utc::now() {
                    self.repository.forget_watch(lease, attempt.id).await?;
                }
                continue;
            };
            self.repository
                .bind_watch(lease, attempt.id, &found.subscription)
                .await?;
            if attempt.generation == lease.mailbox.sync_generation
                && keep.is_none()
                && found.subscription.expires_at > Utc::now()
            {
                keep = Some((attempt.id, found.subscription.id.clone()));
            } else {
                self.repository.renew_watch_lease(lease).await?;
                self.gateway
                    .remove_watch(lease.mailbox, &found.subscription.id)
                    .await?;
                self.repository.forget_watch(lease, attempt.id).await?;
            }
        }
        let expires = Utc::now() + Duration::days(3);
        if let Some((id, provider_id)) = keep {
            match self
                .gateway
                .renew_watch(lease.mailbox, &provider_id, expires)
                .await
            {
                Ok(subscription) => {
                    return self.repository.bind_watch(lease, id, &subscription).await;
                }
                Err(EmailApiError::NotFound) => self.repository.forget_watch(lease, id).await?,
                Err(error) => return Err(error.into()),
            }
        }
        let id = Uuid::new_v4();
        let state = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let verifier = Sha256::digest(state.as_bytes());
        self.repository
            .reserve_watch(lease, id, &verifier, expires)
            .await?;
        let subscription = self
            .gateway
            .create_watch(lease.mailbox, &self.callback(id), &state, expires)
            .await?;
        self.repository.bind_watch(lease, id, &subscription).await
    }
}
