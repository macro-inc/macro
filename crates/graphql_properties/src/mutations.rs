use async_graphql::{Context, ID, Object};
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use graphql_common::{GraphqlPropertyEntityType, parse_id};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::requests::SetPropertyValue;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::shared::EntityReference;
use properties::PropertiesService;
use properties::domain::model::EntityPropertyOptionUpdate;
use std::{marker::PhantomData, sync::Arc};
use uuid::Uuid;

use crate::objects::GraphqlProperty;

/// Mutation root for entity property writes.
#[derive(Default)]
pub struct PropertiesMutationRoot<T>(PhantomData<T>);

impl<T> PropertiesMutationRoot<T> {
    /// Create a mutation root for the configured property writer.
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

/// One multi-select property's option delta within a selection update.
#[derive(Debug, Clone)]
pub struct EntityPropertyOptionDelta {
    /// The multi-select property definition being changed.
    pub property_definition_id: Uuid,
    /// Options to add to the currently stored value.
    pub add_option_ids: Vec<Uuid>,
    /// Options to strip from the currently stored value.
    pub remove_option_ids: Vec<Uuid>,
}

/// GraphQL boundary for setting an entity property.
pub trait EntityPropertyWriter: Send + Sync + 'static {
    /// Set or attach one property on an entity.
    fn set_entity_property(
        &self,
        entity_type: model_entity::EntityType,
        entity_id: String,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> impl Future<Output = Result<EntityPropertyWithDefinition, rootcause::Report>> + Send;

    /// Apply option add/remove deltas across one entity's multi-select
    /// properties, returning each touched property as committed.
    ///
    /// Deltas compose with concurrent edits instead of clobbering them, and the
    /// whole selection is one transaction.
    fn update_entity_property_options(
        &self,
        entity_type: model_entity::EntityType,
        entity_id: String,
        updates: Vec<EntityPropertyOptionDelta>,
    ) -> impl Future<Output = Result<Vec<EntityPropertyWithDefinition>, rootcause::Report>> + Send;
}

/// Property writer used by schema-only GraphQL construction.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpEntityPropertyWriter;

impl EntityPropertyWriter for NoOpEntityPropertyWriter {
    async fn set_entity_property(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _property_definition_id: Uuid,
        _value: Option<SetPropertyValue>,
    ) -> Result<EntityPropertyWithDefinition, rootcause::Report> {
        Err(rootcause::report!("property writer is not configured"))
    }

    async fn update_entity_property_options(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _updates: Vec<EntityPropertyOptionDelta>,
    ) -> Result<Vec<EntityPropertyWithDefinition>, rootcause::Report> {
        Err(rootcause::report!("property writer is not configured"))
    }
}

/// Entity property writer backed by the properties and entity access services.
pub struct PropertiesEntityPropertyWriter<P, A> {
    /// Domain service used to write properties.
    properties_service: Arc<P>,
    /// Access service used to authorize writes.
    entity_access_service: Arc<A>,
    /// Authenticated user performing the write.
    user_id: MacroUserIdStr<'static>,
}

impl<P, A> PropertiesEntityPropertyWriter<P, A> {
    /// Create a writer for the authenticated caller.
    pub fn new(
        properties_service: Arc<P>,
        entity_access_service: Arc<A>,
        user_id: MacroUserIdStr<'static>,
    ) -> Self {
        Self {
            properties_service,
            entity_access_service,
            user_id,
        }
    }
}

impl<P, A> EntityPropertyWriter for PropertiesEntityPropertyWriter<P, A>
where
    P: PropertiesService,
    A: EntityAccessService,
{
    async fn set_entity_property(
        &self,
        entity_type: model_entity::EntityType,
        entity_id: String,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<EntityPropertyWithDefinition, rootcause::Report> {
        let entity_access_receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &self.user_id,
                None,
                &entity_id,
                entity_type,
            )
            .await
            .map_err(|err| rootcause::report!(err))?;
        Ok(self
            .properties_service
            .set_entity_property(&entity_access_receipt, property_definition_id, value)
            .await
            .map_err(|err| rootcause::report!(err))?)
    }

    async fn update_entity_property_options(
        &self,
        entity_type: model_entity::EntityType,
        entity_id: String,
        updates: Vec<EntityPropertyOptionDelta>,
    ) -> Result<Vec<EntityPropertyWithDefinition>, rootcause::Report> {
        let entity_access_receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &self.user_id,
                None,
                &entity_id,
                entity_type,
            )
            .await
            .map_err(|err| rootcause::report!(err))?;

        let touched_definition_ids: Vec<Uuid> = updates
            .iter()
            .map(|update| update.property_definition_id)
            .collect();

        self.properties_service
            .bulk_update_entity_property_options(
                &entity_access_receipt,
                updates
                    .into_iter()
                    .map(|update| EntityPropertyOptionUpdate {
                        property_definition_id: update.property_definition_id,
                        add_option_ids: update.add_option_ids,
                        remove_option_ids: update.remove_option_ids,
                    })
                    .collect(),
            )
            .await
            .map_err(|err| rootcause::report!(err))?;

        // The domain returns reconciled option ids only. Re-read the committed
        // rows so the response carries whole property records: the client's
        // normalized cache keys on the assignment id and needs the definition
        // to render a property it has never seen on this entity before.
        let view_receipt = entity_access_receipt
            .try_into_requirement::<ViewAccessLevel>()
            .map_err(|err| rootcause::report!(err))?;
        let properties = self
            .properties_service
            .get_entity_properties_with_definitions(&view_receipt)
            .await
            .map_err(|err| rootcause::report!(err))?;

        Ok(properties
            .into_iter()
            .filter(|property| {
                touched_definition_ids.contains(&property.property.property_definition_id)
            })
            .collect())
    }
}

