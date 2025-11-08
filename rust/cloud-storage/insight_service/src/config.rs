use anyhow::Context;
pub use macro_env::Environment;
use std::env::var;
#[derive(Debug, Clone)]
pub struct Config {
    /// Current environment
    pub environment: Environment,
    /// SQS Url
    pub queue_url: String,
    /// max messages per poll
    pub queue_max_messages: u32,
    /// queue wait time
    pub queue_wait_time_seconds: u32,
    /// macro_db_url
    pub macro_db_url: String,
    /// api port
    pub port: u32,
    pub lexical_service_url: String,
    pub internal_auth_key: String,
    pub document_storage_service_url: String,
    pub sync_service_url: String,
    pub sync_service_auth_key: String,
    pub email_service_url: String,
    pub document_cognition_service_url: String,
}

impl Config {
    pub fn from_env() -> Result<Self, anyhow::Error> {
        let environment = Environment::new_or_prod();

        let queue_url = var("INSIGHT_CONTEXT_QUEUE").context("INSIGHT_CONTEXT_QUEUE")?;

        let queue_max_messages = var("INSIGHT_CONTEXT_QUEUE_MAX_MESSAGES")
            .unwrap_or("5".to_string())
            .parse::<u32>()
            .context("INSIGHT_CONTEXT_QUEUE_MAX_MESSAGES")?;

        let queue_wait_time_seconds = var("INSIGHT_CONTEXT_QUEUE_WAIT_TIME_SECONDS")
            .unwrap_or("5".to_string())
            .parse::<u32>()
            .unwrap();

        let macro_db_url = var("MACRODB_URL").context("MACRODB_URL")?;

        let port = var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<u32>()
            .expect("PORT to be a number");

        let lexical_service_url =
            var("LEXICAL_SERVICE_URL").expect("LEXICAL_SERVICE_URL to be provied");

        let internal_auth_key = std::env::var("SERVICE_INTERNAL_AUTH_KEY")
            .expect("SERVICE_INTERNAL_AUTH_KEY environment variable not set");

        let document_storage_service_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")
            .expect("DOCUMENT_STORAGE_SERVICE_URL must be provided");

        let sync_service_url =
            std::env::var("SYNC_SERVICE_URL").expect("SYNC_SERVICE_URL must be provided");

        let sync_service_auth_key =
            std::env::var("SYNC_SERVICE_AUTH_KEY").expect("SYNC_SERVICE_AUTH_KEY must be provided");

        let email_service_url =
            std::env::var("EMAIL_SERVICE_URL").expect("EMAIL_SERVICE_URL must be provided");

        let document_cognition_service_url = std::env::var("DOCUMENT_COGNITION_SERVICE_URL")
            .expect("DOCUMENT_COGNITION_SERVICE_URL must be provided");

        Ok(Config {
            environment,
            queue_url,
            queue_wait_time_seconds,
            queue_max_messages,
            macro_db_url,
            port,
            lexical_service_url,
            internal_auth_key,
            document_storage_service_url,
            sync_service_url,
            sync_service_auth_key,
            email_service_url,
            document_cognition_service_url,
        })
    }
}
