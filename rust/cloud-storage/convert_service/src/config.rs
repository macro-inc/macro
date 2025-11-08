use anyhow::Context;
use macro_env::Environment;
use std::sync::LazyLock;

/// The path to the LibreOffice binary
pub static LOK_PATH: LazyLock<String> = LazyLock::new(|| std::env::var("LOK_PATH").unwrap());

/// The websocket response lambda
pub static WEB_SOCKET_RESPONSE_LAMBDA: LazyLock<String> =
    LazyLock::new(|| std::env::var("WEB_SOCKET_RESPONSE_LAMBDA").unwrap());

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
pub struct Config {
    /// The SQS queue for convert jobs
    pub convert_queue: String,
    /// The queue max messages per poll
    pub queue_max_messages: i32,
    /// The queue wait time seconds
    pub queue_wait_time_seconds: i32,

    /// The path to the LibreOffice binary
    #[allow(dead_code)]
    pub lok_path: String,

    /// The url of macrodb
    pub database_url: String,

    /// The name of the document storage bucket
    pub document_storage_bucket: String,

    /// The lambda function to send job responses to for conversion
    #[allow(dead_code)]
    pub web_socket_response_lambda: String,

    /// The port to listen for HTTP requests on.
    pub port: usize,
    /// The environment we are in
    pub environment: Environment,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let convert_queue =
            std::env::var("CONVERT_QUEUE").context("CONVERT_QUEUE must be provided")?;

        let queue_max_messages: i32 = std::env::var("QUEUE_MAX_MESSAGES")
            .unwrap_or("5".to_string()) // For the convert queue, we can safely handle ~5 conversions at a time
            .parse::<i32>()
            .unwrap();

        let queue_wait_time_seconds: i32 = std::env::var("QUEUE_WAIT_TIME_SECONDS")
            .unwrap_or("5".to_string())
            .parse::<i32>()
            .unwrap();

        let lok_path = std::env::var("LOK_PATH").context("LOK_PATH must be provided")?;

        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let document_storage_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")
            .context("DOCUMENT_STORAGE_BUCKET must be provided")?;

        let web_socket_response_lambda = std::env::var("WEB_SOCKET_RESPONSE_LAMBDA")
            .context("WEB_SOCKET_RESPONSE_LAMBDA must be provided")?;

        let environment = Environment::new_or_prod();

        Ok(Config {
            convert_queue,
            queue_max_messages,
            queue_wait_time_seconds,
            lok_path,
            database_url,
            document_storage_bucket,
            web_socket_response_lambda,
            port,
            environment,
        })
    }
}
