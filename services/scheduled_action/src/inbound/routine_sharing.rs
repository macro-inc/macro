//! Team routine read and sharing endpoints; all authorization lives in the domain service.
use super::axum_router::ScheduledActionApiError;
use crate::domain::{
    models::ActionExecutionRecord,
    sharing::{RoutineSharingService, SharedRoutine},
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    routing::get,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_uuid::Uuid;
use serde::Deserialize;
use std::sync::Arc;
use utoipa::ToSchema;

pub struct RoutineSharingState<S, A> {
    pub service: Arc<S>,
    pub authorization_state: MacroAuthorizationState<A>,
}
impl<S, A> Clone for RoutineSharingState<S, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}
impl<S, A> FromRef<RoutineSharingState<S, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &RoutineSharingState<S, A>) -> Self {
        state.authorization_state.clone()
    }
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ShareRoutine {
    pub team_id: Option<Uuid>,
}

pub fn router<S: RoutineSharingService, A: MacroAuthorizationService>(
    state: RoutineSharingState<S, A>,
) -> Router {
    Router::new()
        .route("/routines/team", get(list::<S, A>))
        .route("/routines/{id}", get(read::<S, A>))
        .route("/routines/{id}/sharing", axum::routing::put(share::<S, A>))
        .route("/routines/{id}/history", get(history::<S, A>))
        .with_state(state)
}
#[utoipa::path(get, path = "/routines/team", operation_id = "list_team_routines", responses((status = 200, body = Vec<SharedRoutine>)))]
pub async fn list<S: RoutineSharingService, A: MacroAuthorizationService>(
    State(state): State<RoutineSharingState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
) -> Result<Json<Vec<SharedRoutine>>, ScheduledActionApiError> {
    Ok(Json(
        state
            .service
            .list(user.authorization.user.macro_user_id.clone())
            .await?,
    ))
}
#[utoipa::path(get, path = "/routines/{id}", operation_id = "get_routine", params(("id" = Uuid, Path)), responses((status = 200, body = SharedRoutine)))]
pub async fn read<S: RoutineSharingService, A: MacroAuthorizationService>(
    State(state): State<RoutineSharingState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<SharedRoutine>, ScheduledActionApiError> {
    Ok(Json(
        state
            .service
            .get(id, user.authorization.user.macro_user_id.clone())
            .await?,
    ))
}
#[utoipa::path(put, path = "/routines/{id}/sharing", operation_id = "share_routine", params(("id" = Uuid, Path)), request_body = ShareRoutine, responses((status = 200, body = SharedRoutine)))]
pub async fn share<S: RoutineSharingService, A: MacroAuthorizationService>(
    State(state): State<RoutineSharingState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
    Json(body): Json<ShareRoutine>,
) -> Result<Json<SharedRoutine>, ScheduledActionApiError> {
    Ok(Json(
        state
            .service
            .share(
                id,
                body.team_id,
                user.authorization.user.macro_user_id.clone(),
            )
            .await?,
    ))
}
#[utoipa::path(get, path = "/routines/{id}/history", operation_id = "get_routine_history", params(("id" = Uuid, Path)), responses((status = 200, body = Vec<ActionExecutionRecord>)))]
pub async fn history<S: RoutineSharingService, A: MacroAuthorizationService>(
    State(state): State<RoutineSharingState<S, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<ActionExecutionRecord>>, ScheduledActionApiError> {
    Ok(Json(
        state
            .service
            .history(id, user.authorization.user.macro_user_id.clone())
            .await?,
    ))
}
