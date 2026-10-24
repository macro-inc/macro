//! Startup configuration. Every value comes from Doppler (`APP_SECRETS_JSON` in
//! ECS); test-only overrides are read from the process environment by the
//! adapters that use them.

use database_env_vars::DatabaseUrl;

/// Settings supplied by the deployment.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// Pooled MacroDB URL for every read and fenced write.
    pub database_url: DatabaseUrl,
    /// Direct, non-pooled MacroDB URL: the advisory-lock connection and `LISTEN`.
    pub whatsapp_session_lock_database_url: String,
    /// KMS key that wraps each account's data key.
    pub whatsapp_session_kms_key_id: String,
    /// Most accounts one replica runs.
    pub whatsapp_session_max_accounts: u32,
    /// Accounts released per drain step on shutdown.
    pub whatsapp_session_drain_batch: u32,
}
