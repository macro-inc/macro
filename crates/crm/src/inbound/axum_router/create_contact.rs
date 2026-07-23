use axum::{
    Json,
    extract::{Path, State},
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

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};

/// Request body for `POST /crm/companies/{company_id}/contacts`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCrmContactRequest {
    /// Display name for the contact.
    pub name: String,
    /// The contact's email address, e.g. "jane@acme.com". Its domain
    /// must be one of the company's domains (400 otherwise).
    pub email: String,
}

/// Manually create a contact under a CRM company. Access is enforced by
/// [`CrmCompanyAccessLevelExtractor`]: the caller must be on the team
/// that owns the company (hidden companies are reachable for
/// admin/owner only, and the new contact then inherits `hidden`). The
/// email's domain must be one of the company's domains (400), the
/// company must not already track the email (409), and the team's CRM
/// killswitch must be on (403).
#[utoipa::path(
    post,
    path = "/crm/companies/{company_id}/contacts",
    operation_id = "create_crm_contact",
    params(
        ("company_id" = Uuid, Path, description = "The CRM company to add the contact to"),
    ),
    request_body = CreateCrmContactRequest,
    responses(
        (status = 200, body = CrmContactResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(company_id = %company_id))]
pub async fn handler<C: CrmService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: CrmCompanyAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, Eas, Auth>>,
    Path(company_id): Path<Uuid>,
    Json(req): Json<CreateCrmContactRequest>,
) -> Result<Json<CrmContactResponse>, CrmError> {
    let contact = state
        .service
        .create_contact(&access.receipt, &req.name, &req.email)
        .await?;
    Ok(Json(contact.into()))
}
