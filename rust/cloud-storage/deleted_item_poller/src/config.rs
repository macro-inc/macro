use anyhow::Context;
pub use macro_env::Environment;

#[derive(Debug, Clone)]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The document delete queue
    pub document_delete_queue: String,

    /// The chat delete queue
    pub chat_delete_queue: String,

    /// The search text extractor queue
    pub search_event_queue: String,

    /// The environment we are in
    #[allow(dead_code)]
    pub environment: Environment,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let document_delete_queue = std::env::var("DOCUMENT_DELETE_QUEUE")
            .context("DOCUMENT_DELETE_QUEUE must be provided")?;

        let chat_delete_queue =
            std::env::var("CHAT_DELETE_QUEUE").context("CHAT_DELETE_QUEUE must be provided")?;

        let search_event_queue =
            std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

        Ok(Config {
            database_url,
            document_delete_queue,
            chat_delete_queue,
            search_event_queue,
            environment: Environment::new_or_prod(),
        })
    }
}
