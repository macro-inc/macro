//! Axum router for favorites endpoints.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::EntityBodyAccessLevelExtractor,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_entity::EntityType;
use model_error_response::ErrorResponse;
use serde::Deserialize;

use crate::domain::{
    models::{Favorite, FavoritesError, FavoritesList},
    ports::FavoritesService,
};

/// Router state for favorites endpoints.
pub struct FavoritesRouterState<S, AccessSvc, Auth> {
    service: Arc<S>,
    access_service: Arc<AccessSvc>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, AccessSvc, Auth> Clone for FavoritesRouterState<S, AccessSvc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, AccessSvc, Auth> FavoritesRouterState<S, AccessSvc, Auth>
where
    S: FavoritesService,
    AccessSvc: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        access_service: Arc<AccessSvc>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            access_service,
            authorization_state,
        }
    }
}

impl<S, AccessSvc, Auth> FromRef<FavoritesRouterState<S, AccessSvc, Auth>> for Arc<AccessSvc> {
    fn from_ref(state: &FavoritesRouterState<S, AccessSvc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<S, AccessSvc, Auth> FromRef<FavoritesRouterState<S, AccessSvc, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &FavoritesRouterState<S, AccessSvc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the favorites router.
///
/// Routes:
/// - `GET /` — list the caller's favorites.
/// - `POST /` — favorite an entity.
/// - `DELETE /{entity_type}/{entity_id}` — remove a favorite.
/// - `PATCH /reorder` — persist a manual order.
pub fn favorites_router<S, AccessSvc, Auth, T>(
    state: FavoritesRouterState<S, AccessSvc, Auth>,
) -> Router<T>
where
    S: FavoritesService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/", get(list_favorites_handler::<S, AccessSvc, Auth>))
        .route("/", post(add_favorite_handler::<S, AccessSvc, Auth>))
        .route(
            "/{entity_type}/{entity_id}",
            delete(remove_favorite_by_entity_handler::<S, AccessSvc, Auth>),
        )
        .route(
            "/reorder",
            patch(reorder_favorites_handler::<S, AccessSvc, Auth>),
        )
        .with_state(state)
}

/// Request body for favoriting an entity.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddFavoriteRequest {
    /// The type of the entity to favorite.
    // Inlined to avoid claiming the shared `EntityType` component name (see
    // `Favorite::entity_type`).
    #[schema(inline)]
    pub entity_type: EntityType,
    /// The id of the entity to favorite.
    pub entity_id: String,
}

/// Path params for removing a favorite by entity.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct RemoveFavoriteByEntityParams {
    /// The type of the favorited entity.
    #[param(inline)]
    pub entity_type: EntityType,
    /// The id of the favorited entity.
    pub entity_id: String,
}

/// A reference to a favorited entity.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteEntityRef {
    /// The type of the favorited entity.
    // Inlined to avoid claiming the shared `EntityType` component name (see
    // `Favorite::entity_type`).
    #[schema(inline)]
    pub entity_type: EntityType,
    /// The id of the favorited entity.
    pub entity_id: String,
}

/// Request body for reordering favorites.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderFavoritesRequest {
    /// The user's favorited entities in the desired order.
    pub favorites: Vec<FavoriteEntityRef>,
}

/// List the caller's favorites.
#[utoipa::path(
    get,
    tag = "favorites",
    operation_id = "list_favorites",
    path = "/favorites",
    responses(
        (status = 200, body = FavoritesList),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_favorites_handler<S, AccessSvc, Auth>(
    State(state): State<FavoritesRouterState<S, AccessSvc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<FavoritesList>, FavoritesError>
where
    S: FavoritesService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let favorites = state
        .service
        .list_favorites(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(FavoritesList { favorites }))
}

/// Favorite an entity in the caller's collection.
#[utoipa::path(
    post,
    tag = "favorites",
    operation_id = "add_favorite",
    path = "/favorites",
    request_body = AddFavoriteRequest,
    responses(
        (status = 200, body = Favorite),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn add_favorite_handler<S, AccessSvc, Auth>(
    State(state): State<FavoritesRouterState<S, AccessSvc, Auth>>,
    access: EntityBodyAccessLevelExtractor<ViewAccessLevel, AccessSvc, AddFavoriteRequest, Auth>,
) -> Result<Json<Favorite>, FavoritesError>
where
    S: FavoritesService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let favorite = state
        .service
        .add_favorite(&access.entity_access_receipt)
        .await?;
    Ok(Json(favorite))
}

/// Remove a favorite by entity.
#[utoipa::path(
    delete,
    tag = "favorites",
    operation_id = "remove_favorite_by_entity",
    path = "/favorites/{entity_type}/{entity_id}",
    params(RemoveFavoriteByEntityParams),
    responses(
        (status = 200, body = ()),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn remove_favorite_by_entity_handler<S, AccessSvc, Auth>(
    State(state): State<FavoritesRouterState<S, AccessSvc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(params): Path<RemoveFavoriteByEntityParams>,
) -> Result<Json<()>, FavoritesError>
where
    S: FavoritesService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let entity = params.entity_type.with_entity_str(&params.entity_id);
    state
        .service
        .remove_favorite_by_entity(&user.authorization.user.macro_user_id, &entity)
        .await?;
    Ok(Json(()))
}

/// Persist a manual order for the caller's favorites.
#[utoipa::path(
    patch,
    tag = "favorites",
    operation_id = "reorder_favorites",
    path = "/favorites/reorder",
    request_body = ReorderFavoritesRequest,
    responses(
        (status = 200, body = ()),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn reorder_favorites_handler<S, AccessSvc, Auth>(
    State(state): State<FavoritesRouterState<S, AccessSvc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<ReorderFavoritesRequest>,
) -> Result<Json<()>, FavoritesError>
where
    S: FavoritesService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let ordered: Vec<_> = req
        .favorites
        .iter()
        .map(|r| r.entity_type.with_entity_str(&r.entity_id))
        .collect();
    state
        .service
        .reorder_favorites(&user.authorization.user.macro_user_id, &ordered)
        .await?;
    Ok(Json(()))
}

impl IntoResponse for FavoritesError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            FavoritesError::NotFound => StatusCode::NOT_FOUND,
            FavoritesError::UnsupportedEntityType(_) | FavoritesError::BadRequest(_) => {
                StatusCode::BAD_REQUEST
            }
            FavoritesError::Unauthorized => StatusCode::FORBIDDEN,
            FavoritesError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            FavoritesError::Internal(_) => {
                tracing::error!(error=?self, "favorites internal server error");
                "internal server error".to_string()
            }
            error => error.to_string(),
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
