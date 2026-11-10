use crate::domain::{
    MemoryError, MemoryService,
    models::{ActivityReports, ExplicitMemory, MemoryEdit},
};
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::NaiveDate;
use macro_authorization::{
    ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};

#[cfg(test)]
mod test;

/// The user's latest memory.
#[derive(Serialize, ToSchema)]
pub struct MemoryResponse {
    /// The generated memory text.
    pub memory: String,
}

#[derive(Serialize, ToSchema)]
pub struct MemoryErrorBody {
    /// Error description.
    pub error: String,
}

/// Router state containing the memory service and the authorization state
/// used to authenticate callers.
pub struct MemoryRouterState<T, Auth> {
    /// The memory service implementation.
    pub service: Arc<T>,
    /// The authorization state used by the request extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T, Auth> Clone for MemoryRouterState<T, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Auth> FromRef<MemoryRouterState<T, Auth>> for Arc<T> {
    fn from_ref(state: &MemoryRouterState<T, Auth>) -> Self {
        state.service.clone()
    }
}

impl<T, Auth> FromRef<MemoryRouterState<T, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &MemoryRouterState<T, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn memory_router<T, Auth, S>(state: MemoryRouterState<T, Auth>) -> Router<S>
where
    T: MemoryService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/memory", get(get_memory_handler::<T, Auth>))
        .route(
            "/memory/explicit",
            get(get_explicit_memory_handler::<T, Auth>)
                .patch(update_explicit_memory_handler::<T, Auth>),
        )
        .route(
            "/memory/activity",
            get(get_user_activity_handler::<T, Auth>),
        )
        .with_state(state)
}

/// Get the authenticated user's latest memory.
///
/// Compose stored private preferences, latest activity, and current team profiles.
/// Enrolls the caller for daily refresh; generation never runs on this request.
#[utoipa::path(
    get,
    path = "/memory",
    responses(
        (status = 200, description = "Latest memory for the user", body = MemoryResponse),
        (status = 404, description = "No composed memory exists for this user yet"),
        (status = 500, description = "Internal server error", body = MemoryErrorBody),
    ),
    tag = "memory"
)]
#[tracing::instrument(
    skip(service, user),
    fields(actor = %user.acting_entity())
)]
pub async fn get_memory_handler<T: MemoryService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Response {
    let user = user.authorization.user;

    match service.get_memory(user.macro_user_id).await {
        Ok(Some(memory)) => Json(MemoryResponse { memory }).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!(error = ?e, "failed to get memory");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(MemoryErrorBody {
                    error: "failed to get memory".to_string(),
                }),
            )
                .into_response()
        }
    }
}

/// One explicit memory edit at the revision it was based on.
#[derive(Deserialize, ToSchema)]
pub struct UpdateExplicitMemoryRequest {
    /// The revision returned by the last read or successful edit.
    pub revision: i64,
    /// The one-based line edit to apply.
    pub edit: MemoryEdit,
}

/// Inclusive UTC date range of activity reports for one user.
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct UserActivityParams {
    /// A `macro|` user id; omit for the caller.
    pub user: Option<String>,
    /// Inclusive first UTC date.
    pub start: NaiveDate,
    /// Inclusive last UTC date, at most 366 days after `start`.
    pub end: NaiveDate,
}

/// Read the caller's private explicit memory and its revision.
///
/// Content is newline-separated; edits address one-based lines.
#[utoipa::path(
    get,
    operation_id = "read_explicit_memory",
    path = "/memory/explicit",
    responses(
        (status = 200, description = "The caller's explicit memory", body = ExplicitMemory),
        (status = 500, description = "Internal server error", body = MemoryErrorBody),
    ),
    tag = "memory"
)]
#[tracing::instrument(skip_all, fields(actor = %user.acting_entity()))]
pub async fn get_explicit_memory_handler<T: MemoryService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
) -> Response {
    let user = user.authorization.user;

    match service.explicit(&user.macro_user_id).await {
        Ok(memory) => Json(memory).into_response(),
        Err(error) => memory_error_response(error),
    }
}

