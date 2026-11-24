//! The viewer's tag sets: TAG-typed property definitions whose options are labels.

use async_graphql::{Context, Enum, Object, dataloader::DataLoader};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use properties::domain::model::{TagScope, TagSet};

use crate::{
    EntityPropertiesLoader, EntityPropertyReader, GraphqlPropertyDefinition, GraphqlPropertyOption,
    definitions::catalog_read_error,
};

/// Which owner a tag set belongs to.
#[derive(Enum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlTagScope {
    /// The viewer's personal tag set.
    User,
    /// The viewer's team tag set.
    Team,
}

impl From<TagScope> for GraphqlTagScope {
    fn from(scope: TagScope) -> Self {
        match scope {
            TagScope::User => Self::User,
            TagScope::Team => Self::Team,
        }
    }
}

/// A tag set the viewer can use. The team set is listed whenever the viewer is
/// on a team, so its presence says labels can be shared with the team.
pub struct GraphqlTagSet<R> {
    /// Owner of the set.
    scope: GraphqlTagScope,
    /// The set's definition; absent until its first label is created.
    definition: Option<GraphqlPropertyDefinition<R>>,
    /// Labels in the set, read with it.
    options: Vec<GraphqlPropertyOption>,
}

impl<R> From<TagSet> for GraphqlTagSet<R> {
    fn from(set: TagSet) -> Self {
        Self {
            scope: set.scope.into(),
            // The set read its labels already; hand them to the definition so
            // `definition { options }` reads nothing more.
            definition: set.definition.map(|definition| {
                PropertyDefinitionWithOptions {
                    definition,
                    property_options: set.options.clone(),
                }
                .into()
            }),
            options: set.options.into_iter().map(Into::into).collect(),
        }
    }
}

/// A tag set the viewer can use. The team set is listed whenever the viewer is
/// on a team, so its presence says labels can be shared with the team.
#[Object(name = "GraphqlTagSet")]
impl<R: EntityPropertyReader> GraphqlTagSet<R> {
    /// Owner of the set.
    async fn scope(&self) -> GraphqlTagScope {
        self.scope
    }

    /// The set's TAG-typed definition; null until its first label is created.
    async fn definition(&self) -> Option<&GraphqlPropertyDefinition<R>> {
        self.definition.as_ref()
    }

    /// Labels in the set, by display order then name.
    async fn options(&self) -> &[GraphqlPropertyOption] {
        &self.options
    }
}

/// Resolve the viewer's personal set, plus their team's set when on a team.
pub async fn load_tag_sets<R: EntityPropertyReader>(
    ctx: &Context<'_>,
) -> async_graphql::Result<Vec<GraphqlTagSet<R>>> {
    let loader = ctx.data::<DataLoader<EntityPropertiesLoader<R>>>()?;
    let sets = loader
        .loader()
        .tag_sets()
        .await
        .map_err(catalog_read_error)?;
    Ok(sets.into_iter().map(Into::into).collect())
}

#[cfg(test)]
mod test;
