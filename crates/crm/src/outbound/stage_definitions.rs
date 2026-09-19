//! [`StageDefinitionStore`] over the properties domain service.

use std::sync::Arc;

use entity_access::domain::models::MemberTeamRole;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::{
    CreatePropertyDefinitionRequest, CreatePropertyScope, PropertyDataType, SelectStringOption,
};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::{DataType, PropertyOwner};
use properties::domain::model::{
    PropertyOptionInsert, PropertyOptionReplacePlan, PropertyOptionRewrite,
};
use properties::{PropertiesErr, PropertiesService};
use uuid::Uuid;

use crate::domain::{
    auth::CrmTeamReceipt,
    model::CrmError,
    stages::{
        CRM_TEAM_STAGE_DEFINITION_NAME, StageDefinitionStore, StageReplacePlan, TeamStage,
        TeamStageSet,
    },
};

#[cfg(test)]
mod test;

/// Properties-backed [`StageDefinitionStore`].
#[derive(Debug)]
pub struct PropertiesStageDefinitionStore<P> {
    properties: Arc<P>,
}

impl<P> Clone for PropertiesStageDefinitionStore<P> {
    fn clone(&self) -> Self {
        Self {
            properties: self.properties.clone(),
        }
    }
}

impl<P: PropertiesService> PropertiesStageDefinitionStore<P> {
    /// Wrap a properties service.
    pub fn new(properties: Arc<P>) -> Self {
        Self { properties }
    }
}

fn is_team_stage_definition(definition: &PropertyDefinitionWithOptions) -> bool {
    let definition = &definition.definition;
    definition.display_name == CRM_TEAM_STAGE_DEFINITION_NAME
        && definition.data_type == DataType::SelectString
        && !definition.is_multi_select
        && !definition.is_system
        && matches!(definition.owner, PropertyOwner::Team { .. })
}

fn stage_from_option(option: &PropertyOption) -> Option<TeamStage> {
    let PropertyOptionValue::String(label) = &option.value else {
        return None;
    };
    Some(TeamStage {
        id: option.id,
        label: label.clone(),
        display_order: option.display_order,
    })
}

fn stage_set_from_definition(definition: PropertyDefinitionWithOptions) -> TeamStageSet {
    let mut stages: Vec<TeamStage> = definition
        .property_options
        .iter()
        .filter_map(stage_from_option)
        .collect();
    stages.sort_by_key(|stage| stage.display_order);
    TeamStageSet {
        definition_id: definition.definition.id,
        stages,
    }
}

fn acting_user(
    access: &CrmTeamReceipt<MemberTeamRole>,
) -> Result<&MacroUserIdStr<'static>, CrmError> {
    access.receipt().acting_user_id().ok_or_else(|| {
        CrmError::InvalidRequest("editing deal stages requires an authenticated user".into())
    })
}

fn is_unique_violation(err: &anyhow::Error) -> bool {
    err.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<sqlx::Error>(),
            Some(sqlx::Error::Database(db_err)) if db_err.is_unique_violation()
        )
    })
}

fn stage_store_error(err: PropertiesErr) -> CrmError {
    match err {
        PropertiesErr::DuplicateOptionValue => {
            CrmError::InvalidRequest("a stage with that label already exists".into())
        }
        PropertiesErr::Repo(err) if is_unique_violation(&err) => {
            CrmError::InvalidRequest("a stage with that label already exists".into())
        }
        PropertiesErr::Validation(message) => CrmError::InvalidRequest(message),
        PropertiesErr::NotFound | PropertiesErr::OptionNotFound => {
            CrmError::InvalidRequest("stage not found for the team".into())
        }
        other => CrmError::StorageLayerError(other.into()),
    }
}

impl<P: PropertiesService> StageDefinitionStore for PropertiesStageDefinitionStore<P> {
    #[tracing::instrument(skip_all, err)]
    async fn get_team_stage_set(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Option<TeamStageSet>, CrmError> {
        let definitions = self
            .properties
            .list_property_definitions_with_options(Some(access.receipt()), None, false, None)
            .await
            .map_err(stage_store_error)?;
        Ok(definitions
            .into_iter()
            .find(is_team_stage_definition)
            .map(stage_set_from_definition))
    }

    #[tracing::instrument(skip_all, err)]
    async fn create_team_stage_set(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        labels: &[String],
    ) -> Result<TeamStageSet, CrmError> {
        let user = acting_user(access)?;
        let request = CreatePropertyDefinitionRequest {
            scope: CreatePropertyScope::Team,
            display_name: CRM_TEAM_STAGE_DEFINITION_NAME.to_string(),
            data_type: PropertyDataType::SelectString {
                multi: false,
                options: labels
                    .iter()
                    .enumerate()
                    .map(|(index, label)| SelectStringOption {
                        display_order: index as i32,
                        value: label.clone(),
                    })
                    .collect(),
            },
        };
        let definition = self
            .properties
            .create_property_definition(user, Some(access.receipt()), &request)
            .await
            .map_err(stage_store_error)?;
        let options = self
            .properties
            .get_property_options(definition.id, user, Some(access.receipt()))
            .await
            .map_err(stage_store_error)?;
        let mut stages: Vec<TeamStage> = options.iter().filter_map(stage_from_option).collect();
        stages.sort_by_key(|stage| stage.display_order);
        Ok(TeamStageSet {
            definition_id: definition.id,
            stages,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn replace_stages(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        definition_id: Uuid,
        plan: StageReplacePlan,
    ) -> Result<TeamStageSet, CrmError> {
        let plan = PropertyOptionReplacePlan {
            delete: plan.delete,
            rewrite: plan
                .rewrite
                .into_iter()
                .map(|stage| PropertyOptionRewrite {
                    option_id: stage.id,
                    value: PropertyOptionValue::String(stage.label),
                    display_order: stage.display_order,
                })
                .collect(),
            insert: plan
                .insert
                .into_iter()
                .map(|stage| PropertyOptionInsert {
                    value: PropertyOptionValue::String(stage.label),
                    display_order: stage.display_order,
                })
                .collect(),
        };
        let options = self
            .properties
            .replace_property_options(
                acting_user(access)?,
                Some(access.receipt()),
                definition_id,
                plan,
            )
            .await
            .map_err(stage_store_error)?;
        let mut stages: Vec<TeamStage> = options.iter().filter_map(stage_from_option).collect();
        stages.sort_by_key(|stage| stage.display_order);
        Ok(TeamStageSet {
            definition_id,
            stages,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn delete_team_stage_set(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        definition_id: Uuid,
    ) -> Result<(), CrmError> {
        self.properties
            .delete_property_definition(definition_id, acting_user(access)?, Some(access.receipt()))
            .await
            .map_err(stage_store_error)
    }
}
