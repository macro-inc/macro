//! The image a computer's root disk is built from, and how its disk quota
//! splits between that root disk and the data disk that survives updates.

use serde::{Deserialize, Serialize};

use crate::domain::enrollment::Enrollment;
use crate::domain::size::ComputerResources;

/// The root disk's share of a computer's disk quota, in GiB: the NixOS
/// system, Docker images and anything else that an image update replaces.
pub const ROOT_DISK_GIB: u32 = 32;

/// A versioned guest image: an Incus alias such as `macro-box/2026-11-10`, or
/// a Docker tag such as `macro-box:latest`. Each fleet validates its own form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct GuestImage(String);

/// An empty, overlong or unsafe image name.
#[derive(Debug, thiserror::Error)]
#[error("image must be 1..=255 characters of letters, digits and -_./:@")]
pub struct InvalidGuestImage;

impl GuestImage {
    /// Validate an image name.
    pub fn try_new(value: &str) -> Result<Self, InvalidGuestImage> {
        if value.is_empty()
            || value.len() > 255
            || !value.bytes().all(|b| {
                b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'/' | b':' | b'@')
            })
        {
            return Err(InvalidGuestImage);
        }
        Ok(Self(value.to_owned()))
    }
    /// Borrow the image name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for GuestImage {
    type Error = InvalidGuestImage;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl std::fmt::Display for GuestImage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for GuestImage {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

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
    /// The image a new guest is created from: the agent image when its
    /// enrollment carries an agent. A guest recreated after a loss enrolls
    /// the same way, so an agent computer stays on the agent image.
    pub fn for_enrollment(&self, enrollment: &Enrollment) -> &Image {
        if enrollment.agent.is_some() {
            &self.agent
        } else {
            &self.regular
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
