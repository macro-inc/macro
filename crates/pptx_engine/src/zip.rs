//! Minimal ZIP container reader and writer for OPC packages.
//!
//! Only what Office packages use is supported: stored and DEFLATE entries,
//! ZIP64 records, and data descriptors. Untouched entries can be written back
//! with their original compressed bytes, so saving a package never recompresses
//! (or subtly alters) parts the editor did not change.

use crate::error::{Error, Result};

const LOCAL_HEADER_SIG: u32 = 0x0403_4b50;
const CENTRAL_HEADER_SIG: u32 = 0x0201_4b50;
const EOCD_SIG: u32 = 0x0605_4b50;
const ZIP64_EOCD_SIG: u32 = 0x0606_4b50;
const ZIP64_LOCATOR_SIG: u32 = 0x0706_4b50;
const ZIP64_EXTRA_ID: u16 = 0x0001;
const METHOD_STORED: u16 = 0;
const METHOD_DEFLATE: u16 = 8;
const FLAG_ENCRYPTED: u16 = 0x0001;
const FLAG_UTF8: u16 = 0x0800;
/// Largest EOCD comment plus the fixed EOCD size.
const MAX_EOCD_SEARCH: usize = 0xFFFF + 22;
/// Refuse single entries that inflate beyond this many bytes.
pub const MAX_ENTRY_SIZE: u64 = 512 * 1024 * 1024;
/// Refuse archives whose entries inflate beyond this many bytes in total.
pub const MAX_TOTAL_SIZE: u64 = 2 * 1024 * 1024 * 1024;
/// DEFLATE level used for parts the editor rewrites.
const DEFLATE_LEVEL: u8 = 6;
/// DOS date for 1980-01-01, used for newly created entries.
const DOS_EPOCH_DATE: u16 = (1 << 5) | 1;

/// One entry of a ZIP archive, referencing its (still compressed) bytes.
#[derive(Clone, Debug)]
pub struct Entry {
    /// Entry name as stored in the archive (no leading slash).
    pub name: String,
    /// Compression method (0 = stored, 8 = deflate).
    pub method: u16,
    /// CRC-32 of the uncompressed data.
    pub crc32: u32,
    /// Size of the compressed data.
    pub compressed_size: u64,
    /// Size of the uncompressed data.
    pub uncompressed_size: u64,
    /// DOS modification time.
    pub mod_time: u16,
    /// DOS modification date.
    pub mod_date: u16,
    /// Byte range of the compressed data inside the archive.
    pub data_start: usize,
}

/// A parsed archive: the central directory plus the backing bytes.
pub struct Archive<'a> {
    bytes: &'a [u8],
    entries: Vec<Entry>,
}

fn u16_at(b: &[u8], at: usize) -> Result<u16> {
    b.get(at..at + 2)
        .map(|s| u16::from_le_bytes([s[0], s[1]]))
        .ok_or(Error::Zip("truncated archive"))
}

fn u32_at(b: &[u8], at: usize) -> Result<u32> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
        .ok_or(Error::Zip("truncated archive"))
}

fn u64_at(b: &[u8], at: usize) -> Result<u64> {
    b.get(at..at + 8)
        .map(|s| u64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]]))
        .ok_or(Error::Zip("truncated archive"))
}

fn to_usize(v: u64) -> Result<usize> {
    usize::try_from(v).map_err(|_| Error::Zip("offset exceeds address space"))
}

/// Decodes a CP437 entry name (the ZIP default when the UTF-8 flag is unset).
fn decode_cp437(raw: &[u8]) -> String {
    const HIGH: [char; 128] = [
        'Ç', 'ü', 'é', 'â', 'ä', 'à', 'å', 'ç', 'ê', 'ë', 'è', 'ï', 'î', 'ì', 'Ä', 'Å', 'É', 'æ',
        'Æ', 'ô', 'ö', 'ò', 'û', 'ù', 'ÿ', 'Ö', 'Ü', '¢', '£', '¥', '₧', 'ƒ', 'á', 'í', 'ó', 'ú',
        'ñ', 'Ñ', 'ª', 'º', '¿', '⌐', '¬', '½', '¼', '¡', '«', '»', '░', '▒', '▓', '│', '┤', '╡',
        '╢', '╖', '╕', '╣', '║', '╗', '╝', '╜', '╛', '┐', '└', '┴', '┬', '├', '─', '┼', '╞', '╟',
        '╚', '╔', '╩', '╦', '╠', '═', '╬', '╧', '╨', '╤', '╥', '╙', '╘', '╒', '╓', '╫', '╪', '┘',
        '┌', '█', '▄', '▌', '▐', '▀', 'α', 'ß', 'Γ', 'π', 'Σ', 'σ', 'µ', 'τ', 'Φ', 'Θ', 'Ω', 'δ',
        '∞', 'φ', 'ε', '∩', '≡', '±', '≥', '≤', '⌠', '⌡', '÷', '≈', '°', '∙', '·', '√', 'ⁿ', '²',
        '■', '\u{a0}',
    ];
    raw.iter()
        .map(|&b| if b < 0x80 { b as char } else { HIGH[(b - 0x80) as usize] })
        .collect()
}

