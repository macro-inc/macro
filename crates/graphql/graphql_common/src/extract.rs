use async_graphql::Context;
use axum::extract::FromRequestParts;

use crate::request_context::GraphqlRequestParts;

/// Run an axum extractor against the request parts stored in the GraphQL
/// context, using the embedding router state `St` also stored there.
pub async fn extract_part<T, St>(ctx: &Context<'_>) -> async_graphql::Result<T>
where
    T: FromRequestParts<St>,
    T::Rejection: std::fmt::Display,
    St: Clone + Send + Sync + 'static,
{
    let parts = ctx.data::<GraphqlRequestParts>()?;
    let state = ctx.data::<St>()?;
    parts
        .extract_with_state::<T, St>(state)
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))
}
