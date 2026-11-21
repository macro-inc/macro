//! Takes back the agent teammate a computer released after failing its first
//! start was bought for
//! ([`Effect::UndoAgentInvite`]), through the agent teammates domain.

use super::{Clock, ComputerError, ComputerService, internal};
use crate::domain::agent::ComputerAgents;
use crate::domain::lifecycle::{BILLING_BACKOFF, Effect, EffectWorker, backoff};
use crate::domain::ports::{
    AgentInvites, Billing, CompPolicy, ComputerRepo, FleetAttachmentSource, HostScope,
    PendingEffect,
};

/// Effects one pass takes.
const AGENT_BATCH: u32 = 16;
/// How long a leased effect is the pass's before another may take it.
const AGENT_LEASE: chrono::Duration = chrono::Duration::minutes(2);
/// Attempts before an undo is given up and paged.
pub const MAX_AGENT_ATTEMPTS: u32 = 10;

impl<Repo, Bill, Time, Attachment, Policy> ComputerService<Repo, Bill, Time, Attachment, Policy>
where
    Repo: ComputerRepo + ComputerAgents,
    Bill: Billing,
    Time: Clock,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
{
    /// Take back the agents of released computers through `invites`. One
    /// failing undo is retried later and never blocks the others.
    pub async fn run_agent_effects<Invites: AgentInvites>(
        &self,
        invites: &Invites,
    ) -> Result<usize, ComputerError> {
        let now = self.clock.now();
        let effects = self
            .repo
            .lease_effects(
                EffectWorker::Agents,
                HostScope::Every,
                AGENT_BATCH,
                now,
                now + AGENT_LEASE,
            )
            .await
            .map_err(internal)?;
        let count = effects.len();
        for pending in effects {
            let effect_id = pending.id;
            if let Err(error) = self.run_agent_effect(invites, pending, now).await {
                tracing::error!(effect_id, error = ?error, "agent effect could not be recorded");
            }
        }
        Ok(count)
    }

    #[tracing::instrument(
        name = "computer.agents.effect",
        skip_all,
        fields(computer_id = %pending.computer_id, effect_id = pending.id, attempts = i64::from(pending.attempts)),
        err
    )]
    async fn run_agent_effect<Invites: AgentInvites>(
        &self,
        invites: &Invites,
        pending: PendingEffect,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), ComputerError> {
        let done = match &pending.effect {
            Effect::UndoAgentInvite => self.undo_agent_invite(invites, &pending).await,
            other => Err(ComputerError::Internal(rootcause::report!(
                "{other:?} reached the agents worker"
            ))),
        };
        let Err(error) = done else {
            return self
                .repo
                .complete_effect(pending.id)
                .await
                .map_err(internal);
        };
        super::super::telemetry::effect_failed("agents");
        let attempts = pending.attempts.saturating_add(1);
        if attempts >= MAX_AGENT_ATTEMPTS {
            // Alerting keys on this event; see the crate's AGENTS.md.
            tracing::error!(computer_id = %pending.computer_id, effect_id = pending.id,
                attempts, error = ?error, "agent invite undo abandoned");
            return self
                .repo
                .complete_effect(pending.id)
                .await
                .map_err(internal);
        }
        tracing::warn!(effect_id = pending.id, error = ?error, "agent effect failed");
        let attempt = u8::try_from(pending.attempts).unwrap_or(u8::MAX);
        self.repo
            .retry_effect(
                pending.id,
                error.to_string(),
                now + backoff(BILLING_BACKOFF, attempt),
            )
            .await
            .map_err(internal)
    }

    /// A computer bought for no agent has nothing to take back.
    async fn undo_agent_invite<Invites: AgentInvites>(
        &self,
        invites: &Invites,
        pending: &PendingEffect,
    ) -> Result<(), ComputerError> {
        let Some(agent) = self
            .repo
            .agent_of(pending.computer_id)
            .await
            .map_err(internal)?
        else {
            return Ok(());
        };
        let computer = self
            .repo
            .get(pending.computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        invites
            .undo_invite(computer.team_id(), &agent)
            .await
            .map_err(internal)
    }
}
