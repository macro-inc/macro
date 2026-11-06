//! Runtime and agent settings for stopping a session's permission requests,
//! read and changed through the harnesses and bots domains so each change is
//! authorized by the rule its own settings route applies.

use agent_harness::domain::runtime_bypass::{
    RuntimeBypassError, RuntimeBypassFacts, RuntimeBypassSettings,
};
use bot_id::BotId;
use bots::domain::models::PatchAgentRequest;
use bots::domain::ports::{BotError, BotRepo, BotService};
use bots::outbound::pg_bots_repo::PgBotsRepo;
use harness_id::HarnessId;
use harnesses::domain::models::PatchHarnessRequest;
use harnesses::domain::ports::{HarnessError, HarnessRepo, HarnessService};
use harnesses::domain::service::HarnessServiceImpl;
use macro_user_id::user_id::MacroUserIdStr;

/// [`RuntimeBypassSettings`] over the harnesses and bots domains.
pub struct DomainRuntimeBypassSettings<Bots, Harnesses> {
    agents: PgBotsRepo,
    bots: Bots,
    harnesses: HarnessServiceImpl<Harnesses>,
}

impl<Bots, Harnesses> DomainRuntimeBypassSettings<Bots, Harnesses> {
    /// Read agents from `agents`, change them through `bots`, and read and
    /// change runtimes through the harness domain over `harnesses`.
    pub fn new(agents: PgBotsRepo, bots: Bots, harnesses: Harnesses) -> Self {
        Self {
            agents,
            bots,
            harnesses: HarnessServiceImpl::new(harnesses),
        }
    }
}

#[async_trait::async_trait]
impl<Bots, Harnesses> RuntimeBypassSettings for DomainRuntimeBypassSettings<Bots, Harnesses>
where
    Bots: BotService,
    Harnesses: HarnessRepo,
{
    #[tracing::instrument(name = "agent_session.runtime_bypass.facts", skip(self), err)]
    async fn facts(
        &self,
        caller: &MacroUserIdStr<'static>,
        bot: BotId,
    ) -> anyhow::Result<Option<RuntimeBypassFacts>> {
        let Some(agent) = self.agents.get_agent(bot).await? else {
            return Ok(None);
        };
        let Some(harness) = agent.harness_id else {
            return Ok(None);
        };
        let Some(runtime) = self.agents.get_harness_facts(harness).await? else {
            return Ok(None);
        };
        let caller_manages_runtime = self.harnesses.may_manage(caller, harness).await?;
        let caller_manages_agent = match self.bots.manageable_agent(caller.clone(), bot).await {
            Ok(_) => true,
            Err(BotError::Unauthorized | BotError::NotFound(_)) => false,
            Err(error) => return Err(error.into()),
        };
        Ok(Some(RuntimeBypassFacts {
            harness,
            runtime_allows_bypass: runtime.allow_permission_bypass,
            caller_manages_runtime,
            agent_auto_accepts: agent.auto_accept_permissions == Some(true),
            caller_manages_agent,
        }))
    }

    #[tracing::instrument(name = "agent_session.runtime_bypass.allow_runtime", skip(self), err)]
    async fn allow_runtime_bypass(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> Result<(), RuntimeBypassError> {
        self.harnesses
            .patch_harness(
                caller.clone(),
                harness,
                PatchHarnessRequest {
                    name: None,
                    allow_permission_bypass: Some(true),
                },
            )
            .await
            .map(drop)
            .map_err(|error| match error {
                HarnessError::Unauthorized => RuntimeBypassError::Forbidden,
                error => RuntimeBypassError::Settings(error.into()),
            })
    }

    #[tracing::instrument(
        name = "agent_session.runtime_bypass.auto_accept_agent",
        skip(self),
        err
    )]
    async fn auto_accept_permissions(
        &self,
        caller: &MacroUserIdStr<'static>,
        bot: BotId,
    ) -> Result<(), RuntimeBypassError> {
        self.bots
            .patch_agent(
                caller.clone(),
                bot,
                PatchAgentRequest {
                    auto_accept_permissions: Some(true),
                    ..PatchAgentRequest::default()
                },
            )
            .await
            .map(drop)
            .map_err(|error| match error {
                BotError::Unauthorized => RuntimeBypassError::Forbidden,
                error => RuntimeBypassError::Settings(error.into()),
            })
    }
}
