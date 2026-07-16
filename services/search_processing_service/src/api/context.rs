use axum::extract::FromRef;
use macro_authorization::{
    MacroAuthorizationServiceImpl, MacroAuthorizationState, NoopMacroAuthJwtValidator,
};
use std::sync::Arc;

use crate::BackfillServiceImpl;
use crate::config::Config;
use crate::domain::jobs::BackfillJobs;

pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<NoopMacroAuthJwtValidator>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub opensearch_client: Arc<opensearch_client::OpensearchClient>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub config: Arc<Config>,
    pub backfill_service: Arc<BackfillServiceImpl>,
    pub backfill_jobs: BackfillJobs,
}
