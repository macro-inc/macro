//! Normalized GraphQL cache engine (Phase 1: pure, native-tested core).
//!
//! Design doc: `apps/web/docs/graphql-normalized-cache-plan.md`.

pub mod codec;
pub mod denormalize;
pub mod deps;
pub mod document;
pub mod engine;
pub mod entity_resolver;
pub mod link_patch;
pub mod meta;
pub mod normalize;
pub mod predicate;
pub mod query_inspection;
mod query_path;
pub mod queue;
pub mod record_selection;
pub mod revision;
pub mod search;
pub mod store;
pub mod value;
