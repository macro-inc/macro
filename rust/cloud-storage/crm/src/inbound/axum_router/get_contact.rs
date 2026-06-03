use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::{
    domain::{
        models::{AccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::CrmContactAccessLevelExtractor,
};
use model_error_response::ErrorResponse;
use uuid::Uuid;

use crate::domain::{model::CrmError, service::CrmService};

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};

/// Fetch a single CRM contact by id. Access is enforced by
/// [`CrmContactAccessLevelExtractor`]: the user must be on the team that
/// owns the contact's parent company, and hidden contacts are invisible
/// to plain members. Admin/owner callers see hidden contacts so they can
/// render the right unhide UI.
#[utoipa::path(
    get,
    path = "/crm/contacts/{contact_id}",
    operation_id = "get_contact",
    params(
        ("contact_id" = Uuid, Path, description = "The CRM contact to fetch"),
    ),
    responses(
        (status = 200, body = CrmContactResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(contact_id = %contact_id))]
pub async fn handler<C: CrmService, Eas: EntityAccessService>(
    access: CrmContactAccessLevelExtractor<ViewAccessLevel, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(contact_id): Path<Uuid>,
) -> Result<Json<CrmContactResponse>, CrmError> {
    let include_hidden = access
        .entity_access_receipt
        .entity_permission()
        .allows_access_level(AccessLevel::Edit);

    let contact = state
        .service
        .get_contact_for_team(&access.team_id, &contact_id, include_hidden)
        .await?
        .ok_or(CrmError::ContactNotFoundForTeam)?;

    Ok(Json(contact.into()))
}
