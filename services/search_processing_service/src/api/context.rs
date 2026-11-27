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
use crate::outbound::backfill_control::DynamoBackfillControl;

pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<NoopMacroAuthJwtValidator>;
pub(crate) type SpsEventBroker = MacroEventBrokerService<KafkaEventPublisher, TaskTracker>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub agent_session_indexer: Arc<crate::AgentSessionIndexer>,
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub opensearch_client: Arc<opensearch_client::OpensearchClient>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub config: Arc<Config>,
    pub backfill_service: Arc<BackfillServiceImpl>,
    pub backfill_jobs: BackfillJobs,
    /// The switch that pauses every backfill, in every task.
    pub backfill_control: DynamoBackfillControl,
    /// The cap and pause every backfill in this task passes.
    pub backfill_gate: crate::domain::backfill_gate::BackfillGate,
    pub email_attachment_status_backfill: Arc<crate::EmailAttachmentStatusBackfill>,
    pub deleted_chat_message_repair: Arc<crate::DeletedChatMessageRepair>,
    pub macro_event_broker: SpsEventBroker,
}
