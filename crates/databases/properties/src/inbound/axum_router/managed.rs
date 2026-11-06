use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::PropertyOwner;
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
        if scope == CreatePropertyScope::Team && self.is_managed_team_definition_name(display_name)
        {
            return Err(PropertiesErr::ManagedDefinition);
        }
        Ok(())
    }

    pub(super) async fn reject_managed_definition(
        &self,
        definition_id: Uuid,
        user: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> Result<(), PropertiesErr> {
        let definition = match self
            .properties_service
            .get_property_definition(definition_id, user, team)
            .await
        {
            Ok(definition) => definition,
            Err(PropertiesErr::NotFound) => return Ok(()),
            Err(err) => return Err(err),
        };
        if matches!(definition.owner, PropertyOwner::Team { .. })
            && self.is_managed_team_definition_name(&definition.display_name)
        {
            return Err(PropertiesErr::ManagedDefinition);
        }
        Ok(())
    }
}
