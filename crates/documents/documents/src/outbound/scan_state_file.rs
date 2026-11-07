//! The orphaned attachment scan's progress in a local JSON file
//! ([`ScanProgressStore`]), so a stopped scan resumes where it left off.

use crate::domain::released_attachments::orphans::{ScanProgress, ScanProgressStore};
use std::ffi::OsString;
use std::path::PathBuf;

#[cfg(test)]
mod test;

/// A scan state file could not be read or written.
#[derive(Debug, thiserror::Error)]
pub enum ScanStateFileError {
    /// Reading, writing or replacing the file failed.
    #[error("could not read or write the scan state file {path:?}: {source}")]
    Io {
        /// The state file.
        path: PathBuf,
        /// The failure.
        source: std::io::Error,
    },
    /// The file holds something other than scan progress.
    #[error("{path:?} is not a scan state file: {source}")]
    Invalid {
        /// The state file.
        path: PathBuf,
        /// Why it does not parse.
        source: serde_json::Error,
    },
}

/// Scan progress kept as JSON at one path.
pub struct ScanStateFile {
    path: PathBuf,
}

impl ScanStateFile {
    /// The state file at `path`, which need not exist yet.
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// The saved progress, or `None` when nothing was saved yet.
    pub fn load(&self) -> Result<Option<ScanProgress>, ScanStateFileError> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(source) => {
                return Err(ScanStateFileError::Io {
                    path: self.path.clone(),
                    source,
                });
            }
        };

        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|source| ScanStateFileError::Invalid {
                path: self.path.clone(),
                source,
            })
    }
}

impl ScanProgressStore for ScanStateFile {
    type Err = ScanStateFileError;

    /// Write beside the file and rename over it, so a scan stopped mid-write
    /// leaves the last complete progress. The file written beside it is this
    /// process's own, so a second scan started on the same state file by
    /// mistake can't rename a half-written one into place.
    async fn save(&self, progress: &ScanProgress) -> Result<(), Self::Err> {
        let json =
            serde_json::to_vec_pretty(progress).map_err(|source| ScanStateFileError::Invalid {
                path: self.path.clone(),
                source,
            })?;

        let mut written = OsString::from(self.path.as_os_str());
        written.push(format!(".{}.tmp", std::process::id()));
        let written = PathBuf::from(written);
        std::fs::write(&written, json)
            .and_then(|()| std::fs::rename(&written, &self.path))
            .map_err(|source| ScanStateFileError::Io {
                path: self.path.clone(),
                source,
            })
    }
}
