//! Atomic private conversation journal, separate from OAuth credentials.
use crate::domain::acp_session::{SessionStore, StoredSession};
use std::{
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
};
/// File journal under the explicitly configured private state directory.
pub struct JsonSessionStore {
    directory: PathBuf,
}
impl JsonSessionStore {
    /// Create the journal directory under a previously validated private state root.
    pub fn open(root: &Path) -> Result<Self, rootcause::Report> {
        let directory = root.join("sessions");
        if !directory.exists() {
            use std::os::unix::fs::DirBuilderExt as _;
            std::fs::DirBuilder::new().mode(0o700).create(&directory)?;
        }
        let metadata = std::fs::symlink_metadata(&directory)?;
        use std::os::unix::fs::PermissionsExt as _;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || metadata.permissions().mode() & 0o077 != 0
        {
            return Err(rootcause::report!(
                "session directory must be private and not a symlink"
            ));
        }
        Ok(Self { directory })
    }
    fn path(&self, id: &str) -> Result<PathBuf, rootcause::Report> {
        let parsed = uuid::Uuid::parse_str(id)
            .map_err(|_| rootcause::report!("invalid session identifier"))?;
        if parsed.to_string() != id {
            return Err(rootcause::report!("noncanonical session identifier"));
        }
        Ok(self.directory.join(format!("{id}.json")))
    }
}
impl SessionStore for JsonSessionStore {
    fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        let path = self.path(id)?;
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        use std::os::unix::fs::PermissionsExt as _;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.permissions().mode() & 0o077 != 0
        {
            return Err(rootcause::report!(
                "session journal must be a private regular file"
            ));
        }
        const MAX_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;
        let mut bytes = Vec::new();
        std::fs::File::open(path)?
            .take(MAX_JOURNAL_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES {
            return Err(rootcause::report!("session journal exceeds size limit"));
        }
        Ok(Some(serde_json::from_slice(&bytes).map_err(|_| {
            rootcause::report!("invalid session journal")
        })?))
    }
    fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        let path = self.path(id)?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        let bytes = serde_json::to_vec(state)?;
        if bytes.len() > 64 * 1024 * 1024 {
            return Err(rootcause::report!(
                "session journal exceeds size limit; local observation stopped"
            ));
        }
        temporary.write_all(&bytes)?;
        temporary.flush()?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(path)
            .map_err(|_| rootcause::report!("could not persist session journal"))?;
        std::fs::File::open(&self.directory)?.sync_all()?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
