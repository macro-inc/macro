//! Axum router for reports over logged time, merged into the `/time` router.
//!
//! A project report mints a view receipt for the project and passes it
//! inward; the caller's own and their team's reports pass the authenticated
//! user. Which tasks count is the domain's decision.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    routing::get,
};
use chrono::NaiveDate;
use entity_access::domain::{
    models::{AccessError, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use tracing::Level;
use uuid::Uuid;

use crate::{
    domain::{
        models::TimeTrackingError,
        report::{TimeBreakdown, TimeExport, TimeGrouping, TimePeriod, TimeScope, TimeSummary},
        report_service::TimeReportService,
    },
    inbound::axum_router::{TimeTrackingApiError, TimeTrackingErrorCode},
};

/// Router state for the report endpoints.
pub struct TimeReportRouterState<Rp, Eas, Auth> {
    reports: Arc<Rp>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Rp, Eas, Auth> Clone for TimeReportRouterState<Rp, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            reports: self.reports.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Rp, Eas, Auth> TimeReportRouterState<Rp, Eas, Auth> {
    /// Create router state from the report service, entity access and authorization.
    pub fn new(
        reports: Arc<Rp>,
        entity_access_service: Arc<Eas>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            reports,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<Rp, Eas, Auth> FromRef<TimeReportRouterState<Rp, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &TimeReportRouterState<Rp, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the report router.
///
/// Routes:
/// - `GET /summary` — a scope's time over a period, grouped.
/// - `GET /export` — a scope's entries over a period as CSV.
pub fn time_report_router<Rp, Eas, Auth, T>(
    state: TimeReportRouterState<Rp, Eas, Auth>,
) -> Router<T>
where
    Rp: TimeReportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/summary", get(time_summary_handler::<Rp, Eas, Auth>))
        .route("/export", get(export_time_handler::<Rp, Eas, Auth>))
        .with_state(state)
}

/// Whose time a report reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum TimeScopeName {
    /// Everyone's time on a project's tasks; needs `projectId`.
    Project,
    /// The caller's own time.
    Mine,
    /// The time of the caller's team's current members, the caller included.
    Team,
}

/// The scope and days of a report.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query, rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct TimeExportQuery {
    /// Whose time to read.
    pub scope: TimeScopeName,
    /// The project, with `scope=project` only.
    pub project_id: Option<Uuid>,
    /// The first day, `YYYY-MM-DD`.
    pub from: NaiveDate,
    /// The last day, `YYYY-MM-DD`, at most 365 days after `from`.
    pub to: NaiveDate,
}

/// The scope, days and grouping of a summary.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query, rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct TimeSummaryQuery {
    /// Whose time to read.
    pub scope: TimeScopeName,
    /// The project, with `scope=project` only.
    pub project_id: Option<Uuid>,
    /// The first day, `YYYY-MM-DD`.
    pub from: NaiveDate,
    /// The last day, `YYYY-MM-DD`, at most 365 days after `from`.
    pub to: NaiveDate,
    /// What the totals are grouped by.
    pub group_by: TimeGrouping,
    /// What each group is split by; another grouping than `groupBy`.
    pub then_by: Option<TimeGrouping>,
}

fn project_access_error(error: AccessError) -> TimeTrackingApiError {
    match error {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            TimeTrackingApiError::new(
                StatusCode::FORBIDDEN,
                TimeTrackingErrorCode::Forbidden,
                "you do not have access to this project",
            )
        }
        AccessError::NotFound(_) => TimeTrackingError::NotFound("project").into(),
        other => other.into(),
    }
}

async fn scope<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: &Eas,
    user: &MacroAuthorizationExtractor<Auth, UserOnly>,
    name: TimeScopeName,
    project_id: Option<Uuid>,
) -> Result<TimeScope, TimeTrackingApiError> {
    match (name, project_id) {
        (TimeScopeName::Project, Some(project_id)) => Ok(TimeScope::Project(
            access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    &user.authorization.macro_user_id,
                    None,
                    &project_id.to_string(),
                    EntityType::Initiative,
                )
                .await
                .map_err(project_access_error)?,
        )),
        (TimeScopeName::Project, None) => Err(TimeTrackingError::InvalidInput(
            "a project report needs projectId".to_string(),
        )
        .into()),
        (TimeScopeName::Mine | TimeScopeName::Team, Some(_)) => Err(
            TimeTrackingError::InvalidInput("projectId goes with scope=project only".to_string())
                .into(),
        ),
        (TimeScopeName::Mine, None) => Ok(TimeScope::Mine),
        (TimeScopeName::Team, None) => Ok(TimeScope::Team),
    }
}

/// A scope's time over a period: the total, totals by the first grouping,
/// each split by the second, and the second grouping's totals. Only tasks
/// the caller can see count, out of the Trash; a scope past 5,000 tasks is
/// read to the first 5,000 and answers `complete: false`.
#[utoipa::path(
    get,
    tag = "time_tracking",
    operation_id = "get_time_summary",
    path = "/time/summary",
    params(TimeSummaryQuery),
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = TimeSummary),
        (status = 400, body = TimeTrackingApiError),
        (status = 403, body = TimeTrackingApiError),
        (status = 404, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn time_summary_handler<Rp, Eas, Auth>(
    State(state): State<TimeReportRouterState<Rp, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<TimeSummaryQuery>,
) -> Result<Json<TimeSummary>, TimeTrackingApiError>
where
    Rp: TimeReportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let period = TimePeriod::new(query.from, query.to)?;
    let breakdown = TimeBreakdown::new(query.group_by, query.then_by)?;
    let scope = scope(
        &*state.entity_access_service,
        &user,
        query.scope,
        query.project_id,
    )
    .await?;
    let summary = state
        .reports
        .summary(&user.authorization.macro_user_id, scope, period, breakdown)
        .await?;
    Ok(Json(summary))
}

/// A scope's entries over a period as CSV text, oldest day first: one row
/// per entry with its day, person (as an email), task, minutes, hours, note
/// and source. Capped at 10,000 entries and 16 MiB; `complete` is false when
/// entries were left out. May miss writes from the last few seconds.
#[utoipa::path(
    get,
    tag = "time_tracking",
    operation_id = "export_time",
    path = "/time/export",
    params(TimeExportQuery),
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = TimeExport),
        (status = 400, body = TimeTrackingApiError),
        (status = 403, body = TimeTrackingApiError),
        (status = 404, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn export_time_handler<Rp, Eas, Auth>(
    State(state): State<TimeReportRouterState<Rp, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<TimeExportQuery>,
) -> Result<Json<TimeExport>, TimeTrackingApiError>
where
    Rp: TimeReportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let period = TimePeriod::new(query.from, query.to)?;
    let scope = scope(
        &*state.entity_access_service,
        &user,
        query.scope,
        query.project_id,
    )
    .await?;
    let export = state
        .reports
        .export(&user.authorization.macro_user_id, scope, period)
        .await?;
    Ok(Json(export))
}
