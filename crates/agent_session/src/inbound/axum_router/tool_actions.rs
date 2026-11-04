//! Internal tool calls cannot impersonate a human approval or omit the acting user.
use super::*;
use crate::domain::tool_actions::SessionAction;
use macro_authorization::{InternalOnly, UserOrInternal};

/// Session controls for authenticated services acting for a verified user.
pub fn agent_session_tool_actions_router<
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    state: AgentSessionControlState<R, Access, Auth>,
) -> Router {
    Router::new().nest(
        "/internal/agent-sessions",
        Router::new()
            .route("/{session_id}", delete(delete_session::<R, Access, Auth>))
            .route("/{session_id}/control", post(control::<R, Access, Auth>))
            .with_state(state),
    )
}

async fn delete_session<
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    _user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    _access: AgentSessionAccessLevelExtractor<OwnerAccessLevel, Access, Auth>,
    State(state): State<AgentSessionControlState<R, Access, Auth>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AgentSessionApiError> {
    state
        .recipient
        .session_deleted(AgentSessionId::new_from_uuid(id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn control<
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<AgentSessionControlState<R, Access, Auth>>,
    Path(id): Path<Uuid>,
    Json(action): Json<SessionAction>,
) -> Result<Json<ControlResponse>, AgentSessionApiError> {
    let action = match action {
        SessionAction::Prompt { prompt } if !prompt.trim().is_empty() => {
            AgentAction::prompt(prompt)
        }
        SessionAction::Stop => AgentAction::Stop,
        _ => return Err(AgentSessionError::Forbidden.into()),
    };
    let accepted = state
        .recipient
        .control_event(
            AgentSessionId::new_from_uuid(id),
            ControlEvent::authorized(
                action,
                None,
                None,
                crate::domain::control::ControlPrincipal::Runtime(Some(
                    user.authorization.user.macro_user_id,
                )),
                access.entity_access_receipt,
            )?,
        )
        .await?;
    Ok(Json(ControlResponse {
        action_id: accepted.action_id,
        status: accepted.disposition.into(),
    }))
}
