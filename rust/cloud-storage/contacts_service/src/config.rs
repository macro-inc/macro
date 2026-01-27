use anyhow::Context;
pub use macro_env::Environment;

pub struct Config {
    /// port number of service
    pub port: usize,
    /// The environment we are in
    pub environment: Environment,
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,
    /// SQS URL
    pub queue_url: String,
    /// The notification queue max messages per poll
    pub queue_max_messages: i32,
    /// The notification queue wait time seconds
    pub queue_wait_time_seconds: i32,
    /// Connection gateway URL for sending real-time notifications
    pub connection_gateway_url: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .unwrap();

        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let queue_url =
            std::env::var("CONTACTS_QUEUE").context("CONTACTS_QUEUE must be provided")?;

        let queue_max_messages: i32 = std::env::var("CONTACTS_QUEUE_MAX_MESSAGES")
            .unwrap_or("10".to_string())
            .parse::<i32>()
            .unwrap();

        let queue_wait_time_seconds: i32 = std::env::var("CONTACTS_QUEUE_WAIT_TIME_SECONDS")
            .unwrap_or("5".to_string())
            .parse::<i32>()
            .unwrap();

        let connection_gateway_url = std::env::var("CONNECTION_GATEWAY_URL").ok();

        let environment = Environment::new_or_prod();

        Ok(Config {
            port,
            environment,
            database_url,
            queue_url,
            queue_wait_time_seconds,
            queue_max_messages,
            connection_gateway_url,
        })
    }

    #[cfg(test)]
    pub fn new_testing() -> Self {
        Config {
            port: 0,
            environment: Environment::Local,
            database_url: "".to_string(),
            queue_url: "".to_string(),
            queue_max_messages: 0,
            queue_wait_time_seconds: 0,
            connection_gateway_url: None,
        }
    }
}
