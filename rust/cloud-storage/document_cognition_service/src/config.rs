pub use macro_env::Environment;
use macro_env_var::{env_var, maybe_env_var};
use macro_service_urls::{
    ConnectionGatewayUrl, DocumentCognitionServiceUrl, DocumentStorageServiceUrl, EmailServiceUrl,
    LexicalServiceUrl, StaticFileServiceUrl, SyncServiceUrl,
};

use crate::core::constants::DEFAULT_DOCUMENT_BATCH_LIMIT;
/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in cognitive-workspace root for details.
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,
    /// The port to listen for HTTP requests on.
    pub port: usize,
    /// The environment we are in
    pub environment: Environment,
    /// The maximum number of results in a document query
    pub document_batch_limit: i64,
    /// document storage bucket
    pub document_storage_bucket: String,
    /// document storage service url
    pub document_storage_service_url: String,
    /// document storage service auth key
    pub document_storage_service_auth_key: String,
    /// The sqs queue to send document text extract jobs to
    pub document_text_extractor_queue: String,
    /// The sqs queue to send chat delete jobs
    pub chat_delete_queue: String,
    /// The sqs queue to enqueue outbound email sends
    pub email_scheduled_queue: String,
    /// The sqs queue to send notifications to
    pub notification_queue: String,
    pub search_event_queue: String,
    pub sync_service_url: String,
    pub sync_service_auth_key: String,
    pub lexical_service_url: String,
    pub email_service_url: String,
    /// document cognition service url for scribe tool to loopback
    pub document_cognition_service_url: String,
    /// static file service url
    pub static_file_service_url: String,
    /// connection gateway url
    pub connection_gateway_url: String,
    /// authentication service url (for soup service)
    pub authentication_service_url: String,
    /// authentication service secret key (for soup service)
    pub authentication_service_secret_key: String,
    /// Redis host for stream service
    pub redis_host: RedisHost,
    /// The S3 bucket for DOCX document uploads
    pub docx_document_upload_bucket: String,
    /// CloudFront distribution URL for document storage
    pub cloudfront_distribution_url: String,
    /// CloudFront signer public key ID
    pub cloudfront_signer_public_key_id: String,
    /// CloudFront signer private key (secret name or value)
    pub cloudfront_signer_private_key: String,
    /// MCP credentials encryption key (base64-encoded, secret name or value)
    pub mcp_credentials_key_secret_name: String,
}

env_var!(
    pub struct EnvVars {
        pub DatabaseUrl,
        pub DocumentStorageBucket,
        pub DocumentTextExtractorQueue,
        pub ChatDeleteQueue,
        pub EmailScheduledQueue,
        pub NotificationQueue,
        pub DocumentStorageServiceAuthKey,
        pub SearchEventQueue,
        pub SyncServiceAuthKey,
        pub AuthenticationServiceUrl,
        pub AuthenticationServiceSecretKey,
        pub RedisHost,
        pub DocxDocumentUploadBucket,
        pub DocumentStorageServiceCloudfrontDistributionUrl,
        pub DocumentStorageServiceCloudfrontSignerPublicKeyId,
        pub DocumentStorageServiceCloudfrontSignerPrivateKeySecretName,
        pub McpCredentialsKeySecretName,
    }
);

maybe_env_var!(
    pub struct MaybeEnvVars {
        pub Port,
        pub DocumentBatchLimit,
    }
);

