//! Whether this machine can host a teammate: the engine check and the
//! hardware floor, as the [`TeammateHostReport`] the service reads.

use agent_runtime_protocol::domain::schema::v0::{
    ContainerEngine, EngineIsolation, HostArch, HostOs, HostResource, InstalledEngine,
    TeammateHostProblem, TeammateHostReport, TeammateInstall,
};

use super::engine::{EngineInfo, EngineUnavailable};

/// The fewest CPUs a host may have.
pub const MINIMUM_CPUS: u32 = 2;

/// The least memory a host may have: 8 GiB.
pub const MINIMUM_MEMORY_MIB: u64 = 8 * 1024;

/// The least free disk a host may have: 20 GiB.
pub const MINIMUM_DISK_FREE_MIB: u64 = 20 * 1024;

/// The machine macrod runs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Platform {
    /// Its operating system.
    pub os: HostOs,
    /// Its CPU architecture.
    pub arch: HostArch,
}

impl Platform {
    /// This build's target.
    pub fn current() -> Self {
        let os = match std::env::consts::OS {
            "linux" => HostOs::Linux,
            "macos" => HostOs::Macos,
            "windows" => HostOs::Windows,
            _ => HostOs::Other,
        };
        let arch = match std::env::consts::ARCH {
            "x86_64" => HostArch::Amd64,
            "aarch64" => HostArch::Arm64,
            _ => HostArch::Other,
        };
        Self { os, arch }
    }
}

/// The report for what the engine check found. The first problem wins, in
/// the order a person would fix them: the platform, the engine (an engine
/// too old to run the container counts as none), the floor, then the inner
/// sandbox (`user_namespaces`, `None` when it wasn't probed). macOS and
/// Windows (Docker Desktop, a Podman machine) are allowed, and experimental.
pub fn host_report(
    platform: Platform,
    engine: Result<EngineInfo, EngineUnavailable>,
    user_namespaces: Option<bool>,
    engines: Vec<InstalledEngine>,
    installs: Vec<TeammateInstall>,
) -> TeammateHostReport {
    let unsupported_platform =
        matches!(platform.os, HostOs::Other) || matches!(platform.arch, HostArch::Other);

    let info = match engine {
        Ok(info) => info,
        Err(unavailable) => {
            let problem = if unsupported_platform {
                TeammateHostProblem::UnsupportedPlatform
            } else {
                match unavailable {
                    EngineUnavailable::NotInstalled => TeammateHostProblem::NoEngine,
                    EngineUnavailable::Unreachable => TeammateHostProblem::EngineUnreachable,
                }
            };
            return TeammateHostReport {
                engine: None,
                engines,
                os: platform.os,
                arch: platform.arch,
                cpus: 0,
                memory_mib: 0,
                disk_free_mib: None,
                problem: Some(problem),
                installs,
            };
        }
    };

    let below = |resource| Some(TeammateHostProblem::BelowFloor { resource });
    let problem = if unsupported_platform {
        Some(TeammateHostProblem::UnsupportedPlatform)
    } else if !info.supported_version {
        Some(TeammateHostProblem::NoEngine)
    } else if info.cpus < MINIMUM_CPUS {
        below(HostResource::Cpus)
    } else if info.memory_mib < MINIMUM_MEMORY_MIB {
        below(HostResource::Memory)
    } else if info
        .disk_free_mib
        .is_some_and(|free| free < MINIMUM_DISK_FREE_MIB)
    {
        below(HostResource::Disk)
    } else if !matches!(platform.os, HostOs::Linux) {
        // The host's addresses and routes are read with Linux's `ip`, so a
        // policy can't be rendered elsewhere yet (Docker Desktop, Podman
        // machine).
        Some(TeammateHostProblem::NetworkIsolationUnavailable)
    } else if engines.iter().any(|engine| {
        engine.kind == info.kind && matches!(engine.isolation, EngineIsolation::Unavailable { .. })
    }) {
        Some(TeammateHostProblem::NetworkIsolationUnavailable)
    } else if user_namespaces == Some(false) {
        Some(TeammateHostProblem::InnerSandboxUnavailable)
    } else {
        None
    };

    TeammateHostReport {
        engine: Some(ContainerEngine {
            kind: info.kind,
            version: info.version,
            rootless: info.rootless,
        }),
        engines,
        os: platform.os,
        arch: platform.arch,
        cpus: info.cpus,
        memory_mib: info.memory_mib,
        disk_free_mib: info.disk_free_mib,
        problem,
        installs,
    }
}

/// Whether a report lets this runtime list the teammate capability.
pub fn can_host(report: &TeammateHostReport) -> bool {
    report.engine.is_some() && report.problem.is_none()
}
