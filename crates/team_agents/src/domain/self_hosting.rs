//! Agent teammates hosted on their owner's own machine: installs, the
//! machines an inviter may host on, and why one may not.
//!
//! An install binds an agent to one harness (macrod). A delivery is
//! `(generation, delivery)`: the generation goes up with a new image or a
//! rotation, and every mint of its credentials is the next delivery. The
//! machine keeps the highest pair it has seen, and the service delivers
//! only when the machine is behind the row. Each mint revokes the agent's
//! previous key: that is the lease, so a machine the install moved away
//! from can no longer act as the agent.

use agent_runtime_protocol::domain::schema::v0::{
    ContainerEngineKind, EngineIsolation, HostArch, HostOs, HostResource, InstalledEngine,
    IsolationProblem, TeammateHostProblem, TeammateHostReport, TeammateImage, TeammateRunFailure,
    TeammateRunState,
};
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The PostHog flag for hosting agent teammates on one's own machine, on top
/// of [`agent_credentials::AGENT_TEAMMATES_FLAG`]. Off, or unreadable, means
/// no self-hosted teammates for that admin.
pub const SELF_HOSTED_TEAMMATES_FLAG: &str = "enable-self-hosted-teammates";

/// Logical CPUs a machine needs to host a teammate.
pub const MIN_HOST_CPUS: u32 = 2;
/// Memory a machine needs to host a teammate, in MiB.
pub const MIN_HOST_MEMORY_MIB: u64 = 8 * 1024;
/// Free disk a machine needs to host a teammate, in MiB.
pub const MIN_HOST_DISK_FREE_MIB: u64 = 20 * 1024;

/// How long a move or removal waits for the old machine to stop the agent
/// (its last push) before revoking its credentials anyway.
pub const CHECKPOINT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// A runtime fee for a self-hosted teammate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SelfHostedTeammatePricing {
    /// Per month, in cents.
    pub monthly_cents: u64,
}

/// What hosting a teammate on one's own machine costs: nothing, pending
/// review. Model usage is billed as today, or comes from the owner's own
/// sign-in. Nothing writes to billing.
pub const SELF_HOSTED_TEAMMATE_PRICING: Option<SelfHostedTeammatePricing> = None;

/// The teammate runtime image, one per architecture, built by Nix
/// (`nix build .#teammate-runtime-image`). Its id is the image's config
/// digest, which the build fixes; a CI check rebuilds it and compares. A new
/// id is a new generation for every install.
pub struct TeammateRuntimeImage;

impl TeammateRuntimeImage {
    /// Where machines fetch it from, tagged with the id's hex.
    pub const REPOSITORY: &str = "ghcr.io/macro-inc/teammate-runtime";
    /// The x86-64 image's id, once the build pins it.
    pub const AMD64_ID: Option<&str> = None;
    /// The arm64 image's id, once the build pins it.
    pub const ARM64_ID: Option<&str> = None;

    /// A local stack's x86-64 image, `repository@sha256:<hex>` (one built
    /// and `docker load`ed on this machine). Honoured only when
    /// `ENVIRONMENT=local`.
    pub const OVERRIDE_AMD64: &str = "OVERRIDE_TEAMMATE_RUNTIME_IMAGE_AMD64";
    /// The same for arm64.
    pub const OVERRIDE_ARM64: &str = "OVERRIDE_TEAMMATE_RUNTIME_IMAGE_ARM64";

    /// The images machines run: a local stack's `overrides`, read once at
    /// startup, else the pinned constants.
    pub fn images(overrides: LocalImages) -> RuntimeImages {
        std::sync::Arc::new(move |arch| Self::resolve(arch, &overrides))
    }

