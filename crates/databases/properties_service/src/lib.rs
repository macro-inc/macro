//! Properties Service Library - exposes API routes for integration into other services
//!
//! The routes themselves live in `properties::inbound::axum_router`; this crate
//! is the composition shim binding them to the concrete domain and request
//! authorization service types.

pub mod api;

// Re-exports for consumers
pub use api::context::AuthorizationServiceType;
pub use api::context::EntityAccessServiceType;
pub use api::context::PropertiesHandlerState;
pub use api::context::PropertiesService;
pub use api::router as properties_router;
pub use api::swagger::ApiDoc as PropertiesApiDoc;
