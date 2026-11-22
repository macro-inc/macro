//! Draft `agent-runtime.v0` message types.
//!
//! The logical protocol multiplexes two kinds of traffic over one stream:
//! runtime/agent lifecycle events and ACP conversation traffic. Each
//! direction has its own envelope - [`ToRuntimeMessage`] for Agent Service to
//! Agent Runtime traffic and [`ToServerMessage`] for the reverse -
//! discriminated by a `"type"` field. Only the wrapped ACP payload is itself
//! a JSON-RPC message; the outer envelope is not.
//!
//! A connection hosts exactly one agent execution, so nothing on this schema
//! needs an agent or agent-instance identifier: [`AcpMessage`] simply carries
//! the agent's raw ACP traffic.

use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::SessionConfigOption;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use specta::Type;
use specta_typescript::Unknown;

#[cfg(test)]
mod test;

/// The kind of runtime or agent state transition reported to the Agent Service.
///
/// The protocol does not define a full event-name catalog yet, so this enum
/// is non-exhaustive: unrecognized wire strings still round-trip losslessly
/// through [`SystemEvent::Unknown`]. [`SystemEvent::AcpReady`] is the one
/// name the Agent Service actually acts on - it waits for it before starting
/// the ACP `initialize`/`session/new` handshake - rather than merely
/// forwarding it for observability.
///
/// This has a hand-written [`Serialize`]/[`Deserialize`] impl rather than a
/// derive, so it cannot derive [`specta::Type`] either: nothing here
/// introspects its shape for TypeScript. Every field that carries a
/// `SystemEvent` is instead given a `#[specta(type = String)]` override at
/// the field, matching the plain string it actually serializes as.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SystemEvent {
    /// The Agent Runtime's hosted agent process is up and its ACP channel is
    /// wired end-to-end: the Agent Service may now start the ACP
    /// `initialize`/`session/new` handshake. Sent at most once per
    /// connection, before any ACP traffic.
    AcpReady,
    /// The session transport closed or failed and no more frames will arrive.
    Disconnected,
    /// The hosted provider recovered history; the client must reload when idle.
    ReloadRequired,
    /// An application-defined event name with no protocol-level meaning yet.
    Unknown(String),
}

impl SystemEvent {
    /// Borrow the wire string for this event name.
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::AcpReady => "acp_ready",
            Self::Disconnected => "disconnected",
            Self::ReloadRequired => "reload_required",
            Self::Unknown(name) => name,
        }
    }
}

impl Serialize for SystemEvent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for SystemEvent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match String::deserialize(deserializer)?.as_str() {
            "acp_ready" => Self::AcpReady,
            "disconnected" => Self::Disconnected,
            "reload_required" => Self::ReloadRequired,
            name => Self::Unknown(name.to_owned()),
        })
    }
}

/// One complete ACP JSON-RPC message routed between the Agent Service and the
/// single agent execution hosted by this connection.
///
/// Its own JSON-RPC fields are opaque to TypeScript consumers here (typed as
/// an arbitrary object of unknown values): they already have a proper ACP SDK
/// on the TypeScript side, so this crate only needs to guarantee the message
/// round-trips unchanged. This is typed as a map rather than plain `unknown`
/// because [`ToRuntimeMessage`]/[`ToServerMessage`] carry it in an internally
/// tagged `Acp` variant, which requires its payload provably serialize as an
/// object so the `"type"` tag can be merged into it. `#[serde(transparent)]`
/// changes nothing about the actual wire format here - a single-field tuple
/// struct already serializes transparently by default - but it does tell
/// specta's serde-compatibility checker that this newtype is transparent, so
/// it looks through to the map type below instead of treating `AcpMessage`
/// itself as an opaque, non-mergeable struct.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct AcpMessage(
    #[specta(type = std::collections::HashMap<String, Unknown>)] pub RawJsonRpcMessage,
);

/// The result of probing a fresh ACP subprocess.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ModelProbeResult {
    /// The raw options returned by `session/new`.
    Available {
        /// Session configuration options exactly as the agent returned them.
        #[serde(rename = "configOptions")]
        #[specta(type = Vec<Unknown>)]
        config_options: Vec<SessionConfigOption>,
    },
    /// A safe, operator-actionable failure description.
    Error {
        /// Failure text safe to return across the runtime connection.
        message: String,
    },
}

/// The dial header a runtime lists the optional messages it accepts in,
/// comma-separated. The service sends an optional message only to a runtime
/// that listed it, so older runtimes never receive one they cannot read.
pub const RUNTIME_ACCEPTS_HEADER: &str = "x-macro-runtime-accepts";

