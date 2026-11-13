//! Startup configuration, from Doppler `gitai-service` (`APP_SECRETS_JSON` in
//! ECS). Pulumi writes the bucket and table names into Doppler; the repository
//! allowlist and the pinned client version are constants in `gitai`.

use macro_env_var::{env_vars, maybe_env_vars};

env_vars! {
    /// Mints device credentials. Only an operator holds it; it never sits on
    /// a laptop.
    pub struct GitaiSharedKey;
    /// Bucket for raw batches, notes, commits and usage. Kept indefinitely.
    pub struct GitaiEventsBucket;
    /// Bucket for session transcripts. Expires after 180 days.
    pub struct GitaiSessionsBucket;
    /// The DynamoDB index table.
    pub struct GitaiTable;
}

maybe_env_vars! {
    /// Reads pull request commits on the public repository, to resolve
    /// squash merges. Unset means unauthenticated GitHub requests.
    pub struct GithubToken;
}

/// Settings supplied by the deployment.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// See [`GitaiSharedKey`].
    pub gitai_shared_key: GitaiSharedKey,
    /// See [`GithubToken`].
    pub github_token: GithubToken,
    /// See [`GitaiEventsBucket`].
    pub gitai_events_bucket: GitaiEventsBucket,
    /// See [`GitaiSessionsBucket`].
    pub gitai_sessions_bucket: GitaiSessionsBucket,
    /// See [`GitaiTable`].
    pub gitai_table: GitaiTable,
}
