use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    domain::{model::CrmError, service::CrmService},
    inbound::axum_extractors::CrmCompanyAccessLevelExtractor,
};

use super::CrmRouterState;

/// Request body for `PUT /crm/companies/{company_id}/email-sync`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetEmailSyncRequest {
    /// New value for `crm_companies.email_sync`. Purely a read-side
    /// visibility/permission gate — `soup` queries and email-permission
    /// checks require `email_sync = true` before exposing the
    /// company's emails team-wide. Populate continues to write CRM
    /// history regardless, so toggling never destroys data and
    /// re-enabling never requires a backfill.
    pub email_sync: bool,
}

/// Toggle `email_sync` on a CRM company. Purely a visibility flag —
/// it gates whether team members can see each other's emails with
/// this company. Existing CRM data is unaffected.
#[utoipa::path(
    put,
    path = "/crm/companies/{company_id}/email-sync",
    operation_id = "set_email_sync",
    params(
        ("company_id" = Uuid, Path, description = "The CRM company to update"),
    ),
    request_body = SetEmailSyncRequest,
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse, description = "Company is hidden; un-hide before enabling email sync"),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(company_id = %company_id, email_sync = req.email_sync))]
pub async fn handler<C: CrmService, Eas: EntityAccessService>(
    access: CrmCompanyAccessLevelExtractor<EditAccessLevel, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(company_id): Path<Uuid>,
    Json(req): Json<SetEmailSyncRequest>,
) -> Result<StatusCode, CrmError> {
    state
        .service
        .set_email_sync(&access.receipt, req.email_sync)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
