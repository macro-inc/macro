//! Search Service Library - exposes API routes for integration into other services

pub mod api;
mod domain;
mod outbound;

// Re-exports for consumers
pub use api::context::SearchHandlerState;
pub use api::router as search_router;
pub use api::swagger::ApiDoc as SearchApiDoc;
pub use domain::rollout::SearchRollout;
pub use domain::search_allowance::SearchTokenBuckets;
pub use domain::search_lanes::{LanePolicy, SearchLanes};
pub use outbound::rollout::{
    DATABASE_ROW_SEARCH_FLAG, DYNAMIC_TERM_MATCHING_FLAG, FlaggedRollout, LocalRollout,
};
