use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use macro_authorization::MacroAuthorizationService;
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
    /// Allow eligible email contributions for this company's domains.
    /// Disabling excludes new ingestion and CRM thread access while preserving
    /// records. Re-enabling requires an admin, removes exact team exclusions,
    /// and schedules backfill only for explicitly consenting primary mailboxes.
    /// Personal and broader team exclusions continue to apply.
    pub email_sync: bool,
}

/// Toggle email contribution for a CRM company without archiving its records.
/// Individual consent and all remaining exclusions still apply.
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
pub async fn handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmCompanyAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(company_id): Path<Uuid>,
    Json(req): Json<SetEmailSyncRequest>,
) -> Result<StatusCode, CrmError> {
    state
        .service
        .set_email_sync(&access.receipt, req.email_sync)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
