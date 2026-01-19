use anyhow::Context;
pub use macro_env::Environment;

#[derive(Debug, Clone)]
pub struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The queue we put messages on for deletion
    pub email_sfs_delete_queue: String,

    /// The environment we are in
    #[allow(dead_code)]
    pub environment: Environment,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let email_sfs_delete_queue =
            std::env::var("SFS_DELETE_QUEUE").context("SFS_DELETE_QUEUE must be provided")?;

        let environment = Environment::new_or_prod();

        Ok(Config {
            database_url,
            email_sfs_delete_queue,
            environment,
        })
    }
}
