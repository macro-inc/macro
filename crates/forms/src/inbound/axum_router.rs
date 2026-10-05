//! Axum router for the forms endpoints (RFC 01 §10). Every handler hands
//! the receipt its extractor minted to the forms service, which decides
//! everything beyond it. Rename, trash, restore and permanent delete come
//! through the unified entity-mutation router instead.

/// Reading and changing a form, its layout, and the forms catalog.
pub mod forms;
/// Responding, a respondent's own response, the summary and the tally.
pub mod responses;
/// Owners' channel sharing, as a database's.
pub mod sharing;

mod access;
mod error;
#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::Router;
use axum::extract::FromRef;
use axum::routing::{get, post, put};
use databases::domain::models::Viewer;
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use utoipa::OpenApi;

use crate::domain::ports::FormsService;
use crate::domain::sharing::FormSharingService;
pub use access::{AccessRefusal, FormReceipt, SignedIn};
pub use error::FormsApiError;

/// Router state for the forms endpoints.
pub struct FormsRouterState<Service, EntityAccess, Authorization> {
    service: Arc<Service>,
    entity_access_service: Arc<EntityAccess>,
    authorization_state: MacroAuthorizationState<Authorization>,
}

impl<Service, EntityAccess, Authorization> Clone
    for FormsRouterState<Service, EntityAccess, Authorization>
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Service, EntityAccess, Authorization> FormsRouterState<Service, EntityAccess, Authorization>
where
    Service: FormsService,
    EntityAccess: EntityAccessService,
{
    /// Router state from the shared forms service, entity access and
    /// authorization.
    pub fn new(
        service: Arc<Service>,
        entity_access_service: Arc<EntityAccess>,
        authorization_state: MacroAuthorizationState<Authorization>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<FormsRouterState<Service, EntityAccess, Authorization>> for Arc<EntityAccess>
{
    fn from_ref(state: &FormsRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<FormsRouterState<Service, EntityAccess, Authorization>>
    for MacroAuthorizationState<Authorization>
{
    fn from_ref(state: &FormsRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the forms router, mounted at `/forms`.
pub fn forms_router<Service, EntityAccess, Authorization, RouterState>(
    state: FormsRouterState<Service, EntityAccess, Authorization>,
) -> Router<RouterState>
where
    Service: FormsService + FormSharingService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
    RouterState: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            post(forms::create_form_handler::<Service, EntityAccess, Authorization>)
                .get(forms::list_forms_handler::<Service, EntityAccess, Authorization>),
        )
        // Static segments win over `/{id}`, so this never reads as a form.
        .route(
            "/accessible",
            get(forms::list_accessible_forms_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}",
            get(forms::get_form_handler::<Service, EntityAccess, Authorization>)
                .patch(forms::update_form_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/layout",
            put(forms::put_form_layout_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/responses",
            post(responses::submit_form_response_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/responses/mine",
            get(responses::get_my_form_response_handler::<Service, EntityAccess, Authorization>)
                .put(responses::edit_my_form_response_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/responses/summary",
            get(responses::get_form_response_summary_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/tally",
            get(responses::get_form_tally_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/permissions",
            get(sharing::get_form_permissions_handler::<Service, EntityAccess, Authorization>)
                .patch(sharing::update_form_permissions_handler::<Service, EntityAccess, Authorization>),
        )
        .with_state(state)
}

/// The viewer a signed-in request acts as.
pub(crate) fn viewer_of<Authorization>(signed_in: &SignedIn<Authorization>) -> Viewer {
    Viewer {
        user_id: signed_in.user.authorization.user.macro_user_id.clone(),
        acting_bot: None,
    }
}

/// The forms endpoints and their schemas, for the host's OpenAPI document.
#[derive(OpenApi)]
#[openapi(
    paths(
        forms::create_form_handler,
        forms::list_forms_handler,
        forms::list_accessible_forms_handler,
        forms::get_form_handler,
        forms::update_form_handler,
        forms::put_form_layout_handler,
        responses::submit_form_response_handler,
        responses::get_my_form_response_handler,
        responses::edit_my_form_response_handler,
        responses::get_form_response_summary_handler,
        responses::get_form_tally_handler,
        sharing::get_form_permissions_handler,
        sharing::update_form_permissions_handler,
    ),
    components(schemas(
        models_forms::Form,
        models_forms::ListedForm,
        models_forms::FormAccess,
        models_forms::Audience,
        models_forms::FormStatus,
        models_forms::Widget,
        models_forms::CreateForm,
        models_forms::FormSource,
        models_forms::UpdateForm,
        models_forms::FormLayout,
        models_forms::FormSection,
        models_forms::QuestionLayout,
        models_forms::FormDetail,
        models_forms::FormSectionDetail,
        models_forms::FormQuestionDetail,
        models_forms::QuestionOption,
        models_forms::Submission,
        models_forms::Answer,
        models_forms::SubmissionOutcome,
        models_forms::FormResponse,
        models_forms::ResponseStatus,
        models_forms::MyResponse,
        models_forms::ResponseSummary,
        models_forms::SectionCount,
        models_forms::FormTally,
        models_forms::QuestionTally,
        models_forms::TallyBucket,
        models_forms::TallyValue,
        models_forms::FormErrorResponse,
        models_forms::FormErrorCode,
        models_forms::LayoutProblem,
    )),
    tags((name = "forms", description = "Macro Forms: questionnaires over a database table"))
)]
pub struct FormsApi;
