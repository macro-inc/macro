use axum::{Json, extract::State};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::domain::{auth::CrmTeamReceipt, model::CrmError, service::CrmService};

use super::{CrmRouterState, get_company::CrmCompanyResponse};

/// Request body for `POST /crm/companies`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCrmCompanyRequest {
    /// Display name for the company. Team-scoped: overrides the
    /// domain-directory name on every read path.
    pub name: String,
    /// The company's email domain, e.g. "acme.com". Must be a bare
    /// domain (no scheme, path, or email) and not a generic email
    /// provider domain.
    pub domain: String,
}

/// Manually create a CRM company for the caller's team. Any team member
/// may create one. The domain must not already be tracked by the team
/// (409), and the team's CRM killswitch must be on (403). Returns the
/// created company in the same shape as `GET /crm/companies/{id}` (its
/// contact list is empty until emails populate it).
#[utoipa::path(
    post,
    path = "/crm/companies",
    operation_id = "create_crm_company",
    request_body = CreateCrmCompanyRequest,
    responses(
        (status = 200, body = CrmCompanyResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<C: CrmService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, Eas, Auth>>,
    Json(req): Json<CreateCrmCompanyRequest>,
) -> Result<Json<CrmCompanyResponse>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let record = state
        .service
        .create_company(&receipt, &req.name, &req.domain)
        .await?;
    Ok(Json(record.into()))
}
