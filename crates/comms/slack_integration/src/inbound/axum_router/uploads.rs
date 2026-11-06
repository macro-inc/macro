//! Bounded manifest registration and explicit verification/sealing.

use axum::{
    Json,
    extract::{Path, State},
    http::header,
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use serde::Deserialize;
use utoipa::ToSchema;

use super::{ApiError, SlackRouterState};
use crate::domain::{models::*, ports::ImportService};

/// At most fifty immutable upload descriptors, without client-supplied storage keys.
#[derive(Deserialize, ToSchema)]
#[serde(try_from = "RegisterUploads")]
#[schema(as = SlackRegisterRequest, value_type = RegisterUploads)]
pub struct RegisterRequest(RegisterUploads);

impl TryFrom<RegisterUploads> for RegisterRequest {
    type Error = ImportError;

    fn try_from(command: RegisterUploads) -> Result<Self, Self::Error> {
        if command.descriptors.len() > ImportLimits::default().registration_batch as usize {
            return Err(ImportError::LimitExceeded);
        }
        Ok(Self(command))
    }
}

/// At most fifty registered identities to verify and an optional immutable conversation seal.
#[derive(Deserialize, ToSchema)]
#[serde(try_from = "CompleteUploads")]
#[schema(as = SlackCompleteRequest, value_type = CompleteUploads)]
pub struct CompleteRequest(CompleteUploads);

impl TryFrom<CompleteUploads> for CompleteRequest {
    type Error = ImportError;

    fn try_from(command: CompleteUploads) -> Result<Self, Self::Error> {
        if command.uploads.len() > ImportLimits::default().registration_batch as usize {
            return Err(ImportError::LimitExceeded);
        }
        Ok(Self(command))
    }
}

/// Issue short-lived, checksum/length-bound, create-only PUT grants. Do not log or persist URLs.
/// Retry a PUT returning 412 by completing/verifying the existing object, not overwriting it.
#[utoipa::path(post, path = "/slack/imports/{job_id}/uploads", tag = "slack", operation_id = "register_slack_import_uploads",
    params(("job_id" = JobId, Path)), request_body = RegisterRequest,
    responses((status = 200, body = Vec<UploadGrant>), (status = 404, description = "Unknown or inaccessible job"),
        (status = 413, description = "Body limit exceeded"), (status = 503, description = "Slack imports disabled")))]
pub async fn register<T, Eas, Auth>(
    State(state): State<SlackRouterState<T, Eas, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    Path(job): Path<JobId>,
    Json(request): Json<RegisterRequest>,
) -> Result<impl axum::response::IntoResponse, ApiError>
where
    T: ImportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let grants = state
        .service
        .register_uploads(access.entity_access_receipt, job, request.0)
        .await?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(grants)))
}

/// Verify storage checksums and lengths for registered objects. A seal fixes the ENTIRE
/// descriptor set (contiguous indices, sizes and hashes), not just this completion batch.
/// Empty uploads with a zero-part seal support shape-only or empty-history imports.
/// Work becomes ready only after verified users metadata, a seal and every required part.
#[utoipa::path(post, path = "/slack/imports/{job_id}/uploads/complete", tag = "slack", operation_id = "complete_slack_import_uploads",
    params(("job_id" = JobId, Path)), request_body = CompleteRequest,
    responses((status = 200, body = ImportProgress), (status = 404, description = "Unknown or inaccessible job"),
        (status = 409, description = "Immutable manifest conflict"), (status = 413, description = "Body limit exceeded"),
        (status = 422, description = "Object verification failed"), (status = 503, description = "Slack imports disabled")))]
pub async fn complete<T, Eas, Auth>(
    State(state): State<SlackRouterState<T, Eas, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    Path(job): Path<JobId>,
    Json(request): Json<CompleteRequest>,
) -> Result<Json<ImportProgress>, ApiError>
where
    T: ImportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .complete_uploads(access.entity_access_receipt, job, request.0)
            .await?,
    ))
}
