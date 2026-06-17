use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;

env_vars! {
    struct DatabaseUrl;
    struct OpensearchUrl;
    struct OpensearchUsername;
    struct OpensearchPassword;
}

maybe_env_vars! {
    struct Port;
}

pub struct Config {
    /// The port to listen for HTTP requests on.
    pub port: usize,

    /// The environment we are in
    pub environment: Environment,
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,
    /// The URL for the Opensearch instance
    pub opensearch_url: String,
    /// The username for the Opensearch instance
    pub opensearch_username: String,
    /// The password for the Opensearch instance
    pub opensearch_password: String,

    /// The internal auth key
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let port = Port::new()
            .map(|port| port.parse::<usize>().context("should be valid port number"))
            .transpose()?
            .unwrap_or(8080);

        let environment = Environment::new_or_prod();

        let database_url = DatabaseUrl::new()
            .context("DATABASE_URL must be provided")?
            .to_string();

        let opensearch_url = OpensearchUrl::new()
            .context("OPENSEARCH_URL must be provided")?
            .to_string();
        let opensearch_username = OpensearchUsername::new()
            .context("OPENSEARCH_USERNAME must be provided")?
            .to_string();
        let opensearch_password = OpensearchPassword::new()
            .context("OPENSEARCH_PASSWORD must be provided")?
            .to_string();

        let internal_auth_key = LocalOrRemoteSecret::Local(InternalApiSecretKey::new()?);

        Ok(Config {
            port,
            environment,
            database_url,
            opensearch_url,
            opensearch_username,
            opensearch_password,
            internal_auth_key,
        })
    }
}
