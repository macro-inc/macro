//! Port definitions for system properties.
//!
//! These traits define the interfaces that the domain layer uses.
//! Implementations live in the outbound module.

use crate::{StatusOption, domain::model::SystemPropertyError};

/// Repository trait for system property database operations.
///
/// This trait abstracts the database layer, allowing for different implementations
/// (e.g., PostgreSQL, mock for testing).
pub trait SystemPropertiesRepository: Clone + Send + Sync + 'static {
    /// Bulk upsert property rows in a single query.
    fn bulk_upsert_properties(
        &self,
        rows: Vec<crate::domain::model::PropertyRow>,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;

    /// Copy all task properties from one entity to another.
    fn copy_task_properties(
        &self,
        from_task_id: &str,
        to_task_id: &str,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;

    /// Updates the task to have the provided status
    fn update_task_status(
        &self,
        task_id: &str,
        status: StatusOption,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;
}
