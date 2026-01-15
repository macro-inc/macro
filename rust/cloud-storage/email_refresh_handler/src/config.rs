use anyhow::Context;
pub use macro_env::Environment;

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
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let link_manager_queue =
            std::env::var("LINK_MANAGER_QUEUE").context("LINK_MANAGER_QUEUE must be provided")?;

        let environment = Environment::new_or_prod();

        let delete_unused_after_days = std::env::var("DELETE_UNUSED_AFTER_DAYS")
            .context("DELETE_UNUSED_AFTER_DAYS must be provided")?
            .parse()
            .context("DELETE_UNUSED_AFTER_DAYS must be a valid u32")?;

        let delete_inactive_after_days = std::env::var("DELETE_INACTIVE_AFTER_DAYS")
            .context("DELETE_INACTIVE_AFTER_DAYS must be provided")?
            .parse()
            .context("DELETE_INACTIVE_AFTER_DAYS must be a valid u32")?;

        Ok(Config {
            database_url,
            link_manager_queue,
            environment,
            delete_unused_after_days,
            delete_inactive_after_days,
        })
    }
}
