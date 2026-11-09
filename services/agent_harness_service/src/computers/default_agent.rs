//! The team coding agent a Macro computer comes with: created once, when the
//! computer first becomes ready, through the bots service as its buyer.

use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;

use bots::domain::models::{AgentChannelScope, AgentMcpServers, CreateAgentRequest};
use bots::domain::ports::{BotError, BotService, HarnessAssignments};
use harness_id::HarnessId;
use hosted_runtimes::domain::ports::DefaultAgent;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Bots' handle limit.
const MAX_HANDLE_LENGTH: usize = 64;
/// Claude Code's own model choice, as macrod lists it first.
const DEFAULT_MODEL: &str = "default";

/// The computer an agent is created for.
#[derive(Debug, Clone)]
pub struct DefaultAgentRequest {
    pub team_id: Uuid,
    pub buyer: MacroUserIdStr<'static>,
    pub computer_name: String,
    pub harness_id: HarnessId,
}

#[derive(Debug, thiserror::Error)]
pub enum DefaultAgentError {
    #[error(transparent)]
    Bots(#[from] BotError),
    #[error("could not read the harness's agents")]
    Assignments(#[source] Box<dyn std::error::Error + Send + Sync>),
}

/// Object-safe so `HostedHarnesses` stays one concrete type.
pub trait DefaultAgents: Send + Sync + 'static {
    fn create(
        &self,
        request: DefaultAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DefaultAgent, DefaultAgentError>> + Send + '_>>;
}

/// [`DefaultAgents`] over the bots crate.
pub struct BotDefaultAgents<Service, Assignments> {
    bots: Service,
    assignments: Assignments,
}

impl<Service, Assignments> BotDefaultAgents<Service, Assignments> {
    pub fn new(bots: Service, assignments: Assignments) -> Self {
        Self { bots, assignments }
    }
}

impl<Service, Assignments> BotDefaultAgents<Service, Assignments>
where
    Service: BotService,
    Assignments: HarnessAssignments + Send + Sync + 'static,
{
    async fn create_agent(
        &self,
        request: DefaultAgentRequest,
    ) -> Result<DefaultAgent, DefaultAgentError> {
        let bound = self
            .assignments
            .bots_on_harness(request.harness_id)
            .await
            .map_err(|error| DefaultAgentError::Assignments(Box::new(error)))?;
        if !bound.is_empty() {
            return Ok(DefaultAgent::AlreadyBound);
        }

        let name = format!("Claude Code · {}", request.computer_name);
        let taken: HashSet<String> = self
            .bots
            .list_agents(request.buyer.clone())
            .await?
            .into_iter()
            .map(|agent| agent.bot.handle)
            .collect();
        let handle = unique_handle(&name, &taken);

        // The same defaults the Agents settings editor starts a macrod
        // coding agent with.
        self.bots
            .create_agent(
                request.buyer,
                CreateAgentRequest {
                    team_id: Some(request.team_id),
                    harness_id: Some(request.harness_id),
                    name,
                    handle,
                    description: None,
                    avatar_url: None,
                    instructions: String::new(),
                    harness: harness_id::MACROD_HARNESS_SLUG.to_owned(),
                    default_model: DEFAULT_MODEL.to_owned(),
                    channel_scope: AgentChannelScope::All,
                    channel_ids: Vec::new(),
                    mcp: AgentMcpServers::default(),
                    auto_accept_permissions: Some(false),
                    is_coding: true,
                },
            )
            .await?;
        Ok(DefaultAgent::Created)
    }
}

impl<Service, Assignments> DefaultAgents for BotDefaultAgents<Service, Assignments>
where
    Service: BotService,
    Assignments: HarnessAssignments + Send + Sync + 'static,
    Assignments::Err: 'static,
{
    fn create(
        &self,
        request: DefaultAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DefaultAgent, DefaultAgentError>> + Send + '_>> {
        Box::pin(self.create_agent(request))
    }
}

/// The settings editor's slug of `name` (lowercase; runs of anything else
/// become `-`), suffixed `-2`, `-3`, … past handles the buyer already sees.
fn unique_handle(name: &str, taken: &HashSet<String>) -> String {
    let mut slug = String::new();
    for character in name.to_lowercase().chars() {
        if character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '_'
            || character == '-'
        {
            slug.push(character);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');

    let mut suffix = 1;
    loop {
        let ending = if suffix == 1 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let mut base = slug.to_owned();
        base.truncate(MAX_HANDLE_LENGTH - ending.len());
        let handle = format!("{}{ending}", base.trim_end_matches('-'));
        if !taken.contains(&handle) {
            return handle;
        }
        suffix += 1;
    }
}

#[cfg(test)]
mod test;
