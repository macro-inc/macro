use axum::{Json, extract::State};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    auth::CrmTeamReceipt,
    model::{CrmError, CrmPermissionRole, CrmTeamSettings, CrmTeamSettingsPatch},
    service::CrmService,
};

use super::CrmRouterState;

/// The team's CRM configuration (everything on `team_crm_settings`
/// except the `crm_enabled` killswitch, which is managed via
/// `PATCH /team/crm` on the auth service).
#[derive(Debug, Serialize, ToSchema)]
pub struct CrmTeamSettingsResponse {
    /// Who can change the deal stage set in CRM settings.
    pub edit_stages_role: CrmPermissionRole,
    /// Who can move deals out of a closed stage.
    pub move_closed_deals_role: CrmPermissionRole,
    /// Who can delete (hide) CRM records.
    pub delete_records_role: CrmPermissionRole,
    /// Stage option ids counting as closed deals; absent = the client
    /// falls back to its label heuristic.
    pub closed_stage_ids: Option<Vec<Uuid>>,
    /// Team saved views — an opaque JSON array owned by the frontend.
    pub team_views: Value,
    /// Team view applied by default when a member opens the CRM view.
    pub default_team_view_id: Option<String>,
}

impl From<CrmTeamSettings> for CrmTeamSettingsResponse {
    fn from(settings: CrmTeamSettings) -> Self {
        Self {
            edit_stages_role: settings.edit_stages_role,
            move_closed_deals_role: settings.move_closed_deals_role,
            delete_records_role: settings.delete_records_role,
            closed_stage_ids: settings.closed_stage_ids,
            team_views: settings.team_views,
            default_team_view_id: settings.default_team_view_id,
        }
    }
}

/// Deserializes a field so that a missing key and an explicit `null`
/// are distinguishable: missing → outer `None`, `null` → `Some(None)`.
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

/// Request body for `PUT /crm/settings`. Every field is optional:
/// omitted fields keep their current values.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateCrmTeamSettingsRequest {
    /// New `edit_stages_role`, if provided.
    pub edit_stages_role: Option<CrmPermissionRole>,
    /// New `move_closed_deals_role`, if provided.
    pub move_closed_deals_role: Option<CrmPermissionRole>,
    /// New `delete_records_role`, if provided.
    pub delete_records_role: Option<CrmPermissionRole>,
    /// New closed-stage set. Omit to keep the current value; pass
    /// `null` to clear it (falling back to the client label heuristic).
    #[serde(default, deserialize_with = "double_option")]
    pub closed_stage_ids: Option<Option<Vec<Uuid>>>,
    /// Replacement team-views array (whole-blob, last write wins).
    pub team_views: Option<Value>,
    /// New default team view id. Omit to keep the current value; pass
    /// `null` to clear it.
    #[serde(default, deserialize_with = "double_option")]
    pub default_team_view_id: Option<Option<String>>,
}

impl From<UpdateCrmTeamSettingsRequest> for CrmTeamSettingsPatch {
    fn from(req: UpdateCrmTeamSettingsRequest) -> Self {
        Self {
            edit_stages_role: req.edit_stages_role,
            move_closed_deals_role: req.move_closed_deals_role,
            delete_records_role: req.delete_records_role,
            closed_stage_ids: req.closed_stage_ids,
            team_views: req.team_views,
            default_team_view_id: req.default_team_view_id,
        }
    }
}

/// Read the caller's team CRM configuration. Any team member may read;
/// teams without a settings row get the defaults.
#[utoipa::path(
    get,
    path = "/crm/settings",
    operation_id = "get_crm_team_settings",
    responses(
        (status = 200, body = CrmTeamSettingsResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn get_handler<
    C: CrmService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, Eas, Auth>>,
) -> Result<Json<CrmTeamSettingsResponse>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let settings = state.service.get_team_settings(&receipt).await?;
    Ok(Json(settings.into()))
}

/// Partially update the caller's team CRM configuration. Any team
/// member may update the views fields (`team_views`,
/// `default_team_view_id`); the governance fields (permission
/// thresholds, `closed_stage_ids`) require an admin/owner team role
/// (403 otherwise). Omitted fields keep their current values;
/// `team_views` is replaced whole. Returns the resulting settings.
#[utoipa::path(
    put,
    path = "/crm/settings",
    operation_id = "put_crm_team_settings",
    request_body = UpdateCrmTeamSettingsRequest,
    responses(
        (status = 200, body = CrmTeamSettingsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn update_handler<
    C: CrmService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, Eas, Auth>>,
    Json(req): Json<UpdateCrmTeamSettingsRequest>,
) -> Result<Json<CrmTeamSettingsResponse>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let settings = state
        .service
        .update_team_settings(&receipt, req.into())
        .await?;
    Ok(Json(settings.into()))
}
