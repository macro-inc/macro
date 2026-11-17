//! Handler for filtered, paged initiative reads with properties and progress.

use axum::{
    Json,
    extract::{Query, State},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;

use super::InitiativeRouterState;
use crate::domain::{
    models::InitiativeError,
    ports::InitiativeService,
    reads::{InitiativePage, InitiativePageRequest},
};

/// Page the initiatives the caller can view, filtered by name and canonical properties,
/// with each row's properties and progress over the tasks the caller can view.
#[utoipa::path(
    get,
    tag = "initiative",
    operation_id = "page_initiatives",
    path = "/initiatives/page",
    params(InitiativePageRequest),
    responses(
        (status = 200, body = InitiativePage),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn page_initiatives_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(request): Query<InitiativePageRequest>,
) -> Result<Json<InitiativePage>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let page = state
        .service
        .page(&user.authorization.user.macro_user_id, request)
        .await?;
    Ok(Json(page))
}
