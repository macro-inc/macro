//! Conditional turn cancellation, using the ordinary control authorization.

use super::*;
use crate::domain::cancel::{CancelTurn, CancelTurnOutcome};

/// Cancel a specific running turn, optionally reserving a corrected prompt.
#[utoipa::path(
    post,
    path = "/agent-sessions/{session_id}/turn/cancel",
    tag = "agent-sessions",
    operation_id = "cancel_agent_session_turn",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = CancelTurn,
    responses(
        (status = 200, body = CancelTurnOutcome),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 409, body = String, description = "Target ended or changed, or an identity was reused"),
        (status = 422, body = String),
        (status = 500, body = String),
    )
)]
#[tracing::instrument(skip_all, err(Debug))]
pub async fn cancel_agent_session_turn_handler<
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<AgentSessionControlState<R, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserBotOrHarness>,
    Path(session_id): Path<Uuid>,
    Json(request): Json<CancelTurn>,
) -> Result<Json<CancelTurnOutcome>, AgentSessionApiError> {
    let session_id = AgentSessionId::new_from_uuid(session_id);
    ensure_harness_serves_session(&caller.authorization, state.recipient.as_ref(), session_id)
        .await?;
    let principal = match &caller.authorization {
        UserBotOrHarnessAuthorization::User(_) => crate::domain::control::ControlPrincipal::User,
        authorization => crate::domain::control::ControlPrincipal::Runtime(
            authorization
                .acting_user()
                .map(|user| user.macro_user_id.clone()),
        ),
    };
    let authorized = ControlEvent::authorized(
        AgentAction::Stop,
        Some(request.request_id),
        principal,
        access.entity_access_receipt,
    )?;
    Ok(Json(
        state
            .recipient
            .cancel_turn(session_id, request, authorized.actor)
            .await?,
    ))
}