    /// The image for `arch` given a stack's `overrides`.
    pub fn resolve(arch: HostArch, overrides: &LocalImages) -> Option<TeammateImage> {
        let (local, pinned) = match arch {
            HostArch::Amd64 => (&overrides.amd64, Self::AMD64_ID),
            HostArch::Arm64 => (&overrides.arm64, Self::ARM64_ID),
            HostArch::Other => return None,
        };
        local.clone().or_else(|| {
            Some(TeammateImage {
                repository: Self::REPOSITORY.to_owned(),
                image_id: pinned?.to_owned(),
            })
        })
    }
}

/// A local stack's runtime images from `OVERRIDE_TEAMMATE_RUNTIME_IMAGE_*`.
/// Empty outside `ENVIRONMENT=local`, and for a value that isn't
/// `repository@sha256:<64 hex>`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalImages {
    /// The x86-64 override.
    pub amd64: Option<TeammateImage>,
    /// The arm64 override.
    pub arm64: Option<TeammateImage>,
}

impl LocalImages {
    /// Read the overrides with `read` (the process env outside tests).
    pub fn read(
        environment: macro_env::Environment,
        read: impl Fn(&str) -> Option<String>,
    ) -> Self {
        let mut images = Self::default();
        for (name, slot) in [
            (TeammateRuntimeImage::OVERRIDE_AMD64, &mut images.amd64),
            (TeammateRuntimeImage::OVERRIDE_ARM64, &mut images.arm64),
        ] {
            let Some(value) = read(name).filter(|value| !value.trim().is_empty()) else {
                continue;
            };
            if !matches!(environment, macro_env::Environment::Local) {
                tracing::warn!(
                    variable = name,
                    "a teammate runtime image override is ignored outside a local stack"
                );
                continue;
            }
            *slot = parse_image(value.trim());
            if slot.is_none() {
                tracing::warn!(
                    variable = name,
                    "a teammate runtime image override isn't repository@sha256:<64 hex>; ignored"
                );
            }
        }
        images
    }
}

/// `repository@sha256:<64 lowercase hex>`.
fn parse_image(value: &str) -> Option<TeammateImage> {
    let (repository, image_id) = value.rsplit_once('@')?;
    let hex = image_id.strip_prefix("sha256:")?;
    let valid = !repository.is_empty()
        && hex.len() == 64
        && hex
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
    valid.then(|| TeammateImage {
        repository: repository.to_owned(),
        image_id: image_id.to_owned(),
    })
}

/// The images machines run, by architecture: [`TeammateRuntimeImage::images`]
/// outside tests.
pub type RuntimeImages = std::sync::Arc<dyn Fn(HostArch) -> Option<TeammateImage> + Send + Sync>;

/// Where an install's container is, as its machine last said, for the
/// install's current generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum InstallRunState {
    /// The machine hasn't said anything about this generation yet.
    Pending,
    /// Fetching the runtime image.
    Downloading,
    /// The container is starting.
    Starting,
    /// The container runs.
    Running,
    /// The container stopped unasked and is restarted.
    Restarting,
    /// The container stopped as asked.
    Stopped,
    /// This generation's image failed; the container runs the image the
    /// install ran before, with this generation's credentials.
    RolledBack,
    /// The machine gave up on this generation.
    Failed,
}

/// Why a machine gave up on an install's generation. Stored snake_case;
/// camelCase on the API.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    serde::Serialize,
    serde::Deserialize,
    strum::AsRefStr,
    strum::EnumString,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "snake_case")]
pub enum InstallFailure {
    /// The image could not be fetched.
    ImageUnavailable,
    /// The fetched image's digest differs from the one asked for.
    ImageMismatch,
    /// The engine refused to create or start the container.
    EngineRefused,
    /// The agent reported a missing or invalid setting.
    BadConfiguration,
    /// The agent's code needs a newer runtime than the image has; only a
    /// newer image helps.
    IncompatibleRuntime,
    /// The agent kept failing to start.
    CrashLoop,
    /// The machine can't host teammates.
    HostUnsupported,
    /// The engine couldn't confine the teammate's network, so it wasn't
    /// started.
    NetworkIsolationUnavailable,
    /// The machine has no route to the internet, so the agent couldn't
    /// reach anything it is allowed to; it wasn't started.
    EgressBlocked,
}

