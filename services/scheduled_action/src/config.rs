//! Configuration for the agent schedule service, loaded via the standard
//! `macro_config` pattern so it gets a `doppler_config` validation binary.
//!
//! All required env vars are declared here as typed fields. The
//! `doppler_config` binary loads this `Config` from Doppler for both the dev
//! and prod environments, surfacing any missing or mistyped values at CI time.
//!
//! The AI tool service context built by
//! [`ai_tools::build_tool_service_context_from_env`] reads several env vars of
//! its own; those are mirrored here so the Doppler validation binary covers
//! them as well.

use anyhow::Context;
use database_env_vars::DatabaseUrl;
pub use macro_env::Environment;
use macro_env_var::env_vars;
use macro_middleware::auth::internal_access::InternalApiKey;

env_vars! {
    /// Auth key used by the document storage / search / lexical clients.
    pub struct DocumentStorageServiceAuthKey;
    /// Secrets Manager secret name for the sync service auth key.
    pub struct SyncServiceAuthKey;
    /// S3 bucket for document storage.
    pub struct DocumentStorageBucket;
    /// S3 bucket for docx document uploads.
    pub struct DocxDocumentUploadBucket;
    /// CloudFront distribution URL for document storage.
    pub struct DocumentStorageServiceCloudfrontDistributionUrl;
    /// CloudFront signer public key id for document storage.
    pub struct DocumentStorageServiceCloudfrontSignerPublicKeyId;
    /// Secrets Manager secret name for the CloudFront signer private key.
    pub struct DocumentStorageServiceCloudfrontSignerPrivateKeySecretName;
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
}

/// The configuration parameters for the agent schedule service.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// Port to listen on. Defaults to `8080` when unset.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The connection URL for the Postgres database this application uses.
    pub database_url: DatabaseUrl,
    pub document_storage_service_auth_key: DocumentStorageServiceAuthKey,
    pub sync_service_auth_key: SyncServiceAuthKey,
    pub document_storage_bucket: DocumentStorageBucket,
    pub docx_document_upload_bucket: DocxDocumentUploadBucket,
    pub document_storage_service_cloudfront_distribution_url:
        DocumentStorageServiceCloudfrontDistributionUrl,
    pub document_storage_service_cloudfront_signer_public_key_id:
        DocumentStorageServiceCloudfrontSignerPublicKeyId,
    pub document_storage_service_cloudfront_signer_private_key_secret_name:
        DocumentStorageServiceCloudfrontSignerPrivateKeySecretName,
    pub kafka_brokers: KafkaBrokers,
    /// The internal api key
    pub internal_api_key: InternalApiKey,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load agent schedule service config")
    }
}
