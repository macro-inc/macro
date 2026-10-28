//! Durable native-session identities. No prompts or MCP credentials are stored here.

use super::acp_agent::TuiAgent;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Record {
    pub version: u32,
    pub id: String,
    pub kind: TuiAgent,
    pub cwd: PathBuf,
    pub model: String,
    pub native_id: Option<String>,
    pub transcript: Option<PathBuf>,
    pub started: u64,
}

pub(crate) struct Store(pub PathBuf);

impl Store {
    fn path(&self, id: &str) -> std::io::Result<PathBuf> {
        let id = uuid::Uuid::parse_str(id).map_err(std::io::Error::other)?;
        Ok(self.0.join("sessions").join(format!("{id}.json")))
    }

    pub fn save(&self, record: &Record) -> std::io::Result<()> {
        use std::os::unix::fs::DirBuilderExt as _;
        let path = self.path(&record.id)?;
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path.parent().unwrap_or(&self.0))?;
        write_private(&path, &serde_json::to_vec(record)?)
    }

    pub fn load(&self, id: &str) -> std::io::Result<Record> {
        let record: Record = serde_json::from_slice(&std::fs::read(self.path(id)?)?)?;
        if record.version != 1 || record.id != id {
            return Err(std::io::Error::other(
                "unsupported or mismatched native session record",
            ));
        }
        Ok(record)
    }
}

pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt as _;
    let pending = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&pending)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&pending, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&pending);
    }
    result
}
