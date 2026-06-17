use anyhow::Context;
use macro_env_var::env_vars;

env_vars! {
    pub struct DatabaseUrl;
    pub struct RedisUri;
    pub struct DocumentStorageBucket;
    pub struct WebSocketResponseLambda;
    pub struct ConvertQueue;
}

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
#[derive(Debug, Clone)]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The connection URI for the redis cluster this application should use.
    pub redis_uri: String,

    /// The document storage s3 bucket
    pub document_storage_bucket: String,

    /// The name of the lambda function that will be used to send the response to the websocket
    pub web_socket_response_lambda: String,

    /// The name of the convert queue
    pub convert_queue: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = DatabaseUrl::new()
            .context("DATABASE_URL must be provided")?
            .to_string();
        let redis_uri = RedisUri::new()
            .context("REDIS_URI must be provided")?
            .to_string();
        let document_storage_bucket = DocumentStorageBucket::new()
            .context("DOCUMENT_STORAGE_BUCKET must be provided")?
            .to_string();
        let web_socket_response_lambda = WebSocketResponseLambda::new()
            .context("WEB_SOCKET_RESPONSE_LAMBDA must be provided")?
            .to_string();
        let convert_queue = ConvertQueue::new()
            .context("CONVERT_QUEUE must be provided")?
            .to_string();

        Ok(Config {
            database_url,
            redis_uri,
            document_storage_bucket,
            web_socket_response_lambda,
            convert_queue,
        })
    }
}
