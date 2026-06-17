use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use macro_service_urls::StaticFileServiceUrl;

env_vars! {
    struct StaticFileServiceDynamodbTableName;
    struct StaticStorageBucket;
    struct StaticFileServiceS3EventQueueUrl;
    struct InternalApiSecretKey;
}

maybe_env_vars! {
    struct Port;
}

#[derive(Debug, Clone)]
pub struct Config {
    /// self explanatory
    pub environment: Environment,
    /// port (8080)
    pub port: usize,
    /// the tablename of the metadata table
    pub dynamodb_table: String,
    /// s3 storage bucket
    pub storage_bucket_name: String,
    /// service url
    pub service_url: String,
    /// s3 upload notification queue
    pub s3_event_queue_url: String,
    /// Internal API secret key
    pub internal_api_secret_key: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let environment = Environment::new_or_prod();
        let port = Port::new()
            .map(|port| port.parse::<usize>().context("PORT must be a valid usize"))
            .transpose()?
            .unwrap_or(8080);
        let dynamodb_table = StaticFileServiceDynamodbTableName::new()
            .context("STATIC_FILE_SERVICE_DYNAMODB_TABLE_NAME must be provided")?
            .to_string();

        let storage_bucket_name = StaticStorageBucket::new()
            .context("STATIC_STORAGE_BUCKET must be provided")?
            .to_string();

        let service_url = StaticFileServiceUrl::new()?.to_string();

        let s3_event_queue_url = StaticFileServiceS3EventQueueUrl::new()
            .context("S3_EVENT_QUEUE_URL must be provided")?
            .to_string();

        let internal_api_secret_key = InternalApiSecretKey::new()
            .context("INTERNAL_API_SECRET_KEY must be provided")?
            .to_string();

        Ok(Config {
            environment,
            port,
            dynamodb_table,
            storage_bucket_name,
            service_url,
            s3_event_queue_url,
            internal_api_secret_key,
        })
    }
}
