use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
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

/// Request body for `PUT /companies/{company_id}/name`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetCompanyNameRequest {
    /// New display name for the company. Stored on the team-scoped
    /// `crm_companies.custom_name` override, which read paths COALESCE
    /// over the global directory name — the shared directory is never
    /// modified. Must be non-blank (400 otherwise).
    pub name: String,
}

/// Rename a CRM company. Access is enforced by
/// [`CrmCompanyAccessLevelExtractor`]: the caller must be on the team
/// that owns the company (hidden companies are reachable for
/// admin/owner only). The name is a team-scoped override
/// (`custom_name`) and never touches the global domain directory.
#[utoipa::path(
    put,
    path = "/crm/companies/{company_id}/name",
    operation_id = "set_crm_company_name",
    params(
        ("company_id" = Uuid, Path, description = "The CRM company to rename"),
    ),
    request_body = SetCompanyNameRequest,
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(company_id = %company_id))]
pub async fn handler<C: CrmService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: CrmCompanyAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, Eas, Auth>>,
    Path(company_id): Path<Uuid>,
    Json(req): Json<SetCompanyNameRequest>,
) -> Result<StatusCode, CrmError> {
    state
        .service
        .set_company_name(&access.receipt, &req.name)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
