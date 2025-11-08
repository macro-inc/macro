use crate::config::Config;
use anyhow::Context;
use document_cognition_service_client::DocumentCognitionServiceClient;
use document_storage_service_client::DocumentStorageServiceClient;
use email_service_client::EmailServiceClient;
use lexical_client::LexicalClient;
use scribe::{ScribeClient, dcs::DcsClient, document::DocumentClient, email::EmailClient};
use sqlx::{PgPool, Pool, Postgres};
use std::sync::Arc;
use sync_service_client::SyncServiceClient;
pub type InsightScribe = ScribeClient<DocumentClient, (), DcsClient, EmailClient, ()>;
// Extend with channels, sync, etc
pub struct ServiceContext {
    pub macro_db: Pool<Postgres>,
    pub content_client: InsightScribe,
}

impl ServiceContext {
    pub async fn try_from_config(config: &Config) -> Result<Self, anyhow::Error> {
        let macro_db = PgPool::connect(config.macro_db_url.as_str())
            .await
            .context("connect to MacroDB")?;

        let dss_client = DocumentStorageServiceClient::new(
            config.internal_auth_key.clone(),
            config.document_storage_service_url.clone(),
        );

        let sync_service_client = SyncServiceClient::new(
            config.sync_service_auth_key.clone(),
            config.sync_service_url.clone(),
        );

        let email_service_client = EmailServiceClient::new(
            config.internal_auth_key.clone(),
            config.email_service_url.clone(),
        );

        let dcs_client = DocumentCognitionServiceClient::new(
            config.internal_auth_key.clone(),
            config.document_cognition_service_url.clone(),
        );

        let lexical_client = LexicalClient::new(
            config.sync_service_auth_key.clone(),
            config.lexical_service_url.clone(),
        );

        let content_client = ScribeClient::new()
            .with_dcs_client(dcs_client)
            .with_document_client(
                DocumentClient::builder()
                    .with_dss_client(Arc::new(dss_client))
                    .with_lexical_client(Arc::new(lexical_client))
                    .with_sync_service_client(Arc::new(sync_service_client))
                    .build(),
            )
            .with_email_client(email_service_client);

        Ok(Self {
            macro_db,
            content_client,
        })
    }
}
