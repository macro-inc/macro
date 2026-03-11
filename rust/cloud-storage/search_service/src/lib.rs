//! Search Service Library - exposes API routes for integration into other services

pub mod api;
pub mod config;

// Re-exports for consumers
pub use api::context::SearchHandlerState;
pub use api::router as search_router;
pub use api::swagger::ApiDoc as SearchApiDoc;