/// Canonical entity type accepted for property targets.
#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlPropertyTargetEntityType {
    /// Call record target.
    CallRecord,
    /// Channel target.
    Channel,
    /// Chat target.
    Chat,
    /// CRM company target.
    Company,
    /// Document target, including tasks and snippets.
    Document,
    /// Project target.
    Project,
    /// Email thread target.
    Thread,
    /// User target.
    User,
}

impl GraphqlPropertyTargetEntityType {
    /// Convert this GraphQL target type into the canonical entity model.
    pub fn into_model(self) -> model_entity::EntityType {
        match self {
            Self::CallRecord => model_entity::EntityType::Call,
            Self::Channel => model_entity::EntityType::Channel,
            Self::Chat => model_entity::EntityType::Chat,
            Self::Company => model_entity::EntityType::CrmCompany,
            Self::Document => model_entity::EntityType::Document,
            Self::Project => model_entity::EntityType::Project,
            Self::Thread => model_entity::EntityType::EmailThread,
            Self::User => model_entity::EntityType::User,
        }
    }
}

/// Input for assigning or updating an entity property.
#[derive(async_graphql::InputObject)]
struct SetEntityPropertyInput {
    /// Type of entity receiving the property.
    entity_type: GraphqlPropertyTargetEntityType,
    /// Identifier of the entity receiving the property.
    entity_id: String,
    /// Identifier of the property definition to assign.
    property_definition_id: ID,
    /// Omit or pass null to attach the property without a value.
    value: Option<GraphqlSetPropertyValue>,
}

/// Input for applying option deltas across one entity's properties.
#[derive(async_graphql::InputObject)]
struct UpdateEntityPropertyOptionsInput {
    /// Type of entity whose properties are changing.
    entity_type: GraphqlPropertyTargetEntityType,
    /// Identifier of the entity whose properties are changing.
    entity_id: String,
    /// Per-property option deltas applied in one transaction.
    properties: Vec<EntityPropertyOptionDeltaInput>,
}

/// One property's option delta within an options update.
#[derive(async_graphql::InputObject)]
struct EntityPropertyOptionDeltaInput {
    /// Identifier of the multi-select property definition being changed.
    property_definition_id: ID,
    /// Options to add to the currently stored value.
    add_option_ids: Vec<ID>,
    /// Options to strip from the currently stored value.
    remove_option_ids: Vec<ID>,
}

impl EntityPropertyOptionDeltaInput {
    /// Convert the GraphQL delta into its writer-port model.
    fn try_into_model(self) -> async_graphql::Result<EntityPropertyOptionDelta> {
        Ok(EntityPropertyOptionDelta {
            property_definition_id: parse_id(self.property_definition_id, "propertyDefinitionId")?,
            add_option_ids: self
                .add_option_ids
                .into_iter()
                .map(|id| parse_id(id, "addOptionIds"))
                .collect::<async_graphql::Result<_>>()?,
            remove_option_ids: self
                .remove_option_ids
                .into_iter()
                .map(|id| parse_id(id, "removeOptionIds"))
                .collect::<async_graphql::Result<_>>()?,
        })
    }
}

/// Input identifying an entity referenced by a property value.
#[derive(async_graphql::InputObject)]
struct GraphqlEntityReferenceInput {
    /// Type of the referenced entity.
    entity_type: GraphqlPropertyEntityType,
    /// Identifier of the referenced entity.
    entity_id: String,
    /// Specific message when the reference targets a thread message.
    specific_message_id: Option<ID>,
}

