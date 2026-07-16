use async_graphql::{Context, Enum, ID, Object, SimpleObject, Union, dataloader::DataLoader};
use graphql_common::GraphqlPropertyEntityType;
use models_properties::service::{
    entity_property_with_definition::EntityPropertyWithDefinition, property_value::PropertyValue,
};

use crate::loaders::{EntityPropertiesLoader, EntityPropertyReader};

/// A property definition's supported value type.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlPropertyDataType {
    /// Boolean true/false values.
    Boolean,
    /// Date and time values.
    Date,
    /// Numeric values.
    Number,
    /// String or text values.
    String,
    /// A select property with numeric options.
    SelectNumber,
    /// A select property with string options.
    SelectString,
    /// User- or team-scoped colored labels.
    Tag,
    /// References to other entities.
    Entity,
    /// URL values.
    Link,
}

impl From<models_properties::DataType> for GraphqlPropertyDataType {
    fn from(data_type: models_properties::DataType) -> Self {
        match data_type {
            models_properties::DataType::Boolean => Self::Boolean,
            models_properties::DataType::Date => Self::Date,
            models_properties::DataType::Number => Self::Number,
            models_properties::DataType::String => Self::String,
            models_properties::DataType::SelectNumber => Self::SelectNumber,
            models_properties::DataType::SelectString => Self::SelectString,
            models_properties::DataType::Tag => Self::Tag,
            models_properties::DataType::Entity => Self::Entity,
            models_properties::DataType::Link => Self::Link,
        }
    }
}

/// Load the properties attached to an entity through the request-scoped loader.
pub async fn load_entity_properties<R>(
    ctx: &Context<'_>,
    entity: model_entity::Entity<'static>,
) -> async_graphql::Result<Vec<GraphqlProperty>>
where
    R: EntityPropertyReader,
{
    let loader = ctx.data::<DataLoader<EntityPropertiesLoader<R>>>()?;
    let properties = loader
        .load_one(model_entity::OwnedEntity::from(entity))
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))?
        .unwrap_or_default();
    Ok(properties.into_iter().map(GraphqlProperty::from).collect())
}

/// A property definition assigned to an entity, together with its current value.
pub struct GraphqlProperty(EntityPropertyWithDefinition);

impl From<EntityPropertyWithDefinition> for GraphqlProperty {
    fn from(value: EntityPropertyWithDefinition) -> Self {
        Self(value)
    }
}

/// A property assignment and its current value.
#[Object]
impl GraphqlProperty {
    /// The globally unique identifier of this entity-property assignment.
    async fn id(&self) -> ID {
        ID(self.0.property.id.to_string())
    }

    /// The identifier of the shared property definition.
    async fn property_definition_id(&self) -> ID {
        ID(self.0.definition.id.to_string())
    }

    /// The user-facing name of the property.
    async fn display_name(&self) -> &str {
        &self.0.definition.display_name
    }

    /// The type of value accepted by the property.
    async fn data_type(&self) -> GraphqlPropertyDataType {
        self.0.definition.data_type.into()
    }

    /// Whether the property can contain more than one value.
    async fn is_multi_select(&self) -> bool {
        self.0.definition.is_multi_select
    }

    /// The required entity type for entity-reference properties, when constrained.
    async fn specific_entity_type(&self) -> Option<GraphqlPropertyEntityType> {
        self.0
            .definition
            .specific_entity_type
            .map(GraphqlPropertyEntityType::from)
    }

    /// Whether this property is managed by the system.
    async fn is_system(&self) -> bool {
        self.0.definition.is_system
    }

    /// Whether this property describes entity metadata.
    async fn is_metadata(&self) -> bool {
        self.0.definition.is_metadata
    }

    /// The current value, represented by exactly one typed union variant.
    async fn value(&self) -> Option<GraphqlPropertyValue> {
        self.0.value.as_ref().map(GraphqlPropertyValue::from)
    }
}

