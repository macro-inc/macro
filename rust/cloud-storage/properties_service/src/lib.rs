//! Properties Service Library - exposes API routes for integration into other services

pub mod api;
pub mod constants;

// Re-exports for consumers
pub use api::context::PropertiesHandlerState;
pub use api::context::PropertiesService;
pub use api::properties::router as properties_router;
pub use api::swagger::ApiDoc as PropertiesApiDoc;
