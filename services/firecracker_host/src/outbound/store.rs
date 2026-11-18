//! [`Store`] as one JSON file per computer on the durable disk, root-only
//! (it holds the enrollment), replaced atomically.

use std::io::ErrorKind;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use firecracker_host_api::{ComputerId, HostLimits};

use crate::domain::model::ComputerRecord;
use crate::domain::ports::Store;
use crate::outbound::layout::Layout;

const RECORD: &str = "record.json";
const HOST_LIMITS: &str = "host-limits.json";

/// A record could not be read or written.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// File operation.
    #[error("{action} {path}: {source}")]
    Io {
        /// What.
        action: &'static str,
        /// Where.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// A record that does not parse.
    #[error("record {path}: {source}")]
    Parse {
        /// Where.
        path: PathBuf,
        /// Why.
        source: serde_json::Error,
    },
}

fn io(action: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> StoreError {
    let path = path.to_owned();
    move |source| StoreError::Io {
        action,
        path,
        source,
    }
}

/// Records under `computers/`.
#[derive(Debug, Clone)]
pub struct FileStore {
    layout: Layout,
}

impl FileStore {
    /// Records in `layout`.
    pub fn new(layout: Layout) -> Self {
        Self { layout }
    }
}

impl Store for FileStore {
    type Err = StoreError;

    async fn load_all(&self) -> Result<Vec<ComputerRecord>, StoreError> {
        let computers = self.layout.computers();
        let entries = match std::fs::read_dir(&computers) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(io("list", &computers)(error)),
        };
        let mut records = Vec::new();
        for entry in entries {
            let entry = entry.map_err(io("list", &computers))?;
            let path = entry.path().join(RECORD);
            let text = match std::fs::read(&path) {
                Ok(text) => text,
                // A directory whose record was deleted last by a destroy.
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(io("read", &path)(error)),
            };
            let record = serde_json::from_slice(&text)
                .map_err(|source| StoreError::Parse { path, source })?;
            records.push(record);
        }
        Ok(records)
    }

    async fn save(&self, record: &ComputerRecord) -> Result<(), StoreError> {
        let directory = self.layout.computer(record.computer_id);
        let path = directory.join(RECORD);
        let text = serde_json::to_vec_pretty(record).map_err(|source| StoreError::Parse {
            path: path.clone(),
            source,
        })?;
        // fsync can take seconds while the disk flushes a snapshot: off the
        // async workers.
        tokio::task::spawn_blocking(move || write_atomically(&directory, RECORD, &text))
            .await
            .map_err(|error| StoreError::Io {
                action: "write",
                path: self.layout.computer(record.computer_id),
                source: std::io::Error::other(error),
            })?
    }

    async fn load_host_limits(&self) -> Result<Option<HostLimits>, StoreError> {
        let path = self.layout.host_limits();
        match std::fs::read(&path) {
            Ok(text) => serde_json::from_slice(&text)
                .map(Some)
                .map_err(|source| StoreError::Parse { path, source }),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io("read", &path)(error)),
        }
    }

    async fn save_host_limits(&self, limits: &HostLimits) -> Result<(), StoreError> {
        let directory = self.layout.durable();
        let text = serde_json::to_vec_pretty(limits).map_err(|source| StoreError::Parse {
            path: self.layout.host_limits(),
            source,
        })?;
        tokio::task::spawn_blocking(move || write_atomically(&directory, HOST_LIMITS, &text))
            .await
            .map_err(|error| StoreError::Io {
                action: "write",
                path: self.layout.host_limits(),
                source: std::io::Error::other(error),
            })?
    }

    async fn delete(&self, computer_id: ComputerId) -> Result<(), StoreError> {
        let directory = self.layout.computer(computer_id);
        match std::fs::remove_dir_all(&directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io("remove", &directory)(error)),
        }
    }
}

/// Write `text` to `path` through a staged file, synced, then renamed.
/// Replace `directory/name` with `text`, durably.
fn write_atomically(directory: &Path, name: &str, text: &[u8]) -> Result<(), StoreError> {
    use std::io::Write;

    std::fs::create_dir_all(directory).map_err(io("create", directory))?;
    let path = directory.join(name);
    let staged = directory.join(format!("{name}.new"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&staged)
        .map_err(io("write", &staged))?;
    file.write_all(text).map_err(io("write", &staged))?;
    file.sync_all().map_err(io("sync", &staged))?;
    std::fs::rename(&staged, &path).map_err(io("replace", &path))?;
    std::fs::File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(io("sync", directory))
}
