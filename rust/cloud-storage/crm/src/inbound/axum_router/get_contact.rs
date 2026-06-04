use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::{
    domain::{
        models::{MemberTeamRole, TeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;
use uuid::Uuid;

use crate::domain::{model::CrmError, service::CrmService};

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};

/// Fetch a single CRM contact by id, scoped to the requesting user's
/// team. Returns 404 when the contact doesn't exist or isn't owned by
/// the team. Non-admin viewers also 404 on hidden contacts or hidden
/// parent companies (so existence doesn't leak); admin/owner viewers
/// reach every owned contact regardless of `hidden`.
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
    access: MacroUserTeamExtractor<MemberTeamRole, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(contact_id): Path<Uuid>,
) -> Result<Json<CrmContactResponse>, CrmError> {
    let team_id = macro_uuid::string_to_uuid(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CrmError::InvalidTeamId)?;
    let include_hidden = access
        .entity_access_receipt
        .entity_permission()
        .allows_team_role(TeamRole::Admin);

    let contact = state
        .service
        .get_contact_for_team(&team_id, &contact_id, include_hidden)
        .await?
        .ok_or(CrmError::ContactNotFoundForTeam)?;

    Ok(Json(contact.into()))
}
