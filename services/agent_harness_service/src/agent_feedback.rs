//! Ratings of agent responses (`crates/agent_feedback`): the routes, and the
//! adapters that read a rated response's agent from the crates that own it.

use std::sync::Arc;

use agent_feedback::domain::ports::{AgentSessions, RoutineRuns, RunFacts, SessionFacts};
use agent_feedback::domain::service::FeedbackService;
use agent_feedback::inbound::axum_router::{AgentFeedbackRouterState, agent_feedback_router};
use agent_feedback::outbound::pg::PgFeedbackRepo;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::AgentSessionRepo;
use axum::Router;
use entity_access::domain::ports::EntityAccessService;
use feature_flags::FeatureFlags;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use messages::domain::api::MessageReader;
use rootcause::Report;
use scheduled_action::domain::models::ExecutionResourceType;
use scheduled_action::domain::ports::ExecutionRecords;
use sqlx::PgPool;
use uuid::Uuid;

/// A session's agent, harness and model, through the session repository.
pub(crate) struct SessionRepoFacts<Repo>(pub(crate) Repo);

impl<Repo: AgentSessionRepo> AgentSessions for SessionRepoFacts<Repo> {
    async fn session(&self, id: AgentSessionId) -> Result<Option<SessionFacts>, Report> {
        let session = self
            .0
            .find(id)
            .await
            .map_err(|error| rootcause::report!("agent session lookup failed: {error}"))?;
        Ok(session.map(|session| SessionFacts {
            bot_id: session.bot_id,
            harness: session.harness,
            model: session.model,
        }))
    }
}

/// A routine's run, and the agent session it ran, through the routines
/// repository.
pub(crate) struct RoutineRunRecords<Records>(pub(crate) Records);

impl<Records: ExecutionRecords> RoutineRuns for RoutineRunRecords<Records> {
    async fn run(&self, routine_id: Uuid, run_id: Uuid) -> Result<Option<RunFacts>, Report> {
        let Some(record) = self
            .0
            .execution_record(&routine_id, &run_id)
            .await
            .map_err(|error| rootcause::report!("routine run lookup failed: {error:#}"))?
        else {
            return Ok(None);
        };

        // A run's result names what it produced; only an agent session is
        // context for a rating. A result that doesn't parse has none.
        let agent_session_id = record
            .execution_resource()
            .ok()
            .flatten()
            .filter(|resource| resource.resource_type == ExecutionResourceType::Agent)
            .and_then(|resource| resource.id.parse().ok())
            .map(AgentSessionId::new_from_uuid);
        Ok(Some(RunFacts { agent_session_id }))
    }
}

/// The feedback routes over the shared pool.
pub(crate) fn router<Sessions, Records, Flags, Access, Auth>(
    pool: PgPool,
    sessions: Sessions,
    runs: Records,
    flags: Option<Flags>,
    messages: Arc<dyn MessageReader>,
    entity_access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
) -> Router
where
    Sessions: AgentSessionRepo,
    Records: ExecutionRecords,
    Flags: FeatureFlags + 'static,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let repo = PgFeedbackRepo::new(pool);
    let service = FeedbackService::new(
        repo.clone(),
        flags,
        SessionRepoFacts(sessions),
        RoutineRunRecords(runs),
        repo,
        messages,
    );
    agent_feedback_router(AgentFeedbackRouterState::new(
        Arc::new(service),
        entity_access,
        authorization,
    ))
}