/// A property value represented by a type-safe GraphQL union.
#[derive(Union)]
pub enum GraphqlPropertyValue {
    /// A Boolean value.
    Boolean(GraphqlBooleanPropertyValue),
    /// A numeric value.
    Number(GraphqlNumberPropertyValue),
    /// A string value.
    String(GraphqlStringPropertyValue),
    /// An RFC 3339 date-time value.
    Date(GraphqlDatePropertyValue),
    /// One or more selected option identifiers.
    SelectOption(GraphqlSelectOptionPropertyValue),
    /// One or more entity references.
    EntityReference(GraphqlEntityReferencePropertyValue),
    /// One or more URL values.
    Link(GraphqlLinkPropertyValue),
}

/// A Boolean property value.
#[derive(SimpleObject)]
pub struct GraphqlBooleanPropertyValue {
    /// The stored Boolean.
    value: bool,
}

/// A numeric property value.
#[derive(SimpleObject)]
pub struct GraphqlNumberPropertyValue {
    /// The stored number.
    value: f64,
}

/// A string property value.
#[derive(SimpleObject)]
pub struct GraphqlStringPropertyValue {
    /// The stored string.
    value: String,
}

/// A date-time property value.
#[derive(SimpleObject)]
pub struct GraphqlDatePropertyValue {
    /// The stored date-time formatted as RFC 3339.
    value: String,
}

/// A select-option property value.
#[derive(SimpleObject)]
pub struct GraphqlSelectOptionPropertyValue {
    /// The selected option identifiers.
    option_ids: Vec<ID>,
}

/// An entity-reference property value.
#[derive(SimpleObject)]
pub struct GraphqlEntityReferencePropertyValue {
    /// The referenced entities.
    references: Vec<GraphqlPropertyEntityReference>,
}

/// A link property value.
#[derive(SimpleObject)]
pub struct GraphqlLinkPropertyValue {
    /// The stored URLs.
    urls: Vec<String>,
}

impl From<&PropertyValue> for GraphqlPropertyValue {
    fn from(value: &PropertyValue) -> Self {
        match value {
            PropertyValue::Bool(value) => {
                Self::Boolean(GraphqlBooleanPropertyValue { value: *value })
            }
            PropertyValue::Num(value) => Self::Number(GraphqlNumberPropertyValue { value: *value }),
            PropertyValue::Str(value) => Self::String(GraphqlStringPropertyValue {
                value: value.clone(),
            }),
            PropertyValue::Date(value) => Self::Date(GraphqlDatePropertyValue {
                value: value.to_rfc3339(),
            }),
            PropertyValue::SelectOption(values) => {
                Self::SelectOption(GraphqlSelectOptionPropertyValue {
                    option_ids: values.iter().map(|id| ID(id.to_string())).collect(),
                })
            }
            PropertyValue::EntityRef(values) => {
                Self::EntityReference(GraphqlEntityReferencePropertyValue {
                    references: values
                        .iter()
                        .map(GraphqlPropertyEntityReference::from)
                        .collect(),
                })
            }
            PropertyValue::Link(values) => Self::Link(GraphqlLinkPropertyValue {
                urls: values.clone(),
            }),
        }
    }
}

/// An entity reference stored in a property value.
#[derive(SimpleObject)]
pub struct GraphqlPropertyEntityReference {
    /// The referenced entity's identifier.
    entity_id: String,
    /// The referenced entity's property-domain type.
    entity_type: GraphqlPropertyEntityType,
    /// The specific message identifier when the reference targets a thread message.
    specific_message_id: Option<ID>,
}

impl From<&models_properties::EntityReference> for GraphqlPropertyEntityReference {
    fn from(value: &models_properties::EntityReference) -> Self {
        Self {
            entity_id: value.entity_id.clone(),
            entity_type: value.entity_type.into(),
            specific_message_id: value
                .specific_message_id
                .map(|message_id| ID(message_id.to_string())),
        }
    }
}
