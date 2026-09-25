//! Typed deployment configuration, loaded through macro_env_var by MacroConfig.
use database_env_vars::DatabaseUrl;
use macro_env::Environment;

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    pub database_url: DatabaseUrl,
    pub internal_api_key: String,
    /// Persistent OpenSSH ed25519 server private key (Doppler secret).
    pub preview_ssh_host_key: String,
    pub preview_domain: String,
    pub preview_ssh_host: String,
    /// Local stacks only: Cloudflare quick-tunnel hostname fronting the SSH listener,
    /// so an agent running off this machine can still reach it.
    pub preview_ssh_proxy_host: Option<String>,
    #[macro_config_default(22)]
    pub preview_ssh_public_port: u16,
    #[macro_config_default(443)]
    pub preview_https_port: u16,
    /// Exact origin allowed to submit the browser authentication form.
    pub preview_app_origin: String,
    /// Comma separated DNS hostnames accepted on the internal MCP listener.
    pub preview_control_hosts: String,
    #[macro_config_default(8110)]
    pub port: u16,
    #[macro_config_default(8111)]
    pub preview_http_port: u16,
    #[macro_config_default(2222)]
    pub preview_ssh_port: u16,
}