/// The [`RUNTIME_ACCEPTS_HEADER`] entry for [`ToRuntimeMessage::AgentsChanged`].
pub const ACCEPTS_AGENTS_CHANGED: &str = "agents-changed";

/// The [`RUNTIME_ACCEPTS_HEADER`] entry for [`ToRuntimeMessage::ApplyAgent`]:
/// a runtime that doesn't list it can't run an agent teammate.
pub const ACCEPTS_APPLY_AGENT: &str = "apply-agent";

/// The [`RUNTIME_ACCEPTS_HEADER`] entry for [`ToRuntimeMessage::RunTeammate`]
/// and [`ToRuntimeMessage::StopTeammate`]: the runtime can host agent
/// teammates in the teammate runtime container on its own machine. It lists
/// it only when it found a container engine it supports; its
/// [`ToServerMessage::TeammateHost`] report says which, or why not.
pub const ACCEPTS_TEAMMATE_CONTAINER: &str = "teammate-container";

/// The [`RUNTIME_ACCEPTS_HEADER`] entry for
/// [`ToRuntimeMessage::RecheckTeammateHost`]. A runtime set up to host
/// teammates lists it whether or not its engine answers, so a machine whose
/// engine was down can be asked to check again.
pub const ACCEPTS_RECHECK_TEAMMATE_HOST: &str = "recheck-teammate-host";

/// Agent Service to Agent Runtime traffic on the logical protocol stream.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
#[non_exhaustive]
pub enum ToRuntimeMessage {
    /// An ACP message routed to the hosted agent.
    Acp(AcpMessage),
    /// Probe a separate fresh agent process for its session configuration.
    ///
    /// The request carries no parameters: it asks this connection's one
    /// configured harness what it advertises. Answers are therefore
    /// interchangeable, so nothing correlates a response to a request.
    ModelProbeRequest,
    /// The agents bound to this runtime may have changed: re-read them.
    ///
    /// A hint with no payload, sent when the service may have just bound an
    /// agent to the runtime, so it starts serving that agent's triggers at
    /// once rather than at its next poll. Runtimes that do not serve
    /// triggers ignore it.
    AgentsChanged,
    /// Check the machine's teammate hosting again now (the container
    /// engine, the floor, the isolation probe) and send a fresh
    /// [`ToServerMessage::TeammateHost`] report. A hint, sent when a person
    /// asks to check again; sent only to a runtime that listed
    /// [`ACCEPTS_RECHECK_TEAMMATE_HOST`].
    RecheckTeammateHost {
        /// W3C `traceparent` of the service's span that asked, so the
        /// runtime's check joins its trace. Opaque ids only.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        traceparent: Option<String>,
    },
    /// Run this agent teammate on the computer: write its environment where
    /// the guest's agent service reads it, which (re)starts the agent. Sent
    /// to a warm pool computer a purchase took for an agent; the agent's own
    /// online report, not a reply, confirms it.
    ApplyAgent {
        /// The agent's environment.
        environment: AgentEnvironment,
        /// W3C context of the computer's setup, so the agent's start joins
        /// its trace. Absent from older services.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        traceparent: Option<String>,
    },
    /// Run this agent teammate in the teammate runtime container on this
    /// machine, replacing the install's earlier generation if one runs. Sent
    /// only to a runtime that listed [`ACCEPTS_TEAMMATE_CONTAINER`]; the
    /// runtime answers with [`ToServerMessage::TeammateStatus`] reports, and
    /// the agent's own online report confirms it.
    RunTeammate {
        /// Which install, and which generation of it, this is.
        install: TeammateInstall,
        /// The runtime image to run, pinned by its id.
        image: TeammateImage,
        /// The agent's environment: its install credentials and addresses.
        environment: AgentEnvironment,
        /// W3C `traceparent` of the service's delivery span, so the
        /// runtime's spans join its trace. Opaque ids only.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        traceparent: Option<String>,
    },
    /// Stop this agent teammate's container and delete its install: the
    /// container, its volumes and its credentials file. Sent when the agent
    /// moves to another machine or is removed; the agent's memory is in its
    /// repository. A generation older than the one the runtime runs is
    /// ignored.
    StopTeammate {
        /// The install to stop.
        install: TeammateInstall,
        /// W3C `traceparent` of the service's span that asked for the stop.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        traceparent: Option<String>,
    },
}

