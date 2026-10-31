//! Staging a downloaded release next to the running executable, swapping it
//! in, and re-executing.

use std::io::Read as _;
use std::path::{Path, PathBuf};

use sha2::{Digest as _, Sha256};

#[cfg(all(test, unix))]
mod test;

/// The binary's name inside a release archive.
const EXECUTABLE_NAME: &str = if cfg!(windows) {
    "macrod.exe"
} else {
    "macrod"
};

/// Why a downloaded archive could not be staged.
#[derive(Debug, thiserror::Error)]
pub enum StageError {
    #[error("the checksum file holds no SHA-256 digest")]
    MalformedChecksum,
    #[error("checksum mismatch: published {published}, downloaded {downloaded}")]
    ChecksumMismatch {
        published: String,
        downloaded: String,
    },
    #[error("the archive holds no {EXECUTABLE_NAME}")]
    MissingExecutable,
    #[cfg(windows)]
    #[error("could not read the zip archive")]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// Where the running executable lives, and where the updater puts a new
/// one: beside it on Unix, so the swap is a rename on one filesystem; in the
/// installation's `versions` folder on Windows ([`super::versions`]).
#[derive(Debug, Clone)]
pub struct Installation {
    executable: PathBuf,
}

impl Installation {
    /// The running executable, with symlinks resolved so the swap replaces
    /// the real file rather than the link to it.
    pub fn current() -> std::io::Result<Self> {
        Ok(Self::at(std::env::current_exe()?.canonicalize()?))
    }

    fn at(executable: PathBuf) -> Self {
        Self { executable }
    }

    pub fn executable(&self) -> &Path {
        &self.executable
    }

    /// The verified new binary, waiting to be swapped in.
    #[cfg(not(windows))]
    fn staged_path(&self, _tag: &str) -> PathBuf {
        self.executable.with_file_name(".macrod.new")
    }

    #[cfg(windows)]
    fn staged_path(&self, tag: &str) -> PathBuf {
        super::versions::Versions::of_executable(&self.executable).staging_executable(tag)
    }

    /// Remove a staged binary an earlier run never swapped in. Best effort.
    pub fn remove_leftovers(&self) {
        #[cfg(not(windows))]
        {
            let leftover = self.staged_path("");
            if let Err(error) = std::fs::remove_file(&leftover)
                && error.kind() != std::io::ErrorKind::NotFound
            {
                tracing::debug!(error = ?error, path = %leftover.display(), "could not remove an updater leftover");
            }
        }
    }

    /// Verify `archive` against the published `checksum` file, then write
    /// its executable to the staged path for `tag`. Nothing is left behind
    /// on failure.
    pub fn stage(&self, archive: &[u8], checksum: &str, tag: &str) -> Result<PathBuf, StageError> {
        verify_checksum(archive, checksum)?;
        let binary = extract_executable(archive)?;
        let staged = self.staged_path(tag);
        if let Some(parent) = staged.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_executable(&staged, &binary).inspect_err(|_| {
            let _ = std::fs::remove_file(&staged);
        })?;
        Ok(staged)
    }

    /// Put the staged binary where the running one is. The rename replaces
    /// it atomically while the running process keeps its open inode.
    #[cfg(not(windows))]
    pub fn swap(&self, staged: &Path) -> std::io::Result<()> {
        std::fs::rename(staged, &self.executable)
    }

    /// Make the staged version the one the launcher starts next.
    #[cfg(windows)]
    pub fn commit(&self, tag: &str) -> std::io::Result<PathBuf> {
        super::versions::Versions::of_executable(&self.executable).commit(tag)
    }
}

/// The checksum file is `sha256sum` output: the hex digest, then the name.
fn verify_checksum(archive: &[u8], checksum: &str) -> Result<(), StageError> {
    let published = checksum
        .split_whitespace()
        .next()
        .filter(|digest| lazy_regex::regex_is_match!(r"^[0-9a-fA-F]{64}$", digest))
        .ok_or(StageError::MalformedChecksum)?
        .to_ascii_lowercase();
    let downloaded = hex::encode(Sha256::digest(archive));
    if published == downloaded {
        Ok(())
    } else {
        Err(StageError::ChecksumMismatch {
            published,
            downloaded,
        })
    }
}

#[cfg(not(windows))]
fn extract_executable(archive: &[u8]) -> Result<Vec<u8>, StageError> {
    let mut entries = tar::Archive::new(flate2::read::GzDecoder::new(archive));
    for entry in entries.entries()? {
        let mut entry = entry?;
        if entry.path()?.as_ref() == Path::new(EXECUTABLE_NAME) {
            let mut binary = Vec::new();
            entry.read_to_end(&mut binary)?;
            return Ok(binary);
        }
    }
    Err(StageError::MissingExecutable)
}

#[cfg(windows)]
fn extract_executable(archive: &[u8]) -> Result<Vec<u8>, StageError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(archive))?;
    let mut entry = match archive.by_name(EXECUTABLE_NAME) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Err(StageError::MissingExecutable),
        Err(error) => return Err(error.into()),
    };
    let mut binary = Vec::new();
    entry.read_to_end(&mut binary)?;
    Ok(binary)
}

fn write_executable(path: &Path, binary: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;

    if let Err(error) = std::fs::remove_file(path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        return Err(error);
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o755);
    }
    let mut file = options.open(path)?;
    file.write_all(binary)?;
    file.sync_all()
}

/// Replace this process with `executable`, with the same arguments and
/// environment, handing it `agent` when there is one. Returns only on
/// failure, and then the agent is stopped.
///
/// Takes the path recorded before the swap: once the running file is
/// replaced, Linux reports this process's executable as deleted.
#[cfg(unix)]
pub fn relaunch(
    executable: &Path,
    tag: &str,
    agent: Option<crate::handoff::HandedOffAgent>,
) -> std::io::Error {
    use std::os::unix::process::CommandExt as _;

    use super::log::{self, ApplyMethod, UpdateEvent};

    let mut args = std::env::args_os();
    let mut command = std::process::Command::new(executable);
    if let Some(arg0) = args.next() {
        command.arg0(arg0);
    }
    command.args(args).env_remove(crate::handoff::HANDOFF_ENV);
    // Held open until `exec`: the new image reads the state from it.
    let mut _state = None;
    let mut method = ApplyMethod::ExecveHandoff;
    let active_prompts = agent
        .as_ref()
        .map_or(0, crate::handoff::HandedOffAgent::active_prompt_count);
    if let Some(agent) = &agent {
        match agent.prepare_exec() {
            Ok((state, number)) => {
                command.env(crate::handoff::HANDOFF_ENV, number);
                _state = Some(state);
            }
            Err(error) => {
                method = ApplyMethod::FreshAgentFallback;
                tracing::warn!(error = %error, "could not hand the agent over; it restarts with macrod");
            }
        }
    }
    let applied = |result: String| {
        log::record(UpdateEvent::Apply {
            from: Some(super::VERSION.to_owned()),
            to: tag.to_owned(),
            method,
            active_prompts,
            result,
        });
    };
    applied("restarting".to_owned());
    let error = command.exec();
    applied(format!("restart failed: {error}"));
    drop(agent);
    error
}
