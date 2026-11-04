//! GraphQL inbound adapter for external agents: agent personas whose runtime
//! lives outside Macro.
//!
//! Two audiences share one schema. The people who own external agents
//! register and manage them through `GraphqlUser.externalAgents` and the
//! owner mutations. An agent's runtime, authenticated by its bot token,
//! reads its inbox through the root `externalAgent` viewer and answers
//! through `replyToExternalAgentEvent` and `setExternalAgentTyping`; no
//! user-scoped field resolves for it.
#![deny(missing_docs)]

mod agent;
mod context;
mod mutation;
mod objects;
mod user_query;

#[cfg(test)]
mod test;

pub use agent::GraphqlExternalAgentViewer;
pub use context::{ExternalAgentGraphqlContext, GraphqlAgentPrincipal};
pub use mutation::{
    ExternalAgentMutationRoot, RegisterExternalAgentInput, ReplyToExternalAgentEventInput,
    SetExternalAgentEndpointInput, SetExternalAgentTypingInput,
};
pub use objects::{
    GraphqlExternalAgent, GraphqlExternalAgentEndpoint, GraphqlExternalAgentEndpointChange,
    GraphqlExternalAgentEndpointVerification, GraphqlExternalAgentEvent,
    GraphqlExternalAgentEventKind, GraphqlExternalAgentReply, GraphqlRegisteredExternalAgent,
};
pub use user_query::GraphqlExternalAgentQuery;

use async_graphql::ErrorExtensions;
use external_agents::domain::ports::ExternalAgentError;

/// The GraphQL error for an external agent failure, with a stable
/// `extensions.code`. Internal details are logged, never returned.
pub(crate) fn agent_error(error: ExternalAgentError) -> async_graphql::Error {
    let (code, message) = match &error {
        ExternalAgentError::BadRequest(message) => ("BAD_USER_INPUT", message.clone()),
        ExternalAgentError::NotFound => ("NOT_FOUND", "not found".to_owned()),
        ExternalAgentError::Unauthorized => ("FORBIDDEN", "forbidden".to_owned()),
        ExternalAgentError::Conflict => (
            "CONFLICT",
            "a message with this id already exists".to_owned(),
        ),
        ExternalAgentError::Internal(report) => {
            tracing::error!(error = ?report, "external agent request failed");
            (
                "INTERNAL_SERVER_ERROR",
                "external agent request failed".to_owned(),
            )
        }
    };
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", code);
    })
}

pub(crate) fn bad_input(message: impl Into<String>) -> async_graphql::Error {
    async_graphql::Error::new(message.into()).extend_with(|_, extensions| {
        extensions.set("code", "BAD_USER_INPUT");
    })
}

/// Parse an external agent's id argument.
pub(crate) fn parse_agent_id(id: &async_graphql::ID) -> async_graphql::Result<bot_id::BotId> {
    bot_id::BotId::parse_uuid_str(id.as_str()).map_err(|_| bad_input("invalid agentId"))
}

/// Parse a UUID argument named `field`.
pub(crate) fn parse_uuid(id: &async_graphql::ID, field: &str) -> async_graphql::Result<uuid::Uuid> {
    uuid::Uuid::parse_str(id.as_str()).map_err(|_| bad_input(format!("invalid {field}")))
}
