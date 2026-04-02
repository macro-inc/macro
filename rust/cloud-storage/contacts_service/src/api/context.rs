use crate::{api::Service, config::Config};
use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use rate_limit::{RateLimitServiceImpl, RedisRateLimitAdapter};
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

pub type RateLimiter = RateLimitServiceImpl<RedisRateLimitAdapter<redis::Client>>;

#[derive(Clone, FromRef)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: PgPool,
    pub jwt_args: JwtValidationArgs,
    pub internal_api_secret: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub contacts_service: Arc<Service>,
    pub rate_limit_service: RateLimiter,
}
