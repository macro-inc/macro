use axum::{Json, extract::State, http::StatusCode};
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
    model::CrmError,
    stages::{CrmStageService, StageInput, TeamStageSet},
};

use super::CrmRouterState;

/// One stage in a `PUT /crm/stages` body.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CrmStageInput {
    /// Existing stage to keep; omit to add one.
    #[serde(default)]
    pub id: Option<Uuid>,
    /// Label after the update; non-blank and unique within the set.
    pub label: String,
}

/// Request body for `PUT /crm/stages`: the whole stage set in order.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReplaceCrmStagesRequest {
    /// Stages first to last.
    pub stages: Vec<CrmStageInput>,
}

/// One stage of the team's custom pipeline.
#[derive(Debug, Serialize, ToSchema)]
pub struct CrmStageResponse {
    /// Property option id companies carry as their stage value.
    pub id: Uuid,
    /// Label.
    pub label: String,
}

/// The team's custom stage set.
#[derive(Debug, Serialize, ToSchema)]
pub struct CrmStagesResponse {
    /// Team-scoped stage definition id.
    pub definition_id: Uuid,
    /// Stages in pipeline order.
    pub stages: Vec<CrmStageResponse>,
}

impl From<TeamStageSet> for CrmStagesResponse {
    fn from(set: TeamStageSet) -> Self {
        Self {
            definition_id: set.definition_id,
            stages: set
                .stages
                .into_iter()
                .map(|stage| CrmStageResponse {
                    id: stage.id,
                    label: stage.label,
                })
                .collect(),
        }
    }
}

/// Replace the team's deal stages; requires `edit_stages_role` (403 otherwise).
#[utoipa::path(
    put,
    path = "/crm/stages",
    operation_id = "put_crm_team_stages",
    request_body = ReplaceCrmStagesRequest,
    responses(
        (status = 200, body = CrmStagesResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn replace_handler<
    C,
    St: CrmStageService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Json(req): Json<ReplaceCrmStagesRequest>,
) -> Result<Json<CrmStagesResponse>, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    let stages = req
        .stages
        .into_iter()
        .map(|stage| StageInput {
            id: stage.id,
            label: stage.label,
        })
        .collect();
    let set = state.stage_service.replace_stages(&receipt, stages).await?;
    Ok(Json(set.into()))
}

/// Reset the team's deal stages to the defaults; gated like `PUT /crm/stages`.
#[utoipa::path(
    delete,
    path = "/crm/stages",
    operation_id = "reset_crm_team_stages",
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn reset_handler<
    C,
    St: CrmStageService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
) -> Result<StatusCode, CrmError> {
    let receipt = CrmTeamReceipt::from_team_receipt(access.entity_access_receipt)?;
    state.stage_service.reset_stages(&receipt).await?;
    Ok(StatusCode::NO_CONTENT)
}
