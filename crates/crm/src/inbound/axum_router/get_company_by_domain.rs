use axum::{Json, extract::Query, extract::State};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::domain::{auth::CrmTeamReceipt, model::CrmError, service::CrmService};

use super::{CrmRouterState, get_company::CrmCompanyResponse};

/// Query parameters for resolving a CRM company by domain.
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct GetCompanyByDomainParams {
    /// The company domain to resolve within the caller's team, such as
    /// `acme.com`.
    pub domain: String,
}

/// Response from looking up a CRM company by domain.
#[derive(Debug, Serialize, ToSchema)]
pub struct GetCompanyByDomainResponse {
    /// The company that owns the domain, without its contacts, or `null`
    /// when the team tracks none the caller may see.
    pub company: Option<CrmCompanyResponse>,
}

/// Look up the CRM company that owns a domain in the caller's team, as
/// `GET /crm/companies/{company_id}` reads it, without its contacts. Returns
/// a null `company` when the team tracks no company at the domain. A team
/// member with CRM access gets a visible company; admins and owners also get
/// a hidden one.
#[utoipa::path(
    get,
    path = "/crm/companies/by-domain",
    operation_id = "get_company_by_domain",
    params(GetCompanyByDomainParams),
    responses(
        (
            status = 200,
            body = GetCompanyByDomainResponse,
            description = "The company for the domain, or a null company when none is visible."
        ),
        (status = 400, body = ErrorResponse, description = "The domain is not a bare domain like acme.com."),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Query(params): Query<GetCompanyByDomainParams>,
) -> Result<Json<GetCompanyByDomainResponse>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let company = state
        .service
        .get_company_by_domain(&receipt, &params.domain)
        .await?
        .map(Into::into);

    Ok(Json(GetCompanyByDomainResponse { company }))
}
