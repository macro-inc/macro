//! The fleet a control plane drives, chosen once by explicit config.
//! There is no fallback: an unreachable Incus host fails loudly instead of
//! quietly running computers in Docker.

use crate::domain::enrollment::Enrollment;
use crate::domain::ids::ComputerId;
use crate::domain::models::{Computer, ControlPlaneId, HostRegistration};
use crate::domain::ports::{Fleet, FleetError, FleetInstance};
use crate::outbound::docker_fleet::{DockerFleet, DockerFleetError};
use crate::outbound::incus_fleet::{IncusFleet, IncusFleetError};

pub enum ConfiguredFleet {
    Incus(IncusFleet),
    /// Dev only; [`DockerFleet::new`] refuses non-local environments.
    Docker(DockerFleet),
}

#[derive(Debug, thiserror::Error)]
pub enum ConfiguredFleetError {
    #[error(transparent)]
    Incus(#[from] IncusFleetError),
    #[error(transparent)]
    Docker(#[from] DockerFleetError),
}

impl FleetError for ConfiguredFleetError {
    fn is_missing(&self) -> bool {
        match self {
            Self::Incus(error) => error.is_missing(),
            Self::Docker(error) => error.is_missing(),
        }
    }
}

impl Fleet for ConfiguredFleet {
    type Err = ConfiguredFleetError;

    fn control_plane_id(&self) -> &ControlPlaneId {
        match self {
            Self::Incus(fleet) => fleet.control_plane_id(),
            Self::Docker(fleet) => fleet.control_plane_id(),
        }
    }

    async fn create(
        &self,
        computer: &Computer,
        enrollment: &Enrollment,
        start: bool,
    ) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.create(computer, enrollment, start).await?),
            Self::Docker(fleet) => Ok(fleet.create(computer, enrollment, start).await?),
        }
    }

    async fn start(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.start(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.start(computer_id).await?),
        }
    }

    async fn stop(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.stop(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.stop(computer_id).await?),
        }
    }

    async fn restart(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.restart(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.restart(computer_id).await?),
        }
    }

    async fn freeze(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.freeze(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.freeze(computer_id).await?),
        }
    }

    async fn unfreeze(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.unfreeze(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.unfreeze(computer_id).await?),
        }
    }

    async fn suspend(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.suspend(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.suspend(computer_id).await?),
        }
    }

    async fn resume(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.resume(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.resume(computer_id).await?),
        }
    }

    async fn destroy(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.destroy(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.destroy(computer_id).await?),
        }
    }

    async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.clear_enrollment(computer_id).await?),
            Self::Docker(fleet) => Ok(fleet.clear_enrollment(computer_id).await?),
        }
    }

    async fn instances(&self) -> Result<Vec<FleetInstance>, Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.instances().await?),
            Self::Docker(fleet) => Ok(fleet.instances().await?),
        }
    }

    async fn host(&self) -> Result<HostRegistration, Self::Err> {
        match self {
            Self::Incus(fleet) => Ok(fleet.host().await?),
            Self::Docker(fleet) => Ok(fleet.host().await?),
        }
    }
}
