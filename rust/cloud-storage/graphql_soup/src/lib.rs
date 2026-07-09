//! GraphQL inbound adapter for Soup.
//!
//! This crate is intentionally additive: it maps GraphQL requests onto the
//! existing `soup` domain service without changing the existing REST API.
#![deny(missing_docs)]

mod auth;
mod inputs;
mod loaders;
mod objects;
mod request_context;
mod schema;

pub use inputs::{GraphqlSimpleSortMethod, SoupInput};
pub use loaders::{
    EntityNotificationsKey, EntityNotificationsLoader, EntityPropertiesKey, EntityPropertiesLoader,
    SoupNotificationEdgeReader, SoupPropertyEdgeReader, entity_notifications_loader,
    entity_properties_loader,
};
pub use objects::{
    GraphqlSoupCall, GraphqlSoupChannel, GraphqlSoupChannelThread, GraphqlSoupChat,
    GraphqlSoupCrmCompany, GraphqlSoupDocument, GraphqlSoupDocumentSubType, GraphqlSoupEmailThread,
    GraphqlSoupEntity, GraphqlSoupEntityType, GraphqlSoupForeignEntity, GraphqlSoupItem,
    GraphqlSoupNotification, GraphqlSoupProject, GraphqlSoupProperty,
    GraphqlSoupPropertyEntityReference, GraphqlSoupPropertyValue, SoupPage,
};
pub use request_context::GraphqlSoupRequestParts;
pub use schema::{
    SchemaOnlyEmailService, SchemaOnlyEntityAccessService, SchemaOnlySoupSchema,
    SchemaOnlySoupService, SchemaOnlyState, SharedSoupSchema, SharedSoupService, SoupQueryRoot,
    SoupSchema, build_schema, build_schema_from_arc, build_schema_with_service,
};
