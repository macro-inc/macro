//! Shared plumbing for the domain GraphQL adapter crates: request-scoped
//! extractor context, filter-input conversion helpers, and cross-domain
//! schema types.
#![deny(missing_docs)]

// Re-exported for use by the `filter_expr_input!` macro expansion.
pub use filter_ast;

mod entity_type;
mod extract;
mod filter_input;
mod request_context;

pub use entity_type::GraphqlSoupEntityType;
pub use extract::extract_part;
pub use filter_input::{IntoFilterExpr, optional_tree, parse_id, parse_macro_user_id, parse_uuid};
pub use request_context::GraphqlSoupRequestParts;
