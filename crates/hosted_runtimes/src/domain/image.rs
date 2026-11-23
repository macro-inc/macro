//! The image a computer's root disk is built from, and how its disk quota
//! splits between that root disk and the data disk that survives updates.

use crate::domain::enrollment::Enrollment;
use crate::domain::size::ComputerResources;

/// The root disk's share of a computer's disk quota, in GiB: the NixOS
/// system, Docker images and anything else that an image update replaces.
pub const ROOT_DISK_GIB: u32 = 32;

pub use computer_types::{GuestImage, InvalidGuestImage};

/// The images a fleet creates guests from: the regular guest, and the same
/// guest built in agent mode for computers that run an agent teammate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuestImages<Image> {
    /// For computers without an agent, e.g. `macro-box/2026-11-10`.
    pub regular: Image,
    /// For agent teammate computers, e.g. `macro-box-agent/2026-11-10`.
    pub agent: Image,
}

impl<Image> GuestImages<Image> {
    /// The image a new guest is created from: the agent image for an agent
    /// computer. A guest recreated after a loss enrolls with the same role,
    /// so an agent computer stays on the agent image.
    pub fn for_enrollment(&self, enrollment: &Enrollment) -> &Image {
        match enrollment.role {
            crate::domain::enrollment::ComputerRole::Agent => &self.agent,
            crate::domain::enrollment::ComputerRole::Person => &self.regular,
        }
    }

    /// Convert both images, failing on the first that does not convert.
    pub fn try_map<Other, Error>(
        self,
        mut convert: impl FnMut(Image) -> Result<Other, Error>,
    ) -> Result<GuestImages<Other>, Error> {
        Ok(GuestImages {
            regular: convert(self.regular)?,
            agent: convert(self.agent)?,
        })
    }
}

/// The `/home` sizes the current catalog sells, in GiB, smallest first.
pub fn sold_home_disk_gib() -> Vec<u32> {
    let mut sizes: Vec<u32> = crate::domain::size::SIZE_SPECS
        .iter()
        .map(|spec| spec.home_disk_gib.get())
        .collect();
    sizes.sort_unstable();
    sizes.dedup();
    sizes
}

/// The data disk's share of the disk quota: everything but [`ROOT_DISK_GIB`].
/// `None` when the quota leaves no data disk.
pub fn data_disk_gib(resources: ComputerResources) -> Option<u32> {
    resources
        .disk_gib
        .get()
        .checked_sub(ROOT_DISK_GIB)
        .filter(|gib| *gib > 0)
}

#[cfg(test)]
mod test;
