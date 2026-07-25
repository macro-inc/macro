//! Axum inbound adapter for the properties domain.
//!
//! Exposes the property definition / option / tag / entity property endpoints
//! as a [`Router`] generic over the [`PropertiesService`] implementation and
//! the entity access service (used for team-membership extraction).
//!
//! The composition root supplies the concrete services and request
//! authorization state via [`PropertiesRouterState`].

#[cfg(test)]
mod test;

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
use entity_access::inbound::axum_extractors::OptionalMacroUserTeamExtractorV2;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};

use crate::domain::error::PropertiesErr;
use crate::domain::service::PropertiesService;

/// State for the properties router.
pub struct PropertiesRouterState<S, A, Auth> {
    properties_service: Arc<S>,
    entity_access_service: Arc<A>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, A, Auth> Clone for PropertiesRouterState<S, A, Auth> {
    fn clone(&self) -> Self {
        Self {
            properties_service: self.properties_service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: PropertiesService, A: EntityAccessService, Auth> PropertiesRouterState<S, A, Auth> {
    /// Create router state wrapping the properties, entity access, and authorization services.
    pub fn new(
        properties_service: Arc<S>,
        entity_access_service: Arc<A>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            properties_service,
            entity_access_service,
            authorization_state,
        }
    }
}

/// Lets the entity access extractors pull the access service out of the state.
impl<S, A, Auth> FromRef<PropertiesRouterState<S, A, Auth>> for Arc<A> {
    fn from_ref(state: &PropertiesRouterState<S, A, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

/// Lets request extractors pull the authorization service out of the state.
impl<S, A, Auth> FromRef<PropertiesRouterState<S, A, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &PropertiesRouterState<S, A, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Team extractor used by property definition endpoints. Resolves the caller's team
/// membership without failing when they have no team. Member role is required, matching
/// the model where anyone on a team can manage that team's properties.
pub type PropertyTeamExtractor<A, Auth> = OptionalMacroUserTeamExtractorV2<MemberTeamRole, A, Auth>;

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
pub fn router<S, A, Auth>() -> Router<PropertiesRouterState<S, A, Auth>>
where
    S: PropertiesService,
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new()
        // Property Definition Management - requires authentication
        .route(
            "/definitions",
            get(definitions::list_properties::<S, A, Auth>)
                .post(definitions::create_property_definition::<S, A, Auth>),
        )
        .route(
            "/definitions/{definition_id}",
            delete(definitions::delete_property_definition::<S, A, Auth>),
        )
        // Property Options Management - requires authentication
        .route(
            "/definitions/{definition_id}/options",
            get(options::get_property_options::<S, A, Auth>)
                .post(options::add_property_option::<S, A, Auth>),
        )
        .route(
            "/definitions/{definition_id}/options/{option_id}",
            delete(options::delete_property_option::<S, A, Auth>)
                .patch(options::update_property_option::<S, A, Auth>),
        )
        .route(
            "/tags",
            get(tags::list_tags::<S, A, Auth>).post(tags::ensure_tag_set::<S, A, Auth>),
        )
        // Entity Property Operations
        // GET allows anonymous access for public entities
        .route(
            "/entities/{entity_type}/{entity_id}",
            get(entities::get_entity_properties::<S, A, Auth>),
        )
        // Bulk entity properties - requires authentication
        .route(
            "/entities/bulk",
            post(entities::get_bulk_entity_properties::<S, A, Auth>),
        )
        // PUT/DELETE require authentication
        .route(
            "/entities/{entity_type}/{entity_id}/{property_id}",
            put(entities::set_entity_property::<S, A, Auth>),
        )
        // Atomic single-option delta on a multi-select value (merges concurrent edits)
        .route(
            "/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}",
            post(entities::add_entity_property_option::<S, A, Auth>)
                .delete(entities::remove_entity_property_option::<S, A, Auth>),
        )
        // Transactional multi-property option deltas (one tag-picker selection)
        .route(
            "/entities/{entity_type}/{entity_id}/options/bulk",
            post(entities::bulk_update_entity_property_options::<S, A, Auth>),
        )
        // Cross-entity option delta: one shared delta applied to many entities
        // (e.g. tag N emails with one label), best-effort per entity
        .route(
            "/options/bulk",
            post(entities::bulk_update_entities_property_options::<S, A, Auth>),
        )
        .route(
            "/entity_properties/{entity_property_id}",
            delete(entities::delete_entity_property::<S, A, Auth>),
        )
}
