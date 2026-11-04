use async_graphql::Context;
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;

use crate::{
    context::{NotificationInboxGraphqlContext, to_graphql_error},
    inputs::NotificationInboxInput,
    objects::GraphqlNotificationInboxPage,
};

/// Resolve one page of `user`'s notification inbox.
pub async fn resolve_notification_inbox<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    input: NotificationInboxInput,
) -> async_graphql::Result<GraphqlNotificationInboxPage<E>> {
    let context = ctx.data::<NotificationInboxGraphqlContext>()?;
    let query = input.into_query()?;
    let viewer = context.viewer(user).await?;
    let page = context
        .service
        .page(viewer, query)
        .await
        .map_err(to_graphql_error)?;
    Ok(GraphqlNotificationInboxPage::new(page))
}
