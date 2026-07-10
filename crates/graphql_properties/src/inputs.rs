use async_graphql::{Enum, ID};
use filter_ast::Expr;
use graphql_common::{IntoFilterExpr, filter_expr_input, parse_id};
use item_filters::ast::properties::{
    EntityRefId, PropertiesLiteral, PropertyEntityType, PropertyMatchValue,
};

filter_expr_input!(
    GraphqlPropertiesExpr,
    GraphqlPropertiesBinaryExpr,
    GraphqlPropertiesLiteral,
    PropertiesLiteral,
    "PropertiesFilterExpr"
);

/// GraphQL input for matching a property value on an entity.
#[derive(async_graphql::InputObject)]
pub struct GraphqlPropertiesLiteral {
    /// Property definition id to match.
    property_definition_id: ID,
    /// Optional entity type scope for the property match.
    entity_type: Option<GraphqlPropertyEntityType>,
    /// Value to compare against the property.
    value: GraphqlPropertyMatchValue,
}

impl IntoFilterExpr<PropertiesLiteral> for GraphqlPropertiesLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<PropertiesLiteral>> {
        Ok(Expr::val(PropertiesLiteral {
            property_definition_id: parse_id(self.property_definition_id, "propertyDefinitionId")?,
            entity_type: self.entity_type.map(Into::into),
            value: self.value.into_ast()?,
        }))
    }
}

/// GraphQL input value used when matching a property.
#[derive(async_graphql::OneofObject)]
pub enum GraphqlPropertyMatchValue {
    /// Select option id to match.
    SelectOption(ID),
    /// Entity reference id to match.
    EntityRef(String),
}

impl GraphqlPropertyMatchValue {
    fn into_ast(self) -> async_graphql::Result<PropertyMatchValue> {
        Ok(match self {
            Self::SelectOption(id) => {
                PropertyMatchValue::SelectOption(parse_id(id, "selectOption")?)
            }
            Self::EntityRef(value) => {
                PropertyMatchValue::EntityRef(EntityRefId::new(value).map_err(|err| {
                    async_graphql::Error::new(format!("invalid entityRef: {err}"))
                })?)
            }
        })
    }
}

/// GraphQL entity type supported by property filters.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlPropertyEntityType {
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

impl From<GraphqlPropertyEntityType> for models_properties::EntityType {
    fn from(value: GraphqlPropertyEntityType) -> Self {
        match value {
            GraphqlPropertyEntityType::Channel => Self::Channel,
            GraphqlPropertyEntityType::Chat => Self::Chat,
            GraphqlPropertyEntityType::Company => Self::Company,
            GraphqlPropertyEntityType::Document => Self::Document,
            GraphqlPropertyEntityType::Project => Self::Project,
            GraphqlPropertyEntityType::Task => Self::Task,
            GraphqlPropertyEntityType::Thread => Self::Thread,
            GraphqlPropertyEntityType::User => Self::User,
        }
    }
}

impl From<GraphqlPropertyEntityType> for PropertyEntityType {
    fn from(value: GraphqlPropertyEntityType) -> Self {
        match value {
            GraphqlPropertyEntityType::Channel => Self::Channel,
            GraphqlPropertyEntityType::Chat => Self::Chat,
            GraphqlPropertyEntityType::Company => Self::Company,
            GraphqlPropertyEntityType::Document => Self::Document,
            GraphqlPropertyEntityType::Project => Self::Project,
            GraphqlPropertyEntityType::Task => Self::Task,
            GraphqlPropertyEntityType::Thread => Self::Thread,
            GraphqlPropertyEntityType::User => Self::User,
        }
    }
}
