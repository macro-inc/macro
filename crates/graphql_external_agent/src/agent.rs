use async_graphql::{Context, ID, Object};
use bot_id::BotId;

use crate::{
    ExternalAgentGraphqlContext, GraphqlExternalAgentEvent, agent_error, context::require_agent,
    parse_uuid,
};

/// Events one inbox read returns when the caller names no limit.
const DEFAULT_EVENTS_PER_READ: u16 = 50;

/// The external agent a runtime authenticated as, with its bot token.
pub struct GraphqlExternalAgentViewer {
    bot_id: BotId,
}

impl GraphqlExternalAgentViewer {
    /// The authenticated agent, or an error for any other caller.
    pub fn resolve(ctx: &Context<'_>) -> async_graphql::Result<Self> {
        Ok(Self {
            bot_id: require_agent(ctx)?,
        })
    }
}

/// The authenticated external agent and its inbox.
#[Object]
impl GraphqlExternalAgentViewer {
    /// The agent's bot id.
    async fn id(&self) -> ID {
        ID(self.bot_id.to_string())
    }

    /// Messages that addressed the agent after the event `after`, oldest
    /// first: its direct messages and mentions. Poll with the last event's id
    /// as `after`; each event is also pushed to the agent's endpoint when it
    /// has one.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn events(
        &self,
        ctx: &Context<'_>,
        after: Option<ID>,
        #[graphql(validator(minimum = 1, maximum = 100))] limit: Option<i32>,
    ) -> async_graphql::Result<Vec<GraphqlExternalAgentEvent>> {
        let api = &ctx.data::<ExternalAgentGraphqlContext>()?.api;
        let after = after.as_ref().map(|id| parse_uuid(id, "after")).transpose()?;
        let limit = limit
            .and_then(|limit| u16::try_from(limit).ok())
            .unwrap_or(DEFAULT_EVENTS_PER_READ);
        let events = api
            .events(self.bot_id, after, limit)
            .await
            .map_err(agent_error)?;
        Ok(events.into_iter().map(Into::into).collect())
    }
}
