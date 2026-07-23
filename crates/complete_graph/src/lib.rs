//! Composition of the domain GraphQL adapter crates (`graphql_soup`,
//! `graphql_properties`, `graphql_notification`, `graphql_email`,
//! `graphql_entity_mutation`) into the complete schema served by
//! `document_storage_service` and exported as SDL.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Cross-domain fields composed onto Soup entities.
mod edges;
/// Complete schema types and construction helpers.
mod schema;
#[cfg(test)]
mod sdl_test;

pub use edges::{SoupEdges, SoupEmailThreadEdges};
pub use graphql_common::GraphqlRequestParts;
pub use graphql_email::{
    EmailContentKey, EmailContentLoad, EmailContentLoader, EmailServiceEmailContentReader,
    NoOpSoupEmailContentEdgeReader, SoupEmailContentEdgeReader, email_content_loader,
};
pub use graphql_entity_mutation::{
    ChannelSharePolicyInput, DuplicateEntityInput, EntityMutationPayload, EntityMutationRoot,
    EntityRefInput, EntitySharePolicyInput, GraphqlEntityMutationError,
    GraphqlEntityMutationErrorCode, GraphqlEntityMutationRef, GraphqlEntityMutationResult,
    GraphqlSharePolicyOperation, MoveEntityInput, RenameEntityInput, UpdateEntitySharePolicyInput,
};
pub use graphql_favorite::{
    EntityFavoriteEdgeReader, EntityFavoriteKey, EntityFavoriteLoader, entity_favorite_loader,
};
pub use graphql_notification::{
    EntityNotificationsLoader, SoupNotificationEdgeReader, entity_notifications_loader,
};
pub use graphql_permission::{
    EntityPermissionEdgeReader, EntityPermissionKey, EntityPermissionLoader,
    GraphqlChannelParticipantRole, GraphqlEntityAccessLevel, GraphqlEntityPermission,
    GraphqlEntityPermissionKind, GraphqlTeamRole, entity_permission_loader,
};
pub use graphql_properties::{
    EntityPropertiesLoader, EntityPropertyReader, EntityPropertyWriter, NoOpEntityPropertyReader,
    PropertiesEntityPropertyReader, PropertiesEntityPropertyWriter, PropertiesMutationRoot,
    entity_properties_loader,
};
pub use schema::{
    SchemaOnlySoupSchema, SchemaOnlyState, SharedSoupSchema, SoupQueryRoot, SoupSchema,
    SoupSubscriptionRoot, build_schema, build_schema_from_arc, build_schema_from_arcs,
    build_schema_with_service, build_schema_with_services,
};