impl Config {
    #[tracing::instrument(err, skip_all)]
    pub fn from_env(env_vars: EnvVars) -> anyhow::Result<Self> {
        let maybe = MaybeEnvVars::new();

        let port: usize = maybe.port.as_deref().unwrap_or("8080").parse().unwrap();
        let environment = Environment::new_or_prod();

        let document_batch_limit = maybe
            .document_batch_limit
            .as_deref()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(DEFAULT_DOCUMENT_BATCH_LIMIT);

        let document_storage_service_url = DocumentStorageServiceUrl::new()?.to_string();
        let sync_service_url = SyncServiceUrl::new()?.to_string();
        let lexical_service_url = LexicalServiceUrl::new()?.to_string();
        let email_service_url = EmailServiceUrl::new()?.to_string();
        let document_cognition_service_url = DocumentCognitionServiceUrl::new()?.to_string();
        let static_file_service_url = StaticFileServiceUrl::new()?.to_string();
        let connection_gateway_url = ConnectionGatewayUrl::new()?.to_string();

        let EnvVars {
            database_url,
            document_storage_bucket,
            document_text_extractor_queue,
            chat_delete_queue,
            email_scheduled_queue,
            notification_queue,
            document_storage_service_auth_key,
            search_event_queue,
            sync_service_auth_key,
            authentication_service_url,
            authentication_service_secret_key,
            redis_host,
            docx_document_upload_bucket,
            document_storage_service_cloudfront_distribution_url,
            document_storage_service_cloudfront_signer_public_key_id,
            document_storage_service_cloudfront_signer_private_key_secret_name,
            mcp_credentials_key_secret_name,
        } = env_vars;

        Ok(Config {
            database_url: database_url.to_string(),
            port,
            environment,
            document_batch_limit,
            document_storage_bucket: document_storage_bucket.to_string(),
            document_storage_service_url,
            document_storage_service_auth_key: document_storage_service_auth_key.to_string(),
            document_text_extractor_queue: document_text_extractor_queue.to_string(),
            chat_delete_queue: chat_delete_queue.to_string(),
            email_scheduled_queue: email_scheduled_queue.to_string(),
            notification_queue: notification_queue.to_string(),
            search_event_queue: search_event_queue.to_string(),
            sync_service_auth_key: sync_service_auth_key.to_string(),
            sync_service_url,
            lexical_service_url,
            email_service_url,
            document_cognition_service_url,
            static_file_service_url,
            connection_gateway_url,
            authentication_service_url: authentication_service_url.to_string(),
            authentication_service_secret_key: authentication_service_secret_key.to_string(),
            redis_host,
            docx_document_upload_bucket: docx_document_upload_bucket.to_string(),
            cloudfront_distribution_url: document_storage_service_cloudfront_distribution_url
                .to_string(),
            cloudfront_signer_public_key_id:
                document_storage_service_cloudfront_signer_public_key_id.to_string(),
            cloudfront_signer_private_key:
                document_storage_service_cloudfront_signer_private_key_secret_name.to_string(),
            mcp_credentials_key_secret_name: mcp_credentials_key_secret_name.to_string(),
        })
    }

    #[cfg(test)]
    pub fn new_empty_for_test() -> Self {
        Config {
            environment: Environment::Local,
            database_url: Default::default(),
            port: Default::default(),
            document_batch_limit: Default::default(),
            document_storage_bucket: Default::default(),
            document_storage_service_url: Default::default(),
            document_storage_service_auth_key: Default::default(),
            document_text_extractor_queue: Default::default(),
            chat_delete_queue: Default::default(),
            email_scheduled_queue: Default::default(),
            notification_queue: Default::default(),
            search_event_queue: Default::default(),
            sync_service_url: Default::default(),
            sync_service_auth_key: Default::default(),
            lexical_service_url: Default::default(),
            email_service_url: Default::default(),
            document_cognition_service_url: Default::default(),
            static_file_service_url: Default::default(),
            connection_gateway_url: Default::default(),
            authentication_service_url: Default::default(),
            authentication_service_secret_key: Default::default(),
            redis_host: RedisHost::Comptime("redis://localhost:6379"),
            docx_document_upload_bucket: Default::default(),
            cloudfront_distribution_url: Default::default(),
            cloudfront_signer_public_key_id: Default::default(),
            cloudfront_signer_private_key: Default::default(),
            mcp_credentials_key_secret_name: Default::default(),
        }
    }
}
