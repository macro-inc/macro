use async_graphql::{Context, Object};
use macro_user_id::user_id::MacroUserIdStr;

use crate::{ExternalAgentGraphqlContext, GraphqlExternalAgent, agent_error};

/// Flattenable external agent fields of the authenticated user.
pub struct GraphqlExternalAgentQuery {
    user_id: MacroUserIdStr<'static>,
}

impl GraphqlExternalAgentQuery {
    /// External agent fields scoped to the authenticated `user_id`.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self { user_id }
    }
}

/// External agent fields of the authenticated user.
#[Object]
impl GraphqlExternalAgentQuery {
    /// The external agents the viewer may manage: their own, and their team's.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn external_agents(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlExternalAgent>> {
        let registry = &ctx.data::<ExternalAgentGraphqlContext>()?.registry;
        let agents = registry
            .list(self.user_id.clone())
            .await
            .map_err(agent_error)?;
        Ok(agents.into_iter().map(Into::into).collect())
    }
}
