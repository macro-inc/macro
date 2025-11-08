use crate::{config::Config, service};
use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub redis_client: Arc<service::redis::Redis>,
    pub ses_client: Arc<ses_client::Ses>,
    pub config: Arc<Config>,
    jwt_args: JwtValidationArgs,
    internal_api_key: LocalOrRemoteSecret<InternalApiSecretKey>,
}

impl ApiContext {
    pub fn init(
        db: PgPool,
        redis_client: redis::Client,
        ses_client: ses_client::Ses,
        config: Config,
        jwt_args: JwtValidationArgs,
    ) -> Self {
        ApiContext {
            db,
            redis_client: Arc::new(service::redis::Redis::new(redis_client)),
            ses_client: Arc::new(ses_client),
            jwt_args,
            internal_api_key: LocalOrRemoteSecret::Local(config.internal_api_secret_key.clone()),
            config: Arc::new(config),
        }
    }
}
