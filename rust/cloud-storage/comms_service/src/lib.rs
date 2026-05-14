//! Comms Service Library - exposes API routes for integration into other services

pub mod api;
pub mod channel_permissions;
pub mod config;
pub mod constants;
pub mod notification;
pub mod service;
pub mod utils;

// Re-exports for consumers
pub use api::context::AppState as CommsHandlerState;
pub use api::context::ChannelImpl;
pub use api::context::DocumentPermissionJwtSecretKey;
pub use api::context::EntityAccessServiceType;
pub use api::router as comms_router;
pub use api::swagger::ApiDoc as CommsApiDoc;

// Re-export comms types needed to construct the state
pub use comms::domain::service::ChannelServiceImpl;
pub use comms::inbound::router::CommsRouterState;
pub use comms::outbound::postgres::comms_repo::PgCommsRepo;
pub use comms::outbound::postgres::user_repo::PgUserRepo;
pub use frecency::outbound::postgres::FrecencyPgStorage;
