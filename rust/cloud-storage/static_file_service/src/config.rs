use anyhow::Context;
pub use macro_env::Environment;

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
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .unwrap();
        let dynamodb_table = std::env::var("DYNAMODB_TABLE_NAME")
            .context("DYNAMMODB_TABLE_NAME must be provided")?;

        let storage_bucket_name = std::env::var("STATIC_STORAGE_BUCKET")
            .context("STATIC_STORAGE_BUCKET must be provided")?;

        let service_url = std::env::var("SERVICE_URL").context("SERVICE_URL must be provided")?;

        let s3_event_queue_url =
            std::env::var("S3_EVENT_QUEUE_URL").context("S3_EVENT_QUEUE_URL must be provided")?;

        let internal_api_secret_key = std::env::var("INTERNAL_API_SECRET_KEY")
            .context("INTERNAL_API_SECRET_KEY must be provided")?;

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
