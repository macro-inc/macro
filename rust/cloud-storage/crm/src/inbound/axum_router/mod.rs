//! Axum router for CRM endpoints.

/// Toggle the `email_sync` flag on a `crm_companies` row.
pub mod set_email_sync;

/// Toggle the `hidden` flag on a `crm_companies` row.
pub mod set_company_hidden;

/// Toggle the `hidden` flag on a `crm_contacts` row.
pub mod set_contact_hidden;

/// List contacts of a `crm_companies` row. Role-aware: members see
/// visible contacts only; admin/owner see hidden contacts too.
pub mod list_company_contacts;

/// Fetch a single CRM contact by id. Role-aware: members 404 on hidden
/// rows; admin/owner reach hidden contacts (and hidden parent companies).
pub mod get_contact;

/// Fetch a single CRM company by id, hydrated with domains and contacts.
pub mod get_company;

/// Comment threads on a `crm_companies` / `crm_contacts` row.
pub mod comments;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::FromRef,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, put},
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

/// Newtype around `Arc<C>` so it can be pulled from
/// [`CrmRouterState`] via `FromRef` without colliding with
/// [`FromRef`] for [`Arc<Eas>`] in the (theoretical) case where
/// `C == Eas`. Plain `Arc<C>` vs `Arc<Eas>` overlap as
/// implementations when both type params resolve to the same type;
/// wrapping one side fixes it without changing the state's storage.
#[derive(Debug)]
pub struct CrmServiceRef<C>(pub Arc<C>);

impl<C> Clone for CrmServiceRef<C> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<C, Eas> FromRef<CrmRouterState<C, Eas>> for CrmServiceRef<C> {
    fn from_ref(state: &CrmRouterState<C, Eas>) -> Self {
        CrmServiceRef(state.service.clone())
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
        .route(
            "/companies/{company_id}/hidden",
            put(set_company_hidden::handler::<C, Eas>),
        )
        .route(
            "/companies/{company_id}",
            get(get_company::handler::<C, Eas>),
        )
        .route(
            "/companies/{company_id}/contacts",
            get(list_company_contacts::handler::<C, Eas>),
        )
        .route(
            "/contacts/{contact_id}",
            get(get_contact::handler::<C, Eas>),
        )
        .route(
            "/contacts/{contact_id}/hidden",
            put(set_contact_hidden::handler::<C, Eas>),
        )
        .route(
            "/comments/{entity_type}/{entity_id}",
            get(comments::list_handler::<C, Eas>).post(comments::create_handler::<C, Eas>),
        )
        .route(
            "/comment/{comment_id}",
            patch(comments::edit_handler::<C, Eas>).delete(comments::delete_handler::<C, Eas>),
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
            CrmError::ContactNotFoundForTeam => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "crm contact not found for team".into(),
                }),
            ),
            CrmError::ThreadNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "crm comment thread not found".into(),
                }),
            ),
            CrmError::CommentNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "crm comment not found".into(),
                }),
            ),
            CrmError::CommentNotOwned => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "you can only modify your own crm comments".into(),
                }),
            ),
            CrmError::InvalidRequest(message) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            ),
            CrmError::CompanyHidden => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: "crm company is hidden; un-hide before enabling email sync".into(),
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
