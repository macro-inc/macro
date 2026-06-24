use anyhow::Context;
pub use macro_env::Environment;
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
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,
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
    pub document_storage_bucket: String,
    /// document storage service url
    #[macro_config_default(DocumentStorageServiceUrl::unwrap_new().to_string())]
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
    /// The sqs queue used to enqueue and poll ai projection materialization jobs
    pub ai_projection_queue: String,
    #[macro_config_default(SyncServiceUrl::unwrap_new().to_string())]
    pub sync_service_url: String,
    pub sync_service_auth_key: String,
    #[macro_config_default(LexicalServiceUrl::unwrap_new().to_string())]
    pub lexical_service_url: String,
    #[macro_config_default(EmailServiceUrl::unwrap_new().to_string())]
    pub email_service_url: String,
    /// document cognition service url for scribe tool to loopback
    #[macro_config_default(DocumentCognitionServiceUrl::unwrap_new().to_string())]
    pub document_cognition_service_url: String,
    /// static file service url
    #[macro_config_default(StaticFileServiceUrl::unwrap_new().to_string())]
    pub static_file_service_url: String,
    /// connection gateway url
    #[macro_config_default(ConnectionGatewayUrl::unwrap_new().to_string())]
    pub connection_gateway_url: String,
    /// authentication service url (for soup service)
    pub authentication_service_url: String,
    /// authentication service secret key (for soup service)
    pub authentication_service_secret_key: String,
    /// Redis host for stream service
    pub redis_host: String,
    /// The S3 bucket for DOCX document uploads
    pub docx_document_upload_bucket: String,
    /// CloudFront distribution URL for document storage
    #[serde(rename = "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL")]
    pub cloudfront_distribution_url: String,
    /// CloudFront signer public key ID
    #[serde(rename = "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID")]
    pub cloudfront_signer_public_key_id: String,
    /// CloudFront signer private key (secret name or value)
    #[serde(rename = "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME")]
    pub cloudfront_signer_private_key: String,
    /// MCP credentials encryption key (base64-encoded, secret name or value)
    pub mcp_credentials_key_secret_name: String,
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
            ai_projection_queue: Default::default(),
            sync_service_url: Default::default(),
            sync_service_auth_key: Default::default(),
            lexical_service_url: Default::default(),
            email_service_url: Default::default(),
            document_cognition_service_url: Default::default(),
            static_file_service_url: Default::default(),
            connection_gateway_url: Default::default(),
            authentication_service_url: Default::default(),
            authentication_service_secret_key: Default::default(),
            redis_host: "redis://localhost:6379".to_string(),
            docx_document_upload_bucket: Default::default(),
            cloudfront_distribution_url: Default::default(),
            cloudfront_signer_public_key_id: Default::default(),
            cloudfront_signer_private_key: Default::default(),
            mcp_credentials_key_secret_name: Default::default(),
        }
    }
}
