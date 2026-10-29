//! Configuration for the email focus worker, loaded with `macro_config` from
//! the email-service Doppler project it shares with the other email binaries.

pub use macro_env::Environment;
use macro_env_var::env_vars;

env_vars! {
    /// The connection URL for the Macro database.
    pub struct MacroDbUrl;
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
}

/// The email focus worker's configuration.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The connection URL for the Macro database.
    pub macro_db_url: MacroDbUrl,
    /// Kafka bootstrap servers; the worker reads `macro.email`.
    pub kafka_brokers: KafkaBrokers,
    /// TypeSafe credential for Jev. While it is unset the worker classifies nothing.
    pub typesafe_api_key: jev::outbound::TypesafeApiKey,
    /// Comma-separated inbox domains to classify, e.g. `macro.com`. Mail from
    /// any other inbox never leaves the system. Empty classifies nothing.
    #[macro_config_default(String::new())]
    pub focus_enabled_email_domains: String,
    /// Seconds between sweeps for threads the event stream missed.
    #[macro_config_default(3600)]
    pub focus_sweep_interval_secs: u64,
    /// Days of mail the sweep and the Focus list cover.
    #[macro_config_default(30)]
    pub focus_window_days: u16,
}

impl Config {
    /// Load and validate the configuration from the environment.
    pub fn from_env() -> Result<Self, rootcause::Report> {
        Ok(macro_config::ConfigLoader::load::<Config>()?)
    }

    /// The allowlisted inbox domains, trimmed and lowercased.
    pub fn enabled_domains(&self) -> Vec<String> {
        self.focus_enabled_email_domains
            .split(',')
            .map(|domain| domain.trim().to_lowercase())
            .filter(|domain| !domain.is_empty())
            .collect()
    }
}
