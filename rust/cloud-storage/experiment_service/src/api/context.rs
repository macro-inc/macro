use std::sync::Arc;

use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;

use crate::config::Config;

#[derive(Clone, FromRef)]
pub(crate) struct AppState {
    pub db: PgPool,
    pub jwt_args: JwtValidationArgs,
    pub internal_secret_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub config: Arc<Config>,
}