impl GraphqlEntityReferenceInput {
    /// Convert the GraphQL reference into its properties-domain model.
    fn try_into_model(self) -> async_graphql::Result<EntityReference> {
        Ok(EntityReference {
            entity_type: self.entity_type.into_model(),
            entity_id: self.entity_id,
            specific_message_id: self
                .specific_message_id
                .map(|id| parse_id(id, "specificMessageId"))
                .transpose()?,
        })
    }
}

/// A typed value accepted when setting an entity property.
#[derive(async_graphql::OneofObject)]
enum GraphqlSetPropertyValue {
    /// A Boolean value.
    Boolean(bool),
    /// An RFC 3339 date-time value.
    Date(String),
    /// A numeric value.
    Number(f64),
    /// A string value.
    String(String),
    /// A single selected option identifier.
    SelectOption(ID),
    /// Multiple selected option identifiers.
    MultiSelectOption(Vec<ID>),
    /// A single entity reference.
    EntityReference(GraphqlEntityReferenceInput),
    /// Multiple entity references.
    MultiEntityReference(Vec<GraphqlEntityReferenceInput>),
    /// A single URL value.
    Link(String),
    /// Multiple URL values.
    MultiLink(Vec<String>),
}

impl GraphqlSetPropertyValue {
    /// Convert the GraphQL value into its properties-domain request model.
    fn try_into_model(self) -> async_graphql::Result<SetPropertyValue> {
        Ok(match self {
            Self::Boolean(value) => SetPropertyValue::Boolean { value },
            Self::Date(value) => SetPropertyValue::Date {
                value: chrono::DateTime::parse_from_rfc3339(&value)
                    .map(|date| date.with_timezone(&chrono::Utc))
                    .map_err(|err| {
                        async_graphql::Error::new(format!(
                            "invalid RFC3339 property date `{value}`: {err}"
                        ))
                    })?,
            },
            Self::Number(value) => SetPropertyValue::Number { value },
            Self::String(value) => SetPropertyValue::String { value },
            Self::SelectOption(option_id) => SetPropertyValue::SelectOption {
                option_id: parse_id(option_id, "selectOption")?,
            },
            Self::MultiSelectOption(option_ids) => SetPropertyValue::MultiSelectOption {
                option_ids: option_ids
                    .into_iter()
                    .map(|id| parse_id(id, "multiSelectOption"))
                    .collect::<async_graphql::Result<_>>()?,
            },
            Self::EntityReference(reference) => SetPropertyValue::EntityReference {
                reference: reference.try_into_model()?,
            },
            Self::MultiEntityReference(references) => SetPropertyValue::MultiEntityReference {
                references: references
                    .into_iter()
                    .map(GraphqlEntityReferenceInput::try_into_model)
                    .collect::<async_graphql::Result<_>>()?,
            },
            Self::Link(url) => SetPropertyValue::Link { url },
            Self::MultiLink(urls) => SetPropertyValue::MultiLink { urls },
        })
    }
}

/// Mutations for assigning and updating entity properties.
#[Object]
impl<T> PropertiesMutationRoot<T>
where
    T: EntityPropertyWriter,
{
    /// Set or attach one property on an entity.
    async fn set_entity_property(
        &self,
        ctx: &Context<'_>,
        input: SetEntityPropertyInput,
    ) -> async_graphql::Result<GraphqlProperty> {
        let writer = ctx.data::<T>()?;
        let property_definition_id =
            parse_id(input.property_definition_id, "propertyDefinitionId")?;
        let value = input
            .value
            .map(GraphqlSetPropertyValue::try_into_model)
            .transpose()?;

        let property = writer
            .set_entity_property(
                input.entity_type.into_model(),
                input.entity_id,
                property_definition_id,
                value,
            )
            .await
            .map_err(|err| async_graphql::Error::new(err.to_string()))?;

        Ok(GraphqlProperty::new(property))
    }

    /// Add and remove options across one entity's multi-select properties.
    async fn update_entity_property_options(
        &self,
        ctx: &Context<'_>,
        input: UpdateEntityPropertyOptionsInput,
    ) -> async_graphql::Result<Vec<GraphqlProperty>> {
        let writer = ctx.data::<T>()?;
        let updates = input
            .properties
            .into_iter()
            .map(EntityPropertyOptionDeltaInput::try_into_model)
            .collect::<async_graphql::Result<Vec<_>>>()?;

        let properties = writer
            .update_entity_property_options(
                input.entity_type.into_model(),
                input.entity_id,
                updates,
            )
            .await
            .map_err(|err| async_graphql::Error::new(err.to_string()))?;

        Ok(properties.into_iter().map(GraphqlProperty::new).collect())
    }
}

#[cfg(test)]
mod tests {
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
    }

    impl EntityPropertyWriter for CapturingWriter {
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
}
