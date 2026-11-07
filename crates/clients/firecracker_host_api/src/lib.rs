#![deny(missing_docs)]

//! The REST contract of the Firecracker host agent (`services/firecracker_host`):
//! what the control plane's `FirecrackerFleet` sends over mTLS, and what the
//! agent answers. Both sides use these types; nothing else defines the wire.
//!
//! Every computer is one Firecracker microVM. A new one is a restore of the
//! host's golden snapshot for its image and shape ([`GoldenKey`]): a booted,
//! unenrolled guest, paused and saved once per image version. Its rootfs is a
//! copy-on-write copy of the image's, its `/home` is its own volume, and its
//! identity and enrollment reach the guest through MMDS ([`mmds`]).
//!
//! Power states ([`PowerState`]):
//!
//! - `running`: the VM runs.
//! - `paused`: vCPUs paused, memory kept in RAM (`freeze`). Instant to resume.
//! - `hibernated`: memory and device state saved to the VM's own disk and the
//!   process ended, holding no RAM (`hibernate`). `start` restores it.
//! - `stopped`: guest shut down; only its disks remain. `start` cold boots
//!   its own rootfs (never the golden memory: that matches only a fresh copy
//!   of the image's rootfs).
//!
//! Every request is idempotent: repeating it after a lost response does the
//! work at most once and answers the same state. Routes are declared by the
//! agent's router (its OpenAPI document); [`client::HostClient`] (feature
//! `client`) is the one client, kept in step by a contract test in the agent.

#[cfg(feature = "client")]
pub mod client;
pub mod computer;
pub mod error;
pub mod exec;
pub mod host;
pub mod mmds;
pub mod moves;

pub use computer::{
    Action, Computer, ComputerResources, CreateComputer, DiskBackend, EnrollmentDocument,
    LaunchSource, LaunchTimings, PowerState, SetEnrollment, Usage,
};
pub use computer_id::ComputerId;
pub use computer_types::{ComputerRole, ControlPlaneId, EnrollmentGeneration, GuestImage};
pub use error::{ErrorCode, ErrorResponse};
pub use host::{
    GoldenImage, GoldenKey, GoldenState, HostInfo, HostLimits, InvalidHostLimits, NetworkSlots,
};
pub use pairing_id::PairingId;
