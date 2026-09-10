//! GraphQL inbound adapter for Soup.
//!
//! This crate is intentionally additive: it maps GraphQL requests onto the
//! existing `soup` domain service without changing the existing REST API.
//! The schema itself is composed and served by the `complete_graph` crate.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// GraphQL inputs and conversion into Soup domain requests.
mod inputs;
/// DataLoader-backed hydration for realtime Soup patches.
mod loaders;
/// GraphQL objects representing Soup pages and entities.
mod objects;
/// Top-level Soup query resolver.
mod resolvers;

pub use graphql_common::{GraphqlRequestParts, GraphqlSoupEntityType};
pub use inputs::{GraphqlSimpleSortMethod, GroupedSoupInput, SoupInput};
pub use loaders::{
    EmailServiceInboxReader, SoupInboxReader, SoupItemDataLoader, SoupItemLoader,
    SoupItemLoaderError, SoupItemLoaderKey, soup_item_loader,
};
pub use objects::{
    GraphqlSoupBin, GraphqlSoupCall, GraphqlSoupChannel, GraphqlSoupChannelMessage,
    GraphqlSoupChannelMessagePreview, GraphqlSoupChat, GraphqlSoupCrmCompany, GraphqlSoupDocument,
    GraphqlSoupDocumentSubType, GraphqlSoupEmailThread, GraphqlSoupEntity,
    GraphqlSoupForeignEntity, GraphqlSoupProject, GroupedSoup, SoupCacheProjection,
    SoupEntityEdges, SoupPage, SoupPatch, SoupUpdated,
};
pub use resolvers::{
    SoupEmailThreadMutationOutput, resolve_grouped_soup, resolve_soup, resolve_soup_email_thread,
    resolve_soup_updates,
};
