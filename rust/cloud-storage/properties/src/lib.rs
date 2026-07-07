//! Properties crate.
//!
//! Provides domain logic for property operations following hexagonal architecture.
//!
//! # Architecture
//!
//! This crate follows hexagonal architecture:
//! - `domain::ports` - Port definitions (traits/interfaces)
//! - `domain::service` - Service trait
//! - `domain::service_impl` - Service implementation
//! - `outbound` - Outbound adapters (e.g., PostgreSQL implementation)

pub mod domain;
#[cfg(any(feature = "ai_tools", feature = "inbound"))]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;

pub use domain::error::PropertiesErr;
pub use domain::model::{EntityPropertiesKey, EntityPropertyInfo, PropertyOptionInfo};
pub use domain::ports::{
    NotificationService, PermissionService, PropertiesRepo, PropertySearchIndexer,
};
pub use domain::service::PropertiesService;
pub use domain::service_impl::PropertiesServiceImpl;
#[cfg(feature = "outbound")]
pub use outbound::notification_service::NotificationServiceImpl;
#[cfg(feature = "outbound")]
pub use outbound::permission_service::PermissionServiceImpl;
#[cfg(feature = "outbound")]
pub use outbound::properties_pg_repo::PropertiesPgRepo;
