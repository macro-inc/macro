use async_graphql::{Context, ID, Object};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use graphql_common::parse_id;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::requests::SetPropertyValue;
use models_properties::shared::EntityReference;
use models_soup::SoupProperty;
use properties::{PropertiesAccessReceipt, PropertiesService, access_entity_type};
use std::{marker::PhantomData, sync::Arc};
use uuid::Uuid;

use crate::{
    inputs::GraphqlPropertyEntityType,
    loaders::{EntityPropertiesKey, PropertiesSoupPropertyEdgeReader, SoupPropertyEdgeReader},
    objects::GraphqlSoupProperty,
};

/// Mutation root for entity property writes.
#[derive(Default)]
pub struct PropertiesMutationRoot<T>(PhantomData<T>);

impl<T> PropertiesMutationRoot<T> {
    /// Create a mutation root for the configured property writer.
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

/// GraphQL boundary for setting an entity property.
pub trait EntityPropertyWriter: Send + Sync + 'static {
    /// Set or attach one property on an entity.
    fn set_entity_property(
        &self,
        entity_type: models_properties::EntityType,
        entity_id: String,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> impl Future<Output = Result<SoupProperty, rootcause::Report>> + Send;
}

/// Property writer used by schema-only GraphQL construction.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpEntityPropertyWriter;

impl EntityPropertyWriter for NoOpEntityPropertyWriter {
    async fn set_entity_property(
        &self,
        _entity_type: models_properties::EntityType,
        _entity_id: String,
        _property_definition_id: Uuid,
        _value: Option<SetPropertyValue>,
    ) -> Result<SoupProperty, rootcause::Report> {
        Err(rootcause::report!("property writer is not configured"))
    }
}

/// Entity property writer backed by the properties and entity access services.
pub struct PropertiesEntityPropertyWriter<P, A> {
    properties_service: Arc<P>,
    entity_access_service: Arc<A>,
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
        entity_type: models_properties::EntityType,
        entity_id: String,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<SoupProperty, rootcause::Report> {
        let entity_access_receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &self.user_id,
                None,
                &entity_id,
                access_entity_type(entity_type),
            )
            .await
            .map_err(|err| rootcause::report!(err))?;
        let access = PropertiesAccessReceipt::try_from_entity_access_receipt(
            entity_access_receipt,
            entity_type,
        )
        .map_err(|err| rootcause::report!(err))?;

        self.properties_service
            .set_entity_property(&access, property_definition_id, value)
            .await
            .map_err(|err| rootcause::report!(err))?;

        let key = EntityPropertiesKey {
            entity_type: entity_type.to_string(),
            entity_id,
        };
        let reader = PropertiesSoupPropertyEdgeReader::new(
            self.properties_service.clone(),
            self.entity_access_service.clone(),
        );
        let properties = reader
            .get_properties(&self.user_id, vec![key.clone()])
            .await?
            .remove(&key)
            .unwrap_or_default();

        properties
            .into_iter()
            .find(|property| property.definition.id == property_definition_id)
            .ok_or_else(|| {
                rootcause::report!(
                    "set property {property_definition_id} was absent from the updated entity"
                )
            })
    }
}

#[derive(async_graphql::InputObject)]
struct SetEntityPropertyInput {
    entity_type: GraphqlPropertyEntityType,
    entity_id: String,
    property_definition_id: ID,
    /// Omit or pass null to attach the property without a value.
    value: Option<GraphqlSetPropertyValue>,
}

#[derive(async_graphql::InputObject)]
struct GraphqlEntityReferenceInput {
    entity_type: GraphqlPropertyEntityType,
    entity_id: String,
    specific_message_id: Option<ID>,
}

impl GraphqlEntityReferenceInput {
    fn try_into_model(self) -> async_graphql::Result<EntityReference> {
        Ok(EntityReference {
            entity_type: self.entity_type.into(),
            entity_id: self.entity_id,
            specific_message_id: self
                .specific_message_id
                .map(|id| parse_id(id, "specificMessageId"))
                .transpose()?,
        })
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlSetPropertyValue {
    Boolean(bool),
    Date(String),
    Number(f64),
    String(String),
    SelectOption(ID),
    MultiSelectOption(Vec<ID>),
    EntityReference(GraphqlEntityReferenceInput),
    MultiEntityReference(Vec<GraphqlEntityReferenceInput>),
    Link(String),
    MultiLink(Vec<String>),
}

impl GraphqlSetPropertyValue {
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
    ) -> async_graphql::Result<GraphqlSoupProperty> {
        let writer = ctx.data::<T>()?;
        let property_definition_id =
            parse_id(input.property_definition_id, "propertyDefinitionId")?;
        let value = input
            .value
            .map(GraphqlSetPropertyValue::try_into_model)
            .transpose()?;

        let property = writer
            .set_entity_property(
                input.entity_type.into(),
                input.entity_id,
                property_definition_id,
                value,
            )
            .await
            .map_err(|err| async_graphql::Error::new(err.to_string()))?;

        Ok(property.into())
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
        models_properties::EntityType,
        String,
        Uuid,
        Option<SetPropertyValue>,
    );

    #[derive(Clone)]
    struct CapturingWriter {
        write: Arc<Mutex<Option<CapturedWrite>>>,
        property: SoupProperty,
    }

    impl EntityPropertyWriter for CapturingWriter {
        async fn set_entity_property(
            &self,
            entity_type: models_properties::EntityType,
            entity_id: String,
            property_definition_id: Uuid,
            value: Option<SetPropertyValue>,
        ) -> Result<SoupProperty, rootcause::Report> {
            *self.write.lock().expect("capture mutex poisoned") =
                Some((entity_type, entity_id, property_definition_id, value));
            Ok(self.property.clone())
        }
    }

    #[tokio::test]
    async fn set_entity_property_forwards_to_writer() {
        let property_assignment_id = Uuid::from_u128(3);
        let property_definition_id = Uuid::from_u128(1);
        let option_id = Uuid::from_u128(2);
        let writer = CapturingWriter {
            write: Arc::default(),
            property: SoupProperty {
                id: property_assignment_id,
                definition: models_properties::service::property_definition::PropertyDefinition {
                    id: property_definition_id,
                    owner: models_properties::PropertyOwner::System,
                    display_name: "Status".to_owned(),
                    data_type: models_properties::DataType::SelectString,
                    is_multi_select: false,
                    specific_entity_type: Some(models_properties::EntityType::Task),
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                    is_system: true,
                    is_metadata: false,
                },
                value: Some(
                    models_properties::service::property_value::PropertyValue::SelectOption(vec![
                        option_id,
                    ]),
                ),
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
                        entityType: TASK,
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
                            kind
                            selectOptionIds
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
                        "kind": "SelectOption",
                        "selectOptionIds": [option_id.to_string()],
                    },
                }
            })
        );
        assert_eq!(
            writer.write.lock().expect("capture mutex poisoned").clone(),
            Some((
                models_properties::EntityType::Task,
                "task-1".to_string(),
                property_definition_id,
                Some(SetPropertyValue::SelectOption { option_id }),
            ))
        );
    }
}
