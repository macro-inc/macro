use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{model::CrmError, service::CrmService};

use super::CrmRouterState;

/// Request body for `PUT /crm/companies/{company_id}/email-sync`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetEmailSyncRequest {
    /// New value for `crm_companies.email_sync`. Setting to `false`
    /// permanently deletes the company's CRM contacts and contact sources.
    pub email_sync: bool,
}

/// Toggle `email_sync` on a CRM company. `false` disables CRM email
/// sharing for the company and permanently removes its existing CRM
/// contacts and contact sources.
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
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(company_id = %company_id, email_sync = req.email_sync))]
pub async fn handler<C: CrmService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<AdminTeamRole, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(company_id): Path<Uuid>,
    Json(req): Json<SetEmailSyncRequest>,
) -> Result<StatusCode, CrmError> {
    let team_id = macro_uuid::string_to_uuid(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CrmError::InvalidTeamId)?;

    state
        .service
        .set_email_sync(&team_id, &company_id, req.email_sync)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
