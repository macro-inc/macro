use anyhow::Context;
pub use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;

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

    pub comms_service_url: String,

    pub email_service_url: String,

    pub dss_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("should be valid port number")?;

        let environment = Environment::new_or_prod();

        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let opensearch_url =
            std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL must be provided")?;
        let opensearch_username =
            std::env::var("OPENSEARCH_USERNAME").context("OPENSEARCH_USERNAME must be provided")?;
        let opensearch_password =
            std::env::var("OPENSEARCH_PASSWORD").context("OPENSEARCH_PASSWORD must be provided")?;

        let internal_auth_key = LocalOrRemoteSecret::Local(InternalApiSecretKey::new()?);

        let comms_service_url =
            std::env::var("COMMS_SERVICE_URL").context("COMMS_SERVICE_URL must be provided")?;

        let email_service_url =
            std::env::var("EMAIL_SERVICE_URL").context("EMAIL_SERVICE_URL must be provided")?;

        let dss_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")
            .context("DOCUMENT_STORAGE_SERVICE_URL must be provided")?;
        Ok(Config {
            port,
            environment,
            database_url,
            opensearch_url,
            opensearch_username,
            opensearch_password,
            internal_auth_key,
            comms_service_url,
            email_service_url,
            dss_url,
        })
    }
}
