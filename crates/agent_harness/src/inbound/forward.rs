//! The receiving half of replica-to-replica command forwarding.
//!
//! A peer that consumed a command for a session this replica manages POSTs it
//! here. Internal-only by construction: the caller is another replica of this
//! same deployment, authenticated with the shared internal key, never a user.
//! The handler executes without re-resolving management - forwarding is
//! single-hop, and this endpoint is the second hop honoring that contract.

use std::sync::Arc;

use agent_session::domain::model::AgentSessionId;
use axum::Router;
use axum::extract::{FromRef, Json, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_uuid::Uuid;

use crate::domain::error::HarnessError;
use crate::domain::model::HarnessCommand;
use crate::domain::service::ForwardedCommands;

/// State for the command-forwarding route.
pub struct ForwardGatewayState<Harness, Auth> {
    harness: Arc<Harness>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Harness, Auth> ForwardGatewayState<Harness, Auth> {
    /// Create forwarding state.
    pub fn new(harness: Arc<Harness>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            harness,
            authorization_state,
        }
    }
}

// Manual Clone impl: everything is behind an Arc.
impl<Harness, Auth> Clone for ForwardGatewayState<Harness, Auth> {
    fn clone(&self) -> Self {
        Self {
            harness: Arc::clone(&self.harness),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Harness, Auth> FromRef<ForwardGatewayState<Harness, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ForwardGatewayState<Harness, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the router serving `POST /agent-sessions/{id}/command`. Mount it
/// under `/internal`.
pub fn forward_router<Harness, Auth, S>(state: ForwardGatewayState<Harness, Auth>) -> Router<S>
where
    Harness: ForwardedCommands,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-sessions/{session_id}/command",
            post(forward_handler::<Harness, Auth>),
        )
        .with_state(state)
}

/// Execute a command a peer replica forwarded to this one.
///
/// Instrumented because this is the far half of the hop: the request carries
/// the sending replica's `traceparent`, which the tracing layer turns into a
/// parent link, so this span shows a forwarded command executing under the
/// span that routed it instead of as an unrelated root. `outcome` distinguishes
/// the three answers the sender can get without reading the response body.
#[tracing::instrument(
    name = "harness.forward.receive",
    skip_all,
    fields(
        agent.session.id = %session_id,
        agent.command.forwarded = true,
        agent.command.outcome = tracing::field::Empty,
    )
)]
async fn forward_handler<Harness, Auth>(
    State(state): State<ForwardGatewayState<Harness, Auth>>,
    _caller: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(session_id): Path<Uuid>,
    Json(command): Json<HarnessCommand>,
) -> Response
where
    Harness: ForwardedCommands,
    Auth: MacroAuthorizationService,
{
    let session_id = AgentSessionId::new_from_uuid(session_id);
    let span = tracing::Span::current();
    match state.harness.execute_forwarded(session_id, command).await {
        // The outcome rides back in the body so the sender can answer its own
        // caller honestly - a queued deliver is not a delivered one.
        Ok(outcome) => (StatusCode::OK, axum::Json(outcome)).into_response(),
        // Surfaced with its own status so the sender can tell "the actor is
        // not here after all" from an execution failure: the sender's
        // fallback re-reads the lease on any error, but a 409 is the signal
        // that its view was stale rather than that the command is bad.
        Err(HarnessError::Disconnected(id))
        | Err(HarnessError::Session(
            agent_session::domain::error::AgentSessionError::Disconnected(id),
        )) => {
            span.record("agent.command.outcome", "not_attached_here");
            (
                StatusCode::CONFLICT,
                format!("session {id} is not attached here"),
            )
                .into_response()
        }
        Err(error) => {
            span.record("agent.command.outcome", "failed");
            tracing::error!(error = ?error, %session_id, "a forwarded command failed");
            (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response()
        }
    }
}
