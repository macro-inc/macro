use crate::config::Config;
use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: PgPool,
    pub sns_client: Arc<sns_client::SNS>,
    pub config: Arc<Config>,
    pub jwt_args: JwtValidationArgs,
    pub internal_secret_key: LocalOrRemoteSecret<InternalApiSecretKey>,
}
