//! Composition of the domain GraphQL adapter crates (`graphql_soup`,
//! `graphql_properties`, `graphql_notification`) into the complete schema
//! served by `document_storage_service` and exported as SDL.
#![deny(missing_docs)]

mod edges;
mod schema;
#[cfg(test)]
mod sdl_test;

pub use edges::SoupNotificationEdges;
pub use graphql_common::GraphqlSoupRequestParts;
pub use graphql_notification::{
    EntityNotificationsLoader, SoupNotificationEdgeReader, entity_notifications_loader,
};
pub use graphql_properties::{
    EntityPropertiesLoader, EntityPropertyWriter, PropertiesEntityPropertyWriter,
    PropertiesMutationRoot, PropertiesSoupPropertyEdgeReader, SoupPropertyEdgeReader,
    entity_properties_loader,
};
pub use graphql_soup::SharedSoupService;
pub use schema::{
    SchemaOnlySoupSchema, SchemaOnlyState, SharedSoupSchema, SoupQueryRoot, SoupSchema,
    build_schema, build_schema_from_arc, build_schema_with_service,
};
