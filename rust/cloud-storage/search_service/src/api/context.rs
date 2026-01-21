use crate::config::Config;
use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use opensearch_client::OpensearchClient;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub opensearch_client: Arc<OpensearchClient>,
    pub jwt_args: JwtValidationArgs,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub config: Arc<Config>,
}
