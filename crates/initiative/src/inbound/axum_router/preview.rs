//! Handler for batch initiative previews.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;

use super::InitiativeRouterState;
use crate::domain::{
    models::InitiativeError,
    ports::InitiativeService,
    reads::{InitiativePreviews, InitiativePreviewsRequest},
};

/// Preview a batch of initiatives for the caller, e.g. to render project mentions.
#[utoipa::path(
    post,
    tag = "initiative",
    operation_id = "get_batch_initiative_preview",
    path = "/initiatives/preview",
    request_body = InitiativePreviewsRequest,
    responses(
        (status = 200, body = InitiativePreviews),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_initiative_previews_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<InitiativePreviewsRequest>,
) -> Result<Json<InitiativePreviews>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let previews = state
        .service
        .previews(&user.authorization.user.macro_user_id, request)
        .await?;
    Ok(Json(previews))
}
