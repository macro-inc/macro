use async_graphql::{Enum, ID, Object, SimpleObject};
use models_properties::service::property_value::PropertyValue;
use models_soup::SoupProperty;

/// GraphQL representation of supported Soup property data types.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlSoupDataType {
    /// Boolean true/false values.
    Boolean,
    /// Date and time values.
    Date,
    /// Numeric values.
    Number,
    /// String/text values.
    String,
    /// Select property with numeric options.
    SelectNumber,
    /// Select property with string options.
    SelectString,
    /// Tag property - user- or team-scoped colored labels (always multi-select).
    Tag,
    /// Entity reference property.
    Entity,
    /// Link value Property.
    Link,
}

impl From<models_properties::DataType> for GraphqlSoupDataType {
    fn from(dt: models_properties::DataType) -> Self {
        match dt {
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

/// GraphQL property attached to a Soup entity.
pub struct GraphqlSoupProperty(SoupProperty);

impl From<SoupProperty> for GraphqlSoupProperty {
    fn from(value: SoupProperty) -> Self {
        Self(value)
    }
}

#[Object]
impl GraphqlSoupProperty {
    /// Id of the shared property *definition* — deliberately not named `id`:
    /// a property instance has no global identity (its `value` is
    /// per-entity), so it must never be treated as a cacheable entity.
    /// Normalized caches key objects by the presence of an `id` field.
    async fn property_definition_id(&self) -> ID {
        ID(self.0.definition.id.to_string())
    }

    async fn display_name(&self) -> &str {
        &self.0.definition.display_name
    }

    async fn data_type(&self) -> GraphqlSoupDataType {
        self.0.definition.data_type.into()
    }

    async fn is_multi_select(&self) -> bool {
        self.0.definition.is_multi_select
    }

    async fn specific_entity_type(&self) -> Option<GraphqlSoupPropertyEntityType> {
        self.0
            .definition
            .specific_entity_type
            .map(GraphqlSoupPropertyEntityType::from)
    }

    async fn is_system(&self) -> bool {
        self.0.definition.is_system
    }

    async fn is_metadata(&self) -> bool {
        self.0.definition.is_metadata
    }

    async fn value(&self) -> Option<GraphqlSoupPropertyValue> {
        self.0.value.as_ref().map(GraphqlSoupPropertyValue::from)
    }
}

/// GraphQL representation of a property value.
#[derive(SimpleObject)]
pub struct GraphqlSoupPropertyValue {
    kind: String,
    bool_value: Option<bool>,
    number_value: Option<f64>,
    string_value: Option<String>,
    date_value: Option<String>,
    select_option_ids: Vec<ID>,
    entity_references: Vec<GraphqlSoupPropertyEntityReference>,
    links: Vec<String>,
}

impl From<&PropertyValue> for GraphqlSoupPropertyValue {
    fn from(value: &PropertyValue) -> Self {
        match value {
            PropertyValue::Bool(value) => Self {
                kind: "Boolean".to_owned(),
                bool_value: Some(*value),
                number_value: None,
                string_value: None,
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::Num(value) => Self {
                kind: "Number".to_owned(),
                bool_value: None,
                number_value: Some(*value),
                string_value: None,
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::Str(value) => Self {
                kind: "String".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: Some(value.clone()),
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::Date(value) => Self {
                kind: "Date".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: None,
                date_value: Some(value.to_rfc3339()),
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::SelectOption(values) => Self {
                kind: "SelectOption".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: None,
                date_value: None,
                select_option_ids: values.iter().map(|id| ID(id.to_string())).collect(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::EntityRef(values) => Self {
                kind: "EntityReference".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: None,
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: values
                    .iter()
                    .map(GraphqlSoupPropertyEntityReference::from)
                    .collect(),
                links: Vec::new(),
            },
            PropertyValue::Link(values) => Self {
                kind: "Link".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: None,
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: values.clone(),
            },
        }
    }
}

/// GraphQL entity reference stored in a property value.
#[derive(SimpleObject)]
pub struct GraphqlSoupPropertyEntityReference {
    entity_id: String,
    entity_type: GraphqlSoupPropertyEntityType,
    specific_message_id: Option<ID>,
}

/// GraphQL entity type supported by Soup properties.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlSoupPropertyEntityType {
    /// Channel entity.
    Channel,
    /// Chat entity.
    Chat,
    /// Company entity.
    Company,
    /// Document entity.
    Document,
    /// Project entity.
    Project,
    /// Task entity.
    Task,
    /// Thread entity.
    Thread,
    /// User entity.
    User,
}

impl From<models_properties::EntityType> for GraphqlSoupPropertyEntityType {
    fn from(entity: models_properties::EntityType) -> Self {
        match entity {
            models_properties::EntityType::Channel => Self::Channel,
            models_properties::EntityType::Chat => Self::Chat,
            models_properties::EntityType::Company => Self::Company,
            models_properties::EntityType::Document => Self::Document,
            models_properties::EntityType::Project => Self::Project,
            models_properties::EntityType::Task => Self::Task,
            models_properties::EntityType::Thread => Self::Thread,
            models_properties::EntityType::User => Self::User,
        }
    }
}

impl From<&models_properties::EntityReference> for GraphqlSoupPropertyEntityReference {
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
