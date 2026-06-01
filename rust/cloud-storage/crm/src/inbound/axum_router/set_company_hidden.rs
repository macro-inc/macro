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

/// Request body for `PUT /companies/{company_id}/hidden`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetCompanyHiddenRequest {
    /// New value for `crm_companies.hidden`. Setting to `true` hides
    /// the company from CRM listings, disables `email_sync`, and
    /// soft-hides every contact under it (`crm_contacts.hidden = true`).
    /// Contact rows and `crm_contact_sources` are preserved across the
    /// cycle, so un-hide is a true reverse. Setting to `false`
    /// un-hides the company and soft-restores its contacts;
    /// `email_sync` is left untouched and the team must re-enable it
    /// explicitly.
    pub hidden: bool,
}

/// Toggle `hidden` on a CRM company. Hiding also disables
/// `email_sync` and soft-hides every contact under the company.
/// Un-hide restores contact visibility only; `email_sync` is left
/// untouched (the team must re-enable it explicitly). Contact rows
/// and contact sources survive the cycle.
#[utoipa::path(
    put,
    path = "/crm/companies/{company_id}/hidden",
    operation_id = "set_company_hidden",
    params(
        ("company_id" = Uuid, Path, description = "The CRM company to update"),
    ),
    request_body = SetCompanyHiddenRequest,
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(company_id = %company_id, hidden = req.hidden))]
pub async fn handler<C: CrmService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<AdminTeamRole, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(company_id): Path<Uuid>,
    Json(req): Json<SetCompanyHiddenRequest>,
) -> Result<StatusCode, CrmError> {
    let team_id = macro_uuid::string_to_uuid(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CrmError::InvalidTeamId)?;

    state
        .service
        .set_company_hidden(&team_id, &company_id, req.hidden)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
