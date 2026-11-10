//! Persistence, shared image rehosting, and Gmail alias reads for signature settings.

use email::domain::signature_settings::{
    SettingsWriter, SignatureAlias, SignatureImages, SignatureProvider,
};
use email_api_client::domain::models::{AccessToken, EmailApiError, TokenFreshness};
use models_email::service::settings::{Settings, SettingsPatch};
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use uuid::Uuid;

use super::persistence_error::InboxPersistenceError;

pub struct PgSignatureSettings(pub sqlx::PgPool);

impl SettingsWriter for PgSignatureSettings {
    type Err = InboxPersistenceError;

    async fn patch(&self, patch: SettingsPatch) -> Result<Settings, Self::Err> {
        Ok(email_db_client::settings::patch_settings(&self.0, patch).await?)
    }
}

pub struct SignatureImageRehoster {
    pub db: sqlx::PgPool,
    pub sfs: Arc<StaticFileServiceClient>,
}

impl SignatureImages for SignatureImageRehoster {
    type Err = InboxPersistenceError;

    async fn rehost(&self, html: &str) -> Result<(String, usize), Self::Err> {
        Ok(
            crate::util::process_pre_insert::sfs_map::rehost_html_images(&self.db, &self.sfs, html)
                .await?,
        )
    }
}

pub struct GmailSignatures {
    pub email_api: super::email_api::GmailApi,
    pub gmail: Arc<gmail_client::GmailClient>,
}

impl SignatureProvider for GmailSignatures {
    type TokenErr = EmailApiError;
    type ReadErr = gmail_client::GmailApiHttpError;

    async fn fresh_token(&self, link: Uuid) -> Result<AccessToken, Self::TokenErr> {
        self.email_api
            .get_access_token(link, TokenFreshness::Fresh)
            .await
    }

    async fn aliases(&self, token: &AccessToken) -> Result<Vec<SignatureAlias>, Self::ReadErr> {
        Ok(self
            .gmail
            .list_send_as(token.expose_secret())
            .await?
            .send_as
            .unwrap_or_default()
            .into_iter()
            .map(|alias| SignatureAlias {
                email: alias.send_as_email,
                signature: alias.signature,
                primary: alias.is_primary == Some(true),
            })
            .collect())
    }
}
