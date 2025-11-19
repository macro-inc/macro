//! Consolidated service implementation for all property operations

use crate::domain::{
    error::Result,
    ports::{PermissionChecker, PropertiesStorage, PropertyService},
};

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

impl<S, P> PropertyService for PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // TODO: Implement all PropertyService trait methods
}
