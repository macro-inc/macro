use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_vars;

env_vars! {
    struct DatabaseUrl;
    struct DocumentDeleteQueue;
    struct ChatDeleteQueue;
    struct SearchEventQueue;
}

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
        let database_url = DatabaseUrl::new()
            .context("DATABASE_URL must be provided")?
            .to_string();

        let document_delete_queue = DocumentDeleteQueue::new()
            .context("DOCUMENT_DELETE_QUEUE must be provided")?
            .to_string();

        let chat_delete_queue = ChatDeleteQueue::new()
            .context("CHAT_DELETE_QUEUE must be provided")?
            .to_string();

        let search_event_queue = SearchEventQueue::new()
            .context("SEARCH_EVENT_QUEUE must be provided")?
            .to_string();

        Ok(Config {
            database_url,
            document_delete_queue,
            chat_delete_queue,
            search_event_queue,
            environment: Environment::new_or_prod(),
        })
    }
}
