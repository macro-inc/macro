#![deny(missing_docs)]

//! Values shared by the computers control plane (`hosted_runtimes`) and the
//! Firecracker host agent's contract (`firecracker_host_api`): one type per
//! value, validated where it is made.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Whom a computer is for, fixed at purchase. The guest grants its `macro`
/// user sudo and Docker only on a person's computer. Not a secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, strum::Display)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ComputerRole {
    /// A person's computer: its user may administer it.
    Person,
    /// An agent teammate's computer: the agent runs there, and its user gets
    /// no administrator rights.
    Agent,
}

/// Identifies one creation of a computer's guest, including retries of that
/// creation.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema), schema(value_type = u32))]
#[serde(transparent)]
pub struct EnrollmentGeneration(u32);

impl EnrollmentGeneration {
    /// Construct a persisted generation; zero means no guest has been created.
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    /// The persisted counter value.
    pub const fn get(self) -> u32 {
        self.0
    }

    /// Reserve the next creation without wrapping the counter.
    pub fn next(self) -> Option<Self> {
        self.0.checked_add(1).map(Self)
    }
}

impl std::fmt::Display for EnrollmentGeneration {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Stable identity shared by replicas of one computer control plane.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema), schema(value_type = String))]
#[serde(into = "String", try_from = "String")]
pub struct ControlPlaneId(String);

/// An identity that cannot safely be used in ownership metadata.
#[derive(Debug, thiserror::Error)]
#[error("a control plane id is nonempty ASCII alphanumerics, hyphens or underscores")]
pub struct InvalidControlPlaneId;

impl ControlPlaneId {
    /// Reject empty identities and characters outside ASCII letters,
    /// digits, `_` and `-`.
    pub fn try_new(value: &str) -> Result<Self, InvalidControlPlaneId> {
        if value.is_empty()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(InvalidControlPlaneId);
        }
        Ok(Self(value.to_owned()))
    }

    /// The exact identity.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ControlPlaneId {
    type Error = InvalidControlPlaneId;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl std::fmt::Display for ControlPlaneId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// A versioned guest image, e.g. `macro-box/2026-11-17`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema), schema(value_type = String))]
#[serde(into = "String", try_from = "String")]
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
            || !value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(byte, b'-' | b'_' | b'.' | b'/' | b':' | b'@')
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
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl From<ControlPlaneId> for String {
    fn from(value: ControlPlaneId) -> Self {
        value.0
    }
}

impl From<GuestImage> for String {
    fn from(value: GuestImage) -> Self {
        value.0
    }
}
