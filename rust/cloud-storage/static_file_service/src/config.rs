use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_vars;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use macro_service_urls::StaticFileServiceUrl;
use secretsmanager_client::LocalOrRemoteSecret;

env_vars! {
    pub struct StaticFileServiceDynamodbTableName;
    pub struct StaticStorageBucket;
    pub struct StaticFileServiceS3EventQueueUrl;
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// self explanatory
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// port (8080)
    #[macro_config_default(8080)]
    pub port: usize,
    /// the tablename of the metadata table
    pub static_file_service_dynamodb_table_name: StaticFileServiceDynamodbTableName,
    /// s3 storage bucket
    pub static_storage_bucket: StaticStorageBucket,
    /// service url
    #[macro_config_default(StaticFileServiceUrl::unwrap_new().to_string())]
    pub static_file_service_url: String,
    /// s3 upload notification queue
    pub static_file_service_s3_event_queue_url: StaticFileServiceS3EventQueueUrl,
    /// Internal API secret key
    pub internal_api_secret_key: LocalOrRemoteSecret<InternalApiSecretKey>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load static file service config")
    }
}
