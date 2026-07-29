//! Configuration for the MCP server, loaded via the standard `macro_config`
//! pattern so it gets a `doppler_config` validation binary.
//!
//! All required env vars are declared here as typed fields. The
//! `doppler_config` binary loads this `Config` from Doppler for both the dev
//! and prod environments, surfacing any missing or mistyped values at CI time.

use anyhow::Context;
use database_env_vars::DatabaseUrl;
pub use macro_auth::InternalApiKey;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};

maybe_env_vars! {
    /// Browser-reachable FusionAuth origin used for OAuth authorization redirects.
    pub struct FusionauthPublicUrl;
}

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
    /// Public URL this MCP server is served from (used for OAuth callbacks and
    /// the allowed-hosts list).
    pub struct McpPublicUrl;
    /// FusionAuth base URL.
    pub struct FusionauthBaseUrl;
    /// FusionAuth client id.
    pub struct FusionauthClientId;
    /// FusionAuth tenant id.
    pub struct FusionauthTenantId;
    /// Secrets Manager secret name for the FusionAuth API key.
    pub struct FusionauthApiKeySecretKey;
    /// Secrets Manager secret name for the FusionAuth client secret.
    pub struct FusionauthClientSecretKey;
    /// Google OAuth client id.
    pub struct GoogleClientId;
    /// Secrets Manager secret name for the Google OAuth client secret.
    pub struct GoogleClientSecretKey;
    /// Redis URL used by the MCP auth proxy for in-flight OAuth state.
    pub struct RedisUrl;
    /// Base URL of the Macro web app (e.g. `https://macro.com`), used to build
    /// links to Macro items in MCP responses.
    pub struct AppBaseUrl;
    /// JWT secret for minting document permission tokens for the editing worker.
    pub struct DocumentPermissionJwt;
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
}

/// The configuration parameters for the MCP server.
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
    pub mcp_public_url: McpPublicUrl,
    pub fusionauth_base_url: FusionauthBaseUrl,
    /// Browser-reachable FusionAuth URL. Falls back to the API base URL when unset.
    pub fusionauth_public_url: FusionauthPublicUrl,
    pub fusionauth_client_id: FusionauthClientId,
    pub fusionauth_tenant_id: FusionauthTenantId,
    pub fusionauth_api_key_secret_key: FusionauthApiKeySecretKey,
    pub fusionauth_client_secret_key: FusionauthClientSecretKey,
    pub google_client_id: GoogleClientId,
    pub google_client_secret_key: GoogleClientSecretKey,
    pub redis_url: RedisUrl,
    pub app_base_url: AppBaseUrl,
    /// The internal api key
    pub internal_api_key: InternalApiKey,
    pub document_permission_jwt: DocumentPermissionJwt,
    pub kafka_brokers: KafkaBrokers,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>().context("failed to load mcp server config")
    }
}
