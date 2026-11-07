//! [`HostMoves`] through the host agent's move routes
//! (`firecracker_host_api::moves`), and for [`ConfiguredFleet`], whose
//! Docker backend moves nothing.

use chrono::{DateTime, Utc};
use firecracker_host_api::moves::{
    AdoptComputer, ExpectMove, Replicate, Replication, ReplicationState,
};

use super::{FirecrackerFleet, FirecrackerFleetError};
use crate::domain::enrollment::EnrollmentGeneration;
use crate::domain::ids::ComputerId;
use crate::domain::models::ControlPlaneId;
use crate::domain::moves::{HostMoves, MoveTicket, Round, RoundState};
use crate::outbound::configured_fleet::ConfiguredFleet;

fn round(replication: Replication) -> Round {
    Round {
        state: match replication.state {
            ReplicationState::Idle => RoundState::Idle,
            ReplicationState::Running => RoundState::Running,
            ReplicationState::Done => RoundState::Done,
            ReplicationState::Failed { message } => RoundState::Failed(message),
        },
        released: replication.released,
        bytes: replication.bytes,
    }
}

impl HostMoves for FirecrackerFleet {
    type Err = FirecrackerFleetError;

    async fn move_address(&self) -> Result<Option<String>, FirecrackerFleetError> {
        Ok(self.client.host().await?.move_address)
    }

    #[tracing::instrument(name = "firecracker_fleet.expect_move", skip(self, ticket), fields(host = %self.config.host_name), err)]
    async fn expect_move(
        &self,
        computer_id: ComputerId,
        ticket: &MoveTicket,
        expires_at: DateTime<Utc>,
    ) -> Result<(), FirecrackerFleetError> {
        self.client
            .expect_move(
                computer_id,
                &ExpectMove {
                    ticket: firecracker_host_api::moves::MoveTicket::new(
                        ticket.expose().to_owned(),
                    ),
                    expires_at,
                },
            )
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "firecracker_fleet.replicate", skip(self, ticket), fields(host = %self.config.host_name), err)]
    async fn replicate(
        &self,
        computer_id: ComputerId,
        target: &str,
        ticket: &MoveTicket,
    ) -> Result<Round, FirecrackerFleetError> {
        let replication = self
            .client
            .replicate(
                computer_id,
                &Replicate {
                    target: target.to_owned(),
                    ticket: firecracker_host_api::moves::MoveTicket::new(
                        ticket.expose().to_owned(),
                    ),
                },
            )
            .await?;
        Ok(round(replication))
    }

    async fn replication(&self, computer_id: ComputerId) -> Result<Round, FirecrackerFleetError> {
        Ok(round(self.client.replication(computer_id).await?))
    }

    #[tracing::instrument(name = "firecracker_fleet.release", skip(self), fields(host = %self.config.host_name), err)]
    async fn release(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        self.client.release(computer_id).await?;
        Ok(())
    }

    #[tracing::instrument(name = "firecracker_fleet.adopt", skip(self, control_plane_id), fields(host = %self.config.host_name), err)]
    async fn adopt(
        &self,
        computer_id: ComputerId,
        control_plane_id: &ControlPlaneId,
        generation: EnrollmentGeneration,
    ) -> Result<(), FirecrackerFleetError> {
        self.client
            .adopt(
                computer_id,
                &AdoptComputer {
                    control_plane_id: control_plane_id.clone(),
                    generation,
                },
            )
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "firecracker_fleet.drop_staged", skip(self), fields(host = %self.config.host_name), err)]
    async fn drop_staged(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        self.client.drop_staged(computer_id).await?;
        Ok(())
    }
}

/// Why a [`ConfiguredFleet`] could not move a computer.
#[derive(Debug, thiserror::Error)]
pub enum ConfiguredMoveError {
    /// The host agent failed.
    #[error(transparent)]
    Firecracker(#[from] FirecrackerFleetError),
    /// The local Docker fleet moves nothing.
    #[error("the local Docker fleet does not move computers")]
    Unsupported,
}

impl HostMoves for ConfiguredFleet {
    type Err = ConfiguredMoveError;

    async fn move_address(&self) -> Result<Option<String>, ConfiguredMoveError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet.move_address().await?),
            Self::Docker(_) => Ok(None),
        }
    }

    async fn expect_move(
        &self,
        computer_id: ComputerId,
        ticket: &MoveTicket,
        expires_at: DateTime<Utc>,
    ) -> Result<(), ConfiguredMoveError> {
        match self {
            Self::Firecracker(fleet) => {
                Ok(fleet.expect_move(computer_id, ticket, expires_at).await?)
            }
            Self::Docker(_) => Err(ConfiguredMoveError::Unsupported),
        }
    }

    async fn replicate(
        &self,
        computer_id: ComputerId,
        target: &str,
        ticket: &MoveTicket,
    ) -> Result<Round, ConfiguredMoveError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet.replicate(computer_id, target, ticket).await?),
            Self::Docker(_) => Err(ConfiguredMoveError::Unsupported),
        }
    }

    async fn replication(&self, computer_id: ComputerId) -> Result<Round, ConfiguredMoveError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet.replication(computer_id).await?),
            Self::Docker(_) => Err(ConfiguredMoveError::Unsupported),
        }
    }

    async fn release(&self, computer_id: ComputerId) -> Result<(), ConfiguredMoveError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet.release(computer_id).await?),
            Self::Docker(_) => Err(ConfiguredMoveError::Unsupported),
        }
    }

    async fn adopt(
        &self,
        computer_id: ComputerId,
        control_plane_id: &ControlPlaneId,
        generation: EnrollmentGeneration,
    ) -> Result<(), ConfiguredMoveError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet
                .adopt(computer_id, control_plane_id, generation)
                .await?),
            Self::Docker(_) => Err(ConfiguredMoveError::Unsupported),
        }
    }

    async fn drop_staged(&self, computer_id: ComputerId) -> Result<(), ConfiguredMoveError> {
        match self {
            Self::Firecracker(fleet) => Ok(fleet.drop_staged(computer_id).await?),
            Self::Docker(_) => Err(ConfiguredMoveError::Unsupported),
        }
    }
}
