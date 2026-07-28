use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    domain::{model::CrmError, service::CrmService},
    inbound::axum_extractors::CrmContactAccessLevelExtractor,
};

use super::CrmRouterState;

/// Request body for `PUT /contacts/{contact_id}/name`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetContactNameRequest {
    /// New display name for the contact. Stored on `crm_contacts.name`,
    /// which is already team-scoped — unlike company renames no global
    /// directory is involved. Must be non-blank (400 otherwise).
    pub name: String,
}

/// Rename a CRM contact. Access is enforced by
/// [`CrmContactAccessLevelExtractor`]: the caller must be on the team
/// that owns the contact's company (hidden contacts are reachable for
/// admin/owner only). The name overwrites the team-scoped
/// `crm_contacts.name` column.
#[utoipa::path(
    put,
    path = "/crm/contacts/{contact_id}/name",
    operation_id = "set_crm_contact_name",
    params(
        ("contact_id" = Uuid, Path, description = "The CRM contact to rename"),
    ),
    request_body = SetContactNameRequest,
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(contact_id = %contact_id))]
pub async fn handler<C: CrmService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: CrmContactAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    State(state): State<CrmRouterState<C, Eas, Auth>>,
    Path(contact_id): Path<Uuid>,
    Json(req): Json<SetContactNameRequest>,
) -> Result<StatusCode, CrmError> {
    state
        .service
        .set_contact_name(&access.receipt, &req.name)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
