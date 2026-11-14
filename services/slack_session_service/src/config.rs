//! Startup configuration. `DATABASE_URL` comes from Doppler (`APP_SECRETS_JSON`
//! in ECS); the KMS key follows `ENVIRONMENT`
//! (`slack_linked::outbound::kms::SlackKmsKey`); Slack's hosts are
//! `macro_service_urls` types (`slack_client::SlackEndpoints::from_service_urls`).

use database_env_vars::DatabaseUrl;

/// Settings supplied by the deployment.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// MacroDB URL. It must reach the database instance, not RDS Proxy: the
    /// advisory-lock connection and `LISTEN` open from it too.
    pub database_url: DatabaseUrl,
}
