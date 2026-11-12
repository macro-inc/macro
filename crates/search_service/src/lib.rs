//! Search Service Library - exposes API routes for integration into other services

pub mod api;
mod domain;
mod outbound;

// Re-exports for consumers
pub use api::context::SearchHandlerState;
pub use api::router as search_router;
pub use api::swagger::ApiDoc as SearchApiDoc;
/// Name lookup across every kind of item: the port each kind's source
/// implements, and the lookup the `/names` route runs.
pub use domain::names;
