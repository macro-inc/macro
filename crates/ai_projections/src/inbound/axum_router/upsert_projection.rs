//! Handler that gets or creates a projection definition and the requesting
//! user's instance of it.

use axum::{Json, extract::State};
use chrono::{DateTime, Utc};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService};

use crate::domain::{
    ai_projection_service::{AiProjectionService, requires_professional_features},
    model::{
        Expiry, ProjectionStatus, RefreshCadence, TargetType, UpsertProjectionError,
        UpsertProjectionParams, UserAiProjection,
    },
};

use super::AiProjectionRouterState;

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
    /// Optional `provider/model` id used for generation (e.g.
    /// `cerebras/llama-3.3-70b`). The default model is used when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Optional JSON schema the generated result must conform to. When set,
    /// `data` holds the JSON serialization of a conforming value. Enforcement
    /// is prompted (non-strict), so it works across providers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub output_schema: Option<serde_json::Value>,
    /// When `true` and generation is needed (cold instance or `regenerate`),
    /// the server generates inline and responds with the finished result
    /// instead of returning immediately and pushing an update through the
    /// connection gateway.
    #[serde(default, rename = "await")]
    pub await_generation: bool,
    /// When `true`, regenerate even if a cached result exists.
    #[serde(default)]
    pub regenerate: bool,
}

/// The current state of a user's projection instance.
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct ProjectionStateResponse {
    /// The projection id.
    pub id: String,
    /// The materialization status.
    pub status: ProjectionStatus,
    /// The cached result, if any. JSON-encoded when the projection defines an
    /// `output_schema`.
    pub data: Option<String>,
    /// The most recent materialization error, if any.
    pub error: Option<String>,
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
            error: instance.error,
            generated_at: instance.generated_at,
            stale_at: instance.stale_at,
        }
    }
}

/// Gets or creates an ai projection and the requesting user's instance,
/// triggering (or awaiting) materialization when needed.
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
pub async fn handler<T: AiProjectionService, Auth: MacroAuthorizationService>(
    State(state): State<AiProjectionRouterState<T, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
    Json(req): Json<UpsertProjectionRequest>,
) -> Result<Json<ProjectionStateResponse>, UpsertProjectionError> {
    // Free-tier models are available to everyone; anything else (including
    // the default smart model when no model is named) is premium-only.
    if requires_professional_features(req.model.as_deref())
        && !state
            .service
            .has_professional_features(&user.macro_user_id)
            .await?
    {
        return Err(UpsertProjectionError::ProfessionalFeaturesRequired);
    }

    let target_projection = state
        .service
        .upsert_projection(
            &user.macro_user_id,
            UpsertProjectionParams {
                id: req.id,
                prompt: req.prompt,
                target_type: req.target_type,
                refresh_cadence: req.refresh_cadence,
                expiry: req.expiry,
                model: req.model,
                output_schema: req.output_schema,
                await_generation: req.await_generation,
                regenerate: req.regenerate,
            },
        )
        .await?;

    Ok(Json(target_projection.into()))
}
