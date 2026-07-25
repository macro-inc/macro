//! Legacy GraphQL bridge for property-aware Soup filters.
//!
//! Soup historically returned and filtered properties directly. New code
//! should avoid adding property concepts to Soup, and existing usages should
//! move toward the properties domain boundary so this module can be removed.

use async_graphql::{Enum, ID};
use filter_ast::Expr;
use item_filters::ast::properties::{
    EntityRefId, PropertiesLiteral, PropertyEntityType, PropertyMatchValue,
};

use crate::{IntoFilterExpr, filter_expr_input, parse_id};

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
            entity_type: self
                .entity_type
                .and_then(|et| PropertyEntityType::try_from(et).ok()),
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
    /// Convert the GraphQL property match value into its domain representation.
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

/// An entity type supported by the properties domain.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlPropertyEntityType {
    /// Call record entity.
    CallRecord,
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
            GraphqlPropertyEntityType::CallRecord => Self::CallRecord,
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

impl From<models_properties::EntityType> for GraphqlPropertyEntityType {
    fn from(value: models_properties::EntityType) -> Self {
        match value {
            models_properties::EntityType::CallRecord => Self::CallRecord,
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

impl TryFrom<GraphqlPropertyEntityType> for PropertyEntityType {
    type Error = GraphqlPropertyEntityType;

    fn try_from(value: GraphqlPropertyEntityType) -> Result<Self, Self::Error> {
        Ok(match value {
            GraphqlPropertyEntityType::Channel => Self::Channel,
            GraphqlPropertyEntityType::Chat => Self::Chat,
            GraphqlPropertyEntityType::Company => Self::Company,
            GraphqlPropertyEntityType::Document => Self::Document,
            GraphqlPropertyEntityType::Project => Self::Project,
            GraphqlPropertyEntityType::Task => Self::Task,
            GraphqlPropertyEntityType::Thread => Self::Thread,
            GraphqlPropertyEntityType::User => Self::User,
            // Call records are not part of the generic property-filter AST.
            // They are filtered through a dedicated call query instead.
            other @ GraphqlPropertyEntityType::CallRecord => return Err(other),
        })
    }
}
