use anyhow::Context;
use database_env_vars::{DatabaseUrl, RedisUri};
use macro_env::Environment;
use macro_env_var::{env_var, env_vars, maybe_env_var};
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use std::sync::LazyLock;

// We load this through `macro_config` at startup as part of [`Config`]. This lazy is retained for
// older notification template code paths that do not receive `Config` directly.
pub static BASE_URL: LazyLock<String> = LazyLock::new(|| {
    BaseUrl::new()
        .expect("BASE_URL must be provided via APP_SECRETS_JSON or env")
        .as_ref()
        .to_string()
});

env_vars! {
    #[derive(Debug, Clone)]
    pub(crate) struct BaseUrl;
    #[derive(Debug, Clone)]
    pub(crate) struct NotificationQueue;
    #[derive(Debug, Clone)]
    pub(crate) struct NotificationIngressQueue;
    #[derive(Debug, Clone)]
    pub(crate) struct AppleBundleId;
    #[derive(Debug, Clone)]
    pub(crate) struct SnsApnsPlatformArn;
    #[derive(Debug, Clone)]
    pub(crate) struct SnsFcmPlatformArn;
    #[derive(Debug, Clone)]
    pub(crate) struct SenderBaseAddress;
    #[derive(Debug, Clone)]
    pub(crate) struct PushNotificationEventHandlerQueue;
    #[derive(Debug, Clone)]
    pub(crate) struct LastOnlineRedisUri;
}

maybe_env_var! {
    #[derive(Debug, Clone)]
    pub(crate) struct SnsApnsVoipPlatformArn;
}

env_var!(
    #[derive(Debug, Clone)]
    pub(crate) struct UrlSigningHmac;
);

/// The configuration parameters for the application.
///
/// These are loaded from `APP_SECRETS_JSON` when present, otherwise from environment variables.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The service's base url including the scheme.
    #[allow(dead_code)]
    pub(crate) base_url: BaseUrl,

    /// The connection URL for the Postgres database this application should use.
    pub(crate) database_url: DatabaseUrl,

    /// Internal API secret key name/value.
    pub(crate) internal_api_secret_key: InternalApiSecretKey,

    /// Secret name/value for digest unsubscribe URL signing.
    pub(crate) url_signing_hmac: UrlSigningHmac,

    /// The port to listen for HTTP requests on.
    #[macro_config_default(8080)]
    pub(crate) port: usize,

    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub(crate) environment: Environment,

    /// The notification queue max messages per poll.
    #[macro_config_default(9)]
    pub(crate) notification_queue_max_messages: i32,

    /// The notification queue wait time seconds.
    #[macro_config_default(4)]
    pub(crate) notification_queue_wait_time_seconds: i32,

    /// The SQS queue for egress notification delivery.
    pub(crate) notification_queue: NotificationQueue,

    /// The SQS queue for ingress notification creation.
    pub(crate) notification_ingress_queue: NotificationIngressQueue,

    /// Redis used by notification-service for digest batching, rate limiting, etc.
    pub(crate) redis_uri: RedisUri,

    /// Redis used by connection-gateway for last-online state.
    pub(crate) last_online_redis_uri: LastOnlineRedisUri,

    /// Apple app bundle id for APNS pushes.
    pub(crate) apple_bundle_id: AppleBundleId,

    /// The SNS iOS platform ARN.
    pub(crate) sns_apns_platform_arn: SnsApnsPlatformArn,

    /// The SNS Android platform ARN.
    pub(crate) sns_fcm_platform_arn: SnsFcmPlatformArn,

    /// The SNS iOS VoIP platform ARN (APNS_VOIP). Optional locally.
    pub(crate) sns_apns_voip_platform_arn: SnsApnsVoipPlatformArn,

    /// The push notification event handler queue.
    pub(crate) push_notification_event_handler_queue: PushNotificationEventHandlerQueue,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let config = macro_config::ConfigLoader::load::<Config>()
            .context("failed to load notification service config")?;

        if !matches!(config.environment, Environment::Local)
            && !config.sns_apns_voip_platform_arn.is_set()
        {
            anyhow::bail!("SNS_APNS_VOIP_PLATFORM_ARN must be provided");
        }

        Ok(config)
    }

    pub fn sns_apns_voip_platform_arn(&self) -> &str {
        self.sns_apns_voip_platform_arn.value().unwrap_or("")
    }
}