fn decode_name(raw: &[u8], flags: u16) -> String {
    if flags & FLAG_UTF8 != 0 {
        return String::from_utf8_lossy(raw).into_owned();
    }
    match std::str::from_utf8(raw) {
        // Many writers store UTF-8 without setting the flag; ASCII is identical.
        Ok(s) => s.to_owned(),
        Err(_) => decode_cp437(raw),
    }
}

impl<'a> Archive<'a> {
    /// Parses the central directory of `bytes`.
    pub fn parse(bytes: &'a [u8]) -> Result<Self> {
        if bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
            return Err(Error::Unsupported(
                "this file is an OLE compound document (a legacy .ppt or a password-protected presentation)"
                    .into(),
            ));
        }
        let eocd = find_eocd(bytes)?;
        let mut entry_count = u64::from(u16_at(bytes, eocd + 10)?);
        let mut cd_size = u64::from(u32_at(bytes, eocd + 12)?);
        let mut cd_offset = u64::from(u32_at(bytes, eocd + 16)?);
        if (entry_count == 0xFFFF || cd_size == 0xFFFF_FFFF || cd_offset == 0xFFFF_FFFF)
            && eocd >= 20
            && u32_at(bytes, eocd - 20)? == ZIP64_LOCATOR_SIG
        {
            let z64 = to_usize(u64_at(bytes, eocd - 20 + 8)?)?;
            if u32_at(bytes, z64)? != ZIP64_EOCD_SIG {
                return Err(Error::Zip("bad ZIP64 end of central directory"));
            }
            entry_count = u64_at(bytes, z64 + 32)?;
            cd_size = u64_at(bytes, z64 + 40)?;
            cd_offset = u64_at(bytes, z64 + 48)?;
        }
        let cd_start = to_usize(cd_offset)?;
        let cd_end = cd_start
            .checked_add(to_usize(cd_size)?)
            .filter(|&end| end <= bytes.len())
            .ok_or(Error::Zip("central directory out of bounds"))?;
        // Each central header is at least 46 bytes; reject absurd counts early.
        if entry_count > (cd_end - cd_start) as u64 / 46 + 1 {
            return Err(Error::Zip("central directory entry count is inconsistent"));
        }
        let mut entries = Vec::with_capacity(entry_count as usize);
        let mut at = cd_start;
        let mut total: u64 = 0;
        while at + 46 <= cd_end && entries.len() < entry_count as usize {
            if u32_at(bytes, at)? != CENTRAL_HEADER_SIG {
                return Err(Error::Zip("bad central directory header"));
            }
            let flags = u16_at(bytes, at + 8)?;
            let method = u16_at(bytes, at + 10)?;
            let mod_time = u16_at(bytes, at + 12)?;
            let mod_date = u16_at(bytes, at + 14)?;
            let crc32 = u32_at(bytes, at + 16)?;
            let mut compressed_size = u64::from(u32_at(bytes, at + 20)?);
            let mut uncompressed_size = u64::from(u32_at(bytes, at + 24)?);
            let name_len = usize::from(u16_at(bytes, at + 28)?);
            let extra_len = usize::from(u16_at(bytes, at + 30)?);
            let comment_len = usize::from(u16_at(bytes, at + 32)?);
            let mut local_offset = u64::from(u32_at(bytes, at + 42)?);
            let name_raw = bytes
                .get(at + 46..at + 46 + name_len)
                .ok_or(Error::Zip("truncated entry name"))?;
            let extra = bytes
                .get(at + 46 + name_len..at + 46 + name_len + extra_len)
                .ok_or(Error::Zip("truncated extra field"))?;
            apply_zip64_extra(
                extra,
                &mut uncompressed_size,
                &mut compressed_size,
                &mut local_offset,
            )?;
            at += 46 + name_len + extra_len + comment_len;
            let name = decode_name(name_raw, flags);
            if name.ends_with('/') {
                continue; // directory entry
            }
            if flags & FLAG_ENCRYPTED != 0 {
                return Err(Error::Unsupported(format!("encrypted zip entry {name}")));
            }
            if uncompressed_size > MAX_ENTRY_SIZE {
                return Err(Error::LimitExceeded(format!("zip entry {name} is too large")));
            }
            total = total.saturating_add(uncompressed_size);
            if total > MAX_TOTAL_SIZE {
                return Err(Error::LimitExceeded("archive inflates beyond the size limit".into()));
            }
            let lo = to_usize(local_offset)?;
            if u32_at(bytes, lo)? != LOCAL_HEADER_SIG {
                return Err(Error::Zip("bad local file header"));
            }
            let local_name_len = usize::from(u16_at(bytes, lo + 26)?);
            let local_extra_len = usize::from(u16_at(bytes, lo + 28)?);
            let data_start = lo + 30 + local_name_len + local_extra_len;
            let data_end = data_start
                .checked_add(to_usize(compressed_size)?)
                .ok_or(Error::Zip("entry size overflow"))?;
            if data_end > bytes.len() {
                return Err(Error::Zip("entry data out of bounds"));
            }
            entries.push(Entry {
                name,
                method,
                crc32,
                compressed_size,
                uncompressed_size,
                mod_time,
                mod_date,
                data_start,
            });
        }
        Ok(Self { bytes, entries })
    }

    /// Entries in central-directory order.
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// The compressed bytes of an entry.
    pub fn raw_data(&self, entry: &Entry) -> &'a [u8] {
        &self.bytes[entry.data_start..entry.data_start + entry.compressed_size as usize]
    }

    /// Inflates an entry and verifies its checksum.
    pub fn read(&self, entry: &Entry) -> Result<Vec<u8>> {
        inflate_entry(entry, self.raw_data(entry))
    }
}

