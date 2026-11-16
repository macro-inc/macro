//! GitHub Actions runner labels.
//!
//! We run on Namespace (namespace.so) hosted runners, mostly selected by the
//! dashboard *profile* name — the same convention the deploy workflows already
//! use. Each
//! profile's persisted cache volume is configured in the Namespace dashboard;
//! that volume backs Cargo/Nix state while compiled objects use Namespace's
//! official remote sccache (see
//! [`crate::workflows::steps::mount_cache_volume`]).

use std::fmt;

/// The in-VPC self-hosted runner with network access to the databases. Stays
/// off Namespace deliberately — migrations need to reach RDS.
pub const DB_MIGRATOR: &str = "db-migrator";

/// A Namespace runner profile. The set of profiles we're allowed to target is
/// closed; `Display` renders the `runs-on` label.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Runner {
    /// Tiny profile for lightweight automation that does not need cache volume.
    TinyNoCache,
    /// Small profile for light jobs (path filtering, status aggregation).
    Small,
    /// Mid-size profile, shared with the deploy workflows. Its *default* cache
    /// volume is churned by deploys, so always pair it with
    /// [`Runner::with_cache_tag`] to give a workload its own volume.
    Mid,
    /// Dedicated CI profile for the heavy compile + test jobs. Has its own
    /// cache volume, isolated from the deploy profiles so deploy's churn can't
    /// evict the CI Cargo/Nix caches.
    RustCi,
    /// 32 vCPU, 64 GiB profile for the Rust `test` and `check` jobs, which are
    /// held back by compile parallelism and memory on smaller runners.
    Large,
    /// Apple Silicon, for jobs that need a real Apple SDK. A machine label
    /// rather than a dashboard profile, so it needs no setup outside this file.
    MacOsArm,
    /// Larger Apple Silicon machine for desktop release builds.
    MacOsArmLarge,
    /// Windows Server on x86_64, for jobs that need the MSVC toolchain. A
    /// machine label like [`Runner::MacOsArm`].
    Windows,
}

impl fmt::Display for Runner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Runner::TinyNoCache => "namespace-profile-linux-tiny-no-cache",
            Runner::Small => "namespace-profile-linux-small",
            Runner::Mid => "namespace-profile-linux-mid",
            Runner::RustCi => "namespace-profile-linux-rust-ci",
            Runner::Large => "namespace-profile-linux-large-build",
            Runner::MacOsArm => "nscloud-macos-sequoia-arm64-6x14",
            Runner::MacOsArmLarge => "nscloud-macos-sequoia-arm64-12x28",
            Runner::Windows => "nscloud-windows-2022-amd64-8x16",
        })
    }
}

impl Runner {
    /// Render the `runs-on` label with an explicit cache *tag*
    /// (`<profile>;overrides.cache-tag=<tag>`), for a volume apart from the
    /// profile's default one.
    ///
    /// Every job on a tag forks the newest generation its node holds, and the
    /// last job to finish cleanly on that node replaces it, with no merge. Keep
    /// jobs that read back what they wrote apart from jobs that would overwrite
    /// it. A new tag starts empty, so its first jobs fetch the whole Nix store.
    /// Compiled objects use the separately named remote sccache.
    pub fn with_cache_tag(self, tag: &str) -> String {
        format!("{self};overrides.cache-tag={tag}")
    }
}
