use axum::{Json, extract::State};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::domain::{auth::CrmTeamReceipt, model::CrmError, service::CrmService};

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};

/// Request body for `POST /crm/contacts`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCrmTeamContactRequest {
    /// Display name for the contact.
    pub name: String,
    /// The contact's email address, of any domain. Optional: omit it to
    /// add the contact by name only.
    #[serde(default)]
    pub email: Option<String>,
}

/// Manually create a contact without a company for the caller's team.
/// Any team member may create one. The team must not already have a
/// company-less contact with the email (409), and the team's CRM
/// killswitch must be on (403).
#[utoipa::path(
    post,
    path = "/crm/contacts",
    operation_id = "create_crm_team_contact",
    request_body = CreateCrmTeamContactRequest,
    responses(
        (status = 200, body = CrmContactResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Json(req): Json<CreateCrmTeamContactRequest>,
) -> Result<Json<CrmContactResponse>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let contact = state
        .service
        .create_team_contact(&receipt, &req.name, req.email.as_deref())
        .await?;
    Ok(Json(contact.into()))
}
