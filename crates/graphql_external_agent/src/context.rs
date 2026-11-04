use std::sync::Arc;

use async_graphql::{Context, ErrorExtensions};
use bot_id::BotId;
use external_agents::domain::ports::{ExternalAgentApi, ExternalAgentRegistry};

/// External agent services stored in GraphQL request data.
#[derive(Clone)]
pub struct ExternalAgentGraphqlContext {
    pub(crate) registry: Arc<dyn ExternalAgentRegistry>,
    pub(crate) api: Arc<dyn ExternalAgentApi>,
}

impl ExternalAgentGraphqlContext {
    /// Store the owners' registry and the agents' own API.
    pub fn new(registry: Arc<dyn ExternalAgentRegistry>, api: Arc<dyn ExternalAgentApi>) -> Self {
        Self { registry, api }
    }
}

/// The bot an external agent's runtime authenticated as, inserted into
/// request data by the mounting adapter in place of a user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GraphqlAgentPrincipal(pub BotId);

/// The authenticated agent, or an `UNAUTHENTICATED` error for anyone else.
pub(crate) fn require_agent(ctx: &Context<'_>) -> async_graphql::Result<BotId> {
    ctx.data_opt::<GraphqlAgentPrincipal>()
        .map(|principal| principal.0)
        .ok_or_else(|| {
            async_graphql::Error::new("agent authentication required").extend_with(
                |_, extensions| {
                    extensions.set("code", "UNAUTHENTICATED");
                },
            )
        })
}
