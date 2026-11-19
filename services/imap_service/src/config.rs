use database_env_vars::DatabaseUrl;

use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
env_vars! {
    pub struct ImapCredentialKmsKeyId;
    pub struct InternalAuthKey;
}
maybe_env_vars! {
    pub struct PosthogApiKey;
    pub struct PosthogHost;
}
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    #[macro_config_default(8080)]
    pub port: u16,
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    pub database_url: DatabaseUrl,
    pub internal_auth_key: InternalAuthKey,
    pub posthog_api_key: PosthogApiKey,
    pub posthog_host: PosthogHost,
    pub imap_credential_kms_key_id: ImapCredentialKmsKeyId,
    #[macro_config_default(String::new())]
    pub imap_test_endpoint_map: String,
    #[macro_config_default(String::new())]
    pub imap_test_trust_root_pem: String,
}
