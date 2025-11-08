use anyhow::Context;

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
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
        let redis_uri = std::env::var("REDIS_URI").context("REDIS_URI must be provided")?;
        let document_storage_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")
            .context("DOCUMENT_STORAGE_BUCKET must be provided")?;
        let web_socket_response_lambda = std::env::var("WEB_SOCKET_RESPONSE_LAMBDA")
            .context("WEB_SOCKET_RESPONSE_LAMBDA must be provided")?;
        let convert_queue =
            std::env::var("CONVERT_QUEUE").context("CONVERT_QUEUE must be provided")?;
        Ok(Config {
            database_url,
            redis_uri,
            document_storage_bucket,
            web_socket_response_lambda,
            convert_queue,
        })
    }
}
