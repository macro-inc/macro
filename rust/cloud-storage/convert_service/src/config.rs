use std::sync::LazyLock;

use anyhow::Context;
use database_env_vars::DatabaseUrl;
pub use macro_env::Environment;
use macro_env_var::env_vars;

/// The path to the LibreOffice binary
pub static LOK_PATH: LazyLock<String> = LazyLock::new(|| {
    macro_config::required_config_value("LOK_PATH")
        .expect("LOK_PATH must be provided via APP_SECRETS_JSON or env")
});

/// The websocket response lambda
pub static WEB_SOCKET_RESPONSE_LAMBDA: LazyLock<String> = LazyLock::new(|| {
    macro_config::required_config_value("WEB_SOCKET_RESPONSE_LAMBDA")
        .expect("WEB_SOCKET_RESPONSE_LAMBDA must be provided via APP_SECRETS_JSON or env")
});

env_vars! {
    pub struct ConvertQueue;
    pub struct LokPath;
    pub struct DocumentStorageBucket;
    pub struct WebSocketResponseLambda;
}

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The SQS queue for convert jobs
    pub convert_queue: ConvertQueue,
    /// The queue max messages per poll
    #[macro_config_default(5)]
    pub queue_max_messages: i32,
    /// The queue wait time seconds
    #[macro_config_default(5)]
    pub queue_wait_time_seconds: i32,

    /// The path to the LibreOffice binary
    pub lok_path: LokPath,

    /// The url of macrodb
    pub database_url: DatabaseUrl,

    /// The name of the document storage bucket
    pub document_storage_bucket: DocumentStorageBucket,

    /// The lambda function to send job responses to for conversion
    #[allow(dead_code)]
    pub web_socket_response_lambda: WebSocketResponseLambda,

    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load convert service config")
    }
}
