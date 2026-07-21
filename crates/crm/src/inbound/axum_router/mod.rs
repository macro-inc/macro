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

/// Team-level CRM configuration (permission thresholds, closed stages,
/// team saved views).
pub mod team_settings;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::FromRef,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, put},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;

use crate::domain::{model::CrmError, service::CrmService};

/// Router state for the CRM endpoints, including service-backed authorization
/// for direct user credentials and internal service access.
pub struct CrmRouterState<C, Eas, Auth> {
    /// CRM service.
    pub service: Arc<C>,
    /// Entity access service used by the team-scoped extractors.
    pub entity_access_service: Arc<Eas>,
    /// State used to authorize direct users and internal service callers.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<C, Eas, Auth> FromRef<CrmRouterState<C, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &CrmRouterState<C, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<C, Eas, Auth> FromRef<CrmRouterState<C, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CrmRouterState<C, Eas, Auth>) -> Self {
        state.authorization_state.clone()
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

impl<C, Eas, Auth> FromRef<CrmRouterState<C, Eas, Auth>> for CrmServiceRef<C> {
    fn from_ref(state: &CrmRouterState<C, Eas, Auth>) -> Self {
        CrmServiceRef(state.service.clone())
    }
}

// Manual Clone so C, Eas, and Auth don't need Clone.
impl<C, Eas, Auth> Clone for CrmRouterState<C, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

/// Build the CRM router with all endpoints.
pub fn crm_router<C, Eas, Auth, S>(state: CrmRouterState<C, Eas, Auth>) -> Router<S>
where
    C: CrmService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/companies/{company_id}/email-sync",
            put(set_email_sync::handler::<C, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}/hidden",
            put(set_company_hidden::handler::<C, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}",
            get(get_company::handler::<C, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}/contacts",
            get(list_company_contacts::handler::<C, Eas, Auth>),
        )
        .route(
            "/contacts/{contact_id}",
            get(get_contact::handler::<C, Eas, Auth>),
        )
        .route(
            "/contacts/{contact_id}/hidden",
            put(set_contact_hidden::handler::<C, Eas, Auth>),
        )
        .route(
            "/comments/{entity_type}/{entity_id}",
            get(comments::list_handler::<C, Eas, Auth>)
                .post(comments::create_handler::<C, Eas, Auth>),
        )
        .route(
            "/comment/{comment_id}",
            patch(comments::edit_handler::<C, Eas, Auth>)
                .delete(comments::delete_handler::<C, Eas, Auth>),
        )
        .route(
            "/settings",
            get(team_settings::get_handler::<C, Eas, Auth>)
                .put(team_settings::update_handler::<C, Eas, Auth>),
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
            CrmError::AdminRoleRequired => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "querying hidden crm entities requires admin/owner team role".into(),
                }),
            ),
            CrmError::SettingsAdminRequired => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message:
                        "changing crm permission or stage settings requires admin/owner team role"
                            .into(),
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
