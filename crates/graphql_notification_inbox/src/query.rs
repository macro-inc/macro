use async_graphql::{Context, ID};
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;

use crate::{
    context::{NotificationInboxGraphqlContext, to_graphql_error},
    inputs::{NotificationInboxInput, parse_clear_id},
    objects::{GraphqlNotificationInboxClear, GraphqlNotificationInboxPage},
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

/// Resolve `user`'s clears of their notification inbox: the one named by
/// `clear_id` when given (none once it is forgotten), otherwise every clear
/// and undo still running.
pub async fn resolve_notification_inbox_clears(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    clear_id: Option<ID>,
) -> async_graphql::Result<Vec<GraphqlNotificationInboxClear>> {
    let context = ctx.data::<NotificationInboxGraphqlContext>()?;
    let id = clear_id.as_ref().map(parse_clear_id).transpose()?;
    let viewer = context.viewer(user).await?;
    let clears = match id {
        Some(id) => context
            .service
            .clear_action(viewer, id)
            .await
            .map_err(to_graphql_error)?
            .into_iter()
            .collect(),
        None => context
            .service
            .running_clears(viewer)
            .await
            .map_err(to_graphql_error)?,
    };
    Ok(clears.into_iter().map(Into::into).collect())
}
