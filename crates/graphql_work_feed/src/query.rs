use async_graphql::Context;
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;

use crate::{
    context::{WorkFeedGraphqlContext, to_graphql_error},
    inputs::WorkFeedInput,
    objects::GraphqlWorkFeedPage,
};

/// Resolve one page of `user`'s work feed.
pub async fn resolve_work_feed<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    input: WorkFeedInput,
) -> async_graphql::Result<GraphqlWorkFeedPage<E>> {
    let context = ctx.data::<WorkFeedGraphqlContext>()?;
    let query = input.into_query()?;
    let viewer = context.viewer(user).await?;
    let page = context
        .service
        .page(viewer, query)
        .await
        .map_err(to_graphql_error)?;
    Ok(GraphqlWorkFeedPage::new(page))
}
