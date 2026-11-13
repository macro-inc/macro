//! Reads `export.data` out of a `.1pux` zip, and nothing else.
use std::io::{Cursor, Read};

use zeroize::Zeroizing;
use zip_inflate::ZipArchive;
use zip_inflate::read::ZipReadOptions;
use zip_inflate::result::ZipError;

use crate::error::ImportError;
use crate::model::Limits;

pub(crate) const ZIP_MAGIC: &[u8] = b"PK\x03\x04";
pub(crate) const EXPORT_DATA: &str = "export.data";

const END_OF_CENTRAL_DIRECTORY: &[u8] = b"PK\x05\x06";
/// The end-of-central-directory record without its comment.
const END_RECORD_FIXED_BYTES: usize = 22;
/// The fixed record plus the longest comment.
const END_RECORD_SEARCH_BYTES: usize = END_RECORD_FIXED_BYTES + u16::MAX as usize;
/// Offset of "total entries" within the end-of-central-directory record.
const TOTAL_ENTRIES_OFFSET: usize = 10;
/// The total-entries value that defers to a zip64 record.
const ZIP64_ENTRY_COUNT: u16 = u16::MAX;
const ZIP64_LOCATOR: &[u8] = b"PK\x06\x07";
/// The zip64 locator's length, and where it holds the zip64 record's offset.
const ZIP64_LOCATOR_BYTES: usize = 20;
const ZIP64_LOCATOR_RECORD_OFFSET: usize = 8;
const ZIP64_END_RECORD: &[u8] = b"PK\x06\x06";
/// Offset of "total entries" within the zip64 end-of-central-directory record.
const ZIP64_TOTAL_ENTRIES_OFFSET: usize = 32;

type Archive<'a> = ZipArchive<Cursor<&'a [u8]>>;

/// Open a `.1pux` archive and check it without inflating anything: entry
/// count, entry names, and exactly one `export.data`.
pub(crate) fn open_checked<'a>(
    bytes: &'a [u8],
    limits: &Limits,
) -> Result<Archive<'a>, ImportError> {
    // Reject a huge entry count before the zip reader allocates per entry,
    // zip64 counts included.
    if let Some(count) = declared_entry_count(bytes)
        && usize::try_from(count).map_or(true, |count| count > limits.max_zip_entries)
    {
        return Err(ImportError::TooManyEntries);
    }

    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| ImportError::InvalidZip)?;
    // Duplicate names are refused below, so this is every central-directory entry.
    if archive.len() > limits.max_zip_entries {
        return Err(ImportError::TooManyEntries);
    }

    for name in archive.file_names() {
        let name = name.map_err(|_| ImportError::InvalidZip)?;
        if is_unsafe_entry_name(&name) {
            return Err(ImportError::PathTraversal);
        }
    }

    // Header consistency refuses duplicate names anywhere in the archive, so
    // the `export.data` read here is the only one, and the count above is real.
    match archive.by_name_with_options(EXPORT_DATA, consistent()) {
        Ok(_) => {}
        Err(ZipError::FileNotFound) => return Err(ImportError::MissingExportData),
        Err(_) => return Err(ImportError::InvalidZip),
    }

    Ok(archive)
}

/// Inflate `export.data`, bounded by `limits` while reading.
pub(crate) fn read_export_data(
    bytes: &[u8],
    limits: &Limits,
) -> Result<Zeroizing<Vec<u8>>, ImportError> {
    let mut archive = open_checked(bytes, limits)?;
    let entry = archive
        .by_name_with_options(EXPORT_DATA, consistent())
        .map_err(|_| ImportError::InvalidZip)?;

    // The header's size is a hint only; `take` enforces the real bound.
    let capacity = entry.size().min(limits.max_decompressed_bytes);
    let mut data = Zeroizing::new(Vec::with_capacity(usize::try_from(capacity).unwrap_or(0)));
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

fn consistent() -> ZipReadOptions<'static> {
    ZipReadOptions::new().enforce_header_consistency(true)
}

/// Total entries from the end-of-central-directory record, if one is found.
/// When it defers to zip64, the zip64 record's count; if that record can't be
/// read, the deferring value itself, which is over any sane limit.
fn declared_entry_count(bytes: &[u8]) -> Option<u64> {
    let tail_start = bytes.len().saturating_sub(END_RECORD_SEARCH_BYTES);
    let tail = bytes.get(tail_start..)?;
    let record_start = tail
        .windows(END_OF_CENTRAL_DIRECTORY.len())
        .rposition(|window| window == END_OF_CENTRAL_DIRECTORY)?;

    let count_start = record_start + TOTAL_ENTRIES_OFFSET;
    let count = u16::from_le_bytes(read_array(tail, count_start)?);
    if count != ZIP64_ENTRY_COUNT {
        return Some(u64::from(count));
    }
    Some(zip64_entry_count(bytes, tail_start + record_start).unwrap_or(u64::from(count)))
}

/// Total entries from the zip64 end-of-central-directory record, found
/// through the locator that directly precedes the classic record.
fn zip64_entry_count(bytes: &[u8], end_record: usize) -> Option<u64> {
    let locator = end_record.checked_sub(ZIP64_LOCATOR_BYTES)?;
    if bytes.get(locator..locator + 4)? != ZIP64_LOCATOR {
        return None;
    }
    let record = usize::try_from(u64::from_le_bytes(read_array(
        bytes,
        locator + ZIP64_LOCATOR_RECORD_OFFSET,
    )?))
    .ok()?;
    if bytes.get(record..record.checked_add(4)?)? != ZIP64_END_RECORD {
        return None;
    }
    Some(u64::from_le_bytes(read_array(
        bytes,
        record.checked_add(ZIP64_TOTAL_ENTRIES_OFFSET)?,
    )?))
}

fn read_array<const N: usize>(bytes: &[u8], start: usize) -> Option<[u8; N]> {
    bytes.get(start..start.checked_add(N)?)?.try_into().ok()
}

/// Names that could escape an extraction directory. Nothing is extracted,
/// but such a file is not a genuine export, so the whole file is refused.
fn is_unsafe_entry_name(name: &str) -> bool {
    name.contains('\\') || name.starts_with('/') || name.split('/').any(|segment| segment == "..")
}
