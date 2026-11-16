//! The service's scratch space on disk.
//!
//! Every conversion works inside its own [`JobFolder`], which is removed when
//! the job ends however it ends. Nothing a conversion writes lives anywhere
//! else, so the disk holds only the jobs that are running.

use std::path::{Path, PathBuf};

use anyhow::Context;

#[cfg(test)]
mod test;

const JOBS_DIR: &str = "jobs";
const CACHE_DIR: &str = "cache";

/// The directories conversions write to.
#[derive(Debug)]
pub struct Scratch {
    root: PathBuf,
    jobs: PathBuf,
    cache: PathBuf,
}

impl Scratch {
    /// Where a running service keeps its scratch space.
    pub fn default_root() -> PathBuf {
        std::env::temp_dir().join("convert_service")
    }

    /// Prepares the scratch space under `root`, removing whatever an earlier
    /// process left there. Call it once at startup, before any job runs: a
    /// process that was killed could not remove its own job folders.
    pub fn reset(root: &Path) -> anyhow::Result<Self> {
        let scratch = Self {
            root: root.to_path_buf(),
            jobs: root.join(JOBS_DIR),
            cache: root.join(CACHE_DIR),
        };

        for dir in [&scratch.jobs, &scratch.cache] {
            match std::fs::remove_dir_all(dir) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    return Err(e).with_context(|| format!("unable to empty {}", dir.display()));
                }
                _ => {}
            }
            std::fs::create_dir_all(dir)
                .with_context(|| format!("unable to create {}", dir.display()))?;
        }

        Ok(scratch)
    }

    /// The directory holding everything the service writes.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Caches shared by every job, such as the font cache, which is slow to
    /// rebuild and does not grow with the number of jobs.
    pub fn cache(&self) -> &Path {
        &self.cache
    }

    /// Creates an empty folder for one conversion attempt. Its name is unique,
    /// so a redelivered job never shares a folder with its earlier attempt.
    pub fn create_job(&self) -> anyhow::Result<JobFolder> {
        let dir = tempfile::Builder::new()
            .prefix("job-")
            .tempdir_in(&self.jobs)
            .context("unable to create job folder")?;

        Ok(JobFolder { path: dir.keep() })
    }
}

/// One conversion attempt's folder, removed when this is dropped: on success,
/// on an error, and when the job panics.
#[derive(Debug)]
pub struct JobFolder {
    path: PathBuf,
}

impl JobFolder {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for JobFolder {
    fn drop(&mut self) {
        match std::fs::remove_dir_all(&self.path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                tracing::error!(error=?e, path=%self.path.display(), "unable to remove job folder");
            }
            _ => {}
        }
    }
}
