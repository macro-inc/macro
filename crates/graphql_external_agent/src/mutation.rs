use async_graphql::{Context, ID, InputObject, Object};
use external_agents::domain::models::{AgentReply, RegisterExternalAgent};
use graphql_common::require_authenticated_user;

use crate::{
    ExternalAgentGraphqlContext, GraphqlExternalAgentEndpointChange,
    GraphqlExternalAgentEndpointVerification, GraphqlExternalAgentReply,
    GraphqlRegisteredExternalAgent, agent_error, context::require_agent, parse_agent_id,
    parse_uuid,
};

/// Register an external agent.
#[derive(Debug, InputObject)]
pub struct RegisterExternalAgentInput {
    /// Display name.
    pub name: String,
    /// `@` handle: lowercase letters, digits, `-` or `_`.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// Team that owns the agent; omit for an agent private to you.
    pub team_id: Option<ID>,
    /// HTTPS URL to push the agent's events to. Omit when its runtime polls
    /// `externalAgent.events` instead.
    pub endpoint_url: Option<String>,
}

/// Change where an external agent's events are pushed.
#[derive(Debug, InputObject)]
pub struct SetExternalAgentEndpointInput {
    /// The agent.
    pub agent_id: ID,
    /// New endpoint URL; null to stop pushing so its runtime polls instead.
    pub endpoint_url: Option<String>,
}

/// Answer one of the authenticated agent's events.
#[derive(Debug, InputObject)]
pub struct ReplyToExternalAgentEventInput {
    /// The event being answered.
    pub event_id: ID,
    /// Macro Markdown body.
    pub text: String,
    /// UUIDv7 you mint for this reply, so retrying cannot post it twice.
    pub message_id: Option<ID>,
}

/// Show or stop showing the authenticated agent typing.
#[derive(Debug, InputObject)]
pub struct SetExternalAgentTypingInput {
    /// The event the agent is answering.
    pub event_id: ID,
    /// Whether the agent is typing.
    pub active: bool,
}

/// External agent mutations: registration and management for their
/// owners, and answering for the agents themselves.
#[derive(Default)]
pub struct ExternalAgentMutationRoot;

#[Object]
impl ExternalAgentMutationRoot {
    /// Register an agent whose runtime lives outside Macro and mint its bot
    /// token. With an endpoint URL, Macro asks the endpoint to verify itself
    /// and pushes it the agent's events once it has.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn register_external_agent(
        &self,
        ctx: &Context<'_>,
        input: RegisterExternalAgentInput,
    ) -> async_graphql::Result<GraphqlRegisteredExternalAgent> {
        let viewer = require_authenticated_user(ctx)?;
        let registry = &ctx.data::<ExternalAgentGraphqlContext>()?.registry;
        let team_id = input
            .team_id
            .as_ref()
            .map(|id| parse_uuid(id, "teamId"))
            .transpose()?;
        let registered = registry
            .register(
                viewer,
                RegisterExternalAgent {
                    team_id,
                    name: input.name,
                    handle: input.handle,
                    description: input.description,
                    avatar_url: input.avatar_url,
                    endpoint_url: input.endpoint_url,
                },
            )
            .await
            .map_err(agent_error)?;
        Ok(registered.into())
    }

    /// Push an external agent's events to a new endpoint, which must verify
    /// itself again, or stop pushing them.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn set_external_agent_endpoint(
        &self,
        ctx: &Context<'_>,
        input: SetExternalAgentEndpointInput,
    ) -> async_graphql::Result<GraphqlExternalAgentEndpointChange> {
        let viewer = require_authenticated_user(ctx)?;
        let registry = &ctx.data::<ExternalAgentGraphqlContext>()?.registry;
        let change = registry
            .set_endpoint(viewer, parse_agent_id(&input.agent_id)?, input.endpoint_url)
            .await
            .map_err(agent_error)?;
        Ok(change.into())
    }

    /// Ask an external agent's endpoint to verify itself again.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn verify_external_agent_endpoint(
        &self,
        ctx: &Context<'_>,
        agent_id: ID,
    ) -> async_graphql::Result<GraphqlExternalAgentEndpointVerification> {
        let viewer = require_authenticated_user(ctx)?;
        let registry = &ctx.data::<ExternalAgentGraphqlContext>()?.registry;
        let verification = registry
            .verify_endpoint(viewer, parse_agent_id(&agent_id)?)
            .await
            .map_err(agent_error)?;
        Ok(verification.into())
    }

    /// Mint another bot token for an external agent. Earlier tokens keep
    /// working until revoked.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn issue_external_agent_token(
        &self,
        ctx: &Context<'_>,
        agent_id: ID,
    ) -> async_graphql::Result<String> {
        let viewer = require_authenticated_user(ctx)?;
        let registry = &ctx.data::<ExternalAgentGraphqlContext>()?.registry;
        registry
            .issue_token(viewer, parse_agent_id(&agent_id)?)
            .await
            .map_err(agent_error)
    }

    /// Delete an external agent, its endpoint, and its inbox. Answers with
    /// the deleted agent's id.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn delete_external_agent(
        &self,
        ctx: &Context<'_>,
        agent_id: ID,
    ) -> async_graphql::Result<ID> {
        let viewer = require_authenticated_user(ctx)?;
        let registry = &ctx.data::<ExternalAgentGraphqlContext>()?.registry;
        registry
            .delete(viewer, parse_agent_id(&agent_id)?)
            .await
            .map_err(agent_error)?;
        Ok(agent_id)
    }

    /// As the authenticated agent, answer one of its events. A direct
    /// message is answered in the conversation; a mention, in its thread.
    /// Call it once per message to send several.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn reply_to_external_agent_event(
        &self,
        ctx: &Context<'_>,
        input: ReplyToExternalAgentEventInput,
    ) -> async_graphql::Result<GraphqlExternalAgentReply> {
        let agent = require_agent(ctx)?;
        let api = &ctx.data::<ExternalAgentGraphqlContext>()?.api;
        let reply = api
            .reply(
                agent,
                AgentReply {
                    event_id: parse_uuid(&input.event_id, "eventId")?,
                    content: input.text,
                    message_id: input
                        .message_id
                        .as_ref()
                        .map(|id| parse_uuid(id, "messageId"))
                        .transpose()?,
                },
            )
            .await
            .map_err(agent_error)?;
        Ok(reply.into())
    }

    /// As the authenticated agent, show or stop showing it typing where its
    /// answer to the event will appear. Viewers stop seeing it after a few
    /// seconds without a renewal.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn set_external_agent_typing(
        &self,
        ctx: &Context<'_>,
        input: SetExternalAgentTypingInput,
    ) -> async_graphql::Result<bool> {
        let agent = require_agent(ctx)?;
        let api = &ctx.data::<ExternalAgentGraphqlContext>()?.api;
        api.set_typing(agent, parse_uuid(&input.event_id, "eventId")?, input.active)
            .await
            .map_err(agent_error)?;
        Ok(input.active)
    }
}