/// Inflates the compressed bytes of `entry` and verifies the CRC.
pub fn inflate_entry(entry: &Entry, raw: &[u8]) -> Result<Vec<u8>> {
    let data = match entry.method {
        METHOD_STORED => raw.to_vec(),
        METHOD_DEFLATE => miniz_oxide::inflate::decompress_to_vec_with_limit(
            raw,
            entry.uncompressed_size.min(MAX_ENTRY_SIZE) as usize,
        )
        .map_err(|_| Error::Zip("corrupt deflate stream"))?,
        other => {
            return Err(Error::Unsupported(format!(
                "zip compression method {other} in {}",
                entry.name
            )));
        }
    };
    if data.len() as u64 != entry.uncompressed_size {
        return Err(Error::Zip("entry size mismatch"));
    }
    if crc32(&data) != entry.crc32 {
        return Err(Error::Zip("entry checksum mismatch"));
    }
    Ok(data)
}

fn apply_zip64_extra(
    mut extra: &[u8],
    uncompressed: &mut u64,
    compressed: &mut u64,
    offset: &mut u64,
) -> Result<()> {
    while extra.len() >= 4 {
        let id = u16::from_le_bytes([extra[0], extra[1]]);
        let len = usize::from(u16::from_le_bytes([extra[2], extra[3]]));
        let body = extra.get(4..4 + len).ok_or(Error::Zip("truncated extra field"))?;
        if id == ZIP64_EXTRA_ID {
            let mut at = 0;
            for field in [&mut *uncompressed, &mut *compressed, &mut *offset] {
                if *field == 0xFFFF_FFFF {
                    *field = u64_at(body, at)?;
                    at += 8;
                }
            }
        }
        extra = &extra[4 + len..];
    }
    Ok(())
}

fn find_eocd(bytes: &[u8]) -> Result<usize> {
    if bytes.len() < 22 {
        return Err(Error::Zip("file is too small to be a zip archive"));
    }
    let lowest = bytes.len().saturating_sub(MAX_EOCD_SEARCH);
    let mut at = bytes.len() - 22;
    loop {
        if u32_at(bytes, at)? == EOCD_SIG {
            return Ok(at);
        }
        if at == lowest {
            return Err(Error::Zip("not a zip archive (no end of central directory)"));
        }
        at -= 1;
    }
}

/// The payload of an entry being written.
pub enum WriteData<'a> {
    /// Uncompressed bytes to deflate (or store, for already-compressed media).
    Fresh {
        /// The uncompressed bytes.
        data: &'a [u8],
        /// Whether to deflate the bytes.
        compress: bool,
    },
    /// Original compressed bytes, copied verbatim.
    Raw {
        /// The entry metadata from the source archive.
        entry: &'a Entry,
        /// The compressed bytes from the source archive.
        raw: &'a [u8],
    },
}

struct Written {
    name: String,
    method: u16,
    crc32: u32,
    compressed: u64,
    uncompressed: u64,
    mod_time: u16,
    mod_date: u16,
    offset: u64,
}

