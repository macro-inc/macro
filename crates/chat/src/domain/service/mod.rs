//! Service implementations for the chat domain.

mod chat;
/// Unified entity-mutation capability impls.
mod entity_mutation;
mod model_access;

pub use chat::ChatServiceImpl;
pub use model_access::ModelAccessServiceImpl;
