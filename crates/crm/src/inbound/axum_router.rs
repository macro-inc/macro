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

pub mod contact_emails;
pub mod set_contact_company;
pub mod set_contact_email;
/// Set the display name (`name`) on a `crm_contacts` row.
pub mod set_contact_name;

/// List contacts of a `crm_companies` row. Role-aware: members see
/// visible contacts only; admin/owner see hidden contacts too.
pub mod list_company_contacts;

/// One page of a company's contacts, filtered by archive state and search,
/// for the Team list. Same visibility rules as `list_company_contacts`.
pub mod list_company_contacts_page;

/// Fetch a single CRM contact by id. Role-aware: members 404 on hidden
/// rows; admin/owner reach hidden contacts (and hidden parent companies).
pub mod get_contact;

/// Look up a CRM contact by email in the caller's team. Role-aware: members
/// receive null for hidden rows; admin/owner reach hidden contacts.
pub mod get_contact_by_email;

/// Resolve a team's CRM company by one of its domains.
pub mod get_company_by_domain;

/// Search the caller's team's CRM contacts by email or name.
pub mod search_contacts;

/// Fetch a single CRM company by id, hydrated with domains and contacts.
pub mod get_company;

/// Title many CRM company and contact chips in one request.
pub mod previews;

/// Manually create a CRM company (name + domain) for the caller's team.
pub mod create_company;

/// Manually create a contact (name + email) under a CRM company.
pub mod create_contact;

/// Manually create a contact for the caller's team without naming a company.
pub mod create_team_contact;

/// Operator route: file a team's manual contacts under their domain's company.
pub mod file_unfiled_contacts;

/// The domains a team keeps out of email sync.
pub mod blocked_domains;

/// Team-level CRM configuration (permission thresholds, closed stages,
/// team saved views).
pub mod team_settings;

/// Fresh viewer authority for session cache retirement.
pub mod member_access;

/// Own-member contribution rules and consent commands.
pub mod email_policy;
/// Individual email consent and domain blocklists.
pub mod email_privacy;

/// The team's deal stage set, gated on `edit_stages_role`.
pub mod stages;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::FromRef,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
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

/// Routes for internal callers, nested under the host's `/internal` router.
/// Each handler authenticates with the internal-only extractor.
pub fn crm_internal_router<C, St, Eas, Auth, S>(
    state: CrmRouterState<C, St, Eas, Auth>,
) -> Router<S>
where
    C: crate::domain::contact_filing::ContactFilingService,
    St: Send + Sync + 'static,
    Eas: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            file_unfiled_contacts::ROUTE,
            post(file_unfiled_contacts::handler::<C, St, Eas, Auth>),
        )
        .with_state(state)
}

/// Build the CRM router with all endpoints.
pub fn crm_router<C, St, Eas, Auth, S>(state: CrmRouterState<C, St, Eas, Auth>) -> Router<S>
where
    C: CrmService
        + crate::domain::email_policy_api::EmailPolicyService
        + crate::domain::email_policy_preview::EmailPreviewService,
    St: CrmStageService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .merge(email_policy::routes::<C, St, Eas, Auth>())
        .route(
            "/member-access",
            get(member_access::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/email-privacy",
            get(email_privacy::get_handler::<C, St, Eas, Auth>)
                .put(email_privacy::update_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/email-privacy/threads",
            get(email_privacy::excluded_threads_handler::<C, St, Eas, Auth>),
        )
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
            "/companies/by-domain",
            get(get_company_by_domain::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}",
            get(get_company::handler::<C, St, Eas, Auth>),
        )
        .route("/previews", post(previews::handler::<C, St, Eas, Auth>))
        .route(
            "/companies/{company_id}/contacts",
            get(list_company_contacts::handler::<C, St, Eas, Auth>)
                .post(create_contact::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/companies/{company_id}/contacts/page",
            get(list_company_contacts_page::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/contacts",
            get(search_contacts::handler::<C, St, Eas, Auth>)
                .post(create_team_contact::handler::<C, St, Eas, Auth>),
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
            "/contacts/{contact_id}/email",
            put(set_contact_email::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/contacts/{contact_id}/emails",
            put(contact_emails::add_handler::<C, St, Eas, Auth>)
                .delete(contact_emails::remove_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/contacts/{contact_id}/company",
            put(set_contact_company::handler::<C, St, Eas, Auth>)
                .delete(set_contact_company::unlink_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/contacts/{contact_id}/name",
            put(set_contact_name::handler::<C, St, Eas, Auth>),
        )
        .route(
            "/settings",
            get(team_settings::get_handler::<C, St, Eas, Auth>)
                .put(team_settings::update_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/blocked-domains",
            get(blocked_domains::list_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/blocked-domains/{domain}",
            put(blocked_domains::block_handler::<C, St, Eas, Auth>)
                .delete(blocked_domains::unblock_handler::<C, St, Eas, Auth>),
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
            CrmError::InvalidRequest(message) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            ),
            CrmError::BlocksConnectedMailbox(reason) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: reason.to_string().into(),
                }),
            ),
            CrmError::AccessDenied => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "CRM access is not enabled for this team member".into(),
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
                    message: "changing CRM admin settings requires admin/owner team role".into(),
                }),
            ),
            CrmError::ThreadExclusionsUnavailable => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "thread exclusions are not available".into(),
                }),
            ),
            CrmError::SelectiveEmailUnavailable => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "selective email contribution is not available".into(),
                }),
            ),
            CrmError::EmailPolicyConflict => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message:
                        "email contribution changed; inspect the current policy before retrying"
                            .into(),
                }),
            ),
            CrmError::EmailPolicySharingRefused => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "this credential cannot enable email contribution".into(),
                }),
            ),
            CrmError::EmailPreviewRateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                Json(ErrorResponse {
                    message: "wait before starting another email contribution preview".into(),
                }),
            ),
            CrmError::EmailRuleLimitExceeded(error) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: error.to_string().into(),
                }),
            ),
            CrmError::EmailPreviewBudgetExhausted => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    message: "email contribution preview reached its work budget".into(),
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
                    message: "crm company is archived; restore it before making this change".into(),
                }),
            ),
            CrmError::CompanyAlreadyExistsForTeam => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: "a crm company already exists for this domain; get it with GET /crm/companies/by-domain, which returns an archived company to team admins only".into(),
                }),
            ),
            CrmError::ContactAlreadyExistsForCompany => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: "a crm contact with this email already exists for the company".into(),
                }),
            ),
            CrmError::ContactAlreadyExistsForTeam => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: "a crm contact with this email already exists for the team".into(),
                }),
            ),
            CrmError::CrmDisabledForTeam => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "crm is unavailable for this team".into(),
                }),
            ),
            CrmError::Contended => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    message: "crm records are busy; retry later".into(),
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
