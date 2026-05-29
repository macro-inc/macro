use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    model::{CrmContact, CrmError},
    service::CrmService,
};

use super::CrmRouterState;

/// A CRM contact as returned by `GET /crm/companies/{company_id}/contacts`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrmContactResponse {
    /// The id of the contact record.
    pub id: Uuid,
    /// The id of the company the contact belongs to.
    pub company_id: Uuid,
    /// The contact's email address.
    pub email: String,
    /// Display name observed for the contact, if any.
    pub name: Option<String>,
    /// Earliest known interaction with this contact.
    pub first_interaction: DateTime<Utc>,
    /// Most recent known interaction with this contact.
    pub last_interaction: DateTime<Utc>,
    /// When the contact record was created.
    pub created_at: DateTime<Utc>,
    /// When the contact record was last updated.
    pub updated_at: DateTime<Utc>,
}

impl From<CrmContact> for CrmContactResponse {
    fn from(c: CrmContact) -> Self {
        Self {
            id: c.id,
            company_id: c.company_id,
            email: c.email,
            name: c.name,
            first_interaction: c.first_interaction,
            last_interaction: c.last_interaction,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

/// List the non-hidden contacts of a CRM company, scoped to the
/// requesting user's team. Returns 404 when the company isn't owned by
/// the team (so existence doesn't leak across teams); an owned company
/// with no visible contacts returns `200 []`.
#[utoipa::path(
    get,
    path = "/crm/companies/{company_id}/contacts",
    operation_id = "list_company_contacts",
    params(
        ("company_id" = Uuid, Path, description = "The CRM company whose contacts to list"),
    ),
    responses(
        (status = 200, body = [CrmContactResponse]),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(company_id = %company_id))]
pub async fn handler<C: CrmService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<MemberTeamRole, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(company_id): Path<Uuid>,
) -> Result<Json<Vec<CrmContactResponse>>, CrmError> {
    let team_id = macro_uuid::string_to_uuid(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CrmError::InvalidTeamId)?;

    let contacts = state
        .service
        .list_contacts_for_company(&team_id, &company_id)
        .await?;

    Ok(Json(contacts.into_iter().map(Into::into).collect()))
}
