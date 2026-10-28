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

/// Where the running executable lives, and the files the updater keeps
/// beside it. Staging in the same directory keeps the swap a rename on one
/// filesystem.
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

    fn sibling(&self, name: &str) -> PathBuf {
        self.executable
            .with_file_name(format!("{name}{}", std::env::consts::EXE_SUFFIX))
    }

    /// The verified new binary, waiting to be swapped in.
    fn staged_path(&self) -> PathBuf {
        self.sibling(".macrod.new")
    }

    /// Where Windows moves the running binary aside: a running `.exe` can be
    /// renamed but not replaced or deleted.
    fn retired_path(&self) -> PathBuf {
        self.sibling(".macrod.old")
    }

    /// Remove what an earlier run left: a staged binary it never swapped in,
    /// or (on Windows) the binary it retired. Best effort; a retired binary
    /// still running elsewhere stays until a later start.
    pub fn remove_leftovers(&self) {
        for leftover in [self.staged_path(), self.retired_path()] {
            if let Err(error) = std::fs::remove_file(&leftover)
                && error.kind() != std::io::ErrorKind::NotFound
            {
                tracing::debug!(error = ?error, path = %leftover.display(), "could not remove an updater leftover");
            }
        }
    }

    /// Verify `archive` against the published `checksum` file, then write
    /// its executable to the staged path. Nothing is left behind on failure.
    pub fn stage(&self, archive: &[u8], checksum: &str) -> Result<PathBuf, StageError> {
        verify_checksum(archive, checksum)?;
        let binary = extract_executable(archive)?;
        let staged = self.staged_path();
        write_executable(&staged, &binary).inspect_err(|_| {
            let _ = std::fs::remove_file(&staged);
        })?;
        Ok(staged)
    }

    /// Put the staged binary where the running one is. On Unix the rename
    /// replaces it atomically while the running process keeps its open
    /// inode; on Windows the running binary is first renamed aside.
    pub fn swap(&self, staged: &Path) -> std::io::Result<()> {
        #[cfg(windows)]
        {
            let retired = self.retired_path();
            let _ = std::fs::remove_file(&retired);
            std::fs::rename(&self.executable, &retired)?;
            if let Err(error) = std::fs::rename(staged, &self.executable) {
                let _ = std::fs::rename(&retired, &self.executable);
                return Err(error);
            }
            Ok(())
        }
        #[cfg(not(windows))]
        std::fs::rename(staged, &self.executable)
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
/// environment. Returns only on failure.
///
/// Takes the path recorded before the swap: once the running file is
/// replaced, Linux reports this process's executable as deleted.
#[cfg(unix)]
pub fn relaunch(executable: &Path) -> std::io::Error {
    use std::os::unix::process::CommandExt as _;

    let mut args = std::env::args_os();
    let mut command = std::process::Command::new(executable);
    if let Some(arg0) = args.next() {
        command.arg0(arg0);
    }
    command.args(args).exec()
}

/// Start `executable` with the same arguments and environment, then exit:
/// Windows has no `exec`. Returns only on failure.
#[cfg(windows)]
pub fn relaunch(executable: &Path) -> std::io::Error {
    match std::process::Command::new(executable)
        .args(std::env::args_os().skip(1))
        .spawn()
    {
        Ok(_) => std::process::exit(0),
        Err(error) => error,
    }
}
