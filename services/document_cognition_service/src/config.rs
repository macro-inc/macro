use anyhow::Context;
use macro_auth::InternalApiKey;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use macro_service_urls::{AiEditingWorkerUrl, DocumentCognitionServiceUrl};
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
    pub struct DocumentPermissionJwt;
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
);

maybe_env_vars!(
    pub struct DocumentBatchLimit;
    /// OAuth client ID for the Pipedream API (Pipedream project settings).
    /// When unset (along with the other Pipedream credentials), the
    /// Pipedream MCP endpoints answer 501 and its toolsets come up empty.
    pub struct PipedreamClientId;
    /// OAuth client secret for the Pipedream API.
    pub struct PipedreamClientSecret;
    /// The Pipedream Connect project ID (`proj_...`).
    pub struct PipedreamProjectId;
    /// The Pipedream project environment (`development` or `production`).
    /// Defaults by deploy environment: production in prd, development
    /// elsewhere.
    pub struct PipedreamEnvironment;
    /// Base URL of the Pipedream API. Defaults to `https://api.pipedream.com`.
    pub struct PipedreamApiUrl;
    /// URL of Pipedream's remote MCP server. Defaults to
    /// `https://remote.mcp.pipedream.net`.
    pub struct PipedreamMcpUrl;
    /// Comma-separated browser origins allowed to embed Pipedream's hosted
    /// Connect UI (sent as the Connect token's `allowed_origins`). Defaults
    /// by deploy environment: the app origin (`https://macro.com` /
    /// `https://dev.macro.com`) plus localhost outside production.
    pub struct PipedreamAllowedOrigins;
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
    /// OAuth client ID for the Pipedream API.
    pub pipedream_client_id: PipedreamClientId,
    /// OAuth client secret for the Pipedream API.
    pub pipedream_client_secret: PipedreamClientSecret,
    /// The Pipedream Connect project ID.
    pub pipedream_project_id: PipedreamProjectId,
    /// The Pipedream project environment.
    pub pipedream_environment: PipedreamEnvironment,
    /// Base URL of the Pipedream API.
    pub pipedream_api_url: PipedreamApiUrl,
    /// URL of Pipedream's remote MCP server.
    pub pipedream_mcp_url: PipedreamMcpUrl,
    /// Browser origins allowed to embed Pipedream's hosted Connect UI.
    pub pipedream_allowed_origins: PipedreamAllowedOrigins,
    /// The internal api key
    pub internal_api_key: InternalApiKey,
    /// AI editing worker URL
    #[macro_config_default(AiEditingWorkerUrl::unwrap_new().to_string())]
    pub ai_editing_worker_url: String,
    /// Browser-facing base URL used for MCP OAuth redirects and client metadata.
    #[macro_config_default(DocumentCognitionServiceUrl::unwrap_new().to_string())]
    pub mcp_public_url: String,
    /// JWT secret for minting document permission tokens for the editing worker.
    pub document_permission_jwt: DocumentPermissionJwt,
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub kafka_brokers: KafkaBrokers,
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
            pipedream_client_id: PipedreamClientId::Unset,
            pipedream_client_secret: PipedreamClientSecret::Unset,
            pipedream_project_id: PipedreamProjectId::Unset,
            pipedream_environment: PipedreamEnvironment::Unset,
            pipedream_api_url: PipedreamApiUrl::Unset,
            pipedream_mcp_url: PipedreamMcpUrl::Unset,
            pipedream_allowed_origins: PipedreamAllowedOrigins::Unset,
            internal_api_key: InternalApiKey::Comptime(""),
            ai_editing_worker_url: AiEditingWorkerUrl::unwrap_new().to_string(),
            mcp_public_url: DocumentCognitionServiceUrl::unwrap_new().to_string(),
            document_permission_jwt: DocumentPermissionJwt::Comptime("DOCUMENT_PERMISSION_JWT"),
            kafka_brokers: KafkaBrokers::Comptime("localhost:9092"),
        }
    }
}
