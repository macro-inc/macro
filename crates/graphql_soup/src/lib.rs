//! GraphQL inbound adapter for Soup.
//!
//! This crate is intentionally additive: it maps GraphQL requests onto the
//! existing `soup` domain service without changing the existing REST API.
//! The schema itself is composed and served by the `complete_graph` crate.
#![deny(missing_docs)]

mod inputs;
mod objects;
mod resolvers;

pub use graphql_common::{GraphqlSoupEntityType, GraphqlSoupRequestParts};
pub use graphql_notification::{
    EntityNotificationsLoader, GraphqlSoupNotification, SoupNotificationEdgeReader,
    entity_notifications_loader,
};
pub use graphql_properties::{
    EntityPropertiesLoader, GraphqlSoupProperty, GraphqlSoupPropertyEntityReference,
    GraphqlSoupPropertyValue, SoupPropertyEdgeReader, entity_properties_loader,
};
pub use inputs::{GraphqlSimpleSortMethod, SoupInput};
pub use objects::{
    GraphqlSoupCall, GraphqlSoupChannel, GraphqlSoupChannelThread, GraphqlSoupChat,
    GraphqlSoupCrmCompany, GraphqlSoupDocument, GraphqlSoupDocumentSubType, GraphqlSoupEmailThread,
    GraphqlSoupEntity, GraphqlSoupForeignEntity, GraphqlSoupItem, GraphqlSoupProject, SoupPage,
};
pub use resolvers::{SharedSoupService, resolve_soup};
