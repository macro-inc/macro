use macro_env_var::env_var;

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
