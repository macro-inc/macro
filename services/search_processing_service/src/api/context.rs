use axum::extract::FromRef;
use macro_middleware::auth::internal_access::InternalApiKey;
use std::sync::Arc;

use crate::BackfillServiceImpl;
use crate::config::Config;
use crate::domain::jobs::BackfillJobs;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub opensearch_client: Arc<opensearch_client::OpensearchClient>,
    pub internal_api_key: InternalApiKey,
    pub config: Arc<Config>,
    pub backfill_service: Arc<BackfillServiceImpl>,
    pub backfill_jobs: BackfillJobs,
}
