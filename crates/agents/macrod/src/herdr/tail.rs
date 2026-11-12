//! Bounded JSONL framing. Provider folds never open files or own byte offsets.

use std::io::{Read as _, Seek as _};
use std::os::unix::fs::MetadataExt as _;
use std::path::Path;

#[cfg(test)]
mod test;

const MAX_BATCH: u64 = 16 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct Cursor {
    pub offset: u64,
    identity: Option<(u64, u64)>,
}

impl Cursor {
    /// Advance only over complete UTF-8 lines. A replaced/truncated log needs
    /// an explicit history reload, never an implicit replay into live output.
    pub fn read(&mut self, path: &Path) -> std::io::Result<Vec<String>> {
        let mut file = std::fs::File::open(path)?;
        let metadata = file.metadata()?;
        let identity = (metadata.dev(), metadata.ino());
        if metadata.len() < self.offset || self.identity.is_some_and(|old| old != identity) {
            return Err(std::io::Error::other(
                "native transcript was replaced or truncated; reload the session",
            ));
        }
        self.identity = Some(identity);
        file.seek(std::io::SeekFrom::Start(self.offset))?;
        let mut bytes = Vec::new();
        file.take(MAX_BATCH).read_to_end(&mut bytes)?;
        let Some(end) = bytes.iter().rposition(|byte| *byte == b'\n') else {
            return if bytes.len() as u64 == MAX_BATCH {
                Err(std::io::Error::other(
                    "native transcript record exceeds 16 MiB",
                ))
            } else {
                Ok(Vec::new())
            };
        };
        let text = std::str::from_utf8(&bytes[..end])
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        let lines = text.lines().map(str::to_owned).collect();
        self.offset += end as u64 + 1;
        Ok(lines)
    }
}
