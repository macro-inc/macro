use std::sync::{Arc, Mutex};

use async_graphql::{EmptySubscription, Object, Schema};

use super::*;

#[derive(Default)]
struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn health(&self) -> bool {
        true
    }
}

type CapturedWrite = (
    model_entity::EntityType,
    String,
    Uuid,
    Option<SetPropertyValue>,
);

type CapturedOptionsWrite = (
    model_entity::EntityType,
    String,
    Vec<(Uuid, Vec<Uuid>, Vec<Uuid>)>,
);

#[derive(Clone)]
struct CapturingWriter {
    write: Arc<Mutex<Option<CapturedWrite>>>,
    options_write: Arc<Mutex<Option<CapturedOptionsWrite>>>,
    property: EntityPropertyWithDefinition,
    affected_task_ids: Vec<Uuid>,
}

impl EntityPropertyWriter for CapturingWriter {
    async fn delete_entity_property(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _entity_property_id: Uuid,
    ) -> Result<(), rootcause::Report> {
        Ok(())
    }

    async fn set_entity_property(
        &self,
        entity_type: model_entity::EntityType,
        entity_id: String,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<EntityPropertyWithDefinition, rootcause::Report> {
        *self.write.lock().expect("capture mutex poisoned") =
            Some((entity_type, entity_id, property_definition_id, value));
        Ok(self.property.clone())
    }

    async fn set_task_property(
        &self,
        task_id: Uuid,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<properties::domain::model::EntityPropertyMutation, rootcause::Report> {
        let property = self
            .set_entity_property(
                model_entity::EntityType::Document,
                task_id.to_string(),
                property_definition_id,
                value,
            )
            .await?;
        Ok(properties::domain::model::EntityPropertyMutation {
            property,
            affected_task_ids: self.affected_task_ids.clone(),
        })
    }

    async fn update_entity_property_options(
        &self,
        entity_type: model_entity::EntityType,
        entity_id: String,
        updates: Vec<EntityPropertyOptionDelta>,
    ) -> Result<Vec<EntityPropertyWithDefinition>, rootcause::Report> {
        *self.options_write.lock().expect("capture mutex poisoned") = Some((
            entity_type,
            entity_id,
            updates
                .into_iter()
                .map(|update| {
                    (
                        update.property_definition_id,
                        update.add_option_ids,
                        update.remove_option_ids,
                    )
                })
                .collect(),
        ));
        Ok(vec![self.property.clone()])
    }
}

#[tokio::test]
async fn set_entity_property_forwards_to_writer() {
    let property_assignment_id = Uuid::from_u128(3);
    let property_definition_id = Uuid::from_u128(1);
    let option_id = Uuid::from_u128(2);
    let now = chrono::Utc::now();
    let writer = CapturingWriter {
        write: Arc::default(),
        options_write: Arc::default(),
        affected_task_ids: Vec::new(),
        property: EntityPropertyWithDefinition {
            property: models_properties::service::entity_property::EntityProperty {
                id: property_assignment_id,
                entity_id: "task-1".to_owned(),
                entity_type: models_properties::EntityType::Task,
                property_definition_id,
                created_at: now,
                updated_at: now,
            },
            definition: models_properties::service::property_definition::PropertyDefinition {
                id: property_definition_id,
                owner: models_properties::PropertyOwner::System,
                display_name: "Status".to_owned(),
                data_type: models_properties::DataType::SelectString,
                is_multi_select: false,
                specific_entity_type: Some(models_properties::EntityType::Task),
                created_at: now,
                updated_at: now,
                is_system: true,
                is_metadata: false,
            },
            value: Some(
                models_properties::service::property_value::PropertyValue::SelectOption(vec![
                    option_id,
                ]),
            ),
            options: None,
        },
    };
    let writer_data = writer.clone();
    let schema = Schema::build(
        QueryRoot,
        PropertiesMutationRoot::<CapturingWriter>::new(),
        EmptySubscription,
    )
    .data(writer_data)
    .finish();
    let response = schema
        .execute(format!(
            r#"
            mutation {{
                setEntityProperty(input: {{
                    entityType: DOCUMENT,
                    entityId: "task-1",
                    propertyDefinitionId: "{property_definition_id}",
                    value: {{ selectOption: "{option_id}" }}
                }}) {{
                    id
                    propertyDefinitionId
                    displayName
                    dataType
                    isMultiSelect
                    specificEntityType
                    isSystem
                    isMetadata
                    value {{
                        __typename
                        ... on GraphqlSelectOptionPropertyValue {{
                            optionIds
                        }}
                    }}
                }}
            }}
            "#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({
            "setEntityProperty": {
                "id": property_assignment_id.to_string(),
                "propertyDefinitionId": property_definition_id.to_string(),
                "displayName": "Status",
                "dataType": "SELECT_STRING",
                "isMultiSelect": false,
                "specificEntityType": "TASK",
                "isSystem": true,
                "isMetadata": false,
                "value": {
                    "__typename": "GraphqlSelectOptionPropertyValue",
                    "optionIds": [option_id.to_string()],
                },
            }
        })
    );
    assert_eq!(
        writer.write.lock().expect("capture mutex poisoned").clone(),
        Some((
            model_entity::EntityType::Document,
            "task-1".to_string(),
            property_definition_id,
            Some(SetPropertyValue::SelectOption { option_id }),
        ))
    );
}

/// A user-owned multi-select tag property carrying `option_ids`.
fn tag_property(
    property_assignment_id: Uuid,
    property_definition_id: Uuid,
    option_ids: Vec<Uuid>,
) -> EntityPropertyWithDefinition {
    let now = chrono::Utc::now();
    EntityPropertyWithDefinition {
        property: models_properties::service::entity_property::EntityProperty {
            id: property_assignment_id,
            entity_id: "doc-1".to_owned(),
            entity_type: models_properties::EntityType::Document,
            property_definition_id,
            created_at: now,
            updated_at: now,
        },
        definition: models_properties::service::property_definition::PropertyDefinition {
            id: property_definition_id,
            owner: models_properties::PropertyOwner::User {
                user_id: "macro|austin@macro.com".to_owned(),
            },
            display_name: "Tags".to_owned(),
            data_type: models_properties::DataType::Tag,
            is_multi_select: true,
            specific_entity_type: None,
            created_at: now,
            updated_at: now,
            is_system: false,
            is_metadata: false,
        },
        value: Some(
            models_properties::service::property_value::PropertyValue::SelectOption(option_ids),
        ),
        options: None,
    }
}

#[tokio::test]
async fn update_entity_property_options_forwards_deltas_and_returns_properties() {
    let property_assignment_id = Uuid::from_u128(7);
    let property_definition_id = Uuid::from_u128(4);
    let added_option_id = Uuid::from_u128(5);
    let removed_option_id = Uuid::from_u128(6);
    let writer = CapturingWriter {
        write: Arc::default(),
        options_write: Arc::default(),
        affected_task_ids: Vec::new(),
        property: tag_property(
            property_assignment_id,
            property_definition_id,
            vec![added_option_id],
        ),
    };
    let writer_data = writer.clone();
    let schema = Schema::build(
        QueryRoot,
        PropertiesMutationRoot::<CapturingWriter>::new(),
        EmptySubscription,
    )
    .data(writer_data)
    .finish();
    let response = schema
        .execute(format!(
            r#"
            mutation {{
                updateEntityPropertyOptions(input: {{
                    entityType: DOCUMENT,
                    entityId: "doc-1",
                    properties: [{{
                        propertyDefinitionId: "{property_definition_id}",
                        addOptionIds: ["{added_option_id}"],
                        removeOptionIds: ["{removed_option_id}"]
                    }}]
                }}) {{
                    id
                    propertyDefinitionId
                    dataType
                    isMultiSelect
                    value {{
                        __typename
                        ... on GraphqlSelectOptionPropertyValue {{
                            optionIds
                        }}
                    }}
                }}
            }}
            "#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({
            "updateEntityPropertyOptions": [{
                "id": property_assignment_id.to_string(),
                "propertyDefinitionId": property_definition_id.to_string(),
                "dataType": "TAG",
                "isMultiSelect": true,
                "value": {
                    "__typename": "GraphqlSelectOptionPropertyValue",
                    "optionIds": [added_option_id.to_string()],
                },
            }]
        })
    );
    assert_eq!(
        writer
            .options_write
            .lock()
            .expect("capture mutex poisoned")
            .clone(),
        Some((
            model_entity::EntityType::Document,
            "doc-1".to_string(),
            vec![(
                property_definition_id,
                vec![added_option_id],
                vec![removed_option_id],
            )],
        ))
    );
}

