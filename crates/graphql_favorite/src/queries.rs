use std::sync::Arc;

use async_graphql::Context;
use favorites::domain::{
    models::{Favorite, FavoritesError},
    ports::FavoritesService,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::{GraphqlFavorite, NoOpEntityFavoriteEdgeReader};

#[cfg(test)]
mod test;

/// Reader used by GraphQL user-scoped favorites queries.
pub trait FavoriteQueryReader: Send + Sync + 'static {
    /// List a user's favorites in manual order.
    fn list_favorites<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Favorite>, FavoritesError>> + Send + 'a;
}

impl<T> FavoriteQueryReader for Arc<T>
where
    T: FavoritesService,
{
    async fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        FavoritesService::list_favorites(self.as_ref(), user_id).await
    }
}

impl FavoriteQueryReader for NoOpEntityFavoriteEdgeReader {
    async fn list_favorites(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        Ok(Vec::new())
    }
}

/// Resolve the authenticated user's ordered favorites from GraphQL request data.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn resolve_favorites<R>(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
) -> async_graphql::Result<Vec<GraphqlFavorite>>
where
    R: FavoriteQueryReader,
{
    let reader = ctx.data::<R>()?;
    reader
        .list_favorites(user_id)
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
