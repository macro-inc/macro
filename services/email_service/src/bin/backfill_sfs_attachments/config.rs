use anyhow::Context;
use macro_env_var::env_vars;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    pub sfs_url: String,
    pub internal_auth_key: String,
    pub macro_ids: String,
    pub database_url: String,
    pub upload_concurrency: usize,
    pub fusionauth_api_key: String,
    pub fusionauth_base_url: String,
    pub fusionauth_identity_provider_id: String,
    pub gmail_client_id: String,
    pub gmail_client_secret: String,
}

env_vars! {
    struct UploadConcurrency;
    struct SfsUrl;
    struct InternalAuthKey;
    struct MacroIds;
    struct DatabaseUrl;
    struct FusionauthApiKey;
    struct FusionauthBaseUrl;
    struct FusionauthIdentityProviderId;
    struct GmailClientId;
    struct GmailClientSecret;
}

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let upload_concurrency = UploadConcurrency::new()
            .context("UPLOAD_CONCURRENCY not set")?
            .parse::<usize>()
            .context("UPLOAD_CONCURRENCY is not a number")?;

        Ok(Self {
            sfs_url: SfsUrl::new().context("SFS_URL not set")?.to_string(),
            internal_auth_key: InternalAuthKey::new()
                .context("INTERNAL_AUTH_KEY not set")?
                .to_string(),
            macro_ids: MacroIds::new().context("MACRO_IDS not set")?.to_string(),
            database_url: DatabaseUrl::new()
                .context("DATABASE_URL not set")?
                .to_string(),
            upload_concurrency,
            fusionauth_api_key: FusionauthApiKey::new()
                .context("FUSIONAUTH_API_KEY not set")?
                .to_string(),
            fusionauth_base_url: FusionauthBaseUrl::new()
                .context("FUSIONAUTH_BASE_URL not set")?
                .to_string(),
            fusionauth_identity_provider_id: FusionauthIdentityProviderId::new()
                .context("FUSIONAUTH_IDENTITY_PROVIDER_ID not set")?
                .to_string(),
            gmail_client_id: GmailClientId::new()
                .context("GMAIL_CLIENT_ID not set")?
                .to_string(),
            gmail_client_secret: GmailClientSecret::new()
                .context("GMAIL_CLIENT_SECRET not set")?
                .to_string(),
        })
    }
}
