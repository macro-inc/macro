//! Atomic private conversation journal, separate from OAuth credentials.
use codex_cloud_agents::domain::acp_session::{SessionStore, StoredSession};
use codex_cloud_agents::domain::cloud::TurnId;
use codex_cloud_agents::domain::journal::{JournalEntry, JournalInput};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
};
/// File journal under the explicitly configured private state directory.
pub struct JsonSessionStore {
    directory: PathBuf,
    gate: tokio::sync::Mutex<()>,
}
#[derive(Serialize, Deserialize)]
struct DemoJournal {
    state: StoredSession,
    inputs: Vec<JournalEntry>,
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
        Ok(Self {
            directory,
            gate: tokio::sync::Mutex::new(()),
        })
    }
    fn path(&self, id: &str) -> Result<PathBuf, rootcause::Report> {
        let parsed = uuid::Uuid::parse_str(id)
            .map_err(|_| rootcause::report!("invalid session identifier"))?;
        if parsed.to_string() != id {
            return Err(rootcause::report!("noncanonical session identifier"));
        }
        Ok(self.directory.join(format!("{id}.json")))
    }
    fn read_file(&self, id: &str) -> Result<Option<DemoJournal>, rootcause::Report> {
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
        let journal: DemoJournal = serde_json::from_slice(&bytes)
            .map_err(|_| rootcause::report!("invalid demo journal"))?;
        if journal
            .inputs
            .iter()
            .enumerate()
            .any(|(index, entry)| entry.sequence != index as i64 + 1)
        {
            return Err(rootcause::report!("incomplete demo journal"));
        }
        Ok(Some(journal))
    }
    fn write_file(&self, id: &str, journal: &DemoJournal) -> Result<(), rootcause::Report> {
        let path = self.path(id)?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        let bytes = serde_json::to_vec(journal)?;
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
impl SessionStore for JsonSessionStore {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        let _gate = self.gate.lock().await;
        Ok(self.read_file(id)?.map(|journal| journal.state))
    }
    async fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        let _gate = self.gate.lock().await;
        let mut journal = self.read_file(id)?.unwrap_or_else(|| DemoJournal {
            state: StoredSession::default(),
            inputs: Vec::new(),
        });
        journal.state = state.clone();
        self.write_file(id, &journal)
    }
    async fn read(&self, id: &str) -> Result<Vec<JournalEntry>, rootcause::Report> {
        let _gate = self.gate.lock().await;
        Ok(self
            .read_file(id)?
            .map(|journal| journal.inputs)
            .unwrap_or_default())
    }
    async fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> Result<JournalEntry, rootcause::Report> {
        let _gate = self.gate.lock().await;
        let mut journal = self
            .read_file(id)?
            .ok_or_else(|| rootcause::report!("unknown demo session"))?;
        let high = journal.inputs.last().map_or(0, |entry| entry.sequence);
        if high != expected {
            return Err(rootcause::report!("demo journal sequence changed"));
        }
        let entry = JournalEntry {
            sequence: high
                .checked_add(1)
                .ok_or_else(|| rootcause::report!("demo journal sequence overflow"))?,
            turn: turn.cloned(),
            input: input.clone(),
        };
        journal.inputs.push(entry.clone());
        self.write_file(id, &journal)?;
        Ok(entry)
    }
    async fn validate(&self) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

#[cfg(test)]
#[path = "session_store/test.rs"]
mod test;
