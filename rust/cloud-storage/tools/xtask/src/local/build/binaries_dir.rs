//! Provenance-agnostic binary directory: host zigbuild output or a Nix/crane
//! store path. The orchestrator only cares about the resulting `/app/out`
//! mount, not how the binaries were produced.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

/// Where the service binaries live on the host.
#[derive(Clone, Debug)]
pub enum BinariesDir {
    /// A cargo target dir (host zigbuild output). Dynamically links against the
    /// runtime image's own glibc; no `/nix/store` needed.
    TargetDir(PathBuf),
    /// A Nix/crane `…/bin` dir. The binaries link the nix dynamic linker, so
    /// the host `/nix/store` must also be mounted read-only.
    NixStore(PathBuf),
}

impl BinariesDir {
    /// Classify a directory by whether it lives under `/nix/store`.
    pub fn classify(dir: &Path) -> Result<Self> {
        let canon = dir
            .canonicalize()
            .with_context(|| format!("binaries dir {} does not exist", dir.display()))?;
        if canon.starts_with("/nix/store") {
            // Accept either the `$out` dir (with a `bin/` child) or the `bin`
            // dir directly.
            let bin_dir = if canon.file_name().and_then(|n| n.to_str()) == Some("bin") {
                canon
            } else if canon.join("bin").is_dir() {
                canon.join("bin")
            } else {
                canon
            };
            Ok(BinariesDir::NixStore(bin_dir))
        } else {
            Ok(BinariesDir::TargetDir(canon))
        }
    }

    /// The directory bind-mounted to `/app/out`.
    pub fn host_dir(&self) -> &Path {
        match self {
            BinariesDir::TargetDir(p) | BinariesDir::NixStore(p) => p,
        }
    }

    fn needs_nix_store(&self) -> bool {
        matches!(self, BinariesDir::NixStore(_))
    }

    /// The compose `volumes:` entries every Rust service needs. Always the
    /// `/app/out` mount; plus `/nix/store` read-only when the binaries are
    /// nix-linked.
    pub fn compose_mounts(&self) -> Vec<String> {
        let mut mounts = vec![format!("{}:/app/out:ro", self.host_dir().display())];
        if self.needs_nix_store() {
            mounts.push("/nix/store:/nix/store:ro".to_string());
        }
        mounts
    }

    /// Assert every expected binary exists in the directory.
    pub fn validate(&self, binaries: &[&str]) -> Result<()> {
        let missing: Vec<&str> = binaries
            .iter()
            .copied()
            .filter(|b| !self.host_dir().join(b).exists())
            .collect();
        if !missing.is_empty() {
            bail!(
                "binaries dir {} is missing: {}\n  build with `cargo x zigbuild` \
                 (or pass --binaries-dir / drop --no-build)",
                self.host_dir().display(),
                missing.join(", ")
            );
        }
        Ok(())
    }
}
