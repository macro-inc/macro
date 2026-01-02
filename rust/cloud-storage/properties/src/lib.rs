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
pub mod outbound;

pub use domain::error::PropertiesErr;
pub use domain::ports::{NotificationService, PermissionService, PropertiesRepo};
pub use domain::service::PropertiesService;
pub use domain::service_impl::PropertiesServiceImpl;
pub use outbound::notification_service::NotificationServiceImpl;
pub use outbound::permission_service::PermissionServiceImpl;
pub use outbound::properties_pg_repo::PropertiesPgRepo;
