use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};

env_vars! {
    pub struct BaseUrl;
    pub struct DatabaseUrl;
    pub struct RedisUri;
    pub struct ContactsQueue;
}

maybe_env_vars! {
    pub struct ContactsQueueMaxMessages;
    pub struct ContactsQueueWaitTimeSeconds;
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// port number of service
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The connection URL for the Postgres database this application should use.
    pub database_url: DatabaseUrl,
    /// The Redis URI for rate limiting.
    pub redis_uri: RedisUri,
    /// SQS URL
    pub contacts_queue: ContactsQueue,
    /// The notification queue max messages per poll
    pub contacts_queue_max_messages: ContactsQueueMaxMessages,
    /// The notification queue wait time seconds
    pub contacts_queue_wait_time_seconds: ContactsQueueWaitTimeSeconds,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load contacts service config")
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn new_testing() -> Self {
        Config {
            port: 0,
            environment: Environment::Local,
            database_url: DatabaseUrl::new_testing(""),
            redis_uri: RedisUri::new_testing(""),
            contacts_queue: ContactsQueue::new_testing(""),
            contacts_queue_max_messages: ContactsQueueMaxMessages::new_unset(),
            contacts_queue_wait_time_seconds: ContactsQueueWaitTimeSeconds::new_unset(),
        }
    }
}
