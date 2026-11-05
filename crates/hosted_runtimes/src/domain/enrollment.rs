//! What a computer reads at first boot to join Macro.
//!
//! The control plane writes one [`Enrollment`] as JSON into the instance
//! config key [`INCUS_ENROLLMENT_KEY`] (read in the guest from `/dev/incus`),
//! or into a file for Docker computers, and deletes it once macrod connects.
//! These types are the contract between the control plane and
//! `macrod enroll`; macrod depends on this crate with default features off.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Instance config key carrying the JSON [`Enrollment`].
pub const INCUS_ENROLLMENT_KEY: &str = "user.macro.enrollment";

/// One-time join material. The device secret claims a pre-approved harness
/// pairing exactly once; a copy read after that claim is useless.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Enrollment {
    pub computer_id: Uuid,
    pub pairing_id: Uuid,
    pub device_secret: String,
    /// Display name the harness shows in Settings → Runtimes.
    pub name: String,
    /// `OVERRIDE_*` service URL variables (see `macro_service_urls`) macrod
    /// must use, for stacks that are not the computer's default environment.
    pub service_url_overrides: BTreeMap<String, String>,
    /// The agent persona this computer is bought for, if any.
    pub persona: Option<Persona>,
}

/// An agent identity that lives on the computer next to macrod: its own OS
/// user and its own long-running systemd service.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Persona {
    pub name: String,
    /// Linux user created for the persona; its service runs as this user.
    pub os_user: String,
    pub extra_service: PersonaService,
    /// Written to `/etc/macro/personas/<os_user>.env` and loaded by the
    /// persona's unit as its `EnvironmentFile`.
    pub config: BTreeMap<String, String>,
}

/// The persona's systemd service, installed as
/// `/etc/systemd/system/<unit_name>.service`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PersonaService {
    /// Unit name without the `.service` suffix.
    pub unit_name: String,
    /// `ExecStart` command line.
    pub exec: String,
    /// Extra `Environment=` values, on top of the `EnvironmentFile`.
    pub env: BTreeMap<String, String>,
}
