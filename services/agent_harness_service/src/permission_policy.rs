//! Postgres-backed permission policies for fixed and database-backed agents.

use agent_harness::domain::model::{AgentKind, resolve_permission_policy};
use agent_harness::domain::ports::PermissionPolicySource;
use agent_session::domain::session::PermissionPolicy;
use bot_id::BotId;
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;

/// Reads the agent's `auto_accept_permissions` setting, falling back to its
/// runtime kind's default when the setting is unset or the bot has no agent
/// configuration at all (the fixed system bots).
#[derive(Clone)]
pub struct PgPermissionPolicySource {
    repo: PgBotsRepo,
}

impl PgPermissionPolicySource {
    /// Build the source over the bots repository.
    pub fn new(repo: PgBotsRepo) -> Self {
        Self { repo }
    }
}

impl PermissionPolicySource for PgPermissionPolicySource {
    async fn permission_policy(&self, bot: BotId) -> anyhow::Result<PermissionPolicy> {
        let agent = self.repo.get_agent(bot).await?;
        let kind = match &agent {
            Some(agent) => AgentKind::for_session(bot, &agent.harness),
            None => AgentKind::of(bot),
        };
        Ok(resolve_permission_policy(
            kind,
            agent.and_then(|agent| agent.auto_accept_permissions),
        ))
    }
}
