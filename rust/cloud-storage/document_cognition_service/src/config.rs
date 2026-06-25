use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use macro_middleware::auth::internal_access::InternalApiKey;
use secretsmanager_client::LocalOrRemoteSecret;

use crate::core::constants::DEFAULT_DOCUMENT_BATCH_LIMIT;

env_vars!(
    pub struct DatabaseUrl;
    pub struct DocumentStorageBucket;
    pub struct DocumentStorageServiceAuthKey;
    pub struct SyncServiceAuthKey;
    pub struct AuthenticationServiceUrl;
    pub struct AuthenticationServiceSecretKey;
    pub struct RedisHost;
    pub struct DocxDocumentUploadBucket;
    pub struct DocumentStorageServiceCloudfrontDistributionUrl;
    pub struct DocumentStorageServiceCloudfrontSignerPublicKeyId;
    pub struct DocumentStorageServiceCloudfrontSignerPrivateKey;
    pub struct McpCredentialsKeySecretName;
);

maybe_env_vars!(
    pub struct DocumentBatchLimit;
);

/// The configuration parameters for the application.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: DatabaseUrl,
    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The maximum number of results in a document query
    #[macro_config_default(DEFAULT_DOCUMENT_BATCH_LIMIT)]
    pub document_batch_limit: i64,
    /// document storage bucket
    pub document_storage_bucket: DocumentStorageBucket,
    /// document storage service auth key
    pub document_storage_service_auth_key: DocumentStorageServiceAuthKey,
    pub sync_service_auth_key: LocalOrRemoteSecret<SyncServiceAuthKey>,
    /// authentication service secret key (for soup service)
    pub authentication_service_secret_key: AuthenticationServiceSecretKey,
    /// Redis host for stream service
    pub redis_host: RedisHost,
    /// The S3 bucket for DOCX document uploads
    pub docx_document_upload_bucket: DocxDocumentUploadBucket,
    /// CloudFront distribution URL for document storage
    pub document_storage_service_cloudfront_distribution_url:
        DocumentStorageServiceCloudfrontDistributionUrl,
    /// CloudFront signer public key ID
    pub document_storage_service_cloudfront_signer_public_key_id:
        DocumentStorageServiceCloudfrontSignerPublicKeyId,
    /// CloudFront signer private key (secret name or value)
    pub document_storage_service_cloudfront_signer_private_key:
        LocalOrRemoteSecret<DocumentStorageServiceCloudfrontSignerPrivateKey>,
    /// MCP credentials encryption key (base64-encoded, secret name or value)
    pub mcp_credentials_key_secret_name: LocalOrRemoteSecret<McpCredentialsKeySecretName>,
    /// The internal api key
    pub internal_api_key: InternalApiKey,
}

impl Config {
    #[tracing::instrument(err, skip_all)]
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>().context("failed to load config")
    }

    #[cfg(test)]
    pub fn new_empty_for_test() -> Self {
        Config {
            environment: Environment::Local,
            database_url: DatabaseUrl::Comptime("DATABASE_URL"),
            port: Default::default(),
            document_batch_limit: DEFAULT_DOCUMENT_BATCH_LIMIT,
            document_storage_bucket: DocumentStorageBucket::Comptime("DOCUMENT_STORAGE_BUCKET"),
            document_storage_service_auth_key: DocumentStorageServiceAuthKey::Comptime(
                "DOCUMENT_STORAGE_SERVICE_AUTH_KEY",
            ),
            sync_service_auth_key: LocalOrRemoteSecret::Local(SyncServiceAuthKey::Comptime(
                "SYNC_SERVICE_AUTH_KEY",
            )),
            authentication_service_secret_key: AuthenticationServiceSecretKey::Comptime(
                "AUTHENTICATION_SERVICE_SECRET_KEY",
            ),
            redis_host: RedisHost::Comptime("REDIS_HOST"),
            docx_document_upload_bucket: DocxDocumentUploadBucket::Comptime(
                "DOCX_DOCUMENT_UPLOAD_BUCKET",
            ),
            document_storage_service_cloudfront_distribution_url:
                DocumentStorageServiceCloudfrontDistributionUrl::Comptime(
                    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL",
                ),
            document_storage_service_cloudfront_signer_public_key_id:
                DocumentStorageServiceCloudfrontSignerPublicKeyId::Comptime(
                    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID",
                ),
            document_storage_service_cloudfront_signer_private_key: LocalOrRemoteSecret::Local(
                DocumentStorageServiceCloudfrontSignerPrivateKey::Comptime(
                    "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY",
                ),
            ),
            mcp_credentials_key_secret_name: LocalOrRemoteSecret::Local(
                McpCredentialsKeySecretName::Comptime("MCP_CREDENTIALS_KEY_SECRET_NAME"),
            ),
            internal_api_key: InternalApiKey::Comptime(""),
        }
    }
}
