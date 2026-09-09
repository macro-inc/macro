use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    auth::CrmTeamReceipt,
    lists::{CrmList, CrmListEntry, CrmListParentType, CrmListService},
    model::CrmError,
};

use super::CrmRouterState;

/// The record type a list collects.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CrmListParentTypeApi {
    /// Companies.
    Company,
    /// Contacts.
    Contact,
}

impl From<CrmListParentTypeApi> for CrmListParentType {
    fn from(value: CrmListParentTypeApi) -> Self {
        match value {
            CrmListParentTypeApi::Company => Self::Company,
            CrmListParentTypeApi::Contact => Self::Contact,
        }
    }
}

impl From<CrmListParentType> for CrmListParentTypeApi {
    fn from(value: CrmListParentType) -> Self {
        match value {
            CrmListParentType::Company => Self::Company,
            CrmListParentType::Contact => Self::Contact,
        }
    }
}

/// A CRM list.
#[derive(Debug, Serialize, ToSchema)]
pub struct CrmListResponse {
    /// List id.
    pub id: Uuid,
    /// Display name, unique within the team.
    pub name: String,
    /// What the entries point at.
    pub parent_type: CrmListParentTypeApi,
    /// The seeded Deals list; cannot be deleted.
    pub builtin: bool,
    /// When the list was created.
    pub created_at: DateTime<Utc>,
    /// When the list was last updated.
    pub updated_at: DateTime<Utc>,
}

impl From<CrmList> for CrmListResponse {
    fn from(list: CrmList) -> Self {
        Self {
            id: list.id,
            name: list.name,
            parent_type: list.parent_type.into(),
            builtin: list.builtin,
            created_at: list.created_at,
            updated_at: list.updated_at,
        }
    }
}

/// A record's membership in a list. Properties attach to `id` under the
/// `CRM_LIST_ENTRY` property entity type.
#[derive(Debug, Serialize, ToSchema)]
pub struct CrmListEntryResponse {
    /// Entry id.
    pub id: Uuid,
    /// The list.
    pub list_id: Uuid,
    /// The company or contact, per the list's parent type.
    pub parent_id: Uuid,
    /// When the entry was created.
    pub created_at: DateTime<Utc>,
    /// When the entry was last updated.
    pub updated_at: DateTime<Utc>,
}

impl From<CrmListEntry> for CrmListEntryResponse {
    fn from(entry: CrmListEntry) -> Self {
        Self {
            id: entry.id,
            list_id: entry.list_id,
            parent_id: entry.parent_id,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
        }
    }
}

/// Request body for `POST /crm/lists`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCrmListRequest {
    /// Display name, unique within the team.
    pub name: String,
    /// What the entries point at.
    pub parent_type: CrmListParentTypeApi,
}

/// Request body for `POST /crm/lists/{list_id}/entries`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AddCrmListEntryRequest {
    /// The company or contact to add, per the list's parent type.
    pub parent_id: Uuid,
}

/// The caller's team's lists.
#[utoipa::path(
    get,
    path = "/crm/lists",
    operation_id = "list_crm_lists",
    responses(
        (status = 200, body = [CrmListResponse]),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn list_handler<
    C,
    St,
    Li: CrmListService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Li, Eas, Auth>>,
) -> Result<Json<Vec<CrmListResponse>>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let lists = state.list_service.list_lists(&receipt).await?;
    Ok(Json(lists.into_iter().map(Into::into).collect()))
}

/// Create a list; admin or owner only (403 otherwise).
#[utoipa::path(
    post,
    path = "/crm/lists",
    operation_id = "create_crm_list",
    request_body = CreateCrmListRequest,
    responses(
        (status = 201, body = CrmListResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn create_handler<
    C,
    St,
    Li: CrmListService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Li, Eas, Auth>>,
    Json(req): Json<CreateCrmListRequest>,
) -> Result<(StatusCode, Json<CrmListResponse>), CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let list = state
        .list_service
        .create_list(&receipt, req.name, req.parent_type.into())
        .await?;
    Ok((StatusCode::CREATED, Json(list.into())))
}

/// Entries of one of the caller's team's lists. Entries whose parent record
/// is hidden are omitted for plain members.
#[utoipa::path(
    get,
    path = "/crm/lists/{list_id}/entries",
    operation_id = "list_crm_list_entries",
    params(
        ("list_id" = Uuid, Path, description = "The list whose entries to return"),
    ),
    responses(
        (status = 200, body = [CrmListEntryResponse]),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(list_id = %list_id))]
pub async fn list_entries_handler<
    C,
    St,
    Li: CrmListService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Li, Eas, Auth>>,
    Path(list_id): Path<Uuid>,
) -> Result<Json<Vec<CrmListEntryResponse>>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let entries = state.list_service.list_entries(&receipt, list_id).await?;
    Ok(Json(entries.into_iter().map(Into::into).collect()))
}

/// Add a company or contact to a list. A record may be in a list more than
/// once. 404 when the list or the record is not the team's.
#[utoipa::path(
    post,
    path = "/crm/lists/{list_id}/entries",
    operation_id = "add_crm_list_entry",
    params(
        ("list_id" = Uuid, Path, description = "The list to add to"),
    ),
    request_body = AddCrmListEntryRequest,
    responses(
        (status = 201, body = CrmListEntryResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(list_id = %list_id))]
pub async fn add_entry_handler<
    C,
    St,
    Li: CrmListService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Li, Eas, Auth>>,
    Path(list_id): Path<Uuid>,
    Json(req): Json<AddCrmListEntryRequest>,
) -> Result<(StatusCode, Json<CrmListEntryResponse>), CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let entry = state
        .list_service
        .add_entry(&receipt, list_id, req.parent_id)
        .await?;
    Ok((StatusCode::CREATED, Json(entry.into())))
}
