use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    domain::{model::CrmError, service::CrmService},
    inbound::axum_extractors::CrmContactAccessLevelExtractor,
};

use super::CrmRouterState;

/// Request body for `PUT /contacts/{contact_id}/hidden`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetContactHiddenRequest {
    /// New value for `crm_contacts.hidden`. `true` hides the contact
    /// from CRM listings for the team; `false` un-hides it. Display-only
    /// — does not affect populate/depopulate.
    pub hidden: bool,
}

/// Toggle `hidden` on a CRM contact. Hiding is a display-only opt-out
/// scoped to the team that owns the contact's company.
#[utoipa::path(
    put,
    path = "/crm/contacts/{contact_id}/hidden",
    operation_id = "set_contact_hidden",
    params(
        ("contact_id" = Uuid, Path, description = "The CRM contact to update"),
    ),
    request_body = SetContactHiddenRequest,
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(contact_id = %contact_id, hidden = req.hidden))]
pub async fn handler<C: CrmService, Eas: EntityAccessService>(
    access: CrmContactAccessLevelExtractor<EditAccessLevel, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(contact_id): Path<Uuid>,
    Json(req): Json<SetContactHiddenRequest>,
) -> Result<StatusCode, CrmError> {
    state
        .service
        .set_contact_hidden(&access.receipt, req.hidden)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
