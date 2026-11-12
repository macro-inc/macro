//! Background routine drafts over HTTP: start one, list and read them, and
//! cancel or discard one.

use std::sync::Arc;

use ai_billing::inbound::admission::AiAdmissionErrorBody;
use axum::extract::{FromRef, Path, State, rejection::JsonRejection};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;

use crate::domain::drafts::jobs::DraftJob;
use crate::domain::ports::RoutineDraftJobService;
use crate::inbound::axum_router::ScheduledActionApiError;
use crate::inbound::draft_router::DraftRoutineRequest;

#[cfg(test)]
mod test;

pub struct RoutineDraftJobRouterState<J, Auth> {
    pub service: Arc<J>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<J, Auth> Clone for RoutineDraftJobRouterState<J, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<J, Auth> FromRef<RoutineDraftJobRouterState<J, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RoutineDraftJobRouterState<J, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn routine_draft_job_router<J, Auth, St>(
    state: RoutineDraftJobRouterState<J, Auth>,
) -> Router<St>
where
    J: RoutineDraftJobService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/draft-jobs",
            get(list_draft_jobs::<J, Auth>).post(start_draft_job::<J, Auth>),
        )
        .route(
            "/scheduled-actions/draft-jobs/{id}",
            get(get_draft_job::<J, Auth>).delete(discard_draft_job::<J, Auth>),
        )
        .with_state(state)
}

/// The W3C trace context of the request being served, kept on the job so
/// work on other replicas can name the trace it started in.
fn current_traceparent() -> Option<String> {
    let mut headers = HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    headers
        .get("traceparent")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/draft-jobs",
    tag = "scheduled actions",
    operation_id = "start_routine_draft_job",
    request_body = DraftRoutineRequest,
    responses(
        (status = 202, body = DraftJob, description = "Drafting in the background; read it, or follow `routine_draft_update` messages, until it is ready or failed. A request that can't be drafted at all comes back failed"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 402, body = AiAdmissionErrorBody, description = "AI usage limit reached"),
        (status = 409, body = String, description = "Too many drafts are drafting already"),
        (status = 503, body = AiAdmissionErrorBody, description = "AI usage validation unavailable"),
        (status = 500, body = String),
    )
)]
pub async fn start_draft_job<J, Auth>(
    State(state): State<RoutineDraftJobRouterState<J, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    request: Result<Json<DraftRoutineRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    J: RoutineDraftJobService,
    Auth: MacroAuthorizationService,
{
    let Json(request) = request.map_err(ScheduledActionApiError::InvalidRequest)?;
    let job = state
        .service
        .start(
            user.authorization.macro_user_id.clone(),
            request.draft,
            request.context,
            current_traceparent(),
        )
        .await?;
    Ok((StatusCode::ACCEPTED, Json(job)))
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/draft-jobs",
    tag = "scheduled actions",
    operation_id = "list_routine_draft_jobs",
    responses(
        (status = 200, body = Vec<DraftJob>, description = "The caller's drafts that are drafting, or finished and not yet discarded, newest first"),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
pub async fn list_draft_jobs<J, Auth>(
    State(state): State<RoutineDraftJobRouterState<J, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<Vec<DraftJob>>, ScheduledActionApiError>
where
    J: RoutineDraftJobService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .jobs(user.authorization.macro_user_id.clone())
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/draft-jobs/{id}",
    tag = "scheduled actions",
    operation_id = "get_routine_draft_job",
    params(("id" = Uuid, Path, description = "ID of the draft")),
    responses(
        (status = 200, body = DraftJob, description = "The draft, with its routine or step when ready, or why it failed"),
        (status = 401, body = String),
        (status = 404, body = String, description = "No such draft of the caller's"),
        (status = 500, body = String),
    )
)]
pub async fn get_draft_job<J, Auth>(
    State(state): State<RoutineDraftJobRouterState<J, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<Json<DraftJob>, ScheduledActionApiError>
where
    J: RoutineDraftJobService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .job(user.authorization.macro_user_id.clone(), id)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/scheduled-actions/draft-jobs/{id}",
    tag = "scheduled actions",
    operation_id = "discard_routine_draft_job",
    params(("id" = Uuid, Path, description = "ID of the draft")),
    responses(
        (status = 204, description = "Cancelled while drafting, or discarded once finished"),
        (status = 401, body = String),
        (status = 404, body = String, description = "No such draft of the caller's"),
        (status = 500, body = String),
    )
)]
pub async fn discard_draft_job<J, Auth>(
    State(state): State<RoutineDraftJobRouterState<J, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ScheduledActionApiError>
where
    J: RoutineDraftJobService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .discard(user.authorization.macro_user_id.clone(), id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
