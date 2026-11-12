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
use serde::{Deserialize, Serialize};

use crate::{IntoFilterExpr, filter_expr_input, parse_id};

#[cfg(test)]
mod test;

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
        let literal = PropertiesLiteral {
            property_definition_id: parse_id(self.property_definition_id, "propertyDefinitionId")?,
            entity_type: self
                .entity_type
                .map(|entity_type| {
                    PropertyEntityType::try_from(entity_type).map_err(|unsupported| {
                        async_graphql::Error::new(format!(
                            "Property filtering is not supported for {unsupported:?}"
                        ))
                    })
                })
                .transpose()?,
            value: self.value.into_ast()?,
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input value used when matching a property.
#[derive(async_graphql::OneofObject)]
pub enum GraphqlPropertyMatchValue {
    /// Select option id to match.
    SelectOption(ID),
    /// Entity reference id to match.
    EntityRef(String),
    /// Match a DATE property in a UTC interval.
    DateRange(GraphqlPropertyDateRange),
}

/// UTC interval for a DATE property.
#[derive(async_graphql::InputObject)]
pub struct GraphqlPropertyDateRange {
    /// Inclusive start, or no lower bound.
    start: Option<String>,
    /// Exclusive end, or no upper bound.
    end: Option<String>,
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
            Self::DateRange(range) => {
                PropertyMatchValue::DateRange(item_filters::ast::properties::DateRange {
                    start: range
                        .start
                        .as_deref()
                        .map(chrono::DateTime::parse_from_rfc3339)
                        .transpose()
                        .map_err(|err| {
                            async_graphql::Error::new(format!("invalid dateRange.start: {err}"))
                        })?
                        .map(|value| value.with_timezone(&chrono::Utc)),
                    end: range
                        .end
                        .as_deref()
                        .map(chrono::DateTime::parse_from_rfc3339)
                        .transpose()
                        .map_err(|err| {
                            async_graphql::Error::new(format!("invalid dateRange.end: {err}"))
                        })?
                        .map(|value| value.with_timezone(&chrono::Utc)),
                })
            }
        })
    }
}

/// An entity type supported by the properties domain.
#[derive(Enum, Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GraphqlPropertyEntityType {
    /// Calendar event entity.
    CalendarEvent,
    /// Call record entity.
    CallRecord,
    /// Channel entity.
    Channel,
    /// Chat entity.
    Chat,
    /// Company entity.
    Company,
    /// Database row entity.
    DatabaseRow,
    /// CRM contact entity.
    Contact,
    /// Document entity.
    Document,
    /// Initiative entity.
    Initiative,
    /// Project entity.
    Project,
    /// Task entity.
    Task,
    /// Thread entity.
    Thread,
    /// User entity.
    User,
}

impl GraphqlPropertyEntityType {
    /// Construct a GraphQL property entity type from its properties-domain model.
    pub fn new(value: properties_types::EntityType) -> Self {
        match value {
            properties_types::EntityType::CalendarEvent => Self::CalendarEvent,
            properties_types::EntityType::CallRecord => Self::CallRecord,
            properties_types::EntityType::Channel => Self::Channel,
            properties_types::EntityType::Chat => Self::Chat,
            properties_types::EntityType::Company => Self::Company,
            properties_types::EntityType::DatabaseRow => Self::DatabaseRow,
            properties_types::EntityType::Contact => Self::Contact,
            properties_types::EntityType::Document => Self::Document,
            properties_types::EntityType::Initiative => Self::Initiative,
            properties_types::EntityType::Project => Self::Project,
            properties_types::EntityType::Task => Self::Task,
            properties_types::EntityType::Thread => Self::Thread,
            properties_types::EntityType::User => Self::User,
        }
    }

    /// Convert this GraphQL entity type into its properties-domain model.
    pub fn into_model(self) -> properties_types::EntityType {
        match self {
            Self::CalendarEvent => properties_types::EntityType::CalendarEvent,
            Self::CallRecord => properties_types::EntityType::CallRecord,
            Self::Channel => properties_types::EntityType::Channel,
            Self::Chat => properties_types::EntityType::Chat,
            Self::Company => properties_types::EntityType::Company,
            Self::DatabaseRow => properties_types::EntityType::DatabaseRow,
            Self::Contact => properties_types::EntityType::Contact,
            Self::Document => properties_types::EntityType::Document,
            Self::Initiative => properties_types::EntityType::Initiative,
            Self::Project => properties_types::EntityType::Project,
            Self::Task => properties_types::EntityType::Task,
            Self::Thread => properties_types::EntityType::Thread,
            Self::User => properties_types::EntityType::User,
        }
    }
}

impl TryFrom<GraphqlPropertyEntityType> for PropertyEntityType {
    type Error = GraphqlPropertyEntityType;

    fn try_from(value: GraphqlPropertyEntityType) -> Result<Self, Self::Error> {
        Ok(match value {
            GraphqlPropertyEntityType::CalendarEvent => Self::CalendarEvent,
            GraphqlPropertyEntityType::CallRecord => Self::CallRecord,
            GraphqlPropertyEntityType::Channel => Self::Channel,
            GraphqlPropertyEntityType::Chat => Self::Chat,
            GraphqlPropertyEntityType::Company => Self::Company,
            GraphqlPropertyEntityType::DatabaseRow => Self::DatabaseRow,
            GraphqlPropertyEntityType::Document => Self::Document,
            GraphqlPropertyEntityType::Project => Self::Project,
            GraphqlPropertyEntityType::Task => Self::Task,
            GraphqlPropertyEntityType::Thread => Self::Thread,
            GraphqlPropertyEntityType::User => Self::User,
            GraphqlPropertyEntityType::Initiative => Self::Initiative,
            other @ GraphqlPropertyEntityType::Contact => {
                return Err(other);
            }
        })
    }
}
