//! Computer lifecycle adapter for standalone-brain gateway authorization.

use std::sync::Arc;

use hosted_runtimes::{
    domain::{
        lifecycle::Phase,
        models::Computer,
        ports::{ComputerRepo, InstanceStatus},
    },
    outbound::pg::PgComputerRepo,
};
use team_agents::domain::gateway::{
    BrainComputerPhase, BrainGatewayComputer, BrainGatewayComputers, BrainGatewayError,
};
use uuid::Uuid;

/// Uses the fleet's existing prompt wake path; it never buys or bills a computer.
pub struct GatewayComputers {
    repo: PgComputerRepo,
    operator: Option<Arc<crate::computers::Operator>>,
}

impl GatewayComputers {
    pub fn new(repo: PgComputerRepo, operator: Option<Arc<crate::computers::Operator>>) -> Self {
        Self { repo, operator }
    }
}

fn facts(computer: Computer) -> BrainGatewayComputer {
    BrainGatewayComputer {
        team_id: computer.team_id,
        phase: match computer.state.phase {
            Phase::Running { .. } => BrainComputerPhase::Running,
            Phase::Frozen { .. } => BrainComputerPhase::Frozen,
            Phase::Stopped { .. } => BrainComputerPhase::Stopped,
            Phase::Destroyed => BrainComputerPhase::Released,
            _ => BrainComputerPhase::Other,
        },
    }
}

impl BrainGatewayComputers for GatewayComputers {
    #[tracing::instrument(skip(self), err)]
    async fn get(
        &self,
        computer_id: Uuid,
    ) -> Result<Option<BrainGatewayComputer>, BrainGatewayError> {
        let Some(computer) = self
            .repo
            .get(computer_id)
            .await
            .map_err(|_| BrainGatewayError::Unavailable)?
        else {
            return Ok(None);
        };
        let mut computer = facts(computer);
        // PromptArrived optimistically writes Running before the outbox effect
        // unfreezes the machine. Every request checks the actual fleet, including
        // requests racing the first Frozen wake.
        if matches!(
            computer.phase,
            BrainComputerPhase::Running | BrainComputerPhase::Frozen
        ) {
            let observed = self
                .operator
                .as_ref()
                .ok_or(BrainGatewayError::Unavailable)?
                .instance_status(computer_id)
                .await
                .map_err(|_| BrainGatewayError::Unavailable)?;
            if computer.phase == BrainComputerPhase::Running {
                computer.phase = match observed {
                    Some(InstanceStatus::Running) => BrainComputerPhase::Running,
                    Some(InstanceStatus::Frozen) => BrainComputerPhase::Frozen,
                    Some(InstanceStatus::Stopped) => BrainComputerPhase::Stopped,
                    None => BrainComputerPhase::Other,
                };
            }
        }
        Ok(Some(computer))
    }

    #[tracing::instrument(skip(self), err)]
    async fn wake(
        &self,
        computer_id: Uuid,
    ) -> Result<Option<BrainGatewayComputer>, BrainGatewayError> {
        let Some(computer) = self
            .repo
            .get(computer_id)
            .await
            .map_err(|_| BrainGatewayError::Unavailable)?
        else {
            return Ok(None);
        };
        if !matches!(
            computer.state.phase,
            Phase::Frozen { .. } | Phase::Running { .. }
        ) {
            return Ok(Some(facts(computer)));
        }
        let harness = computer.harness_id.ok_or(BrainGatewayError::Unavailable)?;
        self.operator
            .as_ref()
            .ok_or(BrainGatewayError::Unavailable)?
            .wake_brain(harness, computer_id)
            .await
            .map_err(|_| BrainGatewayError::Unavailable)?;
        self.get(computer_id).await
    }
}
