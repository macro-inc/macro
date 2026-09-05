//! Provenance-agnostic binary directory: host zigbuild output or a Nix/crane
//! store path. The orchestrator only cares about the resulting `/app/out`
//! mount, not how the binaries were produced.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

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

/// How a running stack adopts a newly located [`BinariesDir`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Adoption {
    /// Same canonical host dir. Content-addressed Nix paths are byte-identical.
    Unchanged,
    /// Different host dir. Rewrite compose mounts and recreate Rust containers.
    Remount,
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

    /// Compare this set to the dir currently bind-mounted at `/app/out`.
    pub fn adoption_from(&self, mounted_dir: &Path) -> Adoption {
        let next = canonicalize_or_clone(self.host_dir());
        let mounted = canonicalize_or_clone(mounted_dir);
        if next == mounted {
            Adoption::Unchanged
        } else {
            Adoption::Remount
        }
    }

    /// Same as [`Self::adoption_from`], except a missing record means remount.
    /// Legacy `stack.json` rows have no `binaries_dir`.
    pub fn adoption_from_recorded(&self, recorded: Option<&Path>) -> Adoption {
        match recorded {
            Some(mounted) => self.adoption_from(mounted),
            None => Adoption::Remount,
        }
    }

    /// Keep a Nix store path alive while containers still mount it.
    ///
    /// `nix build --out-link` on Cloud flips the caller's link to the new
    /// path. Pin each generation under `roots_dir` with its own `--out-link`.
    /// Never rename those links: Nix registers the path, not the inode, so a
    /// rename drops the root.
    pub fn pin_gc_root(&self, roots_dir: &Path) -> Result<()> {
        let Self::NixStore(dir) = self else {
            return Ok(());
        };
        std::fs::create_dir_all(roots_dir)
            .with_context(|| format!("creating {}", roots_dir.display()))?;
        let store_output = store_output_dir(dir);
        let current = roots_dir.join("nix-binaries");
        if current.exists()
            && canonicalize_or_clone(&current) == canonicalize_or_clone(store_output)
        {
            return Ok(());
        }
        if current.exists() {
            publish_gc_root(
                &roots_dir.join("nix-binaries.prev"),
                &canonicalize_or_clone(&current),
            )?;
        }
        publish_gc_root(&current, store_output)
    }

    /// Drop the previous generation's pin after the new mount is recorded.
    pub fn release_previous_gc_root(roots_dir: &Path) {
        let _ = std::fs::remove_file(roots_dir.join("nix-binaries.prev"));
    }
}

/// Register `link` as a Nix GC root for `store_output`. Writes `--out-link`
/// at `link` itself so the auto-root path stays stable.
fn publish_gc_root(link: &Path, store_output: &Path) -> Result<()> {
    let status = Command::new("nix")
        .args(["build", "--out-link"])
        .arg(link)
        .arg(store_output)
        .status()
        .with_context(|| {
            format!(
                "running nix build --out-link {} {}",
                link.display(),
                store_output.display()
            )
        })?;
    if status.success() {
        return Ok(());
    }
    bail!(
        "nix build --out-link {} {} failed with {status}",
        link.display(),
        store_output.display()
    );
}

fn canonicalize_or_clone(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn store_output_dir(bin_dir: &Path) -> &Path {
    if bin_dir.file_name().and_then(|n| n.to_str()) == Some("bin") {
        bin_dir.parent().unwrap_or(bin_dir)
    } else {
        bin_dir
    }
}

#[cfg(test)]
mod test;
