use axum::{Json, extract::Query, extract::State};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::domain::{auth::CrmTeamReceipt, model::CrmError, service::CrmService};

use super::{CrmRouterState, list_company_contacts::CrmContactResponse};

/// Query parameters for resolving a CRM contact by email.
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct GetContactByEmailParams {
    /// The contact email to resolve within the caller's team.
    pub email: String,
}

/// Response from looking up a CRM contact by email.
#[derive(Debug, Serialize, ToSchema)]
pub struct GetContactByEmailResponse {
    /// The matching contact, or `null` when none is visible.
    pub contact: Option<CrmContactResponse>,
}

/// Look up a CRM contact by email in the caller's team. Returns a null
/// `contact` when no visible contact exists. Any team member may resolve a
/// visible contact; admin/owner callers may also resolve hidden contacts and
/// contacts under hidden companies.
#[utoipa::path(
    get,
    path = "/crm/contacts/by-email",
    operation_id = "get_contact_by_email",
    params(GetContactByEmailParams),
    responses(
        (
            status = 200,
            body = GetContactByEmailResponse,
            description = "The matching contact, or a null contact when none is visible."
        ),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(email = %params.email))]
pub async fn handler<C: CrmService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, Eas, Auth>>,
    Query(params): Query<GetContactByEmailParams>,
) -> Result<Json<GetContactByEmailResponse>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let contact = state
        .service
        .get_contact_by_email(&receipt, &params.email)
        .await?
        .map(Into::into);

    Ok(Json(GetContactByEmailResponse { contact }))
}
