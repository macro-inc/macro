//! GraphQL inbound adapter for Soup.
//!
//! This crate is intentionally additive: it maps GraphQL requests onto the
//! existing `soup` domain service without changing the existing REST API.
//! The schema itself is composed and served by the `complete_graph` crate.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// GraphQL inputs and conversion into Soup domain requests.
mod inputs;
/// GraphQL objects representing Soup pages and entities.
mod objects;
/// Top-level Soup query resolver.
mod resolvers;

pub use graphql_common::{GraphqlSoupEntityType, GraphqlSoupRequestParts};
pub use inputs::{GraphqlSimpleSortMethod, SoupInput};
pub use objects::{
    GraphqlSoupCall, GraphqlSoupChannel, GraphqlSoupChannelThread, GraphqlSoupChat,
    GraphqlSoupCrmCompany, GraphqlSoupDocument, GraphqlSoupDocumentSubType, GraphqlSoupEmailThread,
    GraphqlSoupEntity, GraphqlSoupForeignEntity, GraphqlSoupItem, GraphqlSoupProject,
    SoupEntityEdges, SoupPage,
};
pub use resolvers::resolve_soup;
