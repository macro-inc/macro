//! The route a routine's run schedules copies of its sub-routines through.

use super::{
    ScheduledActionApiError, ScheduledActionResponse, ScheduledActionRouterState, requester,
};
use crate::domain::models::{RunCaller, ScheduleSubRoutine};
use crate::domain::ports::{SavedAction, ScheduledActionService};
use axum::Json;
use axum::extract::{State, rejection::JsonRejection};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use entity_access::domain::ports::EntityAccessService;
use entity_registry::CreationPrincipalExtractor;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};

#[utoipa::path(
    post,
    path = "/scheduled-actions/schedule",
    tag = "scheduled actions",
    operation_id = "schedule_sub_routine",
    request_body = ScheduleSubRoutine,
    responses(
        (status = 201, body = ScheduledActionResponse),
        (status = 200, body = ScheduledActionResponse, description = "The copy its key already named, updated"),
        (status = 400, body = String, description = "Malformed request or trigger, unknown sub-routine, invalid inputs, or scheduling disabled"),
        (status = 401, body = String),
        (status = 403, body = String, description = "The request doesn't come from a routine's run"),
        (status = 404, body = String, description = "The parent routine was not found"),
        (status = 409, body = String, description = "The routine reached its active sub-routine limit, the key belongs to a routine with its own steps, or the keyed copy changed or is running"),
        (status = 413, body = String, description = "The request body exceeds the size limit"),
        (status = 500, body = String),
    )
)]
/// Schedule a copy of a sub-routine the running routine defines, with its
/// own trigger and inputs. Only a routine's run can: its code step's
/// credential says which routine, never the body.
pub async fn schedule_sub_routine<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    user: Result<
        MacroAuthorizationExtractor<Auth, UserOrInternal>,
        macro_authorization::MacroAuthorizationRejection,
    >,
    headers: axum::http::HeaderMap,
    body: Result<Json<ScheduleSubRoutine>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let caller = RunCaller {
        routine: agent_correlation::context::current_routine(),
        session: agent_correlation::context::current_session(),
        requester: requester(user.as_ref().ok().map(|user| &user.authorization), &headers),
    };
    let saved = state
        .service
        .schedule_sub_routine(&principal, request, caller)
        .await?;
    let status = match saved {
        SavedAction::Created(_) => StatusCode::CREATED,
        SavedAction::Updated(_) => StatusCode::OK,
    };
    Ok((
        status,
        Json(ScheduledActionResponse::from(saved.into_action())),
    ))
}
