//! Startup configuration, from Doppler (`APP_SECRETS_JSON` in ECS).

use std::path::PathBuf;

use database_env_vars::DatabaseUrl;
use macro_auth::InternalApiKey;
use macro_env::Environment;

/// 500 MiB.
const DEFAULT_MAX_REPO_SIZE_BYTES: u64 = 500 * 1024 * 1024;
const DEFAULT_PUSHES_PER_MINUTE: u32 = 30;

/// Settings supplied by the deployment.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// MacroDB URL.
    pub database_url: DatabaseUrl,
    /// Key other Macro services present on the internal API.
    pub internal_api_key: InternalApiKey,
    /// Directory holding the bare repos (the EFS mount in AWS, a docker
    /// volume locally). Must exist.
    pub repo_storage_root: PathBuf,
    /// Pushes are refused once a repo reaches this size.
    #[macro_config_default(DEFAULT_MAX_REPO_SIZE_BYTES)]
    pub max_repo_size_bytes: u64,
    /// Push budget per repo.
    #[macro_config_default(DEFAULT_PUSHES_PER_MINUTE)]
    pub pushes_per_minute: u32,
}
