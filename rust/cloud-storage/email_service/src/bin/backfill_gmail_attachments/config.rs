use anyhow::Context;

/// Holds all configuration loaded from environment variables.
pub struct Config {
    pub dss_url: String,
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

impl Config {
    /// Creates a new `Config` instance by reading from environment variables.
    /// Returns an error if any required variable is not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let upload_concurrency =
            std::env::var("UPLOAD_CONCURRENCY").context("UPLOAD_CONCURRENCY not set")?;
        let upload_concurrency = upload_concurrency
            .parse::<usize>()
            .context("UPLOAD_CONCURRENCY is not a number")?;

        Ok(Self {
            dss_url: std::env::var("DSS_URL").context("DSS_URL not set")?,
            internal_auth_key: std::env::var("INTERNAL_AUTH_KEY")
                .context("INTERNAL_AUTH_KEY not set")?,
            macro_ids: std::env::var("MACRO_IDS").context("MACRO_IDS not set")?, // Changed
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            upload_concurrency,
            fusionauth_api_key: std::env::var("FUSIONAUTH_API_KEY")
                .context("FUSIONAUTH_API_KEY not set")?,
            fusionauth_base_url: std::env::var("FUSIONAUTH_BASE_URL")
                .context("FUSIONAUTH_BASE_URL not set")?,
            fusionauth_identity_provider_id: std::env::var("FUSIONAUTH_IDENTITY_PROVIDER_ID")
                .context("FUSIONAUTH_IDENTITY_PROVIDER_ID not set")?,
            gmail_client_id: std::env::var("GMAIL_CLIENT_ID").context("GMAIL_CLIENT_ID not set")?,
            gmail_client_secret: std::env::var("GMAIL_CLIENT_SECRET")
                .context("GMAIL_CLIENT_SECRET not set")?,
        })
    }
}