impl From<TeammateRunFailure> for InstallFailure {
    fn from(failure: TeammateRunFailure) -> Self {
        match failure {
            TeammateRunFailure::ImageUnavailable => Self::ImageUnavailable,
            TeammateRunFailure::ImageMismatch => Self::ImageMismatch,
            TeammateRunFailure::EngineRefused => Self::EngineRefused,
            TeammateRunFailure::BadConfiguration => Self::BadConfiguration,
            TeammateRunFailure::IncompatibleRuntime => Self::IncompatibleRuntime,
            TeammateRunFailure::CrashLoop => Self::CrashLoop,
            TeammateRunFailure::HostUnsupported => Self::HostUnsupported,
            TeammateRunFailure::NetworkIsolationUnavailable => Self::NetworkIsolationUnavailable,
            TeammateRunFailure::EgressBlocked => Self::EgressBlocked,
        }
    }
}

/// A machine's report of an install's container, as stored.
pub fn install_state(state: &TeammateRunState) -> (InstallRunState, Option<InstallFailure>) {
    match state {
        TeammateRunState::Downloading => (InstallRunState::Downloading, None),
        TeammateRunState::Starting => (InstallRunState::Starting, None),
        TeammateRunState::Running => (InstallRunState::Running, None),
        TeammateRunState::Restarting { .. } => (InstallRunState::Restarting, None),
        TeammateRunState::Stopped => (InstallRunState::Stopped, None),
        TeammateRunState::RolledBack { reason } => (
            InstallRunState::RolledBack,
            Some(InstallFailure::from(*reason)),
        ),
        TeammateRunState::Failed { reason } => {
            (InstallRunState::Failed, Some(InstallFailure::from(*reason)))
        }
    }
}

/// A move or removal waiting for the old machine to stop the agent, so its
/// last push lands before its credentials are revoked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Checkpoint {
    /// The agent moves to this machine next.
    Moving {
        /// The machine it moves to.
        to: HarnessId,
    },
    /// The agent is being removed.
    Removing,
}

/// An agent's install on one machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeammateInstallRecord {
    /// Opaque, stable id of the install; never the agent's account id.
    pub install_id: Uuid,
    /// The agent.
    pub agent: MacroUserIdStr<'static>,
    /// The agent's team.
    pub team_id: Uuid,
    /// The machine.
    pub harness_id: HarnessId,
    /// The delivery the machine should run.
    pub generation: u64,
    /// Where the machine last said the container is.
    pub run_state: InstallRunState,
    /// Why the machine gave up, when it did.
    pub failure: Option<InstallFailure>,
    /// Mints of this generation's credentials so far.
    pub delivery: u64,
    /// The `(generation, delivery)` the machine confirmed running.
    pub applied: Option<(u64, u64)>,
    /// A move or removal waiting on the machine, and since when.
    pub checkpoint: Option<(Checkpoint, DateTime<Utc>)>,
    /// The runtime image id the latest delivery carried; `None` before the
    /// first.
    pub image_id: Option<String>,
    /// Since when the agent is parked: its machine may no longer host it, so
    /// it is stopped there and runs nowhere until an admin moves it to a
    /// machine of theirs. It keeps its account, seat and repository.
    pub parked_at: Option<DateTime<Utc>>,
    /// Its credentials must still be revoked; nothing is delivered until
    /// they are.
    pub revoke_pending: bool,
}

impl TeammateInstallRecord {
    /// Whether the agent is parked (see [`Self::parked_at`]).
    pub fn parked(&self) -> bool {
        self.parked_at.is_some()
    }
}

