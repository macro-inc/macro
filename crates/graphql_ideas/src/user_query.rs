use async_graphql::{Context, Object};
use ideas::domain::model::IdeaError;
use macro_user_id::user_id::MacroUserIdStr;

use crate::{IdeasGraphqlContext, idea_error, objects::GraphqlIdeaFeed};

#[cfg(test)]
mod test;

/// Flattenable ideas fields of the authenticated user.
pub struct GraphqlIdeasQuery {
    user_id: MacroUserIdStr<'static>,
}

impl GraphqlIdeasQuery {
    /// Ideas fields scoped to the authenticated `user_id`.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self { user_id }
    }
}

/// Ideas fields of the authenticated user.
#[Object]
impl GraphqlIdeasQuery {
    /// The user's ideas they can still open every item of, best first. Null
    /// when ideas are off for them.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn idea_feed(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<GraphqlIdeaFeed>> {
        let ideas = &ctx.data::<IdeasGraphqlContext>()?.0;
        match ideas.feed(self.user_id.clone()).await {
            Ok(feed) => Ok(Some(feed.into())),
            Err(IdeaError::NotFound) => Ok(None),
            Err(error) => Err(idea_error(error)),
        }
    }
}
