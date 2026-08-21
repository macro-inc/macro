use axum::extract::FromRef;
use macro_authorization::{
    MacroAuthorizationServiceImpl, MacroAuthorizationState, NoopMacroAuthJwtValidator,
};
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use std::sync::Arc;
use tokio_util::task::TaskTracker;

use crate::BackfillServiceImpl;
use crate::config::Config;
use crate::domain::jobs::BackfillJobs;

pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<NoopMacroAuthJwtValidator>;
pub(crate) type SpsEventBroker = MacroEventBrokerService<KafkaEventPublisher, TaskTracker>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub opensearch_client: Arc<opensearch_client::OpensearchClient>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub config: Arc<Config>,
    pub backfill_service: Arc<BackfillServiceImpl>,
    pub backfill_jobs: BackfillJobs,
    pub macro_event_broker: SpsEventBroker,
}
