//! Host detection for the local build contract.
//!
//! Service binaries are built natively in the Nix dev shell and run in the
//! runtime image with `/nix/store` mounted, so each binary brings its own
//! loader, glibc, and libssl. A Linux host of either architecture therefore
//! needs no cross-compiler. A macOS build can't run in a Linux container.

use anyhow::{Result, bail};

/// The host's build target: where cargo puts binaries, and the Docker
/// `--platform` of the runtime image.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target {
    /// e.g. `linux/arm64`. Passed to `docker buildx --platform`.
    pub docker_platform: &'static str,
}

/// Detect the build target from the host architecture (`std::env::consts::ARCH`).
pub fn detect() -> Result<Target> {
    match std::env::consts::ARCH {
        "aarch64" => Ok(Target {
            docker_platform: "linux/arm64",
        }),
        "x86_64" => Ok(Target {
            docker_platform: "linux/amd64",
        }),
        other => bail!(
            "unsupported host architecture '{other}' for local builds; \
             only aarch64 and x86_64 are supported"
        ),
    }
}

/// Fail unless this host's cargo builds binaries the runtime image can run.
pub fn ensure_linux_host() -> Result<()> {
    ensure_linux(std::env::consts::OS)
}

fn ensure_linux(os: &str) -> Result<()> {
    if os == "linux" {
        return Ok(());
    }
    bail!(
        "local service binaries are built natively, and a binary built on {os} can't run in \
         the Linux runtime container.\n  Run the local stack on a Linux machine, or pass \
         --binaries-dir with Linux binaries. For frontend-only work, `bun run dev` in apps/web \
         uses the hosted services."
    )
}

impl Target {
    /// The directory (relative to the repository workspace root) cargo writes
    /// service binaries into.
    pub fn debug_dir(&self) -> String {
        "target/debug".to_owned()
    }

    /// Human-readable description for doctor output.
    pub fn describe(&self) -> String {
        format!("native build ({})", self.docker_platform)
    }
}

#[cfg(test)]
mod test;
