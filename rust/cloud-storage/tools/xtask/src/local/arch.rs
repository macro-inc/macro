//! Host-architecture detection and the cross-compile target contract.
//!
//! The local orchestrator builds Linux service binaries on the developer's
//! host with `cargo zigbuild`. We only ever build for the host's own
//! architecture (aarch64 on Apple Silicon, x86_64 on x86 Linux) so zig only
//! pins glibc rather than cross-compiling between architectures — a materially
//! lower-risk use of zigbuild than full cross builds.

use anyhow::{bail, Result};

/// The glibc version the binaries are linked against, expressed as a
/// `cargo zigbuild` target suffix (the same mechanism the Lambda builds use in
/// flake.nix, where the suffix is `.2.26`). 2.36 is below the runtime image's
/// glibc (debian:trixie ships ~2.41), so a binary linked here runs forward on
/// the runtime image and on any host with glibc >= 2.36.
const GLIBC_PIN: &str = "2.36";

/// A resolved build target: the rust triple, the zigbuild target (triple +
/// glibc suffix), and the Docker `--platform` for the runtime image.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target {
    /// e.g. `aarch64-unknown-linux-gnu`. Output binaries land in
    /// `target/<triple>/debug/<binary>`.
    pub triple: &'static str,
    /// e.g. `linux/arm64`. Passed to `docker buildx --platform`.
    pub docker_platform: &'static str,
}

/// Detect the build target from the host architecture (`std::env::consts::ARCH`).
pub fn detect() -> Result<Target> {
    match std::env::consts::ARCH {
        "aarch64" => Ok(Target {
            triple: "aarch64-unknown-linux-gnu",
            docker_platform: "linux/arm64",
        }),
        "x86_64" => Ok(Target {
            triple: "x86_64-unknown-linux-gnu",
            docker_platform: "linux/amd64",
        }),
        other => bail!(
            "unsupported host architecture '{other}' for local builds; \
             only aarch64 and x86_64 are supported"
        ),
    }
}

impl Target {
    /// The `cargo zigbuild --target` value: the rust triple plus the glibc pin
    /// suffix (e.g. `aarch64-unknown-linux-gnu.2.36`). cargo fingerprints the
    /// suffixed target separately from the plain triple, so this never poisons a
    /// normal `cargo build`.
    pub fn zig_target(&self) -> String {
        format!("{}.{GLIBC_PIN}", self.triple)
    }

    /// The directory (relative to the cloud-storage workspace root) that
    /// zigbuild writes binaries into. The `.2.36` glibc suffix is stripped from
    /// the directory name by zigbuild, matching the Lambda install phase.
    pub fn debug_dir(&self) -> String {
        format!("target/{}/debug", self.triple)
    }

    /// Human-readable description for the env summary / doctor output.
    pub fn describe(&self) -> String {
        format!(
            "{} (glibc {GLIBC_PIN}, {})",
            self.triple, self.docker_platform
        )
    }
}
