//! Creation accepts full conversation metadata, never a ZIP or file bytes.

use axum::{Json, extract::State};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use serde::Deserialize;
use utoipa::ToSchema;

use super::{ApiError, SlackRouterState};
use crate::domain::{
    models::{CreateImport, ImportError, ImportLimits, ImportProgress},
    ports::ImportService,
};

/// Bounded full-metadata create payload. Domain validation applies effective limits again.
#[derive(Deserialize, ToSchema)]
#[serde(try_from = "CreateImport")]
#[schema(as = SlackCreateRequest, value_type = CreateImport)]
pub struct CreateRequest(CreateImport);

impl TryFrom<CreateImport> for CreateRequest {
    type Error = ImportError;

    fn try_from(command: CreateImport) -> Result<Self, Self::Error> {
        if command.conversations.len() > ImportLimits::default().conversations as usize {
            return Err(ImportError::LimitExceeded);
        }
        Ok(Self(command))
    }
}

/// Create or replay a job using a scoped idempotency token and full selected metadata.
/// Missing creation timestamps and unknown message counts are represented as null.
#[utoipa::path(post, path = "/slack/imports", tag = "slack", operation_id = "create_slack_import",
    request_body = CreateRequest,
    responses((status = 200, body = ImportProgress), (status = 401, description = "Authentication or team administrator access required"),
        (status = 403, description = "Team administrator required"), (status = 413, description = "Metadata limit exceeded"),
        (status = 503, description = "Slack imports disabled or temporarily unavailable")))]
pub async fn create<T, Eas, Auth>(
    State(state): State<SlackRouterState<T, Eas, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    Json(request): Json<CreateRequest>,
) -> Result<Json<ImportProgress>, ApiError>
where
    T: ImportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .create(access.entity_access_receipt, request.0)
            .await?,
    ))
}
