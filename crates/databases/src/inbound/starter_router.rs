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
    models::DatabaseError,
    starter::{DatabaseStarterService, StarterDatabase},
};
use crate::inbound::axum_router::viewer_of;

/// Starter service and authenticated identity extraction.
pub struct DatabaseStarterRouterState<Service, Authorization> {
    service: Arc<Service>,
    authorization_state: MacroAuthorizationState<Authorization>,
}

impl<Service, Authorization> DatabaseStarterRouterState<Service, Authorization> {
    /// Compose the route at the service entry point.
    pub fn new(
        service: Arc<Service>,
        authorization_state: MacroAuthorizationState<Authorization>,
    ) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<Service, Authorization> Clone for DatabaseStarterRouterState<Service, Authorization> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Service, Authorization> FromRef<DatabaseStarterRouterState<Service, Authorization>>
    for MacroAuthorizationState<Authorization>
{
    fn from_ref(state: &DatabaseStarterRouterState<Service, Authorization>) -> Self {
        state.authorization_state.clone()
    }
}

/// Mount alongside the other database routes.
pub fn starter_router<Service, Authorization, RouterState>(
    state: DatabaseStarterRouterState<Service, Authorization>,
) -> Router<RouterState>
where
    Service: DatabaseStarterService,
    Authorization: MacroAuthorizationService,
    RouterState: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/starter",
            post(ensure_starter_handler::<Service, Authorization>),
        )
        .with_state(state)
}

/// Create a small example once for the authenticated user, if they have no databases.
#[utoipa::path(post, path = "/databases/starter", tag = "databases", responses(
    (status = 200, body = StarterDatabase),
    (status = 401, description = "Authentication required"),
    (status = 500, description = "Provisioning failed; safe to retry")
))]
#[tracing::instrument(err, skip_all)]
pub async fn ensure_starter_handler<Service, Authorization>(
    State(state): State<DatabaseStarterRouterState<Service, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
) -> Result<Json<StarterDatabase>, DatabaseError>
where
    Service: DatabaseStarterService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .ensure_starter(viewer_of(&user))
        .await
        .map(Json)
}
