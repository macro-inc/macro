//! Existing physical-deletion leaves; orchestration lives in the email domain.

use crate::outbound::email_api::GmailApi;
use crate::pubsub::util::cg_refresh_email;
use crate::util::redis::RedisClient;
use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use connection_gateway_client::client::ConnectionGatewayClient;
use email::domain::mailbox::link_manager::deletion::{
    LinkDeletionAuth, LinkDeletionGmail, LinkDeletionRefresh, LinkDeletionRepository,
    PromotedMailboxCleanup,
};
use email_api_client::domain::models::EmailApiError;
use models_email::{
    api::refresh::RefreshEmailEvent,
    service::{cache::TokenCacheKey, link::Link},
};
use sqlx::{PgPool, Postgres, pool::PoolConnection};
use uuid::Uuid;

pub(crate) struct PgLinkDeletion(pub PgPool);
pub(crate) struct PromotedCleanup(PoolConnection<Postgres>);

impl LinkDeletionRepository for PgLinkDeletion {
    type AcquireError = sqlx::Error;
    type Connection = PromotedCleanup;

    async fn mark_link_deleting(&self, link: Uuid) -> anyhow::Result<()> {
        email_db_client::links::delete::mark_link_deleting(&self.0, link).await
    }
    async fn cancel_active_jobs(&self, link: Uuid) -> anyhow::Result<usize> {
        email_db_client::backfill::job::update::cancel_active_jobs_by_link_id(&self.0, link).await
    }
    async fn set_deleted_at(&self, link: Uuid, reason: &str) -> anyhow::Result<()> {
        email_db_client::links_history::update::set_deleted_at(&self.0, link, reason).await
    }
    async fn acquire(&self) -> Result<Self::Connection, Self::AcquireError> {
        self.0.acquire().await.map(PromotedCleanup)
    }
}

impl PromotedMailboxCleanup for PromotedCleanup {
    async fn delete_promoted_mailbox_user(&mut self, owner: &str) -> anyhow::Result<Option<Uuid>> {
        macro_db_client::shared_inbox::delete_promoted_mailbox_user(&mut self.0, owner).await
    }
}

pub(crate) struct DeletionGmail {
    pub api: GmailApi,
    pub cache: RedisClient,
}

impl LinkDeletionGmail for DeletionGmail {
    async fn stop_subscription_for_link(&self, link: &Link) -> Result<(), EmailApiError> {
        self.api.stop_subscription_for_link(link).await
    }
    async fn delete_gmail_access_token(&self, key: &TokenCacheKey) -> anyhow::Result<()> {
        self.cache.delete_gmail_access_token(key).await
    }
}

pub(crate) struct DeletionAuth(pub AuthServiceClient);

impl LinkDeletionAuth for DeletionAuth {
    type Err = AuthServiceClientError;
    async fn remove_link(&self, user: &str, email: &str, provider: &str) -> Result<(), Self::Err> {
        self.0.remove_link(user, email, provider).await
    }
    async fn delete_inbox_grant_user(&self, user: &str) -> Result<(), Self::Err> {
        self.0.delete_inbox_grant_user(user).await
    }
}

pub(crate) struct DeletionRefresh(pub ConnectionGatewayClient);

impl LinkDeletionRefresh for DeletionRefresh {
    async fn refresh_email(&self, owner: &str, event: RefreshEmailEvent) {
        cg_refresh_email(&self.0, owner, event).await;
    }
}
