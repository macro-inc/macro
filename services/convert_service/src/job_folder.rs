use std::{
    path::{Component, Path, PathBuf},
    sync::LazyLock,
};

use anyhow::Context;

/// The folder all job folders live in. Conversions write nothing outside it,
/// and it shares the temp directory's filesystem, which `/health` watches.
pub static JOBS_ROOT: LazyLock<PathBuf> =
    LazyLock::new(|| std::env::temp_dir().join("convert_service_jobs"));

/// Free space below which the task reports itself unhealthy, so ECS replaces
/// it with a fresh disk instead of failing every conversion.
pub const MIN_FREE_BYTES: u64 = 1024 * 1024 * 1024;

/// A conversion's working folder. Dropping it removes the folder and
/// everything in it, so every success, error and panic path cleans up.
pub struct JobFolder {
    path: PathBuf,
}

impl JobFolder {
    /// Creates `root/job_id`. Fails if the folder already exists, so a
    /// redelivered message never shares or removes another attempt's folder.
    pub fn create(root: &Path, job_id: &str) -> anyhow::Result<Self> {
        let mut components = Path::new(job_id).components();
        let (Some(Component::Normal(_)), None) = (components.next(), components.next()) else {
            anyhow::bail!("job id {job_id:?} is not a folder name");
        };
        std::fs::create_dir_all(root).context("unable to create jobs root")?;
        let path = root.join(job_id);
        std::fs::create_dir(&path)
            .with_context(|| format!("unable to create directory {}", path.display()))?;
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for JobFolder {
    fn drop(&mut self) {
        if let Err(e) = remove_folder(&self.path) {
            tracing::error!(error=?e, path=%self.path.display(), "unable to cleanup folder");
        }
    }
}

/// Removes `path` and everything in it. A folder that is already gone is
/// cleaned up.
pub fn remove_folder(path: &Path) -> anyhow::Result<()> {
    match std::fs::remove_dir_all(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(e).context("unable to remove directory")
        }
        _ => Ok(()),
    }
}

/// Empties `root` of folders a previous process left behind. Call before any
/// job starts.
pub fn reset_jobs_root(root: &Path) -> anyhow::Result<()> {
    remove_folder(root)?;
    std::fs::create_dir_all(root).context("unable to create jobs root")
}

/// Free bytes on the filesystem holding `path`.
pub fn free_bytes(path: &Path) -> anyhow::Result<u64> {
    let stats = nix::sys::statvfs::statvfs(path).context("unable to stat filesystem")?;
    Ok(stats.blocks_available() * stats.fragment_size())
}
