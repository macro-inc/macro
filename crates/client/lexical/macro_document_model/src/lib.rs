//! Portable Macro document nodes and exact headless/export editor configurations.
#![deny(missing_docs)]
pub mod context;
pub mod editor;
pub mod nodes;
pub mod policy;
pub use context::*;
pub use document_id::DocumentId;
pub use editor::*;
pub use lexical_node_id::LexicalNodeId;
/// Node hooks return the transactional core error type.
pub type ModelResult<T> = std::result::Result<T, lexical_model::Error>;
mod error;
pub use error::Error;
/// Package operations preserve the error from their owning conversion layer.
pub type Result<T> = std::result::Result<T, Error>;
/// Markdown conversion entry points and document helpers.
pub mod markdown;

/// Ordered Macro markdown transformers and conversion helpers.
pub mod transformers;

