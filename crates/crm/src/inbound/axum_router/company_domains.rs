//! Add or remove one of the domains an authorized CRM company is known by.

#[cfg(test)]
mod test;

use super::{CrmRouterState, get_company::CrmCompanyResponse};
use crate::{
    domain::{
        model::{CompanyDomainHolder, CrmError},
        service::CrmService,
    },
    inbound::axum_extractors::CrmCompanyAccessLevelExtractor,
};
use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// One of a company's domains. It travels in the body, as a contact's
/// addresses do.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyDomainRequest {
    /// A bare domain such as "example.com": no scheme, path or email. An
    /// identical retry is accepted.
    pub domain: String,
}

/// The 409 answer when another company of the team already tracks the domain.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyDomainTakenResponse {
    /// What happened, naming the other company when the caller can see it.
    pub message: String,
    /// The company that tracks the domain. Absent when the caller cannot see
    /// it: an archived company, for a team member.
    pub company_id: Option<Uuid>,
    /// That company's display name, when the caller can see it.
    pub company_name: Option<String>,
}

impl From<Option<CompanyDomainHolder>> for CompanyDomainTakenResponse {
    fn from(holder: Option<CompanyDomainHolder>) -> Self {
        let Some(holder) = holder else {
            return Self {
                message: "an archived company in the team already tracks this domain; a team admin can restore it or remove the domain from it".into(),
                company_id: None,
                company_name: None,
            };
        };

        let name = holder.name.as_deref().unwrap_or("another company");
        let archived = if holder.hidden { " (archived)" } else { "" };
        Self {
            message: format!(
                "{name}{archived} already tracks this domain (crm company {}); remove the domain from it first",
                holder.company_id
            ),
            company_id: Some(holder.company_id),
            company_name: holder.name,
        }
    }
}

/// Add a domain the organization uses to a company, so mail and new contacts
/// from it are filed under this company instead of a company of its own. Any
/// team member who can see the company may add one. The company's name and
/// primary domain stay. Refused for a personal or generic email provider
/// (400) and for a domain another company of the team tracks (409, naming it
/// when the caller can see it). Returns the company without its contacts.
/// Idempotent.
#[utoipa::path(
    put,
    path = "/crm/companies/{company_id}/domains",
    operation_id = "add_crm_company_domain",
    params(("company_id" = Uuid, Path, description = "The company to update")),
    request_body = CompanyDomainRequest,
    responses(
        (status = 200, body = CrmCompanyResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = CompanyDomainTakenResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(%company_id))]
pub async fn add_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmCompanyAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(company_id): Path<Uuid>,
    Json(req): Json<CompanyDomainRequest>,
) -> Result<Json<CrmCompanyResponse>, CrmError> {
    let company = state
        .service
        .add_company_domain(&access.receipt, &req.domain)
        .await?;
    Ok(Json(company.into()))
}

/// Remove a domain from a company. Contacts, their addresses and mail stay;
/// later mail from the domain is filed as it was before the domain was
/// added. The domain the company is named after stays until the company is
/// renamed (400). Removing a domain from a company whose email sync is off
/// requires an admin or owner (403). Returns the company without its
/// contacts. Idempotent.
#[utoipa::path(
    delete,
    path = "/crm/companies/{company_id}/domains",
    operation_id = "remove_crm_company_domain",
    params(("company_id" = Uuid, Path, description = "The company to update")),
    request_body = CompanyDomainRequest,
    responses(
        (status = 200, body = CrmCompanyResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(%company_id))]
pub async fn remove_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmCompanyAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(company_id): Path<Uuid>,
    Json(req): Json<CompanyDomainRequest>,
) -> Result<Json<CrmCompanyResponse>, CrmError> {
    let company = state
        .service
        .remove_company_domain(&access.receipt, &req.domain)
        .await?;
    Ok(Json(company.into()))
}
