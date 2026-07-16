//! Shared plumbing for the domain GraphQL adapter crates: request-scoped
//! extractor context, filter-input conversion helpers, and cross-domain
//! schema types.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

// Re-exported for use by the `filter_expr_input!` macro expansion.
pub use filter_ast;

/// Shared GraphQL entity-type mappings.
mod entity_type;
/// Axum request-parts extraction helpers for GraphQL resolvers.
mod extract;
/// GraphQL filter-input conversion helpers.
mod filter_input;
/// Property-filter GraphQL input types.
mod property_filter;
/// Request-scoped context used by GraphQL resolvers.
mod request_context;

pub use entity_type::GraphqlSoupEntityType;
pub use extract::extract_part;
pub use filter_input::{IntoFilterExpr, optional_tree, parse_id, parse_macro_user_id, parse_uuid};
pub use property_filter::{
    GraphqlPropertiesBinaryExpr, GraphqlPropertiesExpr, GraphqlPropertiesLiteral,
    GraphqlPropertyEntityType, GraphqlPropertyMatchValue,
};
pub use request_context::GraphqlSoupRequestParts;
