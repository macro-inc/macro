use axum::extract::FromRef;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use remote_env_var::LocalOrRemoteSecret;
use s3_client::S3;
use std::sync::Arc;

use crate::config::Config;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: sqlx::PgPool,
    pub s3_client: S3,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub config: Arc<Config>,
}
