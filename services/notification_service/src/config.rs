//! Configuration for the notification service, loaded via the standard
//! `macro_config` pattern so it gets a `doppler_config` validation binary.
//!
//! Required env vars are declared here as typed fields. The `doppler_config`
//! binary loads this `Config` from Doppler for both the dev and prod
//! environments, surfacing any missing or mistyped values at CI time.

use anyhow::Context;
use database_env_vars::{DatabaseUrl, RedisUri};
use macro_auth::InternalApiKey;
use macro_env::Environment;
use macro_env_var::{env_var, env_vars, maybe_env_var};
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
    pub(crate) struct AppleBundleId;
    #[derive(Debug, Clone)]
    pub(crate) struct SnsApnsPlatformArn;
    #[derive(Debug, Clone)]
    pub(crate) struct SnsFcmPlatformArn;
    #[derive(Debug, Clone)]
    pub(crate) struct SenderBaseAddress;
    #[derive(Debug, Clone)]
    pub(crate) struct LastOnlineRedisUri;
    /// Comma-separated Kafka bootstrap servers for WebSocket notification delivery.
    #[derive(Debug, Clone)]
    pub(crate) struct KafkaBrokers;
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

    /// Internal API key.
    pub(crate) internal_api_key: InternalApiKey,

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

    /// Redis used by notification-service for digest batching, rate limiting, etc.
    pub(crate) redis_uri: RedisUri,

    /// Redis used by connection-gateway for last-online state.
    pub(crate) last_online_redis_uri: LastOnlineRedisUri,

    /// Comma-separated Kafka bootstrap servers for WebSocket notification delivery.
    pub(crate) kafka_brokers: KafkaBrokers,

    /// Apple app bundle id for APNS pushes.
    pub(crate) apple_bundle_id: AppleBundleId,

    /// The SNS iOS platform ARN.
    pub(crate) sns_apns_platform_arn: SnsApnsPlatformArn,

    /// The SNS Android platform ARN.
    pub(crate) sns_fcm_platform_arn: SnsFcmPlatformArn,

    /// The SNS iOS VoIP platform ARN (APNS_VOIP). Optional locally.
    pub(crate) sns_apns_voip_platform_arn: SnsApnsVoipPlatformArn,
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
