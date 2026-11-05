//! Add the missing email field of an authorized CRM contact.

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

/// Add a missing contact email. Existing addresses are read-only.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetContactEmailRequest {
    /// The address to add. An identical retry is accepted.
    pub email: String,
}

/// Update an existing team-owned contact without merging its identity.
#[utoipa::path(
    put,
    path = "/crm/contacts/{contact_id}/email",
    operation_id = "set_crm_contact_email",
    params(("contact_id" = Uuid, Path, description = "The contact to update")),
    request_body = SetContactEmailRequest,
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
    Json(req): Json<SetContactEmailRequest>,
) -> Result<Json<CrmContactResponse>, CrmError> {
    let contact = state
        .service
        .set_contact_email(&access.receipt, &req.email)
        .await?;
    Ok(Json(contact.into()))
}
