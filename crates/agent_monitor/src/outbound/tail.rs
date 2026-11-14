//! Byte-offset tailing of append-only JSON-lines files: only complete lines are
//! consumed, an unfinished last line is read again once it ends, and a file
//! that shrank or was replaced is read again from the start.

#[cfg(test)]
mod test;

use std::fs::File;
use std::io::{self, Read as _, Seek as _, SeekFrom};
use std::path::Path;

/// The most one read takes; a bigger backlog is read in several batches, and
/// no file is ever held whole.
pub(crate) const MAX_BATCH: u64 = 16 * 1024 * 1024;

/// Where a file was read up to.
#[derive(Debug, Default)]
pub(crate) struct Tail {
    offset: u64,
    identity: Option<FileIdentity>,
    /// Inside a line longer than [`MAX_BATCH`]: drop bytes up to its end.
    skipping: bool,
}

/// Complete lines read from a file.
#[derive(Debug, Default)]
pub(crate) struct Batch {
    /// The read started at byte 0: drop anything counted from this file
    /// before, since it shrank or was replaced.
    pub from_start: bool,
    /// Complete lines, each ending in `\n` (excluded from [`Batch::lines`]).
    pub bytes: Vec<u8>,
    /// More complete lines may follow; read again.
    pub more: bool,
}

impl Batch {
    /// The lines, without their newlines.
    pub fn lines(&self) -> impl Iterator<Item = &[u8]> {
        self.bytes
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
    }
}

/// A tail's offset and file identity.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TailPosition {
    offset: u64,
    identity: Option<FileIdentity>,
}

impl TailPosition {
    /// Whether the file at this length and identity has bytes the tail has
    /// not read, or was truncated or replaced. A cheap check from `stat` alone.
    pub fn is_stale(&self, metadata: &std::fs::Metadata) -> bool {
        metadata.len() != self.offset || self.identity != identity(metadata)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

impl Tail {
    /// The byte offset read up to.
    #[cfg(test)]
    pub fn offset(&self) -> u64 {
        self.offset
    }

    /// Where this tail stands, for a check away from the tail itself.
    pub fn position(&self) -> TailPosition {
        TailPosition {
            offset: self.offset,
            identity: self.identity,
        }
    }

    /// Reads the complete lines after the offset, at most [`MAX_BATCH`] bytes.
    pub fn read(&mut self, path: &Path) -> io::Result<Batch> {
        let mut file = File::open(path)?;
        let metadata = file.metadata()?;
        let current = identity(&metadata);

        let replaced = self.identity.is_some() && self.identity != current;
        if metadata.len() < self.offset || replaced {
            self.offset = 0;
            self.skipping = false;
        }
        self.identity = current;
        let mut batch = Batch {
            from_start: self.offset == 0,
            ..Batch::default()
        };

        file.seek(SeekFrom::Start(self.offset))?;
        let mut bytes = Vec::new();
        file.take(MAX_BATCH).read_to_end(&mut bytes)?;
        let read = bytes.len() as u64;

        if self.skipping {
            match bytes.iter().position(|byte| *byte == b'\n') {
                Some(end) => {
                    self.skipping = false;
                    self.offset += end as u64 + 1;
                    bytes.drain(..=end);
                }
                None => {
                    self.offset += read;
                    batch.more = read == MAX_BATCH;
                    return Ok(batch);
                }
            }
        }

        match bytes.iter().rposition(|byte| *byte == b'\n') {
            Some(end) => {
                bytes.truncate(end + 1);
                self.offset += bytes.len() as u64;
                batch.more = read == MAX_BATCH;
                batch.bytes = bytes;
            }
            None if read == MAX_BATCH => {
                // One line longer than a whole batch: nothing a source reads
                // is that large, so skip it rather than buffer it.
                tracing::warn!(bytes = read, "skipping an oversized transcript line");
                self.offset += read;
                self.skipping = true;
                batch.more = true;
            }
            None => {}
        }
        Ok(batch)
    }
}

#[cfg(unix)]
fn identity(metadata: &std::fs::Metadata) -> Option<FileIdentity> {
    use std::os::unix::fs::MetadataExt as _;

    Some(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn identity(_metadata: &std::fs::Metadata) -> Option<FileIdentity> {
    None
}
