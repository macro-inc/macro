//! Document upload finalizer application.
//!
//! Production invokes this through an EventBridge Lambda adapter. Local development
//! uses a LocalStack SQS polling adapter. Both adapters normalize transport events
//! into [`app::ObjectCreated`] and call the same use case.

pub mod app;
pub mod inbound;
pub mod outbound;
pub mod ports;
pub mod runtime;

pub use runtime::AppContext;
