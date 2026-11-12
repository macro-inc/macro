//! Add or remove one of the addresses an authorized CRM contact is known by.

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

/// One of a contact's addresses. It travels in the body, never the path, so
/// request telemetry does not record it.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContactEmailRequest {
    /// The address to add or remove. An identical retry is accepted.
    pub email: String,
}

/// Add an address to a contact. It must not belong to another contact in the
/// team, and becomes the primary only when the contact has none. Idempotent.
#[utoipa::path(
    put,
    path = "/crm/contacts/{contact_id}/emails",
    operation_id = "add_crm_contact_email",
    params(("contact_id" = Uuid, Path, description = "The contact to update")),
    request_body = ContactEmailRequest,
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
pub async fn add_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmContactAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(contact_id): Path<Uuid>,
    Json(req): Json<ContactEmailRequest>,
) -> Result<Json<CrmContactResponse>, CrmError> {
    let contact = state
        .service
        .add_contact_email(&access.receipt, &req.email)
        .await?;
    Ok(Json(contact.into()))
}

/// Remove an address from a contact. Nothing else is deleted: the contact
/// stops showing that address's email history. Removing the primary promotes
/// the oldest address left. The last address on a domain of the contact's
/// company cannot be removed while the contact is linked to it. Idempotent.
#[utoipa::path(
    delete,
    path = "/crm/contacts/{contact_id}/emails",
    operation_id = "remove_crm_contact_email",
    params(("contact_id" = Uuid, Path, description = "The contact to update")),
    request_body = ContactEmailRequest,
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
pub async fn remove_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmContactAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(contact_id): Path<Uuid>,
    Json(req): Json<ContactEmailRequest>,
) -> Result<Json<CrmContactResponse>, CrmError> {
    let contact = state
        .service
        .remove_contact_email(&access.receipt, &req.email)
        .await?;
    Ok(Json(contact.into()))
}
