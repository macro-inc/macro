use macro_env_var::env_var;

use crate::service::{auth::Auth, db::Db};

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
        /// Fusionauth oauth redirect uri
        pub FusionauthOauthRedirectUri,
    }
}

/// The context containing everything we need to use in the CLI
pub struct SeedCliContext {
    /// Database connection to macrodb
    pub db: Db,
    /// Fusionauth client
    pub fusionauth_client: Auth,
}
