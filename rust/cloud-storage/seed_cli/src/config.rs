use macro_env_var::env_var;
use sqlx::PgPool;

env_var! {
    pub struct EnvVars {
        /// macrodb url
        pub DatabaseUrl,
        /// fusionauth url
        pub FusionauthBaseUrl,
        /// fusionauth api key
        pub FusionauthApiKeySecretKey,
        /// fusionauth tenant id
        pub FusionauthTenantId,
        /// fusionauth client id
        pub FusionauthClientId,
        /// fusionauth client secret key
        pub FusionauthClientSecretKey,
    }
}

/// The context containing everything we need to use in the CLI
#[derive(Clone)]
pub struct SeedCliContext {
    /// Database connection to macrodb
    pub db: PgPool,
}
