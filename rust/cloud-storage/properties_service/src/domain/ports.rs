//! Ports module - re-exports service and storage port definitions

pub mod service_port;
pub mod storage_port;

pub use service_port::{PermissionChecker, PropertyService};
pub use storage_port::PropertiesStorage;
