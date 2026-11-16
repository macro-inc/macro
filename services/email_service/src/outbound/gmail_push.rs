//! Existing Google key cache, token verification and notification effects.

use super::persistence_error::InboxPersistenceError;
use anyhow::Context;
use email::domain::mailbox::{catalog::InboxAddressLookup, gmail_push::*};
use models_email::{
    gmail::inbox_sync::{
        GmailMessagePayload, GooglePublicKeys, InboxSyncOperation, InboxSyncPubsubMessage,
        JwtVerificationError, KeyMap,
    },
    service::link::UserProvider,
};
use std::sync::Arc;
use uuid::Uuid;

pub struct GooglePushKeyCache(pub Arc<crate::util::redis::RedisClient>);

impl PushKeyCache for GooglePushKeyCache {
    type Err = InboxPersistenceError;

    async fn read(&self) -> Result<Option<KeyMap>, Self::Err> {
        self.0.get_google_public_keys().await.map_err(Into::into)
    }

    async fn write(&self, keys: &GooglePublicKeys) -> Result<(), Self::Err> {
        self.0
            .set_google_public_keys(keys)
            .await
            .map_err(Into::into)
    }
}

pub struct GooglePushKeySource(pub Arc<gmail_client::GmailClient>);

impl PushKeySource for GooglePushKeySource {
    type Err = InboxPersistenceError;

    async fn fetch(&self) -> Result<GooglePublicKeys, Self::Err> {
        self.0
            .get_google_public_keys()
            .await
            .context("Failed to fetch Google public keys")
            .map_err(Into::into)
    }
}

pub struct GooglePushTokenVerifier(pub Arc<gmail_client::GmailClient>);

impl PushTokenVerifier for GooglePushTokenVerifier {
    fn verify(&self, token: &str, keys: KeyMap) -> Result<(), JwtVerificationError> {
        self.0.verify_google_token(token, keys).map(|_| ())
    }
}

pub struct PgPushInboxes(pub sqlx::PgPool);

impl InboxAddressLookup for PgPushInboxes {
    type Err = InboxPersistenceError;

    async fn by_provider_email(
        &self,
        email_address: &str,
        provider: UserProvider,
    ) -> Result<Option<Uuid>, Self::Err> {
        Ok(
            email_db_client::links::get::fetch_link_by_email(&self.0, email_address, provider)
                .await?
                .map(|link| link.id),
        )
    }
}

pub struct GmailPushNotifications(pub sqs_client::SQS);

impl GmailPushQueue for GmailPushNotifications {
    type Err = InboxPersistenceError;

    async fn notify(&self, link_id: Uuid, history_id: u64) -> Result<(), Self::Err> {
        self.0
            .enqueue_gmail_inbox_sync_notification(InboxSyncPubsubMessage {
                link_id,
                operation: InboxSyncOperation::GmailMessage(GmailMessagePayload { history_id }),
            })
            .await
            .map_err(Into::into)
    }
}
