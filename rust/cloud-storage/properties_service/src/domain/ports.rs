//! Ports module - re-exports service and storage port definitions

mod service_port;
mod storage_port;

pub use service_port::{PermissionChecker, PropertyService};
pub use storage_port::PropertiesStorage;
