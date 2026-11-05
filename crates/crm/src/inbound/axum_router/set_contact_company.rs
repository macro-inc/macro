//! Update the optional company field of an authorized CRM contact.

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};
use crate::{
    domain::{model::CrmError, service::CrmService},
    inbound::axum_extractors::CrmContactAccessLevelExtractor,
};
use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// Replace or clear the contact's company.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetContactCompanyRequest {
    /// New company; null clears the field.
    pub company_id: Option<Uuid>,
}

/// Update an existing team-owned contact without merging its identity.
#[utoipa::path(
    put,
    path = "/crm/contacts/{contact_id}/company",
    operation_id = "set_crm_contact_company",
    params(("contact_id" = Uuid, Path, description = "The contact to update")),
    request_body = SetContactCompanyRequest,
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
#[tracing::instrument(skip_all, err, fields(%contact_id))]
pub async fn handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmContactAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(contact_id): Path<Uuid>,
    Json(req): Json<SetContactCompanyRequest>,
) -> Result<Json<CrmContactResponse>, CrmError> {
    let contact = state
        .service
        .set_contact_company(&access.receipt, req.company_id)
        .await?;
    Ok(Json(contact.into()))
}
