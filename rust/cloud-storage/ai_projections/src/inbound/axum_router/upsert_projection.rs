//! Handler that gets or creates a projection definition and the requesting
//! user's instance of it.

use axum::{Json, extract::State};
use chrono::{DateTime, Utc};

use crate::domain::{
    ai_projection_service::AiProjectionService,
    model::{
        Expiry, ProjectionStatus, RefreshCadence, TargetType, UpsertProjectionError,
        UpsertProjectionParams, UserAiProjection,
    },
};

use super::{AiProjectionRouterState, premium_user::PremiumUserExtractor};

/// Request body for getting or creating an ai projection. The concrete target
/// id is resolved from the authenticated user, so only the target type is sent.
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct UpsertProjectionRequest {
    /// The frontend-defined projection id (e.g. `notification_important_widget`).
    pub id: String,
    /// The prompt used to materialize the projection.
    pub prompt: String,
    /// Whether the projection is materialized for the requesting user or their team.
    pub target_type: TargetType,
    /// How frequently the projection should be regenerated.
    pub refresh_cadence: RefreshCadence,
    /// How long the projection remains active without being requested.
    pub expiry: Expiry,
}

/// The current state of a user's projection instance.
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct ProjectionStateResponse {
    /// The projection id.
    pub id: String,
    /// The materialization status.
    pub status: ProjectionStatus,
    /// The cached result, if any.
    pub data: Option<String>,
    /// When the result was generated.
    pub generated_at: Option<DateTime<Utc>>,
    /// When the result becomes stale.
    pub stale_at: Option<DateTime<Utc>>,
}

impl From<UserAiProjection> for ProjectionStateResponse {
    fn from(instance: UserAiProjection) -> Self {
        Self {
            id: instance.ai_projection_id,
            status: instance.status,
            data: instance.result,
            generated_at: instance.generated_at,
            stale_at: instance.stale_at,
        }
    }
}

/// Gets or creates an ai projection and the requesting user's cold instance.
#[utoipa::path(
    post,
    path = "/ai-projections",
    operation_id = "upsert_ai_projection",
    request_body = UpsertProjectionRequest,
    responses(
        (status = 200, body = ProjectionStateResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: AiProjectionService>(
    State(state): State<AiProjectionRouterState<T>>,
    premium_user: PremiumUserExtractor,
    Json(req): Json<UpsertProjectionRequest>,
) -> Result<Json<ProjectionStateResponse>, UpsertProjectionError> {
    let target_projection = state
        .service
        .upsert_projection(
            &premium_user.macro_user_id,
            UpsertProjectionParams {
                id: req.id,
                prompt: req.prompt,
                target_type: req.target_type,
                refresh_cadence: req.refresh_cadence,
                expiry: req.expiry,
            },
        )
        .await?;

    Ok(Json(target_projection.into()))
}
