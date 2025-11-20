//! Permission checker implementation

use crate::domain::{error::Result, models::EntityType, ports::PermissionChecker};

pub struct PgPermissionChecker {
    // Future: Add database connection or permission service client
}

impl PgPermissionChecker {
    pub fn new() -> Self {
        Self {}
    }
}

impl PermissionChecker for PgPermissionChecker {
    fn can_edit_entity(
        &self,
        _user_id: &str,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<bool>> + Send {
        async move {
            // For now, allow all edits
            Ok(true)
        }
    }

    fn can_view_entity(
        &self,
        _user_id: &str,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<bool>> + Send {
        async move {
            // For now, allow all views
            Ok(true)
        }
    }
}
