use anyhow::Context;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use remote_env_var::LocalOrRemoteSecret;

pub struct Config {
    pub database_url: String,
    pub port: usize,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
        let port: usize = std::env::var("PORT")
            .unwrap_or("8080".to_string())
            .parse::<usize>()
            .unwrap();
        let internal_auth_key = LocalOrRemoteSecret::Local(InternalApiSecretKey::new()?);
        Ok(Config {
            database_url,
            port,
            internal_auth_key,
        })
    }
}
