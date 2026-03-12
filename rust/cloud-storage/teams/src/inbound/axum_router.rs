//! Axum router for team endpoints.

use std::sync::Arc;

use axum::Router;

use crate::domain::team_repo::TeamService;

/// Router state containing the team service.
pub struct TeamRouterState<T> {
    /// The team service implementation.
    pub service: Arc<T>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T> Clone for TeamRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Build the teams router with all endpoints.
pub fn teams_router<T, S>(state: TeamRouterState<T>) -> Router<S>
where
    T: TeamService,
    S: Send + Sync + 'static,
{
    Router::new().with_state(state)
}
