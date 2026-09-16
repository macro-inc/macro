//! Axum router for initiative endpoints.

#[cfg(test)]
mod test;

pub mod assign_tasks;
pub mod create;
pub mod delete;
pub mod get;
pub mod list;
pub mod unassign_task;
pub mod update;

use std::str::FromStr;
use std::sync::Arc;

use axum::{
    Json, Router,
    body::Body,
    extract::{FromRef, Path, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
    routing::{self, put},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};

pub use self::{
    assign_tasks::assign_initiative_tasks_handler, create::create_initiative_handler,
    delete::delete_initiative_handler, get::get_initiative_handler, list::list_initiatives_handler,
    unassign_task::unassign_initiative_task_handler, update::update_initiative_handler,
};
use crate::domain::{
    models::{InitiativeBasic, InitiativeError, InitiativeId},
    ports::InitiativeService,
};

/// Router state for initiative endpoints.
pub struct InitiativeRouterState<S, Eas, Auth> {
    service: Arc<S>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for InitiativeRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> InitiativeRouterState<S, Eas, Auth>
where
    S: InitiativeService,
    Eas: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        entity_access_service: Arc<Eas>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<S, Eas, Auth> FromRef<InitiativeRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &InitiativeRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<InitiativeRouterState<S, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &InitiativeRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Successful mutation with no payload.
#[derive(Debug, Clone, Copy, Serialize, utoipa::ToSchema)]
pub struct GenericSuccessResponse {
    /// Whether the mutation succeeded.
    pub success: bool,
}

/// Path parameters for `{initiative_id}` routes.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct InitiativeIdParams {
    /// Initiative identifier.
    pub initiative_id: String,
}

/// Path parameters for unassigning one task.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct UnassignTaskParams {
    /// Initiative identifier.
    pub initiative_id: String,
    /// Task identifier.
    pub task_id: String,
}

/// Build the initiative router.
///
/// Nested under `/initiatives` by the composition root.
pub fn initiative_router<S, Eas, Auth, T>(state: InitiativeRouterState<S, Eas, Auth>) -> Router<T>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    let initiative_id_routes = Router::new()
        .route(
            "/{initiative_id}",
            routing::get(get_initiative_handler::<S, Eas, Auth>)
                .patch(update_initiative_handler::<S, Eas, Auth>)
                .delete(delete_initiative_handler::<S, Eas, Auth>),
        )
        .route(
            "/{initiative_id}/tasks",
            put(assign_initiative_tasks_handler::<S, Eas, Auth>),
        )
        .route(
            "/{initiative_id}/tasks/{task_id}",
            routing::delete(unassign_initiative_task_handler::<S, Eas, Auth>),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ensure_initiative_exists::<S, Eas, Auth>,
        ));

    Router::new()
        .merge(initiative_id_routes)
        .route(
            "/",
            routing::get(list_initiatives_handler::<S, Eas, Auth>)
                .post(create_initiative_handler::<S, Eas, Auth>),
        )
        .with_state(state)
}

#[tracing::instrument(skip(state, request, next))]
async fn ensure_initiative_exists<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    Path(InitiativeIdParams { initiative_id }): Path<InitiativeIdParams>,
    mut request: Request<Body>,
    next: Next,
) -> impl IntoResponse
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let id = match InitiativeId::from_str(&initiative_id) {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid initiative id".into(),
                }),
            )
                .into_response();
        }
    };

    let basic: InitiativeBasic = match state.service.internal_get_basic(id).await {
        Ok(basic) => basic,
        Err(InitiativeError::NotFound) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: format!("initiative with id \"{initiative_id}\" was not found").into(),
                }),
            )
                .into_response();
        }
        Err(error) => {
            tracing::error!(
                error=?error,
                initiative_id=?initiative_id,
                "unable to check if initiative exists"
            );
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unknown error occurred".into(),
                }),
            )
                .into_response();
        }
    };

    request.extensions_mut().insert(basic);
    next.run(request).await.into_response()
}

impl IntoResponse for InitiativeError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            InitiativeError::NotFound => StatusCode::NOT_FOUND,
            InitiativeError::Unauthorized => StatusCode::UNAUTHORIZED,
            InitiativeError::BadRequest(_) => StatusCode::BAD_REQUEST,
            InitiativeError::Conflict(_) => StatusCode::CONFLICT,
            InitiativeError::NameTooLong { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            InitiativeError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            InitiativeError::Internal(e) => {
                tracing::error!(error=?e, "initiative request failed");
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
