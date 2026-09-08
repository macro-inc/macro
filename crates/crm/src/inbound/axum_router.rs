//! Axum router for CRM endpoints.

/// Toggle the `email_sync` flag on a `crm_companies` row.
pub mod set_email_sync;

/// Toggle the `hidden` flag on a `crm_companies` row.
pub mod set_company_hidden;

/// Set the team-scoped display-name override (`custom_name`) on a
/// `crm_companies` row.
pub mod set_company_name;

/// Toggle the `hidden` flag on a `crm_contacts` row.
pub mod set_contact_hidden;

/// Set the display name (`name`) on a `crm_contacts` row.
pub mod set_contact_name;

/// List contacts of a `crm_companies` row. Role-aware: members see
/// visible contacts only; admin/owner see hidden contacts too.
pub mod list_company_contacts;

/// Fetch a single CRM contact by id. Role-aware: members 404 on hidden
/// rows; admin/owner reach hidden contacts (and hidden parent companies).
pub mod get_contact;

/// Look up a CRM contact by email in the caller's team. Role-aware: members
/// receive null for hidden rows; admin/owner reach hidden contacts.
pub mod get_contact_by_email;

/// Fetch a single CRM company by id, hydrated with domains and contacts.
pub mod get_company;

/// Manually create a CRM company (name + domain) for the caller's team.
pub mod create_company;

/// Manually create a contact (name + email) under a CRM company.
pub mod create_contact;

/// Comment threads on a `crm_companies` / `crm_contacts` row.
pub mod comments;

/// Team-level CRM configuration (permission thresholds, closed stages,
/// team saved views).
pub mod team_settings;

/// The team's deal stage set, gated on `edit_stages_role`.
pub mod stages;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::FromRef,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;

use crate::domain::{model::CrmError, service::CrmService, stages::CrmStageService};

/// Router state for the CRM endpoints, including service-backed authorization
/// for direct user credentials and internal service access.
pub struct CrmRouterState<C, St, Eas, Auth> {
    /// CRM service.
    pub service: Arc<C>,
    /// Team deal stage service.
    pub stage_service: Arc<St>,
    /// Entity access service used by the team-scoped extractors.
    pub entity_access_service: Arc<Eas>,
    /// State used to authorize direct users and internal service callers.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<C, St, Eas, Auth> FromRef<CrmRouterState<C, St, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &CrmRouterState<C, St, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<C, St, Eas, Auth> FromRef<CrmRouterState<C, St, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CrmRouterState<C, St, Eas, Auth>) -> Self {
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

impl<C, St, Eas, Auth> FromRef<CrmRouterState<C, St, Eas, Auth>> for CrmServiceRef<C> {
    fn from_ref(state: &CrmRouterState<C, St, Eas, Auth>) -> Self {
        CrmServiceRef(state.service.clone())
    }
}

// Manual Clone so C, St, Eas, and Auth don't need Clone.
impl<C, St, Eas, Auth> Clone for CrmRouterState<C, St, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            stage_service: self.stage_service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

/// Build the CRM router with all endpoints.
pub fn crm_router<C, St, Eas, Auth, S>(state: CrmRouterState<C, St, Eas, Auth>) -> Router<S>
where
    C: CrmService,
    St: CrmStageService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/companies",
            post(create_company::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}/email-sync",
            put(set_email_sync::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}/hidden",
            put(set_company_hidden::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}/name",
            put(set_company_name::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}",
            get(get_company::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}/contacts",
            get(list_company_contacts::handler::<C, St, Eas, Auth>)
                .post(create_contact::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/contacts/by-email",
            get(get_contact_by_email::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/contacts/{contact_id}",
            get(get_contact::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/contacts/{contact_id}/hidden",
            put(set_contact_hidden::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/contacts/{contact_id}/name",
            put(set_contact_name::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/comments/{entity_type}/{entity_id}",
            get(comments::list_handler::<C, St, Eas, Auth>)
                .post(comments::create_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/comment/{comment_id}",
            patch(comments::edit_handler::<C, St, Eas, Auth>)
                .delete(comments::delete_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/settings",
            get(team_settings::get_handler::<C, St, Eas, Auth>)
                .put(team_settings::update_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/stages",
            put(stages::replace_handler::<C, St, Eas, Auth>)
                .delete(stages::reset_handler::<C, St, Eas, Auth>),
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
            CrmError::StageEditRoleRequired(role) => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: format!(
                        "editing deal stages requires the {} team role",
                        role.as_db_str()
                    )
                    .into(),
                }),
            ),
            CrmError::CompanyHidden => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: "crm company is hidden; un-hide before enabling email sync".into(),
                }),
            ),
            CrmError::CompanyAlreadyExistsForTeam => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: "a crm company already exists for this domain".into(),
                }),
            ),
            CrmError::ContactAlreadyExistsForCompany => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: "a crm contact with this email already exists for the company".into(),
                }),
            ),
            CrmError::ContactEmailDomainMismatch => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "contact email domain must match one of the company's domains".into(),
                }),
            ),
            CrmError::CrmDisabledForTeam => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "crm is not enabled for this team".into(),
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
