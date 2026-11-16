//! Free space on the disk conversions write to.
//!
//! A task whose disk fills up fails every conversion until it is replaced.
//! The health check, the queue worker, and the convert endpoint all ask the
//! same [`DiskGuard`], so a task that is running out of room stops taking jobs
//! and is replaced, instead of taking jobs it can only fail.

use std::path::{Path, PathBuf};

use anyhow::Context;

#[cfg(test)]
mod test;

/// Free space a task keeps in reserve. A task starts with about 15 GiB free
/// and a job's files are removed when it ends, so less than this left means
/// something is leaking.
pub const MIN_FREE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Free inodes a task keeps in reserve: a disk out of inodes fails writes the
/// same way a full one does, and each LibreOffice profile is a few hundred files.
pub const MIN_FREE_INODES: u64 = 50_000;

/// Reports whether the filesystem holding `path` has room for more jobs.
#[derive(Debug, Clone)]
pub struct DiskGuard {
    path: PathBuf,
    min_free_bytes: u64,
    min_free_inodes: u64,
}

impl DiskGuard {
    pub fn new(path: &Path, min_free_bytes: u64, min_free_inodes: u64) -> Self {
        Self {
            path: path.to_path_buf(),
            min_free_bytes,
            min_free_inodes,
        }
    }

    /// Errors when the disk is short on space or inodes, or cannot be read.
    pub fn check(&self) -> anyhow::Result<()> {
        let stat = rustix::fs::statvfs(&self.path)
            .with_context(|| format!("unable to read free space of {}", self.path.display()))?;

        self.check_free(
            stat.f_bavail.saturating_mul(stat.f_frsize),
            stat.f_favail,
            stat.f_files,
        )
    }

    /// `total_inodes` is zero on filesystems that do not count inodes, which
    /// cannot run out of them.
    pub(crate) fn check_free(
        &self,
        free_bytes: u64,
        free_inodes: u64,
        total_inodes: u64,
    ) -> anyhow::Result<()> {
        if free_bytes < self.min_free_bytes {
            anyhow::bail!(
                "low disk space: {free_bytes} bytes free, need {}",
                self.min_free_bytes
            );
        }

        if total_inodes > 0 && free_inodes < self.min_free_inodes {
            anyhow::bail!(
                "low disk space: {free_inodes} inodes free, need {}",
                self.min_free_inodes
            );
        }

        Ok(())
    }
}
