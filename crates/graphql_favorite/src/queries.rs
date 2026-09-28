use std::sync::Arc;

use async_graphql::{Context, ID, InputObject};
use favorites::domain::{
    models::{Favorite, FavoriteFilter, FavoritesError},
    ports::FavoritesService,
};
use graphql_common::GraphqlEntityType;
use macro_user_id::user_id::MacroUserIdStr;

use crate::{GraphqlFavorite, NoOpEntityFavoriteEdgeReader};

#[cfg(test)]
mod test;

/// Which of the authenticated user's favorites to return.
///
/// The two dimensions are independent. Values of one are alternatives, and
/// both must hold. An omitted or empty list constrains nothing, so the whole
/// collection is the default.
#[derive(Default, InputObject)]
pub struct FavoritesFilterInput {
    /// Restrict to favorites of these entity types.
    #[graphql(default)]
    pub entity_types: Vec<GraphqlEntityType>,
    /// Restrict to favorites with these entity ids.
    #[graphql(default)]
    pub entity_ids: Vec<ID>,
}

impl FavoritesFilterInput {
    /// Convert the transport input into the domain filter.
    pub fn into_model(self) -> FavoriteFilter {
        FavoriteFilter {
            entity_types: self
                .entity_types
                .into_iter()
                .map(GraphqlEntityType::into_model)
                .collect(),
            entity_ids: self.entity_ids.into_iter().map(|id| id.0).collect(),
        }
    }
}

/// Reader used by GraphQL user-scoped favorites queries.
pub trait FavoriteQueryReader: Send + Sync + 'static {
    /// List a user's favorites matching `filter`, in manual order.
    fn list_favorites<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
        filter: &'a FavoriteFilter,
    ) -> impl Future<Output = Result<Vec<Favorite>, FavoritesError>> + Send + 'a;
}

impl<T> FavoriteQueryReader for Arc<T>
where
    T: FavoritesService,
{
    async fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'static>,
        filter: &FavoriteFilter,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        FavoritesService::list_favorites(self.as_ref(), user_id, filter).await
    }
}

impl FavoriteQueryReader for NoOpEntityFavoriteEdgeReader {
    async fn list_favorites(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _filter: &FavoriteFilter,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        Ok(Vec::new())
    }
}

/// Resolve the authenticated user's ordered favorites from GraphQL request data.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn resolve_favorites<R>(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
    filter: FavoriteFilter,
) -> async_graphql::Result<Vec<GraphqlFavorite>>
where
    R: FavoriteQueryReader,
{
    let reader = ctx.data::<R>()?;
    reader
        .list_favorites(user_id, &filter)
        .await
        .map(|favorites| favorites.into_iter().map(GraphqlFavorite::new).collect())
        .map_err(|error| {
            tracing::error!(
                error = ?error,
                user_id = %user_id,
                "failed to load authenticated user's favorites"
            );
            async_graphql::Error::new("favorites are unavailable")
        })
}
