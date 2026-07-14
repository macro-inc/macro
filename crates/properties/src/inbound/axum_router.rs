//! Axum inbound adapter for the properties domain.
//!
//! Exposes the property definition / option / tag / entity property endpoints
//! as a [`Router`] generic over the [`PropertiesService`] implementation and
//! the entity access service (used for team-membership extraction).
//!
//! The composition root supplies the concrete services via
//! [`PropertiesRouterState`].

pub mod definitions;
pub mod entities;
pub mod extract;
pub mod options;
pub mod tags;

use std::sync::Arc;

use axum::{
    Router,
    extract::FromRef,
    http::StatusCode,
    routing::{delete, get, post, put},
};
use entity_access::domain::models::MemberTeamRole;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::OptionalMacroUserTeamExtractor;
use macro_authorization::MacroAuthorizationServiceHandle;

use crate::domain::error::PropertiesErr;
use crate::domain::service::PropertiesService;

/// State for the properties router.
pub struct PropertiesRouterState<S, A> {
    properties_service: Arc<S>,
    entity_access_service: Arc<A>,
    authorization_service: MacroAuthorizationServiceHandle,
}

impl<S, A> Clone for PropertiesRouterState<S, A> {
    fn clone(&self) -> Self {
        Self {
            properties_service: self.properties_service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_service: self.authorization_service.clone(),
        }
    }
}

impl<S: PropertiesService, A: EntityAccessService> PropertiesRouterState<S, A> {
    /// Create a router state wrapping the properties, entity access, and authorization services.
    pub fn new(
        properties_service: Arc<S>,
        entity_access_service: Arc<A>,
        authorization_service: MacroAuthorizationServiceHandle,
    ) -> Self {
        Self {
            properties_service,
            entity_access_service,
            authorization_service,
        }
    }
}

/// Lets the entity access extractors pull the access service out of the state.
impl<S, A> FromRef<PropertiesRouterState<S, A>> for Arc<A> {
    fn from_ref(state: &PropertiesRouterState<S, A>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, A> FromRef<PropertiesRouterState<S, A>> for MacroAuthorizationServiceHandle {
    fn from_ref(state: &PropertiesRouterState<S, A>) -> Self {
        state.authorization_service.clone()
    }
}

/// Team extractor used by property definition endpoints. Resolves the caller's team
/// membership without failing when they have no team. Member role is required, matching
/// the model where anyone on a team can manage that team's properties.
pub type PropertyTeamExtractor<A> = OptionalMacroUserTeamExtractor<MemberTeamRole, A>;

/// Map a domain [`PropertiesErr`] to the HTTP status code it represents.
pub fn properties_err_status(e: &PropertiesErr) -> StatusCode {
    match e {
        PropertiesErr::Validation(_) => StatusCode::BAD_REQUEST,
        PropertiesErr::NotFound
        | PropertiesErr::OptionNotFound
        | PropertiesErr::EntityPropertyNotFound => StatusCode::NOT_FOUND,
        PropertiesErr::DuplicateOptionValue => StatusCode::CONFLICT,
        PropertiesErr::PermissionDenied
        | PropertiesErr::SystemPropertyNotModifiable
        | PropertiesErr::RequiredProperty
        | PropertiesErr::TeamMembershipRequired => StatusCode::FORBIDDEN,
        PropertiesErr::Repo(_) | PropertiesErr::PermissionServiceNotConfigured => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

/// Creates the properties router.
pub fn router<S, A>() -> Router<PropertiesRouterState<S, A>>
where
    S: PropertiesService,
    A: EntityAccessService,
{
    Router::new()
        // Property Definition Management - requires authentication
        .route(
            "/definitions",
            get(definitions::list_properties::<S, A>)
                .post(definitions::create_property_definition::<S, A>),
        )
        .route(
            "/definitions/{definition_id}",
            delete(definitions::delete_property_definition::<S, A>),
        )
        // Property Options Management - requires authentication
        .route(
            "/definitions/{definition_id}/options",
            get(options::get_property_options::<S, A>).post(options::add_property_option::<S, A>),
        )
        .route(
            "/definitions/{definition_id}/options/{option_id}",
            delete(options::delete_property_option::<S, A>)
                .patch(options::update_property_option::<S, A>),
        )
        .route(
            "/tags",
            get(tags::list_tags::<S, A>).post(tags::ensure_tag_set::<S, A>),
        )
        // Entity Property Operations
        // GET allows anonymous access for public entities
        .route(
            "/entities/{entity_type}/{entity_id}",
            get(entities::get_entity_properties::<S, A>),
        )
        // Bulk entity properties - requires authentication
        .route(
            "/entities/bulk",
            post(entities::get_bulk_entity_properties::<S, A>),
        )
        // PUT/DELETE require authentication
        .route(
            "/entities/{entity_type}/{entity_id}/{property_id}",
            put(entities::set_entity_property::<S, A>),
        )
        // Atomic single-option delta on a multi-select value (merges concurrent edits)
        .route(
            "/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}",
            post(entities::add_entity_property_option::<S, A>)
                .delete(entities::remove_entity_property_option::<S, A>),
        )
        .route(
            "/entity_properties/{entity_property_id}",
            delete(entities::delete_entity_property::<S, A>),
        )
}
