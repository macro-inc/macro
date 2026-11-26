//! [`MoveHost`]: releasing a computer to another host and adopting
//! one from another host, each under the computer's lock.

use firecracker_host_api::moves::AdoptComputer;
use firecracker_host_api::{Action, Computer, ComputerId, PowerState};

use super::{HostError, HostProbe, HostService, internal};
use crate::domain::moves::MoveHost;
use crate::domain::ports::{Disks, Goldens, Machines, Store};
use crate::domain::power::plan;

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> HostService<S, D, G, M, P> {
    pub(super) fn is_staged(&self, computer_id: ComputerId) -> bool {
        self.staged
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains(&computer_id)
    }
}

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> MoveHost
    for HostService<S, D, G, M, P>
{
    async fn is_live(&self, computer_id: ComputerId) -> bool {
        let entry = self.entry(computer_id);
        let live = entry.lock().await.is_some();
        if !live {
            // `entry` made an empty slot; nothing else will fill it.
            self.forget(computer_id);
        }
        live
    }

    async fn release<Staging>(
        &self,
        computer_id: ComputerId,
        stage: Staging,
    ) -> Result<(), HostError>
    where
        Staging: Future<Output = Result<(), HostError>> + Send,
    {
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        let record = guard.as_mut().ok_or(HostError::NotFound(computer_id))?;
        self.observe(record).await?;
        // A clean shutdown, so everything the guest wrote is on its disks;
        // a hibernation is dropped: memory does not move between hosts.
        let steps = plan(record.state, Action::Stop)?;
        self.run_steps(record, steps).await?;
        record.state = PowerState::Stopped;
        record.process = None;
        record.guest_restore_pending = false;
        // Saved before staging, so the record that moves says stopped.
        self.save(record).await?;
        stage.await?;
        *guard = None;
        drop(guard);
        self.forget(computer_id);
        self.states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&computer_id);
        self.running
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&computer_id);
        Ok(())
    }

    async fn adopt<Unstaging, Unstage>(
        &self,
        computer_id: ComputerId,
        request: &AdoptComputer,
        unstage: Unstage,
    ) -> Result<Computer, HostError>
    where
        Unstage: FnOnce(u64) -> Unstaging + Send,
        Unstaging: Future<Output = Result<(), HostError>> + Send,
    {
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        if let Some(record) = guard.as_mut() {
            if record.control_plane_id != request.control_plane_id
                || record.generation != request.generation
            {
                return Err(HostError::GenerationMismatch(computer_id));
            }
            self.observe(record).await?;
            return Ok(self.view(record));
        }
        // Read before unstaging: the quota comes from the record, and a
        // mismatch leaves the copy staged.
        let staged = self
            .store
            .load_staged(computer_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| {
                HostError::MoveRefused(format!("no staged copy of {computer_id} here"))
            })?;
        if staged.computer_id != computer_id
            || staged.control_plane_id != request.control_plane_id
            || staged.generation != request.generation
        {
            return Err(HostError::GenerationMismatch(computer_id));
        }
        // The same quota a create gives: a moved computer may hold its
        // previous system disk too.
        let quota_bytes = self.disks.quota_bytes(&staged.resources);
        unstage(quota_bytes).await?;
        let mut record = staged;
        // It ran on another host: whatever process it recorded is not ours,
        // and its rootfs has booted, so it cold boots.
        record.state = PowerState::Stopped;
        record.process = None;
        record.rootfs_never_booted = false;
        record.guest_restore_pending = false;
        record.last_launch = None;
        self.machines
            .discard_hibernation(computer_id)
            .await
            .map_err(internal)?;
        self.save(&record).await?;
        let computer = self.view(&record);
        *guard = Some(record);
        Ok(computer)
    }

    fn set_staged(&self, computer_id: ComputerId, staged: bool) {
        let mut set = self
            .staged
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if staged {
            set.insert(computer_id);
        } else {
            set.remove(&computer_id);
        }
    }
}
