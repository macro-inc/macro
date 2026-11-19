//! Startup configuration: the probe user's API key, from Doppler
//! (`APP_SECRETS_JSON` in ECS), and the health port. The gateway it calls
//! follows `ENVIRONMENT`.

use macro_env_var::env_vars;

env_vars! {
    /// A user API key (`mak_...`) of the account the probe acts as, one per
    /// environment.
    pub struct ProbeUserApiKey;
}

/// Settings supplied by the deployment.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The probe user's key. Required: the probe has no other identity.
    pub probe_user_api_key: ProbeUserApiKey,

    /// The port `GET /health` listens on.
    #[macro_config_default(8080)]
    pub port: u16,
}
