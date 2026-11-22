use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::CreatePropertyScope;
use uuid::Uuid;

use crate::domain::error::PropertiesErr;
use crate::domain::service::{PropertiesService, TeamReceipt};

use super::PropertiesRouterState;

impl<S: PropertiesService, A: EntityAccessService, Auth> PropertiesRouterState<S, A, Auth> {
    pub(super) fn reject_managed_create(
        &self,
        scope: CreatePropertyScope,
        display_name: &str,
    ) -> Result<(), PropertiesErr> {
        self.managed_team_definitions
            .reject_create(scope, display_name)
    }

    pub(super) async fn reject_managed_definition(
        &self,
        definition_id: Uuid,
        user: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> Result<(), PropertiesErr> {
        self.managed_team_definitions
            .reject_definition(self.properties_service.as_ref(), definition_id, user, team)
            .await
    }
}
