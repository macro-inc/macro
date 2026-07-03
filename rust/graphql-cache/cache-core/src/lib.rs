//! Normalized GraphQL cache engine (Phase 1: pure, native-tested core).
//!
//! Design doc: `js/app/docs/graphql-normalized-cache-plan.md`.

pub mod denormalize;
pub mod deps;
pub mod document;
pub mod engine;
pub mod meta;
pub mod normalize;
pub mod store;
pub mod value;
