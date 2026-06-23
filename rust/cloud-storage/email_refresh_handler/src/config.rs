use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_vars;

env_vars! {
    struct DatabaseUrl;
    struct LinkManagerQueue;
    struct DeleteUnusedAfterDays;
    struct DeleteInactiveAfterDays;
    struct InboxHealthPollIntervalHours;
}

#[derive(Debug, Clone)]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The queue we put the emails on that need refreshing
    pub link_manager_queue: String,

    /// The environment we are in
    #[allow(dead_code)]
    pub environment: Environment,

    /// How many days to keep never-used links around
    pub delete_unused_after_days: u32,

    /// How many days to keep inactive links around
    pub delete_inactive_after_days: u32,

    /// How often (in hours) the background poll probes each link's grant health
    pub health_poll_interval_hours: u32,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = DatabaseUrl::new()
            .context("DATABASE_URL must be provided")?
            .to_string();

        let link_manager_queue = LinkManagerQueue::new()
            .context("LINK_MANAGER_QUEUE must be provided")?
            .to_string();

        let environment = Environment::new_or_prod();

        let delete_unused_after_days = DeleteUnusedAfterDays::new()
            .context("DELETE_UNUSED_AFTER_DAYS must be provided")?
            .parse()
            .context("DELETE_UNUSED_AFTER_DAYS must be a valid u32")?;

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
            link_manager_queue,
            environment,
            delete_unused_after_days,
            delete_inactive_after_days,
            health_poll_interval_hours,
        })
    }
}
