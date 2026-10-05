//! Compose routine operations from the same session, harness, and persona capabilities.

use std::sync::Arc;

use agent_session::domain::ports::{
    AgentSessionNotificationRecipient, AgentSessionRepo, BotDirectory, SessionOpener,
};
use agent_session::domain::routines::RoutineSessionsService;
use agent_session::domain::service::AgentSessionService;
use agent_session::inbound::routine_sessions::{RoutineSessionsState, routine_sessions_router};
use axum::Router;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_event_broker::MacroEventBroker;

use crate::external_session_requests::BrokerExternalSessionRequests;

/// Reuse live harness/session instances and the existing external-request adapter.
pub fn router<Bots, Harness, Sessions, Broker, Repo, Auth>(
    bots: Bots,
    harness: Harness,
    sessions: Sessions,
    broker: Broker,
    repo: Repo,
    authorization: MacroAuthorizationState<Auth>,
) -> Router
where
    Bots: BotDirectory,
    Harness: SessionOpener + AgentSessionNotificationRecipient + Clone,
    Sessions: AgentSessionService,
    Broker: MacroEventBroker,
    Repo: AgentSessionRepo,
    Auth: MacroAuthorizationService,
{
    let service = RoutineSessionsService::new(
        bots,
        harness.clone(),
        BrokerExternalSessionRequests::new(broker, repo),
        sessions,
        harness,
    );
    routine_sessions_router(RoutineSessionsState::new(Arc::new(service), authorization))
}
