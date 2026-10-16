//! Gmail sender discovery, with a short-lived cache for draft autosaves.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use gmail_client::GmailClient;
use macro_user_id::email::EmailStr;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::domain::{
    models::{EmailErr, Link},
    ports::GmailTokenProvider,
    senders::{EmailSenderProvider, SendAsAddress, SendAsFuture},
};

#[cfg(test)]
mod test;

const CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(15);

/// Gmail adapter. Token lookup uses the selected inbox's grant, including when
/// the caller accesses it through delegation rather than owning it.
pub struct GmailSenderProvider<T> {
    client: GmailClient,
    tokens: T,
    cached: Mutex<HashMap<Uuid, (Instant, Vec<SendAsAddress>)>>,
}

impl<T: GmailTokenProvider> GmailSenderProvider<T> {
    /// Construct at the composition root with the shared Gmail/token clients.
    pub fn new(client: GmailClient, tokens: T) -> Self {
        Self {
            client,
            tokens,
            cached: Mutex::new(HashMap::new()),
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn fetch(&self, link: &Link) -> Result<Vec<SendAsAddress>, EmailErr> {
        let token = self.tokens.fetch_gmail_access_token(link).await?;
        let mut result = self.client.list_send_as(&token).await;
        if result
            .as_ref()
            .err()
            .and_then(|error| error.status())
            .is_some_and(|status| status.as_u16() == 401)
        {
            let token = self.tokens.fetch_gmail_access_token_no_cache(link).await?;
            result = self.client.list_send_as(&token).await;
        }
        let response = result.map_err(|error| {
            tracing::error!(error = ?error, link_id = %link.id, "failed to load Gmail senders");
            if error
                .status()
                .is_some_and(|status| matches!(status.as_u16(), 401 | 403))
            {
                EmailErr::SendAsPermissionRequired
            } else {
                EmailErr::ProviderErr(error.into())
            }
        })?;
        Ok(sender_addresses(link, response.send_as.unwrap_or_default()))
    }
}

fn sender_addresses(
    link: &Link,
    aliases: Vec<models_email::gmail::SendAsAlias>,
) -> Vec<SendAsAddress> {
    aliases
        .into_iter()
        .filter_map(|alias| {
            let Ok(email_address) = EmailStr::try_from(alias.send_as_email) else {
                // Do not log the invalid address: provider data may contain PII.
                tracing::warn!(link_id = %link.id, "skipping malformed Gmail send-as address");
                return None;
            };
            let verified = alias.verification_status
                == Some(models_email::gmail::SendAsVerificationStatus::Accepted)
                || email_address
                    .0
                    .as_ref()
                    .eq_ignore_ascii_case(link.email_address.0.as_ref());
            Some(SendAsAddress {
                email_address,
                display_name: alias.display_name,
                verified,
            })
        })
        .collect()
}

impl<T: GmailTokenProvider> EmailSenderProvider for GmailSenderProvider<T> {
    fn send_as<'a>(&'a self, link: &'a Link, refresh: bool) -> SendAsFuture<'a> {
        Box::pin(async move {
            if !refresh
                && let Some((at, senders)) = self.cached.lock().await.get(&link.id)
                && at.elapsed() < CACHE_TTL
            {
                return Ok(senders.clone());
            }
            // Cached facts are never a fallback when delivery validation fails.
            // The primary address remains usable without this lookup.
            let senders = tokio::time::timeout(LOOKUP_TIMEOUT, self.fetch(link))
                .await
                .map_err(|_| EmailErr::SendAsUnavailable)??;
            let mut cache = self.cached.lock().await;
            cache.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
            cache.insert(link.id, (Instant::now(), senders.clone()));
            Ok(senders)
        })
    }
}
