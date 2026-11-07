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
/// Model operations return transactional errors without modifying committed snapshots.
pub type Result<T> = std::result::Result<T, lexical_model::Error>;

/// Ordered Macro markdown transformers and conversion helpers.
pub mod transformers;
