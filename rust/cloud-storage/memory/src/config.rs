pub use macro_env::Environment;
use macro_env_var::{env_var, maybe_env_var};

pub struct Config {
    pub environment: Environment,
    pub database_url: String,
    pub user_id: String,
    pub internal_api_secret_key: String,
    pub document_storage_service_url: String,
    pub search_service_url: String,
    pub email_service_url: String,
    pub sync_service_url: String,
    pub static_file_service_url: String,
    pub lexical_service_url: String,
    pub document_storage_bucket: String,
    pub docx_document_upload_bucket: String,
    pub email_scheduled_queue: String,
    pub document_storage_service_cloudfront_distribution_url: String,
    pub document_storage_service_cloudfront_signer_public_key_id: String,
    pub document_storage_service_cloudfront_signer_private_key_secret_name: String,
}

env_var!(
    pub struct EnvVars {
        pub DatabaseUrl,
        pub UserId,
        pub DocumentStorageServiceUrl,
        pub SearchServiceUrl,
        pub EmailServiceUrl,
        pub SyncServiceUrl,
        pub StaticFileServiceUrl,
        pub DocumentStorageBucket,
        pub DocxDocumentUploadBucket,
        pub EmailScheduledQueue,
        pub DocumentStorageServiceCloudfrontDistributionUrl,
        pub DocumentStorageServiceCloudfrontSignerPublicKeyId,
        pub DocumentStorageServiceCloudfrontSignerPrivateKeySecretName,
    }
);

maybe_env_var!(
    pub struct MaybeEnvVars {
        pub InternalApiSecretKey,
        pub LexicalServiceUrl,
    }
);

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let environment = Environment::new_or_prod();
        let env_vars = EnvVars::new()?;
        let maybe_env_vars = MaybeEnvVars::new();

        let EnvVars {
            database_url,
            user_id,
            document_storage_service_url,
            search_service_url,
            email_service_url,
            sync_service_url,
            static_file_service_url,
            document_storage_bucket,
            docx_document_upload_bucket,
            email_scheduled_queue,
            document_storage_service_cloudfront_distribution_url,
            document_storage_service_cloudfront_signer_public_key_id,
            document_storage_service_cloudfront_signer_private_key_secret_name,
        } = env_vars;

        Ok(Self {
            environment,
            database_url: database_url.to_string(),
            user_id: user_id.to_string(),
            internal_api_secret_key: maybe_env_vars
                .internal_api_secret_key
                .map(|v| v.to_string())
                .unwrap_or_else(|| "local".to_string()),
            document_storage_service_url: document_storage_service_url.to_string(),
            search_service_url: search_service_url.to_string(),
            email_service_url: email_service_url.to_string(),
            sync_service_url: sync_service_url.to_string(),
            static_file_service_url: static_file_service_url.to_string(),
            lexical_service_url: maybe_env_vars
                .lexical_service_url
                .map(|v| v.to_string())
                .unwrap_or_else(|| "http://localhost:8096".to_string()),
            document_storage_bucket: document_storage_bucket.to_string(),
            docx_document_upload_bucket: docx_document_upload_bucket.to_string(),
            email_scheduled_queue: email_scheduled_queue.to_string(),
            document_storage_service_cloudfront_distribution_url:
                document_storage_service_cloudfront_distribution_url.to_string(),
            document_storage_service_cloudfront_signer_public_key_id:
                document_storage_service_cloudfront_signer_public_key_id.to_string(),
            document_storage_service_cloudfront_signer_private_key_secret_name:
                document_storage_service_cloudfront_signer_private_key_secret_name.to_string(),
        })
    }
}
