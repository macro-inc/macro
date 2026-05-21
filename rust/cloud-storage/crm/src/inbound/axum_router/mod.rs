//! Axum router for CRM endpoints.

/// Toggle the `email_sync` flag on a `crm_companies` row.
pub mod set_email_sync;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::FromRef,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::put,
};
use entity_access::domain::ports::EntityAccessService;
use model_error_response::ErrorResponse;

use crate::domain::{model::CrmError, service::CrmService};

/// Router state for the CRM endpoints.
pub struct CrmRouterState<C, Eas> {
    /// CRM service.
    pub service: Arc<C>,
    /// Entity access service used by the team-scoped extractors.
    pub entity_access_service: Arc<Eas>,
}

impl<C, Eas> FromRef<CrmRouterState<C, Eas>> for Arc<Eas> {
    fn from_ref(state: &CrmRouterState<C, Eas>) -> Self {
        state.entity_access_service.clone()
    }
}

// Manual Clone so C, Eas don't need Clone.
impl<C, Eas> Clone for CrmRouterState<C, Eas> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

/// Build the CRM router with all endpoints.
pub fn crm_router<C, Eas, S>(state: CrmRouterState<C, Eas>) -> Router<S>
where
    C: CrmService,
    Eas: EntityAccessService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/companies/{company_id}/email-sync",
            put(set_email_sync::handler::<C, Eas>),
        )
        .with_state(state)
}

impl IntoResponse for CrmError {
    fn into_response(self) -> Response {
        match self {
            CrmError::CompanyNotFoundForTeam => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "crm company not found for team".into(),
                }),
            ),
            CrmError::InvalidTeamId | CrmError::StorageLayerError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal server error".into(),
                }),
            ),
        }
        .into_response()
    }
}
