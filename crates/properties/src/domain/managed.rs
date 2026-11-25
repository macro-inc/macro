//! Team definitions another feature owns, which the generic property writes
//! (REST and GraphQL) must not create or change.

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::PropertyOwner;
use models_properties::api::CreatePropertyScope;
use uuid::Uuid;

use crate::domain::error::PropertiesErr;
use crate::domain::service::{PropertiesService, TeamReceipt};

/// Display names of team definitions managed from their feature's settings
/// (the CRM pipeline stages), shared by every inbound adapter.
#[derive(Clone, Debug, Default)]
pub struct ManagedTeamDefinitions(Arc<[String]>);

impl ManagedTeamDefinitions {
    /// Managed definitions with these display names.
    pub fn new(names: impl IntoIterator<Item = String>) -> Self {
        Self(names.into_iter().collect())
    }

    /// Whether a team definition with this name is managed elsewhere.
    pub fn contains(&self, display_name: &str) -> bool {
        self.0.iter().any(|name| name == display_name)
    }

    /// Refuse to create a team definition under a managed name.
    pub fn reject_create(
        &self,
        scope: CreatePropertyScope,
        display_name: &str,
    ) -> Result<(), PropertiesErr> {
        if scope == CreatePropertyScope::Team && self.contains(display_name) {
            return Err(PropertiesErr::ManagedDefinition);
        }
        Ok(())
    }

    /// Refuse writes to a managed team definition. A definition the caller
    /// cannot see passes, so the write itself answers not found.
    pub async fn reject_definition<S: PropertiesService>(
        &self,
        service: &S,
        definition_id: Uuid,
        user: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> Result<(), PropertiesErr> {
        let definition = match service
            .get_property_definition(definition_id, user, team)
            .await
        {
            Ok(definition) => definition,
            Err(PropertiesErr::NotFound) => return Ok(()),
            Err(err) => return Err(err),
        };
        if matches!(definition.owner, PropertyOwner::Team { .. })
            && self.contains(&definition.display_name)
        {
            return Err(PropertiesErr::ManagedDefinition);
        }
        Ok(())
    }
}
