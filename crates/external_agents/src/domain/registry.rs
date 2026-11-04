//! Registering and managing external agents.
//!
//! An external agent is an agent persona (kept by bots), a registration
//! holding its inbox, and optionally a webhook endpoint its events are
//! pushed to (kept by webhook). Registration creates them together; a
//! failure part way removes what it created, so none is left without the
//! others.

#[cfg(test)]
mod test;

use bot_id::BotId;
use bots::domain::models::{Agent, AgentChannelScope, AgentMcpServers, CreateAgentRequest};
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{
    AgentEndpoint, EXTERNAL_AGENT_MODEL, EndpointChange, EndpointVerification, ExternalAgent,
    RegisterExternalAgent, RegisteredExternalAgent,
};
use super::ports::{
    AgentEndpoints, AgentPersonas, CreatedEndpoint, ExternalAgentError, ExternalAgentRegistry,
    ExternalAgentRepo, ExternalAgentRow, Result,
};

/// Registers external agents over the persona, endpoint, and inbox ports.
pub struct ExternalAgentRegistryService<P, E, R> {
    personas: P,
    endpoints: E,
    repo: R,
}

impl<P, E, R> ExternalAgentRegistryService<P, E, R> {
    /// Compose the owning domains' ports.
    pub fn new(personas: P, endpoints: E, repo: R) -> Self {
        Self {
            personas,
            endpoints,
            repo,
        }
    }
}

fn is_external(agent: &Agent) -> bool {
    agent.bot.has_agent && agent.harness == harness_id::EXTERNAL_HARNESS_SLUG
}

fn agent_request(req: &RegisterExternalAgent) -> CreateAgentRequest {
    CreateAgentRequest {
        team_id: req.team_id,
        harness_id: None,
        name: req.name.clone(),
        handle: req.handle.clone(),
        description: req.description.clone(),
        avatar_url: req.avatar_url.clone(),
        instructions: String::new(),
        harness: harness_id::EXTERNAL_HARNESS_SLUG.to_owned(),
        default_model: EXTERNAL_AGENT_MODEL.to_owned(),
        channel_scope: AgentChannelScope::All,
        channel_ids: Vec::new(),
        mcp: AgentMcpServers::OwnerConnections,
        auto_accept_permissions: None,
        is_coding: false,
    }
}

/// A URL the caller supplied, trimmed; blank means none.
fn endpoint_url(url: Option<String>) -> Option<String> {
    url.map(|url| url.trim().to_owned())
        .filter(|url| !url.is_empty())
}

