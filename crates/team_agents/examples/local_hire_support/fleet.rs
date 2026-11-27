//! A private process substitutes for a guest. It cannot report Macrod or agent readiness.

use std::{
    collections::HashMap,
    io,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use harness_id::HarnessId;
use hosted_runtimes::domain::{
    enrollment::{Deployment, DeploymentSource, DeploymentUnavailable, EnrollmentGeneration},
    ids::{ComputerId, PairingId},
    image::GuestImage,
    models::{Computer, ControlPlaneId, HostName, HostRegistration},
    overcommit::HostAgentLimits,
    ports::{
        DefaultAgent, Fleet, FleetEnrollment, FleetError, FleetInstance, GuestProcess, Harnesses,
        HostMemory, HostedPairing, SetupNotice, SetupNotices,
    },
};

use super::resources::Unwired;

#[derive(Debug, thiserror::Error)]
#[error("local guest stand-in unavailable")]
pub struct LocalFleetError;

impl FleetError for LocalFleetError {
    fn is_missing(&self) -> bool {
        false
    }

    fn is_permanent(&self) -> bool {
        true
    }
}

pub struct LocalFleet {
    control_plane: ControlPlaneId,
    name: HostName,
    process_path: std::path::PathBuf,
    guests: Mutex<HashMap<ComputerId, Child>>,
}

impl LocalFleet {
    pub fn new(process_path: std::path::PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            control_plane: ControlPlaneId::try_new("local-hire-review")?,
            name: HostName::try_new("local-hire-review")?,
            process_path,
            guests: Mutex::default(),
        })
    }
}

impl Drop for LocalFleet {
    fn drop(&mut self) {
        let guests = self
            .guests
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for process in guests.values_mut() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

impl Fleet for LocalFleet {
    type Err = LocalFleetError;

    fn control_plane_id(&self) -> &ControlPlaneId {
        &self.control_plane
    }

    async fn host(&self) -> Result<HostRegistration, Self::Err> {
        Ok(HostRegistration {
            name: self.name.clone(),
            vcpus: 64,
            memory_gb: 128,
        })
    }

    async fn create(
        &self,
        computer: &Computer,
        _: EnrollmentGeneration,
        _: &impl FleetEnrollment,
        start: bool,
    ) -> Result<GuestImage, Self::Err> {
        if start {
            self.start(computer.id).await?;
        }
        GuestImage::try_new("local/guest-stand-in").map_err(|_| LocalFleetError)
    }

    async fn start(&self, computer: ComputerId) -> Result<(), Self::Err> {
        let mut guests = self.guests.lock().map_err(|_| LocalFleetError)?;
        if let Some(child) = guests.get_mut(&computer)
            && child.try_wait().map_err(|_| LocalFleetError)?.is_none()
        {
            return Ok(());
        }

        // An isolated, inert process exercises the fleet effect completion.
        // No path here launches an agent, fetches an image or enrolls a guest.
        let child = Command::new(&self.process_path)
            .args(["-c", "while read -r line; do :; done"])
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| LocalFleetError)?;
        guests.insert(computer, child);
        Ok(())
    }

    async fn stop(&self, id: ComputerId) -> Result<(), Self::Err> {
        if let Some(mut child) = self.guests.lock().map_err(|_| LocalFleetError)?.remove(&id) {
            drop(child.stdin.take());
            child.wait().map_err(|_| LocalFleetError)?;
        }
        Ok(())
    }

    async fn restart(&self, id: ComputerId) -> Result<(), Self::Err> {
        self.stop(id).await?;
        self.start(id).await
    }

    async fn restart_macrod(&self, _: ComputerId) -> Result<(), Self::Err> {
        Err(LocalFleetError)
    }

    async fn destroy(&self, id: ComputerId) -> Result<(), Self::Err> {
        self.stop(id).await
    }

    async fn clear_enrollment(&self, _: ComputerId) -> Result<(), Self::Err> {
        Err(LocalFleetError)
    }

    async fn resources_match(&self, _: &Computer) -> Result<bool, Self::Err> {
        Err(LocalFleetError)
    }

    async fn instances(&self) -> Result<Vec<FleetInstance>, Self::Err> {
        Err(LocalFleetError)
    }

    async fn memory(&self) -> Result<HostMemory, Self::Err> {
        Err(LocalFleetError)
    }

    async fn set_host_limits(&self, _: HostAgentLimits) -> Result<(), Self::Err> {
        Err(LocalFleetError)
    }

    async fn hibernate(&self, _: ComputerId) -> Result<(), Self::Err> {
        Err(LocalFleetError)
    }

    async fn exec(&self, _: ComputerId, _: &[&str]) -> Result<GuestProcess<Self::Err>, Self::Err> {
        Err(LocalFleetError)
    }
}

impl Harnesses for Unwired {
    type Err = io::Error;

    async fn create_hosted_pairing(&self, _: &Computer) -> Result<HostedPairing, Self::Err> {
        Err(io::Error::other("no local Macrod enrollment"))
    }

    async fn pairing_claimed(&self, _: PairingId) -> Result<bool, Self::Err> {
        Ok(false)
    }

    async fn computer_for(&self, _: HarnessId) -> Result<Option<ComputerId>, Self::Err> {
        Ok(None)
    }

    async fn revoke(&self, _: &Computer) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn deliver_agent(
        &self,
        _: HarnessId,
        _: ComputerId,
        _: EnrollmentGeneration,
    ) -> Result<(), Self::Err> {
        Err(io::Error::other("no local agent workload"))
    }

    async fn create_default_agent(
        &self,
        _: &Computer,
        _: HarnessId,
    ) -> Result<DefaultAgent, Self::Err> {
        Err(io::Error::other("no local agent workload"))
    }
}

impl DeploymentSource for Unwired {
    fn deployment(&self) -> Result<Deployment, DeploymentUnavailable> {
        Err(DeploymentUnavailable)
    }
}

impl SetupNotices for Unwired {
    type Err = io::Error;

    async fn send(&self, _: SetupNotice) -> Result<(), Self::Err> {
        Err(io::Error::other("no local setup notification"))
    }
}
