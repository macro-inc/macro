use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_var;

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
    /// The sqs queue to send document text extract jobs to
    pub document_text_extractor_queue: String,
    /// The sqs queue to send chat delete jobs
    pub chat_delete_queue: String,
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
}

env_var!(
    pub struct EnvVars {
        pub RedisHost,
    }
);

impl Config {
    #[tracing::instrument(err, skip_all)]
    pub fn from_env(env_vars: EnvVars) -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .unwrap();
        let environment = Environment::new_or_prod();

        let document_batch_limit = match std::env::var("DOCUMENT_BATCH_LIMIT") {
            Ok(val) => val.parse::<i64>().unwrap_or(DEFAULT_DOCUMENT_BATCH_LIMIT),
            Err(_) => DEFAULT_DOCUMENT_BATCH_LIMIT,
        };

        let document_storage_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")
            .context("DOCUMENT_STORAGE_BUCKET environment variable not set")?;

        let document_text_extractor_queue = std::env::var("DOCUMENT_TEXT_EXTRACTOR_QUEUE")
            .context("DOCUMENT_TEXT_EXTRACTOR_QUEUE environment variable not set")?;

        let chat_delete_queue = std::env::var("CHAT_DELETE_QUEUE")
            .context("CHAT_DELETE_QUEUE environment variable not set")?;

        let notification_queue =
            std::env::var("NOTIFICATION_QUEUE").context("NOTIFICATION_QUEUE must be provided")?;

        let document_storage_service_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")
            .context("DOCUMENT_STORAGE_SERVICE_URL must be provided")?;

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        let sync_service_url =
            std::env::var("SYNC_SERVICE_URL").context("SYNC_SERVICE_URL must be provided")?;

        let sync_service_auth_key = std::env::var("SYNC_SERVICE_AUTH_KEY")
            .context("SYNC_SERVICE_AUTH_KEY must be provided")?;

        let lexical_service_url =
            std::env::var("LEXICAL_SERVICE_URL").context("LEXICAL_SERVICE_URL must be provided")?;

        let email_service_url =
            std::env::var("EMAIL_SERVICE_URL").context("EMAIL_SERVICE_URL must be provided")?;

        let document_cognition_service_url = format!("http://127.0.0.1:{}", port);

        let static_file_service_url = std::env::var("STATIC_FILE_SERVICE_URL")
            .context("STATIC_FILE_SERVICE_URL must be provided")?;

        let authentication_service_url = std::env::var("AUTHENTICATION_SERVICE_URL")
            .context("AUTHENTICATION_SERVICE_URL must be provided")?;

        let authentication_service_secret_key = std::env::var("AUTHENTICATION_SERVICE_SECRET_KEY")
            .context("AUTHENTICATION_SERVICE_SECRET_KEY must be provided")?;

        let docx_document_upload_bucket = std::env::var("DOCX_DOCUMENT_UPLOAD_BUCKET")
            .context("DOCX_DOCUMENT_UPLOAD_BUCKET must be provided")?;

        let cloudfront_distribution_url =
            std::env::var("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL")
                .context("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL must be provided")?;

        let cloudfront_signer_public_key_id = std::env::var(
            "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID",
        )
        .context("DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID must be provided")?;

        let cloudfront_signer_private_key = std::env::var(
            "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME",
        )
        .context(
            "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME must be provided",
        )?;

        let EnvVars { redis_host } = env_vars;

        Ok(Config {
            database_url,
            port,
            environment,
            document_batch_limit,
            document_storage_bucket,
            document_storage_service_url,
            document_text_extractor_queue,
            chat_delete_queue,
            notification_queue,
            search_event_queue,
            sync_service_auth_key,
            sync_service_url,
            lexical_service_url,
            email_service_url,
            document_cognition_service_url,
            static_file_service_url,
            authentication_service_url,
            authentication_service_secret_key,
            redis_host,
            docx_document_upload_bucket,
            cloudfront_distribution_url,
            cloudfront_signer_public_key_id,
            cloudfront_signer_private_key,
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
            document_text_extractor_queue: Default::default(),
            chat_delete_queue: Default::default(),
            notification_queue: Default::default(),
            search_event_queue: Default::default(),
            sync_service_url: Default::default(),
            sync_service_auth_key: Default::default(),
            lexical_service_url: Default::default(),
            email_service_url: Default::default(),
            document_cognition_service_url: Default::default(),
            static_file_service_url: Default::default(),
            authentication_service_url: Default::default(),
            authentication_service_secret_key: Default::default(),
            redis_host: RedisHost::Comptime("redis://localhost:6379"),
            docx_document_upload_bucket: Default::default(),
            cloudfront_distribution_url: Default::default(),
            cloudfront_signer_public_key_id: Default::default(),
            cloudfront_signer_private_key: Default::default(),
        }
    }
}
