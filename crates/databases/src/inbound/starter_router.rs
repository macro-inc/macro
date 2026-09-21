//! Authenticated, retry-safe provisioning of a first example database.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    routing::post,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};

use crate::domain::{
    models::{DatabaseError, Viewer},
    starter::{DatabaseStarterService, StarterDatabase},
};

/// Starter service and authenticated identity extraction.
pub struct DatabaseStarterRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> DatabaseStarterRouterState<S, Auth> {
    /// Compose the route at the service entry point.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> Clone for DatabaseStarterRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<DatabaseStarterRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &DatabaseStarterRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Mount alongside the other database routes.
pub fn starter_router<S, Auth, T>(state: DatabaseStarterRouterState<S, Auth>) -> Router<T>
where
    S: DatabaseStarterService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/starter", post(ensure_starter_handler::<S, Auth>))
        .with_state(state)
}

/// Create a small example once for the authenticated user, if they have no databases.
#[utoipa::path(post, path = "/databases/starter", tag = "databases", responses(
    (status = 200, body = StarterDatabase),
    (status = 401, description = "Authentication required"),
    (status = 500, description = "Provisioning failed; safe to retry")
))]
#[tracing::instrument(skip(state, user), err)]
pub async fn ensure_starter_handler<S, Auth>(
    State(state): State<DatabaseStarterRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<StarterDatabase>, DatabaseError>
where
    S: DatabaseStarterService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .ensure_starter(Viewer {
            user_id: user.authorization.user.macro_user_id.clone(),
        })
        .await
        .map(Json)
}