impl<P, E, R> ExternalAgentRegistryService<P, E, R>
where
    P: AgentPersonas,
    E: AgentEndpoints,
    R: ExternalAgentRepo,
{
    /// A manageable, registered agent on the external harness.
    async fn external(
        &self,
        caller: &MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<(Agent, ExternalAgentRow)> {
        let agent = self.personas.manageable(caller.clone(), bot_id).await?;
        if !is_external(&agent) {
            return Err(ExternalAgentError::NotFound);
        }
        let row = self
            .repo
            .get(&[bot_id])
            .await?
            .into_iter()
            .next()
            .ok_or(ExternalAgentError::NotFound)?;
        Ok((agent, row))
    }

    async fn endpoint_of(
        &self,
        caller: &MacroUserIdStr<'static>,
        row: &ExternalAgentRow,
    ) -> Result<Option<AgentEndpoint>> {
        match &row.webhook_id {
            Some(webhook_id) => self.endpoints.get(caller.clone(), webhook_id).await,
            None => Ok(None),
        }
    }

    /// The endpoint after asking it to verify itself. A request that could
    /// not be sent leaves it unverified rather than failing the write that
    /// preceded it; the owner can verify again.
    async fn verified(
        &self,
        caller: &MacroUserIdStr<'static>,
        endpoint: AgentEndpoint,
    ) -> AgentEndpoint {
        match self
            .endpoints
            .verify(caller.clone(), &endpoint.webhook_id)
            .await
        {
            Ok(check) => AgentEndpoint {
                verified: check.verified,
                ..endpoint
            },
            Err(error) => {
                tracing::warn!(error = ?error, webhook_id = %endpoint.webhook_id, "external agent endpoint verification failed");
                endpoint
            }
        }
    }

    async fn discard_endpoint(&self, caller: &MacroUserIdStr<'static>, webhook_id: &str) {
        if let Err(error) = self.endpoints.delete(caller.clone(), webhook_id).await {
            tracing::error!(error = ?error, %webhook_id, "could not remove an external agent endpoint");
        }
    }

    /// A new endpoint for `agent`, linked to its registration. An endpoint
    /// that cannot be linked is removed again.
    async fn link_new_endpoint(
        &self,
        caller: &MacroUserIdStr<'static>,
        agent: &Agent,
        url: String,
    ) -> Result<CreatedEndpoint> {
        let owner = agent.bot.owner.as_ref().ok_or_else(|| {
            ExternalAgentError::Internal(rootcause::report!("an owned agent has no owner"))
        })?;
        let created = self
            .endpoints
            .create(caller.clone(), owner, agent.bot.id, &agent.bot.name, url)
            .await?;
        if let Err(error) = self
            .repo
            .set_webhook(agent.bot.id, Some(&created.endpoint.webhook_id))
            .await
        {
            self.discard_endpoint(caller, &created.endpoint.webhook_id)
                .await;
            return Err(error);
        }
        Ok(created)
    }

    /// Everything registration needs once the persona exists.
    async fn provision(
        &self,
        caller: &MacroUserIdStr<'static>,
        agent: &Agent,
        url: Option<String>,
    ) -> Result<(String, Option<CreatedEndpoint>)> {
        let bot_token = self
            .personas
            .issue_token(caller.clone(), agent.bot.id)
            .await?;
        self.repo.register(agent.bot.id, None).await?;
        let created = match url {
            Some(url) => Some(self.link_new_endpoint(caller, agent, url).await?),
            None => None,
        };
        Ok((bot_token, created))
    }
}

#[async_trait::async_trait]
impl<P, E, R> ExternalAgentRegistry for ExternalAgentRegistryService<P, E, R>
where
    P: AgentPersonas,
    E: AgentEndpoints,
    R: ExternalAgentRepo,
{
    #[tracing::instrument(skip_all, fields(bot_id = tracing::field::Empty), err)]
    async fn register(
        &self,
        caller: MacroUserIdStr<'static>,
        req: RegisterExternalAgent,
    ) -> Result<RegisteredExternalAgent> {
        let agent = self
            .personas
            .create(caller.clone(), agent_request(&req))
            .await?;
        tracing::Span::current().record("bot_id", tracing::field::display(agent.bot.id));
        let (bot_token, created) = match self
            .provision(&caller, &agent, endpoint_url(req.endpoint_url))
            .await
        {
            Ok(provisioned) => provisioned,
            Err(error) => {
                if let Err(cleanup) = self.repo.remove(agent.bot.id).await {
                    tracing::error!(error = ?cleanup, bot_id = %agent.bot.id, "could not remove the registration of an agent whose registration failed");
                }
                if let Err(cleanup) = self.personas.delete(caller.clone(), agent.bot.id).await {
                    tracing::error!(error = ?cleanup, bot_id = %agent.bot.id, "could not remove an agent whose registration failed");
                }
                return Err(error);
            }
        };
        let (endpoint, signing_secret) = match created {
            Some(created) => (
                Some(self.verified(&caller, created.endpoint).await),
                Some(created.signing_secret),
            ),
            None => (None, None),
        };
        Ok(RegisteredExternalAgent {
            agent: ExternalAgent {
                bot: agent.bot,
                endpoint,
            },
            bot_token,
            signing_secret,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn list(&self, caller: MacroUserIdStr<'static>) -> Result<Vec<ExternalAgent>> {
        let agents: Vec<Agent> = self
            .personas
            .list(caller.clone())
            .await?
            .into_iter()
            .filter(is_external)
            .collect();
        let ids: Vec<BotId> = agents.iter().map(|agent| agent.bot.id).collect();
        let rows = self.repo.get(&ids).await?;
        futures::future::try_join_all(agents.into_iter().filter_map(|agent| {
            let row = rows.iter().find(|row| row.bot_id == agent.bot.id)?.clone();
            let caller = caller.clone();
            Some(async move {
                Ok(ExternalAgent {
                    endpoint: self.endpoint_of(&caller, &row).await?,
                    bot: agent.bot,
                })
            })
        }))
        .await
    }

    #[tracing::instrument(skip(self, caller, url), err)]
    async fn set_endpoint(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        url: Option<String>,
    ) -> Result<EndpointChange> {
        let (agent, row) = self.external(&caller, bot_id).await?;
        let current = self.endpoint_of(&caller, &row).await?;
        let (endpoint, signing_secret) = match (current, endpoint_url(url)) {
            (Some(current), Some(url)) => {
                let moved = self
                    .endpoints
                    .set_url(caller.clone(), &current.webhook_id, url)
                    .await?;
                (Some(self.verified(&caller, moved).await), None)
            }
            (None, Some(url)) => {
                let created = self.link_new_endpoint(&caller, &agent, url).await?;
                (
                    Some(self.verified(&caller, created.endpoint).await),
                    Some(created.signing_secret),
                )
            }
            // Unlinked first, so nothing more is pushed even if the webhook
            // itself cannot be removed.
            (current, None) => {
                self.repo.set_webhook(bot_id, None).await?;
                if let Some(current) = current {
                    self.discard_endpoint(&caller, &current.webhook_id).await;
                }
                (None, None)
            }
        };
        Ok(EndpointChange {
            agent: ExternalAgent {
                bot: agent.bot,
                endpoint,
            },
            signing_secret,
        })
    }

    #[tracing::instrument(skip(self, caller), err)]
    async fn verify_endpoint(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<EndpointVerification> {
        let (agent, row) = self.external(&caller, bot_id).await?;
        let endpoint = self
            .endpoint_of(&caller, &row)
            .await?
            .ok_or(ExternalAgentError::NotFound)?;
        let check = self
            .endpoints
            .verify(caller.clone(), &endpoint.webhook_id)
            .await?;
        Ok(EndpointVerification {
            agent: ExternalAgent {
                bot: agent.bot,
                endpoint: Some(AgentEndpoint {
                    verified: check.verified,
                    ..endpoint
                }),
            },
            response_status: check.response_status,
            message: check.message,
        })
    }

    #[tracing::instrument(skip(self, caller), err)]
    async fn issue_token(&self, caller: MacroUserIdStr<'static>, bot_id: BotId) -> Result<String> {
        self.external(&caller, bot_id).await?;
        self.personas.issue_token(caller, bot_id).await
    }

    /// The agent goes first: its delete policy is the stricter one, and once
    /// it is gone nothing addresses it, so what a failed later step leaves
    /// behind receives nothing.
    #[tracing::instrument(skip(self, caller), err)]
    async fn delete(&self, caller: MacroUserIdStr<'static>, bot_id: BotId) -> Result<()> {
        let (_, row) = self.external(&caller, bot_id).await?;
        self.personas.delete(caller.clone(), bot_id).await?;
        if let Err(error) = self.repo.remove(bot_id).await {
            tracing::error!(error = ?error, %bot_id, "could not remove a deleted external agent's inbox");
        }
        if let Some(webhook_id) = row.webhook_id {
            self.discard_endpoint(&caller, &webhook_id).await;
        }
        Ok(())
    }
}
