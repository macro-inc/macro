//! The agent's computer through hosted_runtimes' normal purchase path.

use std::sync::Arc;

use hosted_runtimes::domain::{
    agent::ComputerAgents,
    lifecycle::Rejected,
    models::{self, FleetAttachment},
    ports::{Billing, CompPolicy, ComputerRepo, FleetAttachmentSource},
    service::{Clock, ComputerError, ComputerService},
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{ComputerId, ComputerPurchase, ComputerState, TeamAgentError};
use crate::domain::ports::Computers;

#[cfg(test)]
mod test;

/// Buys and reads agents' computers with the computer service.
pub struct HostedRuntimesComputers<Repo, Bill, Time, Attachment, Policy, Agents> {
    service: Arc<ComputerService<Repo, Bill, Time, Attachment, Policy>>,
    agents: Agents,
}

impl<Repo, Bill, Time, Attachment, Policy, Agents>
    HostedRuntimesComputers<Repo, Bill, Time, Attachment, Policy, Agents>
{
    /// Wrap the computer service and the agent links.
    pub fn new(
        service: Arc<ComputerService<Repo, Bill, Time, Attachment, Policy>>,
        agents: Agents,
    ) -> Self {
        Self { service, agents }
    }
}

/// A client-safe reason for a refused purchase; the rest is internal.
fn purchase_error(error: ComputerError) -> TeamAgentError {
    match error {
        ComputerError::FleetUnavailable(_) => TeamAgentError::ComputerUnavailable(
            "Macro computers are unavailable right now".to_owned(),
        ),
        ComputerError::RolloutDisabled => TeamAgentError::NotEnabled,
        ComputerError::SoldOut => {
            TeamAgentError::ComputerUnavailable("this computer size is sold out".to_owned())
        }
        ComputerError::SizeNotOffered => {
            TeamAgentError::ComputerUnavailable("this computer size isn't offered".to_owned())
        }
        ComputerError::PurchaseKeyConflict => TeamAgentError::ComputerUnavailable(
            "this invite was already used for a different purchase".to_owned(),
        ),
        ComputerError::Billing(billing) => TeamAgentError::ComputerUnavailable(billing.to_string()),
        other => TeamAgentError::internal(other),
    }
}

/// A roster read that failed: a purchase still confirming is `Purchasing`,
/// not a failure of the whole list.
fn roster_error(error: ComputerError) -> Result<ComputerState, TeamAgentError> {
    match error {
        ComputerError::NotPurchased => Ok(ComputerState::Purchasing),
        other => Err(TeamAgentError::internal(other)),
    }
}

/// What a release means for removing the agent.
fn released<Released>(result: Result<Released, ComputerError>) -> Result<(), TeamAgentError> {
    match result {
        // Already released: by an earlier removal that stopped part way, or
        // by an admin on the Computers page. Or never there at all.
        Ok(_) | Err(ComputerError::NotFound | ComputerError::Rejected(Rejected::Released)) => {
            Ok(())
        }
        // Still confirming, it may yet be charged; removing the agent now
        // would cascade its reservation away and orphan the billed item.
        Err(ComputerError::NotPurchased) => Err(TeamAgentError::PurchaseConfirming),
        Err(error) => Err(TeamAgentError::internal(error)),
    }
}

/// The agent's view of its computer.
fn computer_state(
    kind: models::ComputerStatusKind,
    availability: FleetAttachment,
) -> ComputerState {
    use models::ComputerStatusKind as Kind;
    let state = match kind {
        Kind::Purchasing => ComputerState::Purchasing,
        Kind::SettingUp => ComputerState::SettingUp,
        Kind::Ready => ComputerState::Ready,
        Kind::WaitingForCapacity | Kind::Starting | Kind::Stopping | Kind::Stopped => {
            ComputerState::Paused
        }
        Kind::NeedsAttention | Kind::Failed => ComputerState::Failed,
        Kind::Released => ComputerState::Released,
    };
    match (availability, state) {
        // Without a fleet nothing runs, but terminal states stay terminal.
        (
            FleetAttachment::Detached,
            ComputerState::Purchasing | ComputerState::Failed | ComputerState::Released,
        ) => state,
        (FleetAttachment::Detached, _) => ComputerState::Paused,
        (FleetAttachment::Attached, state) => state,
    }
}

impl<Repo, Bill, Time, Attachment, Policy, Agents> Computers
    for HostedRuntimesComputers<Repo, Bill, Time, Attachment, Policy, Agents>
where
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
    Agents: ComputerAgents,
{
    #[tracing::instrument(skip_all, fields(team_id = %purchase.team_id), err)]
    async fn purchase(&self, purchase: ComputerPurchase) -> Result<ComputerId, TeamAgentError> {
        let purchase_key = models::PurchaseKey::try_new(purchase.purchase_key)
            .map_err(|_| TeamAgentError::InvalidPurchaseKey)?;
        self.service
            .purchase_for_agent(
                models::PurchaseRequest {
                    // The service picks Stripe or a comp by team policy.
                    billing: models::PurchaseBilling::Stripe,
                    purchase_key,
                    team_id: purchase.team_id,
                    created_by: purchase.created_by,
                    size: purchase.size,
                    name: Some(purchase.name),
                    extra_items: vec![],
                },
                purchase.agent,
            )
            .await
            .map(models::Purchase::computer_id)
            .map_err(purchase_error)
    }

    async fn computer_for_agent(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<ComputerId>, TeamAgentError> {
        self.agents
            .computer_for_agent(team_id, agent)
            .await
            .map_err(TeamAgentError::internal)
    }

    async fn agent_of(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<MacroUserIdStr<'static>>, TeamAgentError> {
        self.agents
            .agent_of(computer_id)
            .await
            .map_err(TeamAgentError::internal)
    }

    #[tracing::instrument(skip(self), err)]
    async fn state(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerState, TeamAgentError> {
        match self.service.status_for_roster(team_id, computer_id).await {
            Ok((status, availability)) => Ok(computer_state(status.status, availability)),
            Err(error) => roster_error(error),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn release(&self, team_id: Uuid, computer_id: ComputerId) -> Result<(), TeamAgentError> {
        released(self.service.request_release(team_id, computer_id).await)
    }
}
