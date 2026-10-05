//! A ZIP reader (the central directory, stored and deflated entries, and the
//! ZIP64 extensions large exports need) and a writer of stored entries.

use crate::error::{Result, corrupt};

pub(crate) struct ZipEntry {
    pub name: String,
    method: u16,
    compressed_size: u64,
    uncompressed_size: u64,
    local_header_offset: u64,
}

pub(crate) struct ZipArchive<'a> {
    bytes: &'a [u8],
    entries: Vec<ZipEntry>,
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn u64_at(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

const EOCD: u32 = 0x0605_4b50;
const EOCD64_LOCATOR: u32 = 0x0706_4b50;
const EOCD64: u32 = 0x0606_4b50;
const CENTRAL: u32 = 0x0201_4b50;
const LOCAL: u32 = 0x0403_4b50;

impl<'a> ZipArchive<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        // The end-of-central-directory record sits in the last 64 KiB + 22 bytes.
        let min = bytes.len().saturating_sub(65_557);
        let eocd = (min..bytes.len().saturating_sub(21))
            .rev()
            .find(|&at| u32_at(bytes, at) == Some(EOCD))
            .ok_or_else(|| corrupt("zip: no end of central directory"))?;
        let mut count = u64::from(u16_at(bytes, eocd + 10).unwrap_or(0));
        let mut dir_offset = u64::from(u32_at(bytes, eocd + 16).unwrap_or(0));
        if (count == 0xffff || dir_offset == 0xffff_ffff)
            && eocd >= 20
            && u32_at(bytes, eocd - 20) == Some(EOCD64_LOCATOR)
        {
            let at = u64_at(bytes, eocd - 20 + 8).unwrap_or(0) as usize;
            if u32_at(bytes, at) == Some(EOCD64) {
                count = u64_at(bytes, at + 32).unwrap_or(count);
                dir_offset = u64_at(bytes, at + 48).unwrap_or(dir_offset);
            }
        }
        let mut entries = Vec::with_capacity(count.min(1 << 16) as usize);
        let mut at = dir_offset as usize;
        for _ in 0..count {
            if u32_at(bytes, at) != Some(CENTRAL) {
                return Err(corrupt("zip: bad central directory entry"));
            }
            let method = u16_at(bytes, at + 10).unwrap_or(0);
            let mut compressed_size = u64::from(u32_at(bytes, at + 20).unwrap_or(0));
            let mut uncompressed_size = u64::from(u32_at(bytes, at + 24).unwrap_or(0));
            let name_len = usize::from(u16_at(bytes, at + 28).unwrap_or(0));
            let extra_len = usize::from(u16_at(bytes, at + 30).unwrap_or(0));
            let comment_len = usize::from(u16_at(bytes, at + 32).unwrap_or(0));
            let mut local_header_offset = u64::from(u32_at(bytes, at + 42).unwrap_or(0));
            let name_bytes = bytes
                .get(at + 46..at + 46 + name_len)
                .ok_or_else(|| corrupt("zip: truncated entry name"))?;
            let name = String::from_utf8_lossy(name_bytes).into_owned();
            // ZIP64 extra field: the 64-bit values replace the saturated ones, in order.
            let mut extra = at + 46 + name_len;
            let extra_end = extra + extra_len;
            while extra + 4 <= extra_end {
                let id = u16_at(bytes, extra).unwrap_or(0);
                let size = usize::from(u16_at(bytes, extra + 2).unwrap_or(0));
                if id == 1 {
                    let mut field = extra + 4;
                    if uncompressed_size == 0xffff_ffff {
                        uncompressed_size = u64_at(bytes, field).unwrap_or(0);
                        field += 8;
                    }
                    if compressed_size == 0xffff_ffff {
                        compressed_size = u64_at(bytes, field).unwrap_or(0);
                        field += 8;
                    }
                    if local_header_offset == 0xffff_ffff {
                        local_header_offset = u64_at(bytes, field).unwrap_or(0);
                    }
                }
                extra += 4 + size;
            }
            entries.push(ZipEntry {
                name,
                method,
                compressed_size,
                uncompressed_size,
                local_header_offset,
            });
            at = extra_end + comment_len;
        }
        Ok(Self { bytes, entries })
    }

    pub fn entries(&self) -> &[ZipEntry] {
        &self.entries
    }

    pub fn find(&self, name: &str) -> Option<&ZipEntry> {
        self.entries.iter().find(|entry| entry.name == name)
    }

    /// Where an entry's (possibly compressed) data sits in the archive.
    fn data_range(&self, entry: &ZipEntry) -> Result<std::ops::Range<usize>> {
        let at = entry.local_header_offset as usize;
        if u32_at(self.bytes, at) != Some(LOCAL) {
            return Err(corrupt(format!("zip: bad local header for {}", entry.name)));
        }
        let name_len = usize::from(u16_at(self.bytes, at + 26).unwrap_or(0));
        let extra_len = usize::from(u16_at(self.bytes, at + 28).unwrap_or(0));
        let start = at + 30 + name_len + extra_len;
        start
            .checked_add(entry.compressed_size as usize)
            .filter(|&end| end <= self.bytes.len())
            .map(|end| start..end)
            .ok_or_else(|| corrupt(format!("zip: {} is truncated", entry.name)))
    }

    /// For a stored (uncompressed) entry, where its bytes sit in the archive.
    pub fn stored_range(&self, entry: &ZipEntry) -> Option<std::ops::Range<usize>> {
        if entry.method != 0 {
            return None;
        }
        self.data_range(entry).ok()
    }

    pub fn read(&self, entry: &ZipEntry) -> Result<Vec<u8>> {
        let data = &self.bytes[self.data_range(entry)?];
        match entry.method {
            0 => Ok(data.to_vec()),
            8 => miniz_oxide::inflate::decompress_to_vec_with_limit(
                data,
                (entry.uncompressed_size as usize).max(1 << 20) * 2,
            )
            .map_err(|e| corrupt(format!("zip: {}: {e:?}", entry.name))),
            other => Err(corrupt(format!(
                "zip: {} uses unsupported compression {other}",
                entry.name
            ))),
        }
    }
}

/// A ZIP archive of stored (uncompressed) entries.
pub(crate) fn write_stored(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in entries {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let local = |buf: &mut Vec<u8>, sig: u32, central: bool| {
            buf.extend_from_slice(&sig.to_le_bytes());
            if central {
                buf.extend_from_slice(&20u16.to_le_bytes());
            }
            buf.extend_from_slice(&20u16.to_le_bytes()); // version needed
            buf.extend_from_slice(&0u16.to_le_bytes()); // flags
            buf.extend_from_slice(&0u16.to_le_bytes()); // stored
            buf.extend_from_slice(&0u32.to_le_bytes()); // time, date
            buf.extend_from_slice(&crc.to_le_bytes());
            buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
            buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
            buf.extend_from_slice(&(name.len() as u16).to_le_bytes());
            buf.extend_from_slice(&0u16.to_le_bytes()); // extra
            if central {
                buf.extend_from_slice(&0u16.to_le_bytes()); // comment
                buf.extend_from_slice(&0u16.to_le_bytes()); // disk
                buf.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
                buf.extend_from_slice(&0u32.to_le_bytes()); // external attrs
                buf.extend_from_slice(&offset.to_le_bytes());
            }
            buf.extend_from_slice(name.as_bytes());
        };
        local(&mut out, 0x0403_4b50, false);
        out.extend_from_slice(data);
        local(&mut central, 0x0201_4b50, true);
    }
    let central_offset = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // disk numbers
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&central_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}
