//! Handler for listing initiatives.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;

use super::InitiativeRouterState;
use crate::domain::{
    models::{InitiativeError, InitiativeList},
    ports::InitiativeService,
};

/// List initiatives the caller can view.
#[utoipa::path(
    get,
    tag = "initiative",
    operation_id = "list_initiatives",
    path = "/initiatives",
    responses(
        (status = 200, body = InitiativeList),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_initiatives_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<InitiativeList>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let list = state
        .service
        .list(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(list))
}
