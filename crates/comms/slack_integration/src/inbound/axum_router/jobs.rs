//! Read and settle durable receipts, including while new imports are disabled.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use serde::Deserialize;

use super::{ApiError, SlackRouterState};
use crate::domain::{models::*, ports::ImportService};

/// Exclusive cursor. The service always bounds pages to fifty receipts.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListQuery {
    /// Return jobs older than this job UUID.
    pub before: Option<JobId>,
}

/// List this administrator's team receipts, effective server limits and source binding.
#[utoipa::path(get, path = "/slack/imports", tag = "slack", operation_id = "list_slack_imports",
    params(("before" = Option<JobId>, Query)), responses((status = 200, body = ImportPage)))]
pub async fn list<T, Eas, Auth>(
    State(state): State<SlackRouterState<T, Eas, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ImportPage>, ApiError>
where
    T: ImportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .list(access.entity_access_receipt, query.before)
            .await?,
    ))
}

/// Read sanitized progress; foreign jobs are indistinguishable from missing jobs.
#[utoipa::path(get, path = "/slack/imports/{job_id}", tag = "slack", operation_id = "get_slack_import",
    params(("job_id" = JobId, Path)), responses((status = 200, body = ImportProgress),
        (status = 404, description = "Unknown or inaccessible job")))]
pub async fn progress<T, Eas, Auth>(
    State(state): State<SlackRouterState<T, Eas, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    Path(job_id): Path<JobId>,
) -> Result<Json<ImportProgress>, ApiError>
where
    T: ImportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .progress(access.entity_access_receipt, JobCommand { job_id })
            .await?,
    ))
}

/// Close registration idempotently; never-ready conversations are skipped, not queued work.
#[utoipa::path(post, path = "/slack/imports/{job_id}/finalize", tag = "slack", operation_id = "finalize_slack_import",
    params(("job_id" = JobId, Path)), responses((status = 200, body = ImportProgress),
        (status = 404, description = "Unknown or inaccessible job")))]
pub async fn finalize<T, Eas, Auth>(
    State(state): State<SlackRouterState<T, Eas, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    Path(job_id): Path<JobId>,
) -> Result<Json<ImportProgress>, ApiError>
where
    T: ImportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .finalize(access.entity_access_receipt, JobCommand { job_id })
            .await?,
    ))
}

/// Stop unclaimed work. Active leases may settle; cancellation does not roll back history.
#[utoipa::path(post, path = "/slack/imports/{job_id}/cancel", tag = "slack", operation_id = "cancel_slack_import",
    params(("job_id" = JobId, Path)), responses((status = 200, body = ImportProgress),
        (status = 404, description = "Unknown or inaccessible job")))]
pub async fn cancel<T, Eas, Auth>(
    State(state): State<SlackRouterState<T, Eas, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    Path(job_id): Path<JobId>,
) -> Result<Json<ImportProgress>, ApiError>
where
    T: ImportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .cancel(access.entity_access_receipt, JobCommand { job_id })
            .await?,
    ))
}