/// An install to create, generation 1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewTeammateInstall {
    /// A fresh UUIDv7.
    pub install_id: Uuid,
    /// The agent.
    pub agent: MacroUserIdStr<'static>,
    /// The agent's team.
    pub team_id: Uuid,
    /// The machine.
    pub harness_id: HarnessId,
    /// The admin who installed it.
    pub created_by: MacroUserIdStr<'static>,
}

/// What creating an install did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreatedInstall {
    /// The install was created.
    Created(TeammateInstallRecord),
    /// The agent already has an install; nothing was created.
    AlreadyInstalled(TeammateInstallRecord),
}

/// One of an inviter's own machines, as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct HostFacts {
    /// The machine's harness.
    pub harness_id: HarnessId,
    /// Its name.
    pub name: String,
    /// Whether its macrod is connected now.
    pub connected: bool,
    /// Its latest hosting report, if it ever sent one.
    pub report: Option<TeammateHostReport>,
}

/// Why a machine can't host a teammate now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum HostIneligibility {
    /// Its macrod isn't connected.
    Offline,
    /// Its macrod never said whether it can host teammates (an older macrod).
    NotReported,
    /// No supported container engine is installed.
    NoEngine,
    /// An engine is installed but didn't answer.
    EngineUnreachable,
    /// No teammate runtime image for its operating system or architecture.
    UnsupportedPlatform,
    /// Below the hardware floor.
    BelowFloor,
    /// Its security settings block the teammate's inner sandbox.
    InnerSandboxUnavailable,
    /// Its engine can't confine a teammate's network to the public internet.
    NetworkIsolationUnavailable,
}

/// A resource of the hardware floor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum FloorResource {
    /// Logical CPUs.
    Cpus,
    /// Memory.
    Memory,
    /// Free disk.
    Disk,
}

impl From<HostResource> for FloorResource {
    fn from(resource: HostResource) -> Self {
        match resource {
            HostResource::Cpus => Self::Cpus,
            HostResource::Memory => Self::Memory,
            HostResource::Disk => Self::Disk,
        }
    }
}

/// Whether a machine can host a teammate now, and why not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct HostEligibility {
    /// It can.
    pub ok: bool,
    /// Why not, when it can't.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<HostIneligibility>,
    /// The resource that is short, with [`HostIneligibility::BelowFloor`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<FloorResource>,
}

impl HostEligibility {
    /// Eligible.
    pub const OK: Self = Self {
        ok: true,
        reason: None,
        resource: None,
    };

    fn not(reason: HostIneligibility) -> Self {
        Self {
            ok: false,
            reason: Some(reason),
            resource: None,
        }
    }

    fn below_floor(resource: FloorResource) -> Self {
        Self {
            ok: false,
            reason: Some(HostIneligibility::BelowFloor),
            resource: Some(resource),
        }
    }

    /// A machine is eligible when it is connected, its last report has an
    /// engine and no problem, an image is built for its architecture, and
    /// it meets the hardware floor (checked here again, not only by macrod).
    /// Unknown free disk is left to macrod.
    pub fn of(
        connected: bool,
        report: Option<&TeammateHostReport>,
        images: impl Fn(HostArch) -> Option<TeammateImage>,
    ) -> Self {
        if !connected {
            return Self::not(HostIneligibility::Offline);
        }
        let Some(report) = report else {
            return Self::not(HostIneligibility::NotReported);
        };

        match &report.problem {
            Some(TeammateHostProblem::NoEngine) => return Self::not(HostIneligibility::NoEngine),
            Some(TeammateHostProblem::EngineUnreachable) => {
                return Self::not(HostIneligibility::EngineUnreachable);
            }
            Some(TeammateHostProblem::UnsupportedPlatform) => {
                return Self::not(HostIneligibility::UnsupportedPlatform);
            }
            Some(TeammateHostProblem::BelowFloor { resource }) => {
                return Self::below_floor(FloorResource::from(*resource));
            }
            Some(TeammateHostProblem::InnerSandboxUnavailable) => {
                return Self::not(HostIneligibility::InnerSandboxUnavailable);
            }
            Some(TeammateHostProblem::NetworkIsolationUnavailable) => {
                return Self::not(HostIneligibility::NetworkIsolationUnavailable);
            }
            None => {}
        }

        if report.engine.is_none() {
            return Self::not(HostIneligibility::NoEngine);
        }
        if images(report.arch).is_none() {
            return Self::not(HostIneligibility::UnsupportedPlatform);
        }
        if report.cpus < MIN_HOST_CPUS {
            return Self::below_floor(FloorResource::Cpus);
        }
        if report.memory_mib < MIN_HOST_MEMORY_MIB {
            return Self::below_floor(FloorResource::Memory);
        }
        if report
            .disk_free_mib
            .is_some_and(|free| free < MIN_HOST_DISK_FREE_MIB)
        {
            return Self::below_floor(FloorResource::Disk);
        }
        Self::OK
    }
}