/// Streams entries into a new archive.
#[derive(Default)]
pub struct Writer {
    out: Vec<u8>,
    written: Vec<Written>,
}

impl Writer {
    /// Creates an empty writer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends an entry.
    pub fn add(&mut self, name: &str, data: WriteData<'_>) -> Result<()> {
        let (method, crc, uncompressed, mod_time, mod_date, payload): (
            u16,
            u32,
            u64,
            u16,
            u16,
            std::borrow::Cow<'_, [u8]>,
        ) = match data {
            WriteData::Fresh { data, compress } => {
                let crc = crc32(data);
                if compress && data.len() > 64 {
                    let deflated =
                        miniz_oxide::deflate::compress_to_vec(data, DEFLATE_LEVEL);
                    (METHOD_DEFLATE, crc, data.len() as u64, 0, DOS_EPOCH_DATE, deflated.into())
                } else {
                    (METHOD_STORED, crc, data.len() as u64, 0, DOS_EPOCH_DATE, data.into())
                }
            }
            WriteData::Raw { entry, raw } => (
                entry.method,
                entry.crc32,
                entry.uncompressed_size,
                entry.mod_time,
                entry.mod_date,
                raw.into(),
            ),
        };
        let offset = self.out.len() as u64;
        let compressed = payload.len() as u64;
        if offset > 0xFFFF_FFFF || compressed > 0xFFFF_FFFF || uncompressed > 0xFFFF_FFFF {
            return Err(Error::LimitExceeded("package exceeds 4 GiB".into()));
        }
        let name_bytes = name.as_bytes();
        let name_len =
            u16::try_from(name_bytes.len()).map_err(|_| Error::Zip("entry name too long"))?;
        let flags = if name.is_ascii() { 0 } else { FLAG_UTF8 };
        let out = &mut self.out;
        out.extend_from_slice(&LOCAL_HEADER_SIG.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&flags.to_le_bytes());
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&mod_time.to_le_bytes());
        out.extend_from_slice(&mod_date.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(compressed as u32).to_le_bytes());
        out.extend_from_slice(&(uncompressed as u32).to_le_bytes());
        out.extend_from_slice(&name_len.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra length
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(&payload);
        self.written.push(Written {
            name: name.to_owned(),
            method,
            crc32: crc,
            compressed,
            uncompressed,
            mod_time,
            mod_date,
            offset,
        });
        Ok(())
    }

    /// Writes the central directory and returns the archive bytes.
    pub fn finish(mut self) -> Result<Vec<u8>> {
        let cd_start = self.out.len() as u64;
        let count = u16::try_from(self.written.len())
            .map_err(|_| Error::LimitExceeded("too many package parts".into()))?;
        for w in &self.written {
            let flags: u16 = if w.name.is_ascii() { 0 } else { FLAG_UTF8 };
            let out = &mut self.out;
            out.extend_from_slice(&CENTRAL_HEADER_SIG.to_le_bytes());
            out.extend_from_slice(&20u16.to_le_bytes()); // version made by
            out.extend_from_slice(&20u16.to_le_bytes()); // version needed
            out.extend_from_slice(&flags.to_le_bytes());
            out.extend_from_slice(&w.method.to_le_bytes());
            out.extend_from_slice(&w.mod_time.to_le_bytes());
            out.extend_from_slice(&w.mod_date.to_le_bytes());
            out.extend_from_slice(&w.crc32.to_le_bytes());
            out.extend_from_slice(&(w.compressed as u32).to_le_bytes());
            out.extend_from_slice(&(w.uncompressed as u32).to_le_bytes());
            out.extend_from_slice(&(w.name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // extra
            out.extend_from_slice(&0u16.to_le_bytes()); // comment
            out.extend_from_slice(&0u16.to_le_bytes()); // disk
            out.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
            out.extend_from_slice(&0u32.to_le_bytes()); // external attrs
            out.extend_from_slice(&(w.offset as u32).to_le_bytes());
            out.extend_from_slice(w.name.as_bytes());
        }
        let cd_size = self.out.len() as u64 - cd_start;
        if cd_start > 0xFFFF_FFFF || cd_size > 0xFFFF_FFFF {
            return Err(Error::LimitExceeded("package exceeds 4 GiB".into()));
        }
        let out = &mut self.out;
        out.extend_from_slice(&EOCD_SIG.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&(cd_size as u32).to_le_bytes());
        out.extend_from_slice(&(cd_start as u32).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        Ok(self.out)
    }
}

const fn crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
}

static CRC_TABLE: [u32; 256] = crc_table();

/// CRC-32 (IEEE 802.3), as used by ZIP.
pub fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c = CRC_TABLE[((c ^ u32::from(b)) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

#[cfg(test)]
mod test;
