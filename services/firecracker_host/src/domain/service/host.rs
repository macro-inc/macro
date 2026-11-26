//! The host as a whole: its goldens, its memory limits, and what it reports.

use firecracker_host_api::{
    GoldenImage, GoldenKey, HostInfo, HostLimits, ImageFileName, NetworkSlots, StageImage,
    StagedImage,
};

use super::{HostError, HostProbe, HostService, InvalidRequest, internal};
use crate::domain::ports::{Disks, GoldenAvailability, Goldens, Machines, Store};

#[cfg(test)]
mod test;

/// The largest image file staging accepts: a rootfs is 16 GiB today.
const MAX_IMAGE_FILE_BYTES: u64 = 64 << 30;

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> HostService<S, D, G, M, P> {
    /// Build a golden unless it is ready or building.
    pub fn build_golden(&self, key: GoldenKey) -> Result<GoldenImage, HostError> {
        match self.goldens.availability(&key) {
            GoldenAvailability::ImageMissing => return Err(HostError::ImageMissing(key.image)),
            GoldenAvailability::Absent => self.goldens.build(key.clone()),
            GoldenAvailability::Ready | GoldenAvailability::Building => {}
        }
        self.goldens
            .list()
            .into_iter()
            .find(|golden| golden.key == key)
            .ok_or_else(|| HostError::GoldenNotReady(key.image))
    }

    /// Every golden.
    pub fn goldens(&self) -> Vec<GoldenImage> {
        self.goldens.list()
    }

    /// Stage an image unless it is in place with these contents.
    #[tracing::instrument(name = "firecracker_host.stage_image", skip_all, fields(image = %request.image), err)]
    pub fn stage_image(&self, request: StageImage) -> Result<StagedImage, HostError> {
        if !super::image_name_is_safe(request.image.as_str()) {
            return Err(InvalidRequest::UnsafeImage(request.image).into());
        }
        let mut names: Vec<ImageFileName> = request.files.iter().map(|file| file.name).collect();
        names.sort();
        if names
            != [
                ImageFileName::Vmlinux,
                ImageFileName::RootfsExt4,
                ImageFileName::BootArgs,
            ]
        {
            return Err(InvalidRequest::ImageFiles.into());
        }
        if let Some(file) = request
            .files
            .iter()
            .find(|file| !file.url.0.starts_with("https://") || file.bytes > MAX_IMAGE_FILE_BYTES)
        {
            return Err(InvalidRequest::ImageSource(file.name).into());
        }
        Ok(self.goldens.stage_image(request))
    }

    /// Every image and where its staging stands.
    pub fn images(&self) -> Vec<StagedImage> {
        self.goldens.staged_images()
    }

    /// The control plane's memory limits, if set.
    pub fn host_limits(&self) -> Option<HostLimits> {
        self.host_limits
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// The `/home` sizes the control plane sells; none before its first
    /// limits.
    pub fn home_sizes_gib(&self) -> Vec<u32> {
        self.host_limits()
            .map(|limits| limits.home_disk_gib)
            .unwrap_or_default()
    }

    /// Set the host's memory limits: applied to the VMs' parent cgroup and
    /// kept across restarts.
    #[tracing::instrument(name = "firecracker_host.set_host_limits", skip(self), err)]
    pub async fn set_host_limits(&self, limits: HostLimits) -> Result<(), HostError> {
        let limits = HostLimits::new(
            limits.guest_memory_max_bytes,
            limits.squeeze_above_bytes,
            limits.squeeze_below_bytes,
            limits.home_disk_gib,
        )
        .map_err(InvalidRequest::from)?;
        self.store
            .save_host_limits(&limits)
            .await
            .map_err(internal)?;
        self.machines
            .set_guest_memory_max(limits.guest_memory_max_bytes)
            .await
            .map_err(internal)?;
        *self
            .host_limits
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(limits);
        Ok(())
    }

    /// The host.
    pub fn host(&self) -> HostInfo {
        let measurement = self.probe.measure();
        let (total, free) = {
            let slots = self.slot_pool();
            (slots.total(), slots.free())
        };
        HostInfo {
            name: self.settings.host_name.clone(),
            firecracker_version: self.settings.firecracker_version.clone(),
            agent_version: self.settings.agent_version.clone(),
            limits: self.host_limits(),
            cpus: measurement.cpus,
            memory_total_bytes: measurement.memory_total_bytes,
            memory_available_bytes: measurement.memory_available_bytes,
            guest_resident_memory_bytes: measurement.guest_resident_memory_bytes,
            ksm_shared_bytes: measurement.ksm_shared_bytes,
            network_slots: NetworkSlots {
                total: u32::from(total),
                free: u32::try_from(free).unwrap_or(u32::MAX),
            },
            images: self.goldens.images(),
            goldens: self.goldens.list(),
            move_address: self.settings.move_address.clone(),
        }
    }
}
