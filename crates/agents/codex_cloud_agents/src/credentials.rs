//! Private JSON credential file with atomic writes and a command-lifetime lock.

use codex_cloud_agents::domain::{CredentialStore, Credentials};
use std::fs::{File, OpenOptions};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};

#[cfg(test)]
#[path = "credentials/test.rs"]
mod test;

const AUTH_FILE: &str = "credentials.json";
const MAX_FILE: u64 = 1024 * 1024;

/// Single-user local store. The file lock prevents competing refresh writers.
pub struct JsonStore {
    directory: PathBuf,
    lock: File,
}

impl JsonStore {
    /// Open an explicit private directory, refusing symlinks and broad permissions.
    /// Unix only: this probe does not claim Windows ACL protection.
    pub fn open(directory: &Path) -> Result<Self, rootcause::Report> {
        if !directory.is_absolute() {
            return Err(rootcause::report!("--state-dir must be an absolute path"));
        }
        private_directory(directory)?;
        let lock_path = directory.join(".lock");
        if lock_path.exists() || lock_path.is_symlink() {
            check_private(&lock_path, false)?;
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let lock = options.open(lock_path)?;
        lock.try_lock().map_err(|_| {
            rootcause::report!("another probe command is using this state directory")
        })?;
        Ok(Self {
            directory: directory.to_owned(),
            lock,
        })
    }
}

impl Drop for JsonStore {
    fn drop(&mut self) {
        // Closing only this descriptor does not release a flock while a forked
        // child or duplicated descriptor retains the same open-file description.
        // Explicit unlock ends the store's ownership before File closes below.
        let _ = self.lock.unlock();
    }
}

impl CredentialStore for JsonStore {
    fn load(&self) -> Result<Option<Credentials>, rootcause::Report> {
        let path = self.directory.join(AUTH_FILE);
        match std::fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
            Ok(_) => check_private(&path, false)?,
        }
        let mut bytes = zeroize::Zeroizing::new(Vec::new());
        File::open(path)?
            .take(MAX_FILE + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_FILE {
            return Err(rootcause::report!("credential file exceeds 1 MiB limit"));
        }
        let credentials: Credentials = serde_json::from_slice(&bytes)
            .map_err(|_| rootcause::report!("invalid credential JSON (contents withheld)"))?;
        credentials.validate()?;
        Ok(Some(credentials))
    }

    fn save(&self, credentials: &Credentials) -> Result<(), rootcause::Report> {
        credentials.validate()?;
        let path = self.directory.join(AUTH_FILE);
        if path.exists() || path.is_symlink() {
            check_private(&path, false)?;
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        let bytes = zeroize::Zeroizing::new(serde_json::to_vec_pretty(credentials)?);
        temporary.write_all(&bytes)?;
        temporary.write_all(b"\n")?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(&path)
            .map_err(|_| rootcause::report!("could not atomically save credentials"))?;
        File::open(&self.directory)?.sync_all()?;
        Ok(())
    }

    fn clear(&self) -> Result<(), rootcause::Report> {
        let path = self.directory.join(AUTH_FILE);
        if path.exists() || path.is_symlink() {
            check_private(&path, false)?;
            std::fs::remove_file(path)?;
            File::open(&self.directory)?.sync_all()?;
        }
        Ok(())
    }
}

fn private_directory(path: &Path) -> Result<(), rootcause::Report> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt as _;
        if !path.exists() && !path.is_symlink() {
            std::fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(path)?;
        }
        check_private(path, true)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(rootcause::report!(
            "private JSON storage currently requires Unix"
        ))
    }
}

fn check_private(path: &Path, directory: bool) -> Result<(), rootcause::Report> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(rootcause::report!(
            "state path must be a regular private directory/file, not a symlink"
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(rootcause::report!(
                "state permissions are too broad; directory needs 0700 and files 0600"
            ));
        }
    }
    Ok(())
}
