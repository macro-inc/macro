//! Reads `export.data` out of a `.1pux` zip, and nothing else.
use std::io::{Cursor, Read};

use zeroize::Zeroizing;
use zip_inflate::ZipArchive;
use zip_inflate::result::ZipError;

use crate::error::ImportError;
use crate::model::Limits;

pub(crate) const ZIP_MAGIC: &[u8] = b"PK\x03\x04";
pub(crate) const EXPORT_DATA: &str = "export.data";

const END_OF_CENTRAL_DIRECTORY: &[u8] = b"PK\x05\x06";
/// The fixed end-of-central-directory record plus the longest comment.
const END_RECORD_SEARCH_BYTES: usize = 22 + u16::MAX as usize;
/// Offset of "total entries" within the end-of-central-directory record.
const TOTAL_ENTRIES_OFFSET: usize = 10;
/// The total-entries value that defers to a zip64 record.
const ZIP64_ENTRY_COUNT: u16 = u16::MAX;

/// Inflate `export.data`, bounded by `limits` while reading.
pub(crate) fn read_export_data(
    bytes: &[u8],
    limits: &Limits,
) -> Result<Zeroizing<Vec<u8>>, ImportError> {
    // Reject a huge entry count before the zip reader allocates per entry.
    // A zip64 count is checked once the reader has parsed it.
    if let Some(count) = declared_entry_count(bytes)
        && count != ZIP64_ENTRY_COUNT
        && usize::from(count) > limits.max_zip_entries
    {
        return Err(ImportError::TooManyEntries);
    }

    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| ImportError::InvalidZip)?;
    if archive.len() > limits.max_zip_entries {
        return Err(ImportError::TooManyEntries);
    }

    for name in archive.file_names() {
        let name = name.map_err(|_| ImportError::InvalidZip)?;
        if is_unsafe_entry_name(&name) {
            return Err(ImportError::PathTraversal);
        }
    }

    let entry = match archive.by_name(EXPORT_DATA) {
        Ok(entry) => entry,
        Err(ZipError::FileNotFound) => return Err(ImportError::MissingExportData),
        Err(_) => return Err(ImportError::InvalidZip),
    };

    // The header's size is a hint only; `take` enforces the real bound.
    let capacity = entry.size().min(limits.max_decompressed_bytes);
    let mut data = Zeroizing::new(Vec::with_capacity(
        usize::try_from(capacity).unwrap_or(0),
    ));
    let read_limit = limits.max_decompressed_bytes.saturating_add(1);
    entry
        .take(read_limit)
        .read_to_end(&mut data)
        .map_err(|_| ImportError::InvalidZip)?;

    let read = u64::try_from(data.len()).unwrap_or(u64::MAX);
    if read > limits.max_decompressed_bytes {
        return Err(ImportError::ZipBomb);
    }

    Ok(data)
}

/// Total entries from the end-of-central-directory record, if one is found.
fn declared_entry_count(bytes: &[u8]) -> Option<u16> {
    let tail_start = bytes.len().saturating_sub(END_RECORD_SEARCH_BYTES);
    let tail = bytes.get(tail_start..)?;
    let record_start = tail
        .windows(END_OF_CENTRAL_DIRECTORY.len())
        .rposition(|window| window == END_OF_CENTRAL_DIRECTORY)?;

    let count_start = record_start + TOTAL_ENTRIES_OFFSET;
    let count = tail.get(count_start..count_start + 2)?;
    Some(u16::from_le_bytes([*count.first()?, *count.get(1)?]))
}

/// Names that could escape an extraction directory. Nothing is extracted,
/// but such a file is not a genuine export, so the whole file is refused.
fn is_unsafe_entry_name(name: &str) -> bool {
    name.contains('\\')
        || name.starts_with('/')
        || name.split('/').any(|segment| segment == "..")
}