/// One install of an agent teammate on one machine. An install's id stays
/// the same for its life; a runtime never lets an older
/// `(generation, delivery)` replace a newer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TeammateInstall {
    /// Opaque, stable id of the install (never the agent's account id).
    pub install_id: TeammateInstallId,
    /// The install's generation: a new machine, image or rotation.
    pub generation: u64,
    /// Which delivery of that generation's credentials this is. The service
    /// counts every mint, so a resend after a failed send is a newer
    /// delivery of the same generation, and a runtime applies the highest
    /// `(generation, delivery)` it has seen and ignores the rest.
    #[serde(default)]
    pub delivery: u64,
}

/// An install's opaque id: ASCII letters, digits and `-`, 1 to 64 long, so
/// a runtime can name containers and volumes after it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Type)]
#[serde(transparent)]
pub struct TeammateInstallId(String);

/// The text is not a valid install id.
#[derive(Debug, thiserror::Error)]
#[error("a teammate install id is 1 to 64 ASCII letters, digits or '-'")]
pub struct InvalidTeammateInstallId;

impl TeammateInstallId {
    /// Validate an id.
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidTeammateInstallId> {
        let value = value.into();
        let valid = (1..=64).contains(&value.len())
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidTeammateInstallId)
        }
    }

    /// The id.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for TeammateInstallId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// The teammate runtime image for the runtime's architecture. `image_id` is
/// the image's config digest (what `docker image inspect` reports as `Id`),
/// which the Nix build fixes; a pulled or loaded image whose id differs is
/// refused, so the registry tag is only where to fetch it from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TeammateImage {
    /// Where to fetch it, e.g. `ghcr.io/macro-inc/teammate-runtime`, tagged
    /// with the id's hex.
    pub repository: String,
    /// The image's id: `sha256:` and 64 lowercase hex digits.
    pub image_id: String,
}

/// What a runtime can do about hosting agent teammates, reported once per
/// connection by a runtime that knows the message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TeammateHostReport {
    /// The container engine chosen to run teammates, if any.
    pub engine: Option<ContainerEngine>,
    /// Every engine installed here, and whether each can enforce a
    /// teammate's egress policy, so the choice is visible.
    #[serde(default)]
    pub engines: Vec<InstalledEngine>,
    /// The machine's operating system.
    pub os: HostOs,
    /// The machine's CPU architecture.
    pub arch: HostArch,
    /// Logical CPUs.
    pub cpus: u32,
    /// Total memory, in MiB.
    pub memory_mib: u64,
    /// Free disk where the engine keeps images and volumes, in MiB.
    pub disk_free_mib: Option<u64>,
    /// Why this machine can't host a teammate; `None` when it can.
    pub problem: Option<TeammateHostProblem>,
    /// The installs whose containers this runtime keeps, with the generation
    /// each runs, so the service redelivers only what is behind.
    #[serde(default)]
    pub installs: Vec<TeammateInstall>,
}

/// A container engine the runtime can drive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContainerEngine {
    /// Which engine.
    pub kind: ContainerEngineKind,
    /// Its server version, as it reports it.
    pub version: String,
    /// Whether it runs without root on the host.
    pub rootless: bool,
}

/// An engine installed on the machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEngine {
    /// Which engine.
    pub kind: ContainerEngineKind,
    /// Its server version, when it answered.
    pub version: Option<String>,
    /// Whether it runs without root on the host.
    pub rootless: bool,
    /// Whether it can put a teammate's egress policy in place.
    pub isolation: EngineIsolation,
}

/// Whether an engine can enforce a teammate's egress policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum EngineIsolation {
    /// Its probe put the policy in place and read it back.
    Enforced,
    /// Its probe failed.
    Unavailable {
        /// Why.
        reason: IsolationProblem,
    },
    /// Not probed: no teammate image is here yet, or the engine didn't
    /// answer.
    NotProbed,
}

/// Why an engine can't enforce the egress policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum IsolationProblem {
    /// The guard couldn't load the ruleset (no nftables, no `NET_ADMIN`).
    GuardRefused,
    /// The loaded ruleset didn't read back as rendered.
    ReadbackMismatch,
    /// The host's addresses couldn't be read.
    HostUnreadable,
    /// The engine failed a step (the holder, the network) or took too long.
    EngineFailed,
}

/// The engines a runtime may drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ContainerEngineKind {
    /// Docker Engine, or Docker Desktop's.
    Docker,
    /// Podman.
    Podman,
}

/// Operating systems a runtime reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum HostOs {
    /// Linux.
    Linux,
    /// macOS.
    Macos,
    /// Windows.
    Windows,
    /// Anything else.
    Other,
}

