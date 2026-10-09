use email::domain::mailbox::{MailboxError, health::*};
use email_api_client::domain::{
    models::{AccessToken, EmailApiError, MailboxAccess, TokenError, TokenFreshness},
    ports::MailboxTokenSource,
};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{
    link::{Link, UserProvider},
    pubsub::LinkManagerMessage,
};
use uuid::Uuid;

pub struct PgInboxHealth {
    pub db: sqlx::PgPool,
    pub redis: crate::util::redis::RedisClient,
    pub queue: sqs_client::SQS,
}
impl InboxHealthRepository for PgInboxHealth {
    async fn accessible(&self, actor: &MacroUserIdStr<'_>) -> Result<Vec<Link>, MailboxError> {
        email_db_client::links::get::fetch_inboxes_for_macro_id(&self.db, actor.as_ref())
            .await
            .map_err(|_| MailboxError::Persistence)
    }
    async fn binding(&self, link_id: Uuid) -> Result<Option<InboxHealthBinding>, MailboxError> {
        let Some(row) = sqlx::query!(r#"SELECT id,macro_id,fusionauth_user_id,email_address,provider::text AS "provider!",
            is_sync_active,is_primary,needs_reauth,last_sync_error_at,created_at,updated_at,sync_generation,grant_generation
            FROM email_links WHERE id=$1"#,link_id).fetch_optional(&self.db).await.map_err(|_|MailboxError::Persistence)? else {return Ok(None)};
        let link = Link {
            id: row.id,
            macro_id: MacroUserIdStr::try_from(row.macro_id)
                .map_err(|_| MailboxError::Persistence)?,
            fusionauth_user_id: row.fusionauth_user_id,
            email_address: macro_user_id::email::EmailStr::try_from(row.email_address)
                .map_err(|_| MailboxError::Persistence)?,
            provider: match row.provider.as_str() {
                "GMAIL" => UserProvider::Gmail,
                "OUTLOOK" => UserProvider::Outlook,
                _ => return Err(MailboxError::Persistence),
            },
            is_sync_active: row.is_sync_active,
            is_primary: row.is_primary,
            needs_reauth: row.needs_reauth,
            last_sync_error_at: row.last_sync_error_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
        Ok(Some(InboxHealthBinding {
            link,
            grant_generation: row.grant_generation,
            sync_generation: row.sync_generation,
        }))
    }
    async fn begin_probe(&self, link: Uuid) -> bool {
        self.redis
            .try_begin_health_probe(link, std::time::Duration::from_secs(15 * 60))
            .await
    }
    async fn enqueue_probe(&self, link: Uuid) -> Result<(), MailboxError> {
        let result = self
            .queue
            .enqueue_link_manager_notification(LinkManagerMessage::HealthCheck { link_id: link })
            .await;
        if result.is_err() {
            self.redis.cancel_health_probe(link).await;
        }
        result.map_err(|_| MailboxError::Persistence)
    }
    async fn wake_streams(&self, binding: &InboxHealthBinding) -> Result<(), MailboxError> {
        sqlx::query!(r#"UPDATE email_sync_streams s SET next_run_at = now() FROM email_links l WHERE l.id = $1
            AND l.grant_generation = $2 AND l.sync_generation = $3 AND l.is_sync_active AND s.link_id = l.id AND s.generation = l.sync_generation"#,binding.link.id,binding.grant_generation,binding.sync_generation)
            .execute(&self.db).await.map_err(|_|MailboxError::Persistence)?;
        Ok(())
    }
}

pub struct ProviderInboxHealth<T, B> {
    pub gmail: crate::outbound::email_api::GmailApi,
    pub outlook: T,
    pub db: sqlx::PgPool,
    pub queue: sqs_client::SQS,
    pub broker: B,
}
impl<T: MailboxTokenSource, B: MacroEventBroker> InboxHealthGateway for ProviderInboxHealth<T, B> {
    async fn acquire(
        &self,
        binding: &InboxHealthBinding,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, EmailApiError> {
        match binding.link.provider {
            UserProvider::Gmail => {
                self.gmail
                    .get_access_token(binding.link.id, freshness)
                    .await
            }
            UserProvider::Outlook => self
                .outlook
                .access_token(
                    MailboxAccess {
                        link_id: binding.link.id,
                        grant_generation: binding.grant_generation,
                        sync_generation: binding.sync_generation,
                    },
                    freshness,
                )
                .await
                .map_err(|error| match error {
                    TokenError::ReauthRequired => EmailApiError::AuthRequired,
                    _ => EmailApiError::Transient {
                        message: "Microsoft token health is temporarily unavailable".into(),
                    },
                }),
        }
    }
    async fn refresh_gmail(&self, link: &Link) -> Result<(), MailboxError> {
        // Preserve contact refresh when a permanent watch configuration error
        // prevents renewal. Transient failures retain the durable retry.
        match self.gmail.register_subscription(link.id).await {
            Ok(_) => (),
            Err(EmailApiError::Permanent { .. } | EmailApiError::Forbidden) => {
                tracing::warn!(link_id = %link.id, "Gmail watch renewal was rejected");
            }
            Err(error) => return Err(error.into()),
        }
        crate::util::sync_contacts::sync_contacts(
            link,
            &self.db,
            &self.gmail,
            &self.queue,
            &self.broker,
        )
        .await
        .map_err(|_| MailboxError::Persistence)
    }
}
