//! Typed property definition and option reads through the properties domain.

use std::marker::PhantomData;

use async_graphql::{Context, Enum, ID, Object, SimpleObject, Union, dataloader::DataLoader};
use graphql_common::{GraphqlPropertyEntityType, parse_id};
use models_properties::{
    PropertyOwner,
    service::{
        property_definition::PropertyDefinition,
        property_option::{PropertyOption, PropertyOptionValue},
    },
};

use crate::{EntityPropertiesLoader, EntityPropertyReader, GraphqlPropertyDataType};

/// Which authenticated-caller property definitions to list.
#[derive(Enum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlPropertyDefinitionScope {
    /// Definitions owned by the viewer.
    User,
    /// Definitions owned by the viewer's team.
    Team,
    /// System definitions shared by all viewers.
    System,
    /// The viewer's personal, team, and system definitions.
    All,
}

/// The kind of principal owning a property definition.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlPropertyOwnerScope {
    /// A personal definition.
    User,
    /// A team definition.
    Team,
    /// A system definition.
    System,
}

/// Ownership facts embedded in a property definition.
#[derive(SimpleObject)]
pub struct GraphqlPropertyDefinitionOwner {
    /// Kind of owning principal.
    scope: GraphqlPropertyOwnerScope,
    /// User or team identifier; absent for system definitions.
    principal_id: Option<String>,
}

impl From<&PropertyOwner> for GraphqlPropertyDefinitionOwner {
    fn from(owner: &PropertyOwner) -> Self {
        let (scope, principal_id) = match owner {
            PropertyOwner::User { user_id } => {
                (GraphqlPropertyOwnerScope::User, Some(user_id.clone()))
            }
            PropertyOwner::Team { team_id } => {
                (GraphqlPropertyOwnerScope::Team, Some(team_id.to_string()))
            }
            PropertyOwner::System => (GraphqlPropertyOwnerScope::System, None),
        };
        Self {
            scope,
            principal_id,
        }
    }
}

/// A globally identified property definition, independent of any assignment.
pub struct GraphqlPropertyDefinition<R> {
    /// Definition returned by the owning domain service.
    definition: PropertyDefinition,
    /// Reader used only if the options edge is selected.
    reader: PhantomData<R>,
}

/// A globally identified property definition, independent of any assignment.
#[Object(name = "GraphqlPropertyDefinition")]
impl<R: EntityPropertyReader> GraphqlPropertyDefinition<R> {
    /// Global identity of the shared definition, not an entity assignment.
    async fn id(&self) -> ID {
        ID(self.definition.id.to_string())
    }

    /// Principal owning the definition.
    async fn owner(&self) -> GraphqlPropertyDefinitionOwner {
        (&self.definition.owner).into()
    }

    /// User-visible property name.
    async fn display_name(&self) -> &str {
        &self.definition.display_name
    }

    /// The type of value accepted by this property.
    async fn data_type(&self) -> GraphqlPropertyDataType {
        GraphqlPropertyDataType::new(self.definition.data_type)
    }

    /// Whether more than one selected value is supported.
    async fn is_multi_select(&self) -> bool {
        self.definition.is_multi_select
    }

    /// Entity-reference type constraint, if any.
    async fn specific_entity_type(&self) -> Option<GraphqlPropertyEntityType> {
        self.definition
            .specific_entity_type
            .map(GraphqlPropertyEntityType::new)
    }

    /// Whether the system manages this definition.
    async fn is_system(&self) -> bool {
        self.definition.is_system
    }

    /// Whether the property represents generated entity metadata.
    async fn is_metadata(&self) -> bool {
        self.definition.is_metadata
    }

    /// When this definition was created, as RFC 3339.
    async fn created_at(&self) -> String {
        self.definition.created_at.to_rfc3339()
    }

    /// When this definition last changed, as RFC 3339.
    async fn updated_at(&self) -> String {
        self.definition.updated_at.to_rfc3339()
    }

    /// Selectable options, loaded only when requested.
    async fn options(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlPropertyOption>> {
        load_property_options::<R>(ctx, ID(self.definition.id.to_string())).await
    }
}

/// A globally identified selectable option belonging to one property definition.
#[derive(SimpleObject)]
pub struct GraphqlPropertyOption {
    /// Stable global identity of this selectable option.
    id: ID,
    /// Definition to which the option belongs.
    property_definition_id: ID,
    /// Ordering within the definition's available options.
    display_order: i32,
    /// Typed option value.
    value: GraphqlPropertyOptionValue,
    /// Optional display color.
    color: Option<String>,
    /// Creation time as RFC 3339.
    created_at: String,
    /// Last update time as RFC 3339.
    updated_at: String,
}

impl From<PropertyOption> for GraphqlPropertyOption {
    fn from(option: PropertyOption) -> Self {
        Self {
            id: ID(option.id.to_string()),
            property_definition_id: ID(option.property_definition_id.to_string()),
            display_order: option.display_order,
            value: match option.value {
                PropertyOptionValue::String(value) => {
                    GraphqlPropertyOptionValue::String(GraphqlStringPropertyOptionValue { value })
                }
                PropertyOptionValue::Number(value) => {
                    GraphqlPropertyOptionValue::Number(GraphqlNumberPropertyOptionValue { value })
                }
            },
            color: option.color,
            created_at: option.created_at.to_rfc3339(),
            updated_at: option.updated_at.to_rfc3339(),
        }
    }
}

/// Exactly one of the supported option value types.
#[derive(Union)]
pub enum GraphqlPropertyOptionValue {
    /// String select option.
    String(GraphqlStringPropertyOptionValue),
    /// Numeric select option.
    Number(GraphqlNumberPropertyOptionValue),
}

/// Text stored by a string select option.
#[derive(SimpleObject)]
pub struct GraphqlStringPropertyOptionValue {
    /// Stored text.
    value: String,
}

/// Number stored by a numeric select option.
#[derive(SimpleObject)]
pub struct GraphqlNumberPropertyOptionValue {
    /// Stored number.
    value: f64,
}

/// Resolve a viewer's definitions through the request-scoped authenticated reader.
pub async fn load_property_definitions<R: EntityPropertyReader>(
    ctx: &Context<'_>,
    scope: GraphqlPropertyDefinitionScope,
    for_entity_type: Option<GraphqlPropertyEntityType>,
) -> async_graphql::Result<Vec<GraphqlPropertyDefinition<R>>> {
    let loader = ctx.data::<DataLoader<EntityPropertiesLoader<R>>>()?;
    let definitions = loader
        .loader()
        .definitions(
            scope,
            for_entity_type.map(GraphqlPropertyEntityType::into_model),
        )
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))?;
    Ok(definitions
        .into_iter()
        .map(|definition| GraphqlPropertyDefinition {
            definition,
            reader: PhantomData,
        })
        .collect())
}

/// Resolve options after the owning domain checks definition visibility.
pub async fn load_property_options<R: EntityPropertyReader>(
    ctx: &Context<'_>,
    property_definition_id: ID,
) -> async_graphql::Result<Vec<GraphqlPropertyOption>> {
    let definition_id = parse_id(property_definition_id, "propertyDefinitionId")?;
    let loader = ctx.data::<DataLoader<EntityPropertiesLoader<R>>>()?;
    let options = loader
        .loader()
        .options(definition_id)
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))?;
    Ok(options.into_iter().map(Into::into).collect())
}

#[cfg(test)]
mod test;