/// Apply one edit to the caller's private explicit memory.
///
/// A stale revision changes nothing and answers 409; reread before retrying.
/// Additions that fail privacy review answer 422.
#[utoipa::path(
    patch,
    operation_id = "edit_explicit_memory",
    path = "/memory/explicit",
    request_body = UpdateExplicitMemoryRequest,
    responses(
        (status = 200, description = "The edited explicit memory", body = ExplicitMemory),
        (status = 400, description = "Invalid line or content", body = MemoryErrorBody),
        (status = 409, description = "The revision is stale", body = MemoryErrorBody),
        (status = 422, description = "Rejected by privacy review", body = MemoryErrorBody),
        (status = 500, description = "Internal server error", body = MemoryErrorBody),
    ),
    tag = "memory"
)]
#[tracing::instrument(skip_all, fields(actor = %user.acting_entity(), revision = request.revision))]
pub async fn update_explicit_memory_handler<T: MemoryService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Json(request): Json<UpdateExplicitMemoryRequest>,
) -> Response {
    let user = user.authorization.user;

    match service
        .update_memory(user.macro_user_id, request.revision, &request.edit)
        .await
    {
        Ok(memory) => Json(memory).into_response(),
        Err(error) => memory_error_response(error),
    }
}

/// Read privacy-reviewed professional activity of the caller or a current teammate.
///
/// Reports use UTC calendar days, Monday-start weeks and calendar months.
/// An empty list means no stored activity, not no work.
#[utoipa::path(
    get,
    operation_id = "get_user_activity",
    path = "/memory/activity",
    params(UserActivityParams),
    responses(
        (status = 200, description = "Activity reports in the range", body = ActivityReports),
        (status = 400, description = "Invalid user id or date range", body = MemoryErrorBody),
        (status = 403, description = "The user is not the caller or a current teammate", body = MemoryErrorBody),
        (status = 500, description = "Internal server error", body = MemoryErrorBody),
    ),
    tag = "memory"
)]
#[tracing::instrument(skip_all, fields(actor = %user.acting_entity(), start = %params.start, end = %params.end))]
pub async fn get_user_activity_handler<T: MemoryService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Query(params): Query<UserActivityParams>,
) -> Response {
    let caller = user.authorization.user.macro_user_id;

    let subject = match params.user {
        Some(id) => match MacroUserIdStr::try_from(id) {
            Ok(id) => id,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(MemoryErrorBody {
                        error: "invalid Macro user id".to_string(),
                    }),
                )
                    .into_response();
            }
        },
        None => caller.clone(),
    };

    match service
        .get_user_activity(caller, subject, params.start, params.end)
        .await
    {
        Ok(reports) => Json(ActivityReports { reports }).into_response(),
        Err(error) => memory_error_response(error),
    }
}

fn memory_error_response(error: MemoryError) -> Response {
    let status = match &error {
        MemoryError::Conflict => StatusCode::CONFLICT,
        MemoryError::InvalidLine | MemoryError::InvalidContent | MemoryError::InvalidDate => {
            StatusCode::BAD_REQUEST
        }
        MemoryError::Forbidden => StatusCode::FORBIDDEN,
        MemoryError::Rejected(_) => StatusCode::UNPROCESSABLE_ENTITY,
        MemoryError::AgentError(_)
        | MemoryError::NoGeneration
        | MemoryError::Db(_)
        | MemoryError::Other(_) => {
            tracing::error!(error = ?error, "memory request failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(MemoryErrorBody {
                    error: "memory is temporarily unavailable".to_string(),
                }),
            )
                .into_response();
        }
    };

    (
        status,
        Json(MemoryErrorBody {
            error: error.to_string(),
        }),
    )
        .into_response()
}
