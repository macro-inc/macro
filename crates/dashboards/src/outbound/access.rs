//! Dashboard access through the shared entity access service.

use std::sync::Arc;

use entity_access::domain::models::{AccessError, EntityType};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;

use crate::domain::models::DashboardId;
use crate::domain::ports::DashboardAccess;

/// [`DashboardAccess`] over an [`EntityAccessService`].
pub struct EntityDashboardAccess<S>(pub Arc<S>);

impl<S: EntityAccessService> DashboardAccess for EntityDashboardAccess<S> {
    type Err = AccessError;

    async fn access_level(
        &self,
        user: &MacroUserIdStr<'_>,
        id: DashboardId,
    ) -> Result<Option<AccessLevel>, Self::Err> {
        self.0
            .get_access_level(Some(user), &id.to_string(), EntityType::Dashboard)
            .await
    }
}
