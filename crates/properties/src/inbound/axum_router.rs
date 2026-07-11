//! Axum inbound adapter for the properties domain.
//!
//! Exposes the property definition / option / tag / entity property endpoints
//! as a [`Router`] generic over the [`PropertiesService`] implementation and
//! the entity access service (used for team-membership extraction).
//!
//! The composition root supplies the concrete services via
//! [`PropertiesRouterState`] plus the authentication middleware layer applied
//! to the routes that require an authenticated user.

pub mod definitions;
pub mod entities;
pub mod extract;
pub mod options;
pub mod tags;

use std::convert::Infallible;
use std::sync::Arc;

use axum::{
    Router,
    extract::{FromRef, Request},
    http::StatusCode,
    response::IntoResponse,
    routing::{Route, delete, get, patch, post, put},
};
use entity_access::domain::models::MemberTeamRole;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::OptionalMacroUserTeamExtractor;
use tower::{Layer, Service};

use crate::domain::error::PropertiesErr;
use crate::domain::service::PropertiesService;

/// State for the properties router.
pub struct PropertiesRouterState<S, A> {
    properties_service: Arc<S>,
    entity_access_service: Arc<A>,
}

impl<S, A> Clone for PropertiesRouterState<S, A> {
    fn clone(&self) -> Self {
        Self {
            properties_service: self.properties_service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<S: PropertiesService, A: EntityAccessService> PropertiesRouterState<S, A> {
    /// Create a router state wrapping the properties service and entity access service.
    pub fn new(properties_service: Arc<S>, entity_access_service: Arc<A>) -> Self {
        Self {
            properties_service,
            entity_access_service,
        }
    }
}

/// Lets the entity access extractors pull the access service out of the state.
impl<S, A> FromRef<PropertiesRouterState<S, A>> for Arc<A> {
    fn from_ref(state: &PropertiesRouterState<S, A>) -> Self {
        state.entity_access_service.clone()
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
///
/// `ensure_user_exists` is the authentication middleware layer applied to every
/// route that requires an authenticated user (all except the anonymous-capable
/// entity property GET and the internal endpoints).
pub fn router<S, A, L>(ensure_user_exists: L) -> Router<PropertiesRouterState<S, A>>
where
    S: PropertiesService,
    A: EntityAccessService,
    L: Layer<Route> + Clone + Send + Sync + 'static,
    L::Service: Service<Request> + Clone + Send + Sync + 'static,
    <L::Service as Service<Request>>::Response: IntoResponse + 'static,
    <L::Service as Service<Request>>::Error: Into<Infallible> + 'static,
    <L::Service as Service<Request>>::Future: Send + 'static,
{
    Router::new()
        // Property Definition Management - requires authentication
        .route(
            "/definitions",
            get(definitions::list_properties::<S, A>)
                .post(definitions::create_property_definition::<S, A>)
                .layer(ensure_user_exists.clone()),
        )
        .route(
            "/definitions/{definition_id}",
            delete(definitions::delete_property_definition::<S, A>)
                .layer(ensure_user_exists.clone()),
        )
        // Property Options Management - requires authentication
        .route(
            "/definitions/{definition_id}/options",
            get(options::get_property_options::<S, A>)
                .post(options::add_property_option::<S, A>)
                .layer(ensure_user_exists.clone()),
        )
        .route(
            "/definitions/{definition_id}/options/{option_id}",
            delete(options::delete_property_option::<S, A>)
                .patch(options::update_property_option::<S, A>)
                .layer(ensure_user_exists.clone()),
        )
        .route(
            "/tags",
            get(tags::list_tags::<S, A>)
                .post(tags::ensure_tag_set::<S, A>)
                .layer(ensure_user_exists.clone()),
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
            post(entities::get_bulk_entity_properties::<S, A>).layer(ensure_user_exists.clone()),
        )
        // PUT/DELETE require authentication
        .route(
            "/entities/{entity_type}/{entity_id}/{property_id}",
            put(entities::set_entity_property::<S, A>).layer(ensure_user_exists.clone()),
        )
        // Atomic single-option delta on a multi-select value (merges concurrent edits)
        .route(
            "/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}",
            post(entities::add_entity_property_option::<S, A>)
                .delete(entities::remove_entity_property_option::<S, A>)
                .layer(ensure_user_exists.clone()),
        )
        .route(
            "/entity_properties/{entity_property_id}",
            delete(entities::delete_entity_property::<S, A>).layer(ensure_user_exists.clone()),
        )
        // Status shortcut - requires authentication
        .route(
            "/entities/{entity_type}/{entity_id}/status/complete",
            patch(entities::set_property_status_complete::<S, A>).layer(ensure_user_exists),
        )
}
