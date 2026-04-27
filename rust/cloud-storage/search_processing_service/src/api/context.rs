use axum::extract::FromRef;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use std::sync::Arc;

use crate::BackfillServiceImpl;
use crate::config::Config;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub opensearch_client: Arc<opensearch_client::OpensearchClient>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub config: Arc<Config>,
    pub backfill_service: Arc<BackfillServiceImpl>,
}
