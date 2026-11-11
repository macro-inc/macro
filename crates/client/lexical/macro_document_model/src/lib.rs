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

/// URL validation and source link recognition modes.
pub mod links;
/// Mention projections for previews, search, and embeddings.
pub mod parsers;

/// Reader-oriented XML serialization and shared ordered element builders.
pub mod xml;

/// Durable node identity and depth-first mapping helpers.
pub mod node_ids;

/// Typed authored message references and parsed markdown extraction.
pub mod mentions;

/// Notion enhanced Markdown import.
pub mod notion;

/// Comment-only permission gate using the exact service registry.
pub mod comment_gate;

/// Ownership state, validation and local reconciliation plugin.
pub mod peer;

/// Plaintext, search, cognition and Markdown export projections.
pub mod export;

/// Durable identity helpers and plugin.
pub use node_ids as ids;

/// Golden-seeded server snapshot conversion.
pub mod snapshot;

/// Collaborative content policy and draft preservation commands.
pub mod sync;

/// Optional owned HTML export and htmlparser2-compatible fragment parsing.
#[cfg(feature = "html")]
pub mod html;

/// Application input shortcuts and native menu surface policy.
pub mod plugins_group_a;
/// Structure, list, table, media, clipboard and link surface policy.
pub mod plugins_group_b;
/// Application surface plugin registration.
pub mod surface;

/// Legacy saved document JSON for downloads, separate from live synchronization.
pub mod save;
