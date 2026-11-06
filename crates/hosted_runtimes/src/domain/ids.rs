//! Typed identities at computer domain boundaries.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A computer identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ComputerId(Uuid);

impl ComputerId {
    /// Wrap an already parsed UUID.
    pub const fn new(id: Uuid) -> Self {
        Self(id)
    }
    /// Return the underlying UUID at a storage or external boundary.
    pub const fn into_inner(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for ComputerId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl std::str::FromStr for ComputerId {
    type Err = uuid::Error;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value).map(Self)
    }
}

/// A one-time enrollment pairing identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PairingId(Uuid);

impl PairingId {
    /// Wrap an already parsed UUID.
    pub const fn new(id: Uuid) -> Self {
        Self(id)
    }
    /// Return the underlying UUID at a storage or external boundary.
    pub const fn into_inner(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for PairingId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl std::str::FromStr for PairingId {
    type Err = uuid::Error;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value).map(Self)
    }
}

/// A fleet host identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct HostId(Uuid);

impl HostId {
    /// Wrap an already parsed UUID.
    pub const fn new(id: Uuid) -> Self {
        Self(id)
    }
    /// Return the underlying UUID at a storage or external boundary.
    pub const fn into_inner(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for HostId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl std::str::FromStr for HostId {
    type Err = uuid::Error;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value).map(Self)
    }
}
