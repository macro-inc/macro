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

/// Contacts returned when the request omits `limit`.
const DEFAULT_LIMIT: u8 = 20;

/// Query parameters for searching the caller's team's CRM contacts.
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct SearchContactsParams {
    /// Text the contact's email or name must contain (case-insensitive).
    /// Empty lists the most recently interacted contacts.
    #[serde(default)]
    pub query: String,
    /// Maximum contacts to return (1-50, default 20).
    pub limit: Option<u8>,
}

/// Response from searching CRM contacts.
#[derive(Debug, Serialize, ToSchema)]
pub struct SearchContactsResponse {
    /// Matching contacts, most recently interacted first.
    pub contacts: Vec<CrmContactResponse>,
}

/// Search the caller's team's CRM contacts by email or name. Any team member
/// may search visible contacts; admin/owner callers also match hidden
/// contacts and contacts under hidden companies.
#[utoipa::path(
    get,
    path = "/crm/contacts",
    operation_id = "search_contacts",
    params(SearchContactsParams),
    responses(
        (status = 200, body = SearchContactsResponse),
        (status = 401, body = ErrorResponse),
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
    Query(params): Query<SearchContactsParams>,
) -> Result<Json<SearchContactsResponse>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let contacts = state
        .service
        .search_contacts(
            &receipt,
            &params.query,
            params.limit.unwrap_or(DEFAULT_LIMIT),
        )
        .await?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(Json(SearchContactsResponse { contacts }))
}
