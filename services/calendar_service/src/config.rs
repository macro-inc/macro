use anyhow::Context;
use calendar_events::domain::models::GoogleWatchConfig;
use macro_auth::InternalApiKey;
pub use macro_env::Environment;
use macro_env_var::env_vars;
use secretsmanager_client::LocalOrRemoteSecret;

/// Push notification channels are opened only when both optional watch
/// variables are configured; without them the periodic poll is the sole
/// freshness mechanism.
pub fn calendar_watch_config() -> Option<GoogleWatchConfig> {
    // A variable set to an empty string must count as unset: a blank token
    // would verify blank-header webhook requests.
    let read = |name| {
        macro_env_var::maybe_read_env(name)
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    let address = read("CALENDAR_WATCH_WEBHOOK_URL")?;
    let token = read("CALENDAR_WATCH_TOKEN")?;
    Some(GoogleWatchConfig { address, token })
}

env_vars! {
    pub struct KafkaBrokers;
    pub struct MacroDbUrl;
    pub struct RedisUri;
    pub struct AuthenticationServiceSecretKey;
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The connection URL for the macrodb instance this application should use.
    /// For deployed applications, this is a secret stored in AWS Secrets Manager.
    pub macro_db_url: MacroDbUrl,

    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub port: usize,

    /// The Redis URI for the Redis this application should use.
    pub redis_uri: RedisUri,

    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub kafka_brokers: KafkaBrokers,

    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,

    /// Master switch for calendar sync. When `false` (the default) the sync
    /// scheduler stays parked, the calendar outbox stops publishing, and
    /// calendar backfill deliveries requeue their outbox rows. Enabling it
    /// later resumes everything without a migration.
    #[macro_config_default(false)]
    pub calendar_sync_enabled: bool,

    /// Auth service secret key, used for internal access
    pub authentication_service_secret_key: LocalOrRemoteSecret<AuthenticationServiceSecretKey>,

    /// The internal api key
    pub internal_api_key: InternalApiKey,

    /// The number of workers we spawn for the calendar backfill queue
    #[macro_config_default(25)]
    pub backfill_queue_workers: i32,

    /// The queue max messages per poll for the calendar backfill queue
    #[macro_config_default(1)]
    pub backfill_queue_max_messages: i32,

    /// The queue max messages per poll
    #[macro_config_default(10)]
    pub queue_max_messages: i32,

    /// The queue wait time seconds
    #[macro_config_default(20)]
    pub queue_wait_time_seconds: i32,

    /// The size of the sliding window we use for Google Calendar rate limiting.
    #[macro_config_default(60)]
    pub redis_rate_limit_window_secs: u32,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>().context("failed to load config")
    }
}
