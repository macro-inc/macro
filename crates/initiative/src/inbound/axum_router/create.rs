//! Handler for creating an initiative.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;

use super::InitiativeRouterState;
use crate::domain::{
    models::{CreateInitiativeRequest, InitiativeDetail, InitiativeError},
    ports::InitiativeService,
};

/// Create an initiative owned by the caller.
#[utoipa::path(
    post,
    tag = "initiative",
    operation_id = "create_initiative",
    path = "/initiatives",
    request_body = CreateInitiativeRequest,
    responses(
        (status = 200, body = InitiativeDetail),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, description = "Name exceeds the maximum length", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_initiative_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<CreateInitiativeRequest>,
) -> Result<Json<InitiativeDetail>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let detail = state
        .service
        .create(&user.authorization.user.macro_user_id, request)
        .await?;
    Ok(Json(detail))
}
