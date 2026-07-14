use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use model_error_response::ErrorResponse;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    domain::{
        model::{CrmCompanyWithContacts, CrmDomain, CrmError},
        service::CrmService,
    },
    inbound::axum_extractors::CrmCompanyAccessLevelExtractor,
};

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};

/// A CRM domain associated with a company.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmDomainResponse {
    /// The id of the domain record.
    pub id: Uuid,
    /// The id of the company the domain belongs to.
    pub company_id: Uuid,
    /// The domain (e.g. "acme.com").
    pub domain: String,
    /// When the domain record was created.
    pub created_at: DateTime<Utc>,
}

impl From<CrmDomain> for CrmDomainResponse {
    fn from(d: CrmDomain) -> Self {
        Self {
            id: d.id,
            company_id: d.company_id,
            domain: d.domain,
            created_at: d.created_at,
        }
    }
}

/// A CRM company as returned by `GET /crm/companies/{company_id}`.
/// Mirrors the soup-listed `crmCompany` shape (`name` / `description`
/// resolved from the primary domain's `crm_domain_directory` entry) and
/// embeds the company's contacts so the panel can render in a single
/// request.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmCompanyResponse {
    /// The id of the company.
    pub id: Uuid,
    /// The id of the team that owns this company record.
    pub team_id: Uuid,
    /// Display name from the primary domain's directory entry, or
    /// `None` when unresolved.
    pub name: Option<String>,
    /// Display description from the primary domain's directory entry.
    pub description: Option<String>,
    /// Whether email sync is enabled for this company.
    pub email_sync: bool,
    /// Whether the company is hidden from CRM listings for the
    /// requesting team. Non-admin viewers never see `hidden = true`
    /// rows (the endpoint 404s for them); admin/owner callers see
    /// hidden companies so they can render the right toggle state.
    pub hidden: bool,
    /// Earliest known interaction with this company.
    pub created_at: DateTime<Utc>,
    /// Most recent known interaction with this company.
    pub updated_at: DateTime<Utc>,
    /// All domains associated with this company, ordered by creation
    /// time ascending (primary first).
    pub domains: Vec<CrmDomainResponse>,
    /// Contacts attached to this company. Hidden contacts are filtered
    /// out for non-admin viewers.
    pub contacts: Vec<CrmContactResponse>,
}

impl From<CrmCompanyWithContacts> for CrmCompanyResponse {
    fn from(record: CrmCompanyWithContacts) -> Self {
        let CrmCompanyWithContacts {
            company,
            name,
            description,
            contacts,
        } = record;
        Self {
            id: company.id,
            team_id: company.team_id,
            name,
            description,
            email_sync: company.email_sync,
            hidden: company.hidden,
            created_at: company.created_at,
            updated_at: company.updated_at,
            domains: company.domains.into_iter().map(Into::into).collect(),
            contacts: contacts.into_iter().map(Into::into).collect(),
        }
    }
}

/// Fetch a single CRM company by id, hydrated with its domains, the
/// primary domain's directory display metadata (name + description),
/// and the company's contacts. Access is enforced by
/// [`CrmCompanyAccessLevelExtractor`]: the user must be on the team
/// that owns the company, and hidden companies are invisible to plain
/// members. Admin/owner callers see hidden companies and contacts so
/// they can render the right unhide UI.
#[utoipa::path(
    get,
    path = "/crm/companies/{company_id}",
    operation_id = "get_company",
    params(
        ("company_id" = Uuid, Path, description = "The CRM company to fetch"),
    ),
    responses(
        (status = 200, body = CrmCompanyResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(company_id = %company_id))]
pub async fn handler<C: CrmService, Eas: EntityAccessService>(
    access: CrmCompanyAccessLevelExtractor<ViewAccessLevel, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(company_id): Path<Uuid>,
) -> Result<Json<CrmCompanyResponse>, CrmError> {
    let record = state
        .service
        .get_company_for_team(&access.receipt)
        .await?
        .ok_or(CrmError::CompanyNotFoundForTeam)?;

    Ok(Json(record.into()))
}
