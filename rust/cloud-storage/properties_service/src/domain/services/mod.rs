//! Domain services - concrete implementations of service ports

mod definitions;
mod entity_properties;
mod options;

use crate::domain::ports::{PermissionChecker, PropertiesStorage};

/// Concrete implementation of PropertyService
pub struct PropertyServiceImpl<S, P> {
    storage: S,
    permission_checker: P,
}

impl<S, P> PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: PermissionChecker,
{
    /// Create a new property service implementation
    pub fn new(storage: S, permission_checker: P) -> Self {
        Self {
            storage,
            permission_checker,
        }
    }
}

// Import modules to trigger impl blocks - they're already declared as mod above
