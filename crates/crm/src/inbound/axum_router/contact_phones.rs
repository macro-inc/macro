use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::domain::{
    models::{EditAccessLevel, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    domain::{contact_phones::ContactPhone, model::CrmError, service::CrmService},
    inbound::axum_extractors::CrmContactAccessLevelExtractor,
};

use super::CrmRouterState;

/// A contact's phone numbers, oldest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct ContactPhonesResponse {
    /// The numbers, oldest first.
    pub phones: Vec<ContactPhone>,
}

/// Request body for `PUT /contacts/{contact_id}/phones`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetContactPhonesRequest {
    /// Every number the contact should have, as typed, each with its country
    /// code. Formatting is ignored; numbers are stored in E.164. Numbers the
    /// contact keeps keep their source. Empty removes them all (400 when one
    /// is not a number, or there are more than ten).
    pub phones: Vec<String>,
}

/// The contact's phone numbers. Access is enforced by
/// [`CrmContactAccessLevelExtractor`], like reading the contact.
#[utoipa::path(
    get,
    path = "/crm/contacts/{contact_id}/phones",
    operation_id = "get_crm_contact_phones",
    params(
        ("contact_id" = Uuid, Path, description = "The CRM contact"),
    ),
    responses(
        (status = 200, body = ContactPhonesResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(contact_id = %contact_id))]
pub async fn get_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmContactAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(contact_id): Path<Uuid>,
) -> Result<Json<ContactPhonesResponse>, CrmError> {
    let phones = state.service.contact_phones(&access.receipt).await?;
    Ok(Json(ContactPhonesResponse { phones }))
}

/// Replace the contact's phone numbers. Access is enforced by
/// [`CrmContactAccessLevelExtractor`], like adding the contact's email.
#[utoipa::path(
    put,
    path = "/crm/contacts/{contact_id}/phones",
    operation_id = "set_crm_contact_phones",
    params(
        ("contact_id" = Uuid, Path, description = "The CRM contact"),
    ),
    request_body = SetContactPhonesRequest,
    responses(
        (status = 200, body = ContactPhonesResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(contact_id = %contact_id, count = req.phones.len()))]
pub async fn set_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmContactAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(contact_id): Path<Uuid>,
    Json(req): Json<SetContactPhonesRequest>,
) -> Result<Json<ContactPhonesResponse>, CrmError> {
    let phones = state
        .service
        .set_contact_phones(&access.receipt, &req.phones)
        .await?;
    Ok(Json(ContactPhonesResponse { phones }))
}