/// A container engine, as the Invite dialog shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum HostEngineKind {
    /// Docker.
    Docker,
    /// Podman.
    Podman,
}

/// An operating system, as the Invite dialog shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum HostPlatformOs {
    /// Linux.
    Linux,
    /// macOS.
    Macos,
    /// Windows.
    Windows,
    /// Anything else.
    Other,
}

/// A CPU architecture, as the Invite dialog shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum HostPlatformArch {
    /// x86-64.
    Amd64,
    /// 64-bit ARM.
    Arm64,
    /// Anything else.
    Other,
}

/// A machine's container engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct HostEngine {
    /// Which engine.
    pub kind: HostEngineKind,
    /// Its version, as it reports it.
    pub version: String,
    /// Whether it runs without root.
    pub rootless: bool,
}

/// A container engine installed on a machine, chosen or not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct HostInstalledEngine {
    /// Which engine.
    pub kind: HostEngineKind,
    /// Its version, when it answered.
    pub version: Option<String>,
    /// Whether it runs without root.
    pub rootless: bool,
    /// Whether it can confine a teammate's network.
    pub isolation: HostEngineIsolation,
}

/// Whether an engine can confine a teammate's network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum HostEngineIsolation {
    /// It put the policy in place and read it back.
    Enforced,
    /// It couldn't.
    Unavailable {
        /// Why.
        reason: HostIsolationProblem,
    },
    /// Not checked yet: no teammate image on the machine, or the engine
    /// didn't answer.
    NotProbed,
}

/// Why an engine can't confine a teammate's network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum HostIsolationProblem {
    /// The firewall rules couldn't be loaded.
    GuardRefused,
    /// The loaded rules didn't read back as written.
    ReadbackMismatch,
    /// The machine's own addresses couldn't be read.
    HostUnreadable,
    /// The engine failed a step or took too long.
    EngineFailed,
}

/// What a machine last reported about hosting teammates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct HostReport {
    /// The container engine chosen to run teammates, if any.
    pub engine: Option<HostEngine>,
    /// Every engine installed, and whether each can confine a teammate's
    /// network.
    pub engines: Vec<HostInstalledEngine>,
    /// Operating system.
    pub os: HostPlatformOs,
    /// CPU architecture.
    pub arch: HostPlatformArch,
    /// Logical CPUs.
    pub cpus: u32,
    /// Total memory, in MiB.
    pub memory_mib: u64,
    /// Free disk for images and volumes, in MiB.
    pub disk_free_mib: Option<u64>,
}

