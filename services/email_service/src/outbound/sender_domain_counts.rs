//! Storage and provider adapters for counting recent mail per sender domain.

use chrono::{DateTime, Utc};
use email::domain::mailbox::{MailboxError, MailboxKey};
use email::domain::sender_domain_counts::{
    SenderCountMailbox, SenderDomainCounter, SenderDomainMailboxes,
};
use email_api_client::domain::{
    models::{EmailApiError, MailboxAccess, SenderDomain},
    ports::{
        MailboxSenderActivityClient, MailboxTokenSource, ProviderRateLimiter,
        ScopedMailboxRepository,
    },
    service::mailbox::MailboxApiService,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::link::{Link, UserProvider};
use uuid::Uuid;

use super::email_api::GmailApi;
use super::inbox_health::link_binding;

pub struct PgSenderMailboxes(pub sqlx::PgPool);

impl SenderDomainMailboxes for PgSenderMailboxes {
    async fn accessible_inboxes(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Link>, MailboxError> {
        email_db_client::links::get::fetch_inboxes_for_macro_id(&self.0, actor.as_ref())
            .await
            .map_err(|_| MailboxError::Persistence)
    }

    async fn binding(&self, link_id: Uuid) -> Result<Option<MailboxKey>, MailboxError> {
        Ok(link_binding(&self.0, link_id)
            .await?
            .map(|binding| MailboxKey {
                link_id: binding.link.id,
                sync_generation: binding.sync_generation,
                grant_generation: binding.grant_generation,
            }))
    }
}

/// Gmail queries take a live-budget permit from the Gmail request gate; Graph
/// queries go through the Outlook transport's mailbox gate.
#[derive(Clone)]
pub struct ProviderSenderDomainCounter<R, T, L> {
    pub gmail: GmailApi,
    pub outlook: MailboxApiService<R, T, L>,
}

impl<R, T, L> SenderDomainCounter for ProviderSenderDomainCounter<R, T, L>
where
    R: MailboxSenderActivityClient + ScopedMailboxRepository,
    T: MailboxTokenSource + Clone,
    L: ProviderRateLimiter + Clone,
{
    async fn count(
        &self,
        mailbox: SenderCountMailbox,
        domain: &SenderDomain,
        since: DateTime<Utc>,
    ) -> Result<u32, EmailApiError> {
        match mailbox.provider {
            UserProvider::Gmail => {
                self.gmail
                    .count_messages_from_domain(mailbox.key.link_id, domain, since)
                    .await
            }
            UserProvider::Outlook => {
                self.outlook
                    .count_messages_from_domain(
                        MailboxAccess {
                            link_id: mailbox.key.link_id,
                            sync_generation: mailbox.key.sync_generation,
                            grant_generation: mailbox.key.grant_generation,
                        },
                        domain,
                        since,
                    )
                    .await
            }
        }
    }
}
