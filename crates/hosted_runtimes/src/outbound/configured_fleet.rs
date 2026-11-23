//! The fleet one host runs: a Firecracker host from its row, or the local
//! Docker host its control plane's environment configures. There is no
//! fallback between them.

use crate::domain::enrollment::EnrollmentGeneration;
use crate::domain::ids::ComputerId;
use crate::domain::image::GuestImage;
use crate::domain::models::{Computer, ControlPlaneId, HostRegistration};
use crate::domain::ports::{
    Fleet, FleetEnrollment, FleetError, FleetInstance, GuestProcess, HostMemory,
};
use crate::outbound::docker_fleet::{DockerFleet, DockerFleetError};
use crate::outbound::firecracker_fleet::{FirecrackerFleet, FirecrackerFleetError};

/// Explicitly selected fleet backend.
pub enum ConfiguredFleet {
    /// Firecracker microVMs through a host agent.
    Firecracker(FirecrackerFleet),
    /// Dev only; [`DockerFleet::new`] refuses non-local environments.
    Docker(DockerFleet),
}

/// Failure from the selected fleet backend.
#[derive(Debug, thiserror::Error)]
pub enum ConfiguredFleetError {
    /// Firecracker adapter failure.
    #[error(transparent)]
    Firecracker(#[from] FirecrackerFleetError),
    /// Local Docker adapter failure.
    #[error(transparent)]
    Docker(#[from] DockerFleetError),
}

/// Run `$body` with `$fleet` bound to the selected backend.
macro_rules! each_backend {
    ($self:expr, $fleet:ident => $body:expr) => {
        match $self {
            Self::Firecracker($fleet) => $body,
            Self::Docker($fleet) => $body,
        }
    };
}

impl FleetError for ConfiguredFleetError {
    fn is_missing(&self) -> bool {
        each_backend!(self, error => error.is_missing())
    }

    fn is_permanent(&self) -> bool {
        each_backend!(self, error => error.is_permanent())
    }
}

impl Fleet for ConfiguredFleet {
    type Err = ConfiguredFleetError;

    fn control_plane_id(&self) -> &ControlPlaneId {
        each_backend!(self, fleet => fleet.control_plane_id())
    }

    async fn create(
        &self,
        computer: &Computer,
        generation: EnrollmentGeneration,
        enrollment: &impl FleetEnrollment,
        start: bool,
    ) -> Result<GuestImage, Self::Err> {
        each_backend!(self, fleet => Ok(fleet.create(computer, generation, enrollment, start).await?))
    }

    async fn start(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        each_backend!(self, fleet => Ok(fleet.start(computer_id).await?))
    }

    async fn stop(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        each_backend!(self, fleet => Ok(fleet.stop(computer_id).await?))
    }

    async fn restart(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        each_backend!(self, fleet => Ok(fleet.restart(computer_id).await?))
    }

    async fn restart_macrod(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        each_backend!(self, fleet => Ok(fleet.restart_macrod(computer_id).await?))
    }

    async fn destroy(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        each_backend!(self, fleet => Ok(fleet.destroy(computer_id).await?))
    }

    async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        each_backend!(self, fleet => Ok(fleet.clear_enrollment(computer_id).await?))
    }

    async fn resources_match(&self, computer: &Computer) -> Result<bool, Self::Err> {
        each_backend!(self, fleet => Ok(fleet.resources_match(computer).await?))
    }

    async fn instances(&self) -> Result<Vec<FleetInstance>, Self::Err> {
        each_backend!(self, fleet => Ok(fleet.instances().await?))
    }

    async fn host(&self) -> Result<HostRegistration, Self::Err> {
        each_backend!(self, fleet => Ok(fleet.host().await?))
    }

    async fn memory(&self) -> Result<HostMemory, Self::Err> {
        each_backend!(self, fleet => Ok(fleet.memory().await?))
    }

    async fn set_host_limits(
        &self,
        limits: crate::domain::overcommit::HostAgentLimits,
    ) -> Result<(), Self::Err> {
        each_backend!(self, fleet => Ok(fleet.set_host_limits(limits).await?))
    }

    async fn hibernate(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        each_backend!(self, fleet => Ok(fleet.hibernate(computer_id).await?))
    }

    async fn exec(
        &self,
        computer_id: ComputerId,
        argv: &[&str],
    ) -> Result<GuestProcess<Self::Err>, Self::Err> {
        each_backend!(self, fleet => Ok(fleet
            .exec(computer_id, argv)
            .await?
            .map_err(ConfiguredFleetError::from)))
    }
}
