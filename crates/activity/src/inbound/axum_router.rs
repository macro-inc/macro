//! HTTP adapter: `GET /activity`, the acting user's own activity in a time range.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, Utc};
use macro_authorization::{
    ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::domain::{ports::ActivityReads, service::ActivityReadService};
use crate::inbound::toolset::{ReadActivityError, ReadActivityResponse};

/// Router state: the activity read service and caller authentication.
pub struct ActivityRouterState<R: ActivityReads, Auth> {
    service: Arc<ActivityReadService<R>>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<R: ActivityReads, Auth> Clone for ActivityRouterState<R, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<R: ActivityReads, Auth> ActivityRouterState<R, Auth> {
    /// Compose the read service with the host's authorization.
    pub fn new(
        service: Arc<ActivityReadService<R>>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<R: ActivityReads, Auth> FromRef<ActivityRouterState<R, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ActivityRouterState<R, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Mount `GET /activity`.
pub fn activity_router<R, Auth, S>(state: ActivityRouterState<R, Auth>) -> Router<S>
where
    R: ActivityReads + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/activity", get(read_activity_handler::<R, Auth>))
        .with_state(state)
}

/// Time range of an activity read.
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ActivityRangeParams {
    /// Inclusive start, RFC 3339.
    pub from: DateTime<Utc>,
    /// Exclusive end, RFC 3339; must be after `from`.
    pub to: DateTime<Utc>,
}

/// Error body for activity reads.
#[derive(Serialize, ToSchema)]
pub struct ActivityErrorBody {
    /// Error description.
    pub error: String,
}

/// Read the acting user's own activity in a time range, newest first.
///
/// Includes actions agents performed on the user's behalf. Returns at most
/// 100 events; `truncated` reports that more matched, so narrow the range.
#[utoipa::path(
    get,
    operation_id = "read_my_activity",
    path = "/activity",
    params(ActivityRangeParams),
    responses(
        (status = 200, description = "Activity in the range", body = ReadActivityResponse),
        (status = 400, description = "`from` is not before `to`", body = ActivityErrorBody),
        (status = 500, description = "Internal server error", body = ActivityErrorBody),
    ),
    tag = "activity"
)]
#[tracing::instrument(skip_all, fields(actor = %user.acting_entity(), from = %range.from, to = %range.to))]
pub async fn read_activity_handler<R, Auth>(
    State(state): State<ActivityRouterState<R, Auth>>,
    user: MacroAuthorizationExtractor<Auth, ActingUser>,
    Query(range): Query<ActivityRangeParams>,
) -> Response
where
    R: ActivityReads,
    Auth: MacroAuthorizationService,
{
    let subject = &user.authorization.user.macro_user_id;

    match ReadActivityResponse::read(&state.service, subject, range.from, range.to).await {
        Ok(response) => Json(response).into_response(),
        Err(error @ ReadActivityError::InvalidRange) => (
            StatusCode::BAD_REQUEST,
            Json(ActivityErrorBody {
                error: error.to_string(),
            }),
        )
            .into_response(),
        Err(error @ ReadActivityError::Store(_)) => {
            tracing::error!(error = ?error, "activity read failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ActivityErrorBody {
                    error: error.to_string(),
                }),
            )
                .into_response()
        }
    }
}
