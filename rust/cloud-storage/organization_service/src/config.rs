use anyhow::Context;
pub use macro_env::Environment;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;

pub(crate) struct Config {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The connection URI for Macro Cache redis cluster.
    pub redis_uri: String,

    /// The internal auth key to call DSS.
    pub internal_api_secret_key: InternalApiSecretKey,

    /// The DSS URL.
    pub document_storage_service_url: String,

    /// The email used to send user invites to macro
    pub invite_email: String,

    /// The port to listen for HTTP requests on.
    pub port: usize,

    /// The environment we are in
    pub environment: Environment,

    /// The Auth service url
    pub authentication_service_url: String,
    /// The Auth service internal auth secret key
    pub authentication_service_internal_api_secret_key:
        LocalOrRemoteSecret<AuthenticationServiceInternalApiSecretKey>,
}

env_var! {
    pub(crate) struct AuthenticationServiceInternalApiSecretKey;
}

impl Config {
    pub fn from_env(
        authentication_service_internal_api_secret_key: LocalOrRemoteSecret<
            AuthenticationServiceInternalApiSecretKey,
        >,
    ) -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let redis_uri = std::env::var("REDIS_URI").context("REDIS_URI must be provided")?;

        let document_storage_service_url = std::env::var("DOCUMENT_STORAGE_SERVICE_URL")
            .context("DOCUMENT_STORAGE_SERVICE_URL must be provided")?;

        let invite_email =
            std::env::var("INVITE_EMAIL").context("INVITE_EMAIL must be provided")?;

        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .context("port should be a number")?;

        let environment = Environment::new_or_prod();

        let authentication_service_url = std::env::var("AUTHENTICATION_SERVICE_URL")
            .context("AUTHENTICATION_SERVICE_URL must be provided")?;

        Ok(Config {
            database_url,
            redis_uri,
            internal_api_secret_key: InternalApiSecretKey::new()?,
            document_storage_service_url,
            invite_email,
            port,
            environment,
            authentication_service_url,
            authentication_service_internal_api_secret_key,
        })
    }
}
