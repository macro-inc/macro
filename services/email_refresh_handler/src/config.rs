use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_vars;

env_vars! {
    struct DatabaseUrl;
    struct PauseInactiveAfterDays;
    struct DeleteInactiveAfterDays;
    struct InboxHealthPollIntervalHours;
}

#[derive(Debug, Clone)]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The environment we are in
    #[allow(dead_code)]
    pub environment: Environment,

    /// How many days without activity before a link's sync is paused
    pub pause_inactive_after_days: u32,

    /// How many days without activity before a link is deleted
    pub delete_inactive_after_days: u32,

    /// How often (in hours) the background poll probes each link's grant health
    pub health_poll_interval_hours: u32,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = DatabaseUrl::new()
            .context("DATABASE_URL must be provided")?
            .to_string();

        let environment = Environment::new_or_prod();

        let pause_inactive_after_days = PauseInactiveAfterDays::new()
            .context("PAUSE_INACTIVE_AFTER_DAYS must be provided")?
            .parse()
            .context("PAUSE_INACTIVE_AFTER_DAYS must be a valid u32")?;

        let delete_inactive_after_days = DeleteInactiveAfterDays::new()
            .context("DELETE_INACTIVE_AFTER_DAYS must be provided")?
            .parse()
            .context("DELETE_INACTIVE_AFTER_DAYS must be a valid u32")?;

        let health_poll_interval_hours = InboxHealthPollIntervalHours::new()
            .context("INBOX_HEALTH_POLL_INTERVAL_HOURS must be provided")?
            .parse()
            .context("INBOX_HEALTH_POLL_INTERVAL_HOURS must be a valid u32")?;

        Ok(Config {
            database_url,
            environment,
            pause_inactive_after_days,
            delete_inactive_after_days,
            health_poll_interval_hours,
        })
    }
}
