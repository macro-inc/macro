//! Search Service Library - exposes API routes for integration into other services

pub mod api;

// Re-exports for consumers
pub use api::context::{SearchHandlerState, SearchRouterState};
pub use api::swagger::ApiDoc as SearchApiDoc;
pub use api::{
    router as search_router, router_with_authorization as search_router_with_authorization,
};
