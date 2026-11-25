//! Replacing a computer's system disk (its root drive) with one of another
//! image, or putting its previous one back, while its `/home`, identity,
//! enrollment and pairing stay as they are.
//!
//! The record names the system disk the VM boots ([`SystemDisk`]), so the
//! commit point of a replacement is one record save: before it the computer
//! boots its old disk, after it the new one. A clone the save never named is
//! a leftover, deleted at startup and before the next replacement. The boot
//! that follows is always a cold boot: a golden's memory only matches its own
//! untouched rootfs and its empty `/home`, never this computer's `/home`.

use std::time::Instant;

use firecracker_host_api::{Action, Computer, ComputerId, GoldenKey, GuestImage, PowerState};

use super::{HostError, HostProbe, HostService, internal};
use crate::crash_point::{self, CrashPoint};
use crate::domain::metrics::{Operation, Repair};
use crate::domain::model::{ComputerRecord, PreviousSystemDisk, SystemDisk};
use crate::domain::ports::{Disks, Goldens, Machines, Store};
use crate::domain::power::{Step, plan};

#[cfg(test)]
mod test;

/// How the disk of the asked image comes to be.
enum Replacement {
    /// It is the current one already.
    Current,
    /// It is the previous one: swap them.
    Previous,
    /// Clone it from the image's golden.
    Clone(GoldenKey),
}

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> HostService<S, D, G, M, P> {
    /// Boot the computer from a system disk of `image`; see
    /// [`firecracker_host_api::ReplaceSystemDisk`].
    pub async fn replace_system_disk(
        &self,
        computer_id: ComputerId,
        image: GuestImage,
    ) -> Result<Computer, HostError> {
        let started = Instant::now();
        let result = self.replace_system_disk_measured(computer_id, image).await;
        self.metrics.operation(
            Operation::ReplaceSystemDisk,
            started.elapsed(),
            result.as_ref().map(|_| ()),
        );
        result
    }

    #[tracing::instrument(
        name = "firecracker_host.replace_system_disk",
        skip(self),
        fields(
            from_image = tracing::field::Empty,
            replacement = tracing::field::Empty,
            was_running = tracing::field::Empty,
        ),
        err
    )]
    async fn replace_system_disk_measured(
        &self,
        computer_id: ComputerId,
        image: GuestImage,
    ) -> Result<Computer, HostError> {
        if !super::image_name_is_safe(image.as_str()) {
            return Err(super::InvalidRequest::UnsafeImage(image).into());
        }
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        let record = guard.as_mut().ok_or(HostError::NotFound(computer_id))?;
        self.observe(record).await?;
        let span = tracing::Span::current();
        span.record("from_image", record.image.as_str());

        let replacement = if record.image == image {
            Replacement::Current
        } else if record
            .previous_system_disk
            .as_ref()
            .is_some_and(|previous| previous.image == image)
        {
            Replacement::Previous
        } else {
            let key = GoldenKey {
                image: image.clone(),
                vcpus: record.resources.vcpus,
                memory_mib: record.resources.memory_mib,
            };
            self.require_golden_of(&key)?;
            Replacement::Clone(key)
        };
        span.record(
            "replacement",
            match replacement {
                Replacement::Current => "current",
                Replacement::Previous => "previous",
                Replacement::Clone(_) => "clone",
            },
        );
        if let Replacement::Current = replacement {
            // A replacement cut short by an agent restart left the computer
            // stopped on its new disk: this repeat finishes it.
            self.boot_if_owed(record).await?;
            return Ok(self.view(record));
        }
        if record.state == PowerState::Hibernated {
            return Err(HostError::Hibernated(computer_id));
        }

        // Saved before the shutdown, so a replacement cut short still
        // boots the computer it found running when it is asked again.
        let was_running = record.state != PowerState::Stopped || record.boot_after_system_disk;
        span.record("was_running", was_running);
        if was_running && !record.boot_after_system_disk {
            record.boot_after_system_disk = true;
            self.save(record).await?;
        }
        self.run_steps(record, plan(record.state, Action::Stop)?)
            .await?;

        let swapped = match &replacement {
            Replacement::Current | Replacement::Previous => self.swap_with_previous(record).await,
            Replacement::Clone(key) => self.clone_and_swap(record, key).await,
        };
        if let Err(error) = swapped {
            // Back up on whichever disk the record names: the failure left
            // the computer stopped, and a computer someone was using should
            // not stay down for it.
            if let Err(boot_error) = self.boot_if_owed(record).await {
                tracing::warn!(computer_id = %computer_id, error = %boot_error, "booting again after a failed system disk replacement failed");
            }
            return Err(error);
        }
        self.boot_if_owed(record).await?;
        Ok(self.view(record))
    }

    /// Boot a computer a replacement stopped, then forget that it owes one.
    async fn boot_if_owed(&self, record: &mut ComputerRecord) -> Result<(), HostError> {
        if !record.boot_after_system_disk {
            return Ok(());
        }
        if record.state == PowerState::Stopped {
            self.run_steps(record, &[Step::Boot]).await?;
        }
        record.boot_after_system_disk = false;
        self.save(record).await
    }

    /// Swap the current and the previous system disk.
    async fn swap_with_previous(&self, record: &mut ComputerRecord) -> Result<(), HostError> {
        let Some(previous) = record.previous_system_disk.take() else {
            return Ok(());
        };
        record.previous_system_disk = Some(PreviousSystemDisk {
            disk: record.system_disk,
            image: std::mem::replace(&mut record.image, previous.image),
        });
        record.system_disk = previous.disk;
        record.rootfs_never_booted = false;
        self.save(record).await
    }

    /// Clone `key`'s golden rootfs as the next system disk and put it in
    /// place, keeping the current one as the previous one.
    async fn clone_and_swap(
        &self,
        record: &mut ComputerRecord,
        key: &GoldenKey,
    ) -> Result<(), HostError> {
        // A new generation, never a name a record held: a leftover of that
        // name is replaced, never booted.
        let next = SystemDisk(
            record
                .system_disks()
                .into_iter()
                .map(|disk| disk.0)
                .max()
                .unwrap_or(0)
                + 1,
        );
        // The previous disk is dropped from the record before its file goes,
        // so the record never names a deleted disk; the dataset then has
        // room for the clone beside the current one.
        if record.previous_system_disk.take().is_some() {
            self.save(record).await?;
        }
        crash_point::reach(CrashPoint::SystemDiskPreviousDropped);
        self.remove_leftover_system_disks(record).await?;
        self.disks
            .clone_system_disk(record, key, next)
            .await
            .map_err(internal)?;
        crash_point::reach(CrashPoint::SystemDiskCloned);
        record.previous_system_disk = Some(PreviousSystemDisk {
            disk: record.system_disk,
            image: std::mem::replace(&mut record.image, key.image.clone()),
        });
        record.system_disk = next;
        // Never a golden restore over this computer's `/home`.
        record.rootfs_never_booted = false;
        self.save(record).await?;
        crash_point::reach(CrashPoint::SystemDiskSaved);
        Ok(())
    }

    /// Delete system disk files the record does not name.
    pub(super) async fn remove_leftover_system_disks(
        &self,
        record: &ComputerRecord,
    ) -> Result<(), HostError> {
        let removed = self
            .disks
            .remove_other_system_disks(record.computer_id, &record.system_disks())
            .await
            .map_err(internal)?;
        if !removed.is_empty() {
            let repairs = vec![Repair::LeftoverSystemDiskRemoved; removed.len()];
            tracing::info!(computer_id = %record.computer_id, removed = ?removed, "removed leftover system disks");
            self.metrics.repaired(&repairs);
        }
        Ok(())
    }
}
