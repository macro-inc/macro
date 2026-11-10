use async_graphql::{Context, ID, Object};
use graphql_common::require_authenticated_user;
use macro_uuid::Uuid;

use crate::{IdeasGraphqlContext, bad_input, idea_error, objects::GraphqlIdea};

#[cfg(test)]
mod test;

/// What the authenticated user does with their ideas. Each answers with the
/// idea as the write left it.
#[derive(Default)]
pub struct IdeasMutationRoot;

#[Object]
impl IdeasMutationRoot {
    /// Act on a proposed idea. A background prompt idea starts its run, or
    /// runs again when its last run failed; any other idea is marked
    /// accepted, and the client opens its prompt, draft or routine.
    #[tracing::instrument(skip_all, fields(idea.id = %idea_id.as_str()), err(Debug))]
    async fn accept_idea(
        &self,
        ctx: &Context<'_>,
        idea_id: ID,
    ) -> async_graphql::Result<GraphqlIdea> {
        let user = require_authenticated_user(ctx)?;
        let id = parse_id(&idea_id)?;
        let ideas = &ctx.data::<IdeasGraphqlContext>()?.0;
        ideas
            .accept(user, id)
            .await
            .map(Into::into)
            .map_err(idea_error)
    }

    /// The user isn't interested in an open idea; generation sessions see
    /// when.
    #[tracing::instrument(skip_all, fields(idea.id = %idea_id.as_str()), err(Debug))]
    async fn dismiss_idea(
        &self,
        ctx: &Context<'_>,
        idea_id: ID,
    ) -> async_graphql::Result<GraphqlIdea> {
        let user = require_authenticated_user(ctx)?;
        let id = parse_id(&idea_id)?;
        let ideas = &ctx.data::<IdeasGraphqlContext>()?.0;
        ideas
            .dismiss(user, id)
            .await
            .map(Into::into)
            .map_err(idea_error)
    }

    /// The user opened the app, in IANA time zone `timezone`: they are
    /// counted in for nightly generations, which run in their night. False
    /// when ideas are off for them.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn record_ideas_seen(
        &self,
        ctx: &Context<'_>,
        timezone: String,
    ) -> async_graphql::Result<bool> {
        let user = require_authenticated_user(ctx)?;
        let timezone: chrono_tz::Tz = timezone
            .parse()
            .map_err(|_| bad_input("timezone must be an IANA time zone name"))?;
        let ideas = &ctx.data::<IdeasGraphqlContext>()?.0;
        match ideas.seen(user, timezone).await {
            Ok(()) => Ok(true),
            Err(ideas::domain::model::IdeaError::NotFound) => Ok(false),
            Err(error) => Err(idea_error(error)),
        }
    }
}

fn parse_id(id: &ID) -> async_graphql::Result<Uuid> {
    id.parse().map_err(|_| bad_input("ideaId must be a UUID"))
}
