use std::sync::Arc;

use ai_billing::inbound::admission::AiAdmissionErrorBody;
use axum::extract::{FromRef, State, rejection::JsonRejection};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::domain::drafts::{Draft, DraftContext, DraftRequest};
use crate::domain::ports::RoutineDraftService;
use crate::inbound::axum_router::ScheduledActionApiError;

#[cfg(test)]
mod test;

pub struct RoutineDraftRouterState<D, Auth> {
    pub service: Arc<D>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<D, Auth> Clone for RoutineDraftRouterState<D, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<D, Auth> FromRef<RoutineDraftRouterState<D, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RoutineDraftRouterState<D, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn routine_draft_router<D, Auth, St>(state: RoutineDraftRouterState<D, Auth>) -> Router<St>
where
    D: RoutineDraftService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route("/scheduled-actions/drafts", post(draft_routine::<D, Auth>))
        .with_state(state)
}

/// What to draft, and what the drafter may write and name.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DraftRoutineRequest {
    pub draft: DraftRequest,
    pub context: DraftContext,
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/drafts",
    tag = "scheduled actions",
    operation_id = "draft_routine",
    request_body = DraftRoutineRequest,
    responses(
        (status = 200, body = Draft, description = "A routine or step to review before saving, with any code problems AI couldn't fix, or why AI couldn't draft it"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 402, body = AiAdmissionErrorBody, description = "AI usage limit reached"),
        (status = 503, body = AiAdmissionErrorBody, description = "AI usage validation unavailable"),
        (status = 500, body = String),
    )
)]
pub async fn draft_routine<D, Auth>(
    State(state): State<RoutineDraftRouterState<D, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    request: Result<Json<DraftRoutineRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    D: RoutineDraftService,
    Auth: MacroAuthorizationService,
{
    let Json(request) = request.map_err(ScheduledActionApiError::InvalidRequest)?;
    let draft = state
        .service
        .draft(
            user.authorization.macro_user_id.clone(),
            request.draft,
            request.context,
        )
        .await?;
    Ok(Json(draft))
}
