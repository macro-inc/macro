//! [`HostOperations`] for the inbound adapters: the service's own methods.

use std::sync::Arc;

use firecracker_host_api::{
    Action, Computer, ComputerId, CreateComputer, GoldenImage, GoldenKey, HostInfo, HostLimits,
    SetEnrollment,
};

use super::{HostError, HostProbe, HostService};
use crate::domain::ports::{Disks, Goldens, HostOperations, Machines, Store};

impl<S, D, G, M, P> HostOperations for HostService<S, D, G, M, P>
where
    S: Store,
    D: Disks,
    G: Goldens,
    M: Machines,
    P: HostProbe,
{
    type GuestStream = M::GuestStream;

    fn host(&self) -> HostInfo {
        HostService::host(self)
    }

    fn goldens(&self) -> Vec<GoldenImage> {
        HostService::goldens(self)
    }

    fn build_golden(&self, key: GoldenKey) -> Result<GoldenImage, HostError> {
        HostService::build_golden(self, key)
    }

    async fn list(&self) -> Result<Vec<Computer>, HostError> {
        HostService::list(self).await
    }

    async fn get(&self, computer_id: ComputerId) -> Result<Computer, HostError> {
        HostService::get(self, computer_id).await
    }

    async fn create(
        self: &Arc<Self>,
        computer_id: ComputerId,
        request: CreateComputer,
    ) -> Result<Computer, HostError> {
        HostService::create(self, computer_id, request).await
    }

    async fn power(&self, computer_id: ComputerId, action: Action) -> Result<Computer, HostError> {
        HostService::power(self, computer_id, action).await
    }

    async fn set_enrollment(
        &self,
        computer_id: ComputerId,
        request: SetEnrollment,
    ) -> Result<Computer, HostError> {
        HostService::set_enrollment(self, computer_id, request).await
    }

    async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), HostError> {
        HostService::clear_enrollment(self, computer_id).await
    }

    async fn set_host_limits(&self, limits: HostLimits) -> Result<(), HostError> {
        HostService::set_host_limits(self, limits).await
    }

    async fn destroy(&self, computer_id: ComputerId) -> Result<(), HostError> {
        HostService::destroy(self, computer_id).await
    }

    async fn connect_guest(&self, computer_id: ComputerId) -> Result<M::GuestStream, HostError> {
        HostService::connect_guest(self, computer_id).await
    }
}
