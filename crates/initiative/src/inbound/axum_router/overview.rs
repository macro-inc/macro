//! Handler for reading an initiative with its properties, description and a
//! page of its tasks.

use axum::{
    Json,
    extract::{Query, State},
};
use entity_access::domain::models::ViewAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Deserialize;

use super::{InitiativeIdParams, InitiativeRouterState};
use crate::domain::{
    models::InitiativeError,
    ports::InitiativeService,
    reads::{InitiativeOverview, InitiativeTasksRequest},
};

/// Which page of the initiative's tasks to include.
#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct InitiativeOverviewParams {
    /// Maximum task ids, from 1 through 100; 100 when omitted.
    pub task_limit: Option<u16>,
    /// `nextTaskCursor` from the preceding page.
    pub task_cursor: Option<String>,
}

/// Read an initiative the caller can view: its detail with one page of the
/// tasks they can view, its canonical properties and its description.
#[utoipa::path(
    get,
    tag = "initiative",
    operation_id = "get_initiative_overview",
    path = "/initiatives/{initiative_id}/overview",
    params(InitiativeIdParams, InitiativeOverviewParams),
    responses(
        (status = 200, body = InitiativeOverview),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_initiative_overview_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    access: InitiativeAccessExtractor<ViewAccessLevel, Eas, Auth>,
    Query(params): Query<InitiativeOverviewParams>,
) -> Result<Json<InitiativeOverview>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let overview = state
        .service
        .overview(
            access.entity_access_receipt,
            InitiativeTasksRequest {
                limit: params.task_limit.or(Some(100)),
                cursor: params.task_cursor,
            },
        )
        .await?;
    Ok(Json(overview))
}