struct EffectReader;

impl crate::task_dependencies::TaskDependencyReader for EffectReader {
    fn load<'a>(
        &'a self,
        _user: &'a MacroUserIdStr<'static>,
        ids: &'a [Uuid],
    ) -> futures::future::BoxFuture<
        'a,
        Result<
            std::collections::HashMap<Uuid, crate::task_dependencies::TaskDependencyData>,
            rootcause::Report,
        >,
    > {
        Box::pin(async move {
            Ok(ids
                .iter()
                .map(|id| {
                    (
                        *id,
                        crate::task_dependencies::TaskDependencyData {
                            facts: properties::domain::task_dependency_state::TaskDependencyState {
                                task_id: *id,
                                ..Default::default()
                            },
                            properties: Vec::new(),
                        },
                    )
                })
                .collect())
        })
    }
}

#[tokio::test]
async fn task_effects_include_neighbors_removed_between_pre_read_and_write() {
    let task = Uuid::from_u128(1);
    let removed = Uuid::from_u128(2);
    let definition = system_properties::SystemPropertyKey::DEPENDS_ON_UUID;
    let now = chrono::Utc::now();
    let writer = CapturingWriter {
        write: Arc::default(),
        options_write: Arc::default(),
        affected_task_ids: vec![task, removed],
        property: EntityPropertyWithDefinition {
            property: models_properties::service::entity_property::EntityProperty {
                id: Uuid::from_u128(3),
                entity_id: task.to_string(),
                entity_type: models_properties::EntityType::Task,
                property_definition_id: definition,
                created_at: now,
                updated_at: now,
            },
            definition: models_properties::service::property_definition::PropertyDefinition {
                id: definition,
                owner: models_properties::PropertyOwner::System,
                display_name: "Depends On".to_string(),
                data_type: models_properties::DataType::Entity,
                is_multi_select: true,
                specific_entity_type: Some(models_properties::EntityType::Task),
                created_at: now,
                updated_at: now,
                is_system: true,
                is_metadata: false,
            },
            value: None,
            options: None,
        },
    };
    // Neither read exposes the removed neighbor; only the committed receipt does.
    let loader = crate::task_dependencies::task_dependency_loader(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        EffectReader,
    );
    let schema = Schema::build(
        QueryRoot,
        PropertiesMutationRoot::<CapturingWriter>::new(),
        EmptySubscription,
    )
    .data(writer)
    .data(loader)
    .finish();
    let response = schema
        .execute(format!(
            r#"mutation {{ setTaskProperty(input: {{
            entityType: DOCUMENT, entityId: "{task}",
            propertyDefinitionId: "{definition}", value: null
        }}) {{ effectsComplete tasks {{ id }} }} }}"#
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["setTaskProperty"]["effectsComplete"], true);
    let ids = data["setTaskProperty"]["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|state| state["id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(ids.contains(&removed.to_string().as_str()));
    assert!(ids.contains(&task.to_string().as_str()));
}
