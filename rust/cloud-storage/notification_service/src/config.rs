use anyhow::Context;
use macro_env::Environment;
use macro_env_var::env_var;
use std::sync::LazyLock;

// We have a check for this env var in the config creation so we can safely unwrap here
pub static BASE_URL: LazyLock<String> = LazyLock::new(|| std::env::var("BASE_URL").unwrap());

env_var!(
    pub(super) struct Vars {
        pub(crate) NotificationQueue,
        pub(crate) ConnectionGatewayUrl,
        pub(crate) RedisUri,
        pub(crate) AppleBundleId
    }
);

#[derive(Debug)]
pub struct Config {
    /// The services base url including the scheme.
    pub base_url: String,

    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// Internal API secret key
    pub internal_api_secret_key: String,

    /// The port to listen for HTTP requests on.
    pub port: usize,

    /// The environment we are in
    pub environment: Environment,

    /// The notification queue max messages per poll
    pub notification_queue_max_messages: i32,
    /// The notification queue wait time seconds
    pub notification_queue_wait_time_seconds: i32,

    /// The sns ios platform arn
    pub sns_apns_platform_arn: String,

    /// The sns android platform arn
    pub sns_fcm_platform_arn: String,

    /// The sender base address
    // Explicitly allowed as it's used to ensure we have a correct sender base address in the lazy env var above
    pub sender_base_address: String,

    /// The push notification event handler queue
    pub push_notification_event_handler_queue: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let base_url = std::env::var("BASE_URL").context("BASE_URL must be provided")?;

        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let internal_api_secret_key = std::env::var("INTERNAL_API_SECRET_KEY")
            .context("INTERNAL_API_SECRET_KEY must be provided")?;

        let environment = Environment::new_or_prod();

        let notification_queue_max_messages: i32 = std::env::var("NOTIFICATION_QUEUE_MAX_MESSAGES")
            .unwrap_or("9".to_string())
            .parse::<i32>()
            .unwrap();

        let notification_queue_wait_time_seconds: i32 =
            std::env::var("NOTIFICATION_QUEUE_WAIT_TIME_SECONDS")
                .unwrap_or("4".to_string())
                .parse::<i32>()
                .unwrap();

        let sns_apns_platform_arn = std::env::var("SNS_APNS_PLATFORM_ARN")
            .context("SNS_APNS_PLATFORM_ARN must be provided")?;

        let sns_fcm_platform_arn = std::env::var("SNS_FCM_PLATFORM_ARN")
            .context("SNS_FCM_PLATFORM_ARN must be provided")?;

        let sender_base_address =
            std::env::var("SENDER_BASE_ADDRESS").context("SENDER_BASE_ADDRESS must be provided")?;

        let push_notification_event_handler_queue =
            std::env::var("PUSH_NOTIFICATION_EVENT_HANDLER_QUEUE")
                .context("PUSH_NOTIFICATION_EVENT_HANDLER_QUEUE must be provided")?;

        println!(
            "push_notification_event_handler_queue: {}",
            push_notification_event_handler_queue
        );

        Ok(Config {
            base_url,
            database_url,
            internal_api_secret_key,
            port,
            environment,
            notification_queue_max_messages,
            notification_queue_wait_time_seconds,
            sns_apns_platform_arn,
            sns_fcm_platform_arn,
            sender_base_address,
            push_notification_event_handler_queue,
        })
    }
}
