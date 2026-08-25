use std::sync::Arc;

use entity_access::domain::ports::EntityAccessService as _;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::DataType;
use models_properties::service::property_option::PropertyOptionValue;

use super::{ToolEntityAccessService, ToolPropertiesService};

#[derive(Clone)]
pub struct ToolActivityMetadataResolver {
    properties: Arc<ToolPropertiesService>,
    entity_access_service: Arc<ToolEntityAccessService>,
}

impl ToolActivityMetadataResolver {
    pub(super) fn new(
        properties: Arc<ToolPropertiesService>,
        entity_access_service: Arc<ToolEntityAccessService>,
    ) -> Self {
        Self {
            properties,
            entity_access_service,
        }
    }
}

#[async_trait::async_trait]
impl activity::ActivityMetadataResolver for ToolActivityMetadataResolver {
    async fn resolve_properties(
        &self,
        viewer: &MacroUserIdStr<'_>,
        property_ids: &[String],
    ) -> std::collections::HashMap<String, activity::ActivityPropertyMetadata> {
        use entity_access::domain::models::{
            Entity, EntityAccessReceipt, EntityPermission, EntityType,
        };
        use properties::domain::service::PropertiesService as _;

        if property_ids.is_empty() {
            return std::collections::HashMap::new();
        }

        let team = match self.entity_access_service.get_user_team(viewer).await {
            Ok(Some(team_info)) => {
                let viewer = viewer.copied().into_owned();
                match EntityAccessReceipt::try_new_authenticated_user(
                    viewer,
                    Entity {
                        entity_id: team_info.team_id.to_string(),
                        entity_type: EntityType::Team,
                    },
                    EntityPermission::TeamRole {
                        role: team_info.role,
                    },
                ) {
                    Ok(receipt) => Some(receipt),
                    Err(error) => {
                        tracing::warn!(error=?error, "failed to mint activity metadata team receipt");
                        return std::collections::HashMap::new();
                    }
                }
            }
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(error=?error, "failed to resolve activity metadata team");
                return std::collections::HashMap::new();
            }
        };

        let definitions = match self
            .properties
            .list_property_definitions_with_options(team.as_ref(), Some(viewer), true, None)
            .await
        {
            Ok(definitions) => definitions,
            Err(error) => {
                tracing::warn!(error=?error, "failed to resolve activity property metadata");
                return std::collections::HashMap::new();
            }
        };
        let requested: std::collections::HashSet<&str> =
            property_ids.iter().map(String::as_str).collect();

        definitions
            .into_iter()
            .filter_map(|definition| {
                let id = definition.definition.id.to_string();
                if !requested.contains(id.as_str()) {
                    return None;
                }
                let data_type = property_data_type_name(definition.definition.data_type);
                let option_labels = definition
                    .property_options
                    .into_iter()
                    .map(|option| {
                        let label = match option.value {
                            PropertyOptionValue::String(value) => value,
                            PropertyOptionValue::Number(value) => value.to_string(),
                        };
                        (option.id.to_string(), label)
                    })
                    .collect();
                Some((
                    id,
                    activity::ActivityPropertyMetadata {
                        display_name: definition.definition.display_name,
                        data_type: data_type.to_string(),
                        option_labels,
                    },
                ))
            })
            .collect()
    }
}

fn property_data_type_name(data_type: DataType) -> &'static str {
    match data_type {
        DataType::Boolean => "boolean",
        DataType::Date => "date",
        DataType::Number => "number",
        DataType::String => "string",
        DataType::SelectNumber => "select_number",
        DataType::SelectString => "select_string",
        DataType::Tag => "tag",
        DataType::Entity => "entity",
        DataType::Link => "link",
    }
}
