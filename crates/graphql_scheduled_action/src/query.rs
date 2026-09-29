use async_graphql::Context;
use macro_user_id::user_id::MacroUserIdStr;

use super::context::ScheduledActionGraphqlContext;
use super::objects::{GraphqlScheduledAction, scheduled_action};
use super::unavailable;

#[cfg(test)]
mod test;

/// List routines owned by `user_id`.
pub async fn resolve_scheduled_actions(
    ctx: &Context<'_>,
    user_id: MacroUserIdStr<'static>,
) -> async_graphql::Result<Vec<GraphqlScheduledAction>> {
    let actions = ctx
        .data::<ScheduledActionGraphqlContext>()?
        .0
        .list_owned(user_id)
        .await
        .map_err(unavailable)?;
    actions
        .into_iter()
        .map(scheduled_action)
        .collect::<Result<Vec<_>, _>>()
        .map_err(unavailable)
}