impl From<&TeammateHostReport> for HostReport {
    fn from(report: &TeammateHostReport) -> Self {
        Self {
            engine: report.engine.as_ref().map(|engine| HostEngine {
                kind: HostEngineKind::from(engine.kind),
                version: engine.version.clone(),
                rootless: engine.rootless,
            }),
            os: match report.os {
                HostOs::Linux => HostPlatformOs::Linux,
                HostOs::Macos => HostPlatformOs::Macos,
                HostOs::Windows => HostPlatformOs::Windows,
                HostOs::Other => HostPlatformOs::Other,
            },
            arch: match report.arch {
                HostArch::Amd64 => HostPlatformArch::Amd64,
                HostArch::Arm64 => HostPlatformArch::Arm64,
                HostArch::Other => HostPlatformArch::Other,
            },
            cpus: report.cpus,
            memory_mib: report.memory_mib,
            disk_free_mib: report.disk_free_mib,
            engines: report
                .engines
                .iter()
                .map(HostInstalledEngine::from)
                .collect(),
        }
    }
}

impl From<ContainerEngineKind> for HostEngineKind {
    fn from(kind: ContainerEngineKind) -> Self {
        match kind {
            ContainerEngineKind::Docker => Self::Docker,
            ContainerEngineKind::Podman => Self::Podman,
        }
    }
}

impl From<&InstalledEngine> for HostInstalledEngine {
    fn from(engine: &InstalledEngine) -> Self {
        Self {
            kind: HostEngineKind::from(engine.kind),
            version: engine.version.clone(),
            rootless: engine.rootless,
            isolation: match engine.isolation {
                EngineIsolation::Enforced => HostEngineIsolation::Enforced,
                EngineIsolation::Unavailable { reason } => HostEngineIsolation::Unavailable {
                    reason: match reason {
                        IsolationProblem::GuardRefused => HostIsolationProblem::GuardRefused,
                        IsolationProblem::ReadbackMismatch => {
                            HostIsolationProblem::ReadbackMismatch
                        }
                        IsolationProblem::HostUnreadable => HostIsolationProblem::HostUnreadable,
                        IsolationProblem::EngineFailed => HostIsolationProblem::EngineFailed,
                    },
                },
                EngineIsolation::NotProbed => HostEngineIsolation::NotProbed,
            },
        }
    }
}

/// One of the inviter's own machines, for the Invite dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeammateHost {
    /// The machine's harness.
    pub harness_id: HarnessId,
    /// Its name.
    pub name: String,
    /// Whether its macrod is connected now.
    pub connected: bool,
    /// macOS and Windows engines (Docker Desktop, Podman machine) are
    /// allowed but untested.
    pub experimental: bool,
    /// Its latest hosting report.
    pub report: Option<HostReport>,
    /// Whether it can host a teammate now.
    pub eligibility: HostEligibility,
}

impl TeammateHost {
    /// The machine as the Invite dialog shows it.
    pub fn new(facts: HostFacts, images: impl Fn(HostArch) -> Option<TeammateImage>) -> Self {
        let eligibility = HostEligibility::of(facts.connected, facts.report.as_ref(), images);
        let report = facts.report.as_ref().map(HostReport::from);
        let experimental = report.as_ref().is_some_and(|report| {
            matches!(report.os, HostPlatformOs::Macos | HostPlatformOs::Windows)
        });
        Self {
            harness_id: facts.harness_id,
            name: facts.name,
            connected: facts.connected,
            experimental,
            report,
            eligibility,
        }
    }
}

/// The inviter's own machines.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeammateHosts {
    /// The machines, by name.
    pub hosts: Vec<TeammateHost>,
}

/// Body of `POST /team_agents/{agent}/install`: move the agent to another of
/// the admin's own machines.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MoveTeammate {
    /// The machine to run the agent on.
    pub harness_id: HarnessId,
}

/// What a machine needs to run an install's generation: the image and the
/// agent's freshly issued environment. Issued only to the replica holding
/// the machine's socket, never cached.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedInstall {
    /// The install's generation.
    pub generation: u64,
    /// Which mint of that generation's credentials this is.
    pub delivery: u64,
    /// The runtime image, by id.
    pub image: TeammateImage,
    /// Credentials and addresses.
    pub env: hosted_runtimes::domain::agent::AgentEnv,
}
