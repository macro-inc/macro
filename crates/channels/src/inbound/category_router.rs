//! HTTP adapter for personal channel-category layouts.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};

use crate::domain::category::{
    ChannelCategoryError, ChannelCategoryLayout, ChannelCategoryService,
};

/// Router state for personal channel-category endpoints.
pub struct ChannelCategoryRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for ChannelCategoryRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> ChannelCategoryRouterState<S, Auth> {
    /// Construct router state.
    pub fn new(service: S, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service: Arc::new(service),
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<ChannelCategoryRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ChannelCategoryRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build personal channel-category routes.
pub fn channel_category_router<S, Auth, T>(state: ChannelCategoryRouterState<S, Auth>) -> Router<T>
where
    S: ChannelCategoryService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/channel-categories",
            get(get_layout::<S, Auth>).put(put_layout::<S, Auth>),
        )
        .with_state(state)
}

#[utoipa::path(get, path = "/comms/channel-categories", tag = "channels", operation_id = "get_channel_category_layout", responses((status = 200, body = ChannelCategoryLayout)))]
/// Get the authenticated user's personal channel-category layout.
pub async fn get_layout<S, Auth>(
    State(state): State<ChannelCategoryRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<ChannelCategoryLayout>, ChannelCategoryError>
where
    S: ChannelCategoryService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .get_layout(authorization.authorization.user.macro_user_id.clone())
            .await?,
    ))
}

#[utoipa::path(put, path = "/comms/channel-categories", tag = "channels", operation_id = "replace_channel_category_layout", request_body = ChannelCategoryLayout, responses((status = 200, body = ChannelCategoryLayout), (status = 400, body = String), (status = 409, body = String)))]
/// Replace the authenticated user's personal channel-category layout.
pub async fn put_layout<S, Auth>(
    State(state): State<ChannelCategoryRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(layout): Json<ChannelCategoryLayout>,
) -> Result<Json<ChannelCategoryLayout>, ChannelCategoryError>
where
    S: ChannelCategoryService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .replace_layout(
                authorization.authorization.user.macro_user_id.clone(),
                layout,
            )
            .await?,
    ))
}

impl IntoResponse for ChannelCategoryError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            Self::Invalid(_) => StatusCode::BAD_REQUEST,
            Self::Conflict => StatusCode::CONFLICT,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}
