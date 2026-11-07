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
//!
//! The HTTP routes and AI toolset are `properties_inbound`.

pub mod domain;
#[cfg(feature = "outbound")]
pub mod outbound;
pub mod tag_color;

pub use domain::error::PropertiesErr;
pub use domain::model::{
    CRM_TEAM_STAGE_DEFINITION_NAME, EditReceipt, EntityPropertiesKey, EntityPropertyInfo,
    PropertyAccessReceiptExt, PropertyOptionInfo, PropertyTargetKey, ViewReceipt,
    canonical_entity_type,
};
pub use domain::ports::{
    InitiativeAssigneeService, NotificationService, PermissionService, PropertiesRepo,
};
pub use domain::service::{PropertiesService, TeamReceipt};
pub use domain::service_impl::PropertiesServiceImpl;
#[cfg(feature = "outbound")]
pub use outbound::notification_service::NotificationServiceImpl;
#[cfg(feature = "outbound")]
pub use outbound::permission_service::PermissionServiceImpl;
#[cfg(feature = "outbound")]
pub use outbound::properties_pg_repo::PropertiesPgRepo;
pub use tag_color::TagColor;
