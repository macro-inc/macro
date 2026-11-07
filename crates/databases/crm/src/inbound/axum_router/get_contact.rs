use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    domain::{
        model::{CrmCompanySummary, CrmContactDetail, CrmError},
        service::CrmService,
    },
    inbound::axum_extractors::CrmContactAccessLevelExtractor,
};

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};

/// A CRM contact as returned by `GET /crm/contacts/{contact_id}`: the
/// contact, with what its page shows of its company.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmContactDetailResponse {
    /// The contact.
    #[serde(flatten)]
    pub contact: CrmContactResponse,
    /// The contact's company, when it has one the caller may see. Older
    /// servers omit it; clients then read the company itself.
    #[schema(required = false)]
    pub company: Option<CrmContactCompanyResponse>,
}

/// The name and visibility of a contact's company.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmContactCompanyResponse {
    /// The id of the company; equal to the contact's `companyId`.
    pub id: Uuid,
    /// The company's display name, if it has one.
    pub name: Option<String>,
    /// The company's oldest domain, which clients show when it has no
    /// name.
    pub domain: Option<String>,
    /// Whether the company is hidden. Only admin/owner callers can see a
    /// hidden company.
    pub hidden: bool,
}

impl From<CrmCompanySummary> for CrmContactCompanyResponse {
    fn from(company: CrmCompanySummary) -> Self {
        Self {
            id: company.id,
            name: company.name,
            domain: company.domain,
            hidden: company.hidden,
        }
    }
}

impl From<CrmContactDetail> for CrmContactDetailResponse {
    fn from(detail: CrmContactDetail) -> Self {
        Self {
            contact: detail.contact.into(),
            company: detail.company.map(Into::into),
        }
    }
}

/// Fetch a single CRM contact by id, with its company's name and
/// visibility. Access is enforced by [`CrmContactAccessLevelExtractor`]:
/// the user must be on the team that owns the contact, and hidden
/// contacts are invisible to plain members. Admin/owner callers see
/// hidden contacts so they can render the right unhide UI.
#[utoipa::path(
    get,
    path = "/crm/contacts/{contact_id}",
    operation_id = "get_contact",
    params(
        ("contact_id" = Uuid, Path, description = "The CRM contact to fetch"),
    ),
    responses(
        (status = 200, body = CrmContactDetailResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(contact_id = %contact_id))]
pub async fn handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmContactAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(contact_id): Path<Uuid>,
) -> Result<Json<CrmContactDetailResponse>, CrmError> {
    let contact = state
        .service
        .get_contact_for_team(&access.receipt)
        .await?
        .ok_or(CrmError::ContactNotFoundForTeam)?;

    Ok(Json(contact.into()))
}