/// CPU architectures a runtime reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum HostArch {
    /// x86-64.
    Amd64,
    /// 64-bit ARM.
    Arm64,
    /// Anything else.
    Other,
}

/// Why a machine can't host a teammate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TeammateHostProblem {
    /// No supported container engine is installed. The runtime never
    /// installs one.
    NoEngine,
    /// An engine is installed but didn't answer (stopped, or no permission).
    EngineUnreachable,
    /// The operating system or architecture has no teammate runtime image.
    UnsupportedPlatform,
    /// The engine can't give the container the user namespaces its inner
    /// sandboxes (bubblewrap, Chromium) need, e.g. a host AppArmor policy.
    InnerSandboxUnavailable,
    /// No installed engine passed the network-isolation probe, so the
    /// teammate's egress policy can't be enforced; it never runs open.
    NetworkIsolationUnavailable,
    /// The machine is below the teammate runtime's hardware floor.
    BelowFloor {
        /// The resource that is short.
        resource: HostResource,
    },
}

/// A resource in the hardware floor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum HostResource {
    /// Logical CPUs.
    Cpus,
    /// Memory.
    Memory,
    /// Free disk.
    Disk,
}

/// Where an install's container is, as the runtime last saw it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum TeammateRunState {
    /// Fetching and verifying the runtime image.
    Downloading,
    /// The container is starting.
    Starting,
    /// The container runs.
    Running,
    /// The container stopped and was not asked to: it is restarted.
    Restarting {
        /// Restarts in a row so far.
        attempt: u32,
    },
    /// The container stopped as asked.
    Stopped,
    /// This generation's image failed, so the runtime runs the image the
    /// install ran before, with this generation's credentials.
    RolledBack {
        /// Why this generation's image was abandoned.
        reason: TeammateRunFailure,
    },
    /// The runtime gave up on this generation.
    Failed {
        /// Why.
        reason: TeammateRunFailure,
    },
}

/// Why a runtime gave up on an install's generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TeammateRunFailure {
    /// The image could not be fetched.
    ImageUnavailable,
    /// The fetched image's id differs from the one asked for.
    ImageMismatch,
    /// The engine refused to create or start the container.
    EngineRefused,
    /// The agent reported a missing or invalid setting (exit 78), three
    /// times in a row.
    BadConfiguration,
    /// The agent's code needs a newer runtime than the image has (exit 79):
    /// stopped, not restarted, until a newer image arrives.
    IncompatibleRuntime,
    /// The agent kept failing to start.
    CrashLoop,
    /// The machine can't host teammates (see [`TeammateHostReport`]).
    HostUnsupported,
    /// The install's egress policy couldn't be put in place (or read back
    /// as put), so the agent wasn't started.
    NetworkIsolationUnavailable,
    /// The host has no route to the internet (no default route, v4 or v6),
    /// so every destination the agent's policy leaves it is unreachable:
    /// the agent wasn't started.
    EgressBlocked,
}

/// An agent teammate's environment: credentials and addresses, one variable
/// each. Debug shows only the names.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct AgentEnvironment(
    #[specta(type = std::collections::HashMap<String, String>)]
    pub  std::collections::BTreeMap<String, String>,
);

/// The values are credentials: wiped from memory when dropped.
impl Drop for AgentEnvironment {
    fn drop(&mut self) {
        for value in self.0.values_mut() {
            zeroize::Zeroize::zeroize(value);
        }
    }
}

impl std::fmt::Debug for AgentEnvironment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentEnvironment")
            .field("names", &self.0.keys().collect::<Vec<_>>())
            .finish()
    }
}

/// Agent Runtime to Agent Service traffic on the logical protocol stream.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
#[non_exhaustive]
pub enum ToServerMessage {
    /// An ACP message routed from the hosted agent.
    Acp(AcpMessage),
    /// A runtime or agent lifecycle event.
    Event {
        /// The event name.
        #[specta(type = String)]
        event: SystemEvent,
    },
    /// An answer to a connection-level model probe.
    ModelProbeResponse {
        /// Raw options or a safe failure.
        result: ModelProbeResult,
    },
    /// What this machine can do about hosting agent teammates; sent once
    /// after the connection opens.
    TeammateHost {
        /// The report.
        report: TeammateHostReport,
    },
    /// An install's container changed state.
    TeammateStatus {
        /// The install and generation it is about.
        install: TeammateInstall,
        /// Its state.
        state: TeammateRunState,
    },
}
