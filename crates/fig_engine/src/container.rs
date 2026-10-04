//! The file container around Figma's binary document.
//!
//! Two layouts exist. Files saved since 2022 are ZIP archives holding
//! `canvas.fig` (the document), `meta.json`, `thumbnail.png`, and the image
//! fills under `images/<sha1>`. Older files, and the clipboard format, are
//! the bare document. The document itself starts with an 8-byte magic
//! (`fig-kiwi`, `fig-jam.`, …), a little-endian format version, and
//! length-prefixed chunks: the compressed kiwi schema, the compressed
//! message, and (in legacy files) an uncompressed PNG thumbnail.

use crate::error::{FigError, Result, corrupt};
use crate::zip::ZipArchive;
use std::collections::HashMap;
use std::io::Read;

/// The pieces of a `.fig` file, decompressed.
pub struct Container {
    /// Format version from the document header.
    pub version: u32,
    /// The decompressed kiwi schema.
    pub schema: Vec<u8>,
    /// The decompressed kiwi message.
    pub message: Vec<u8>,
    /// Image fills by lowercase hex SHA-1, still encoded (PNG, JPEG, …).
    pub images: HashMap<String, Vec<u8>>,
    /// Figma's own render of (part of) the first page.
    pub thumbnail: Option<Vec<u8>>,
    /// `meta.json`, when the file has one.
    pub meta: Option<serde_json::Value>,
}

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xb5, 0x2f, 0xfd];

/// Whether `bytes` look like a Figma file of either layout.
pub fn is_fig(bytes: &[u8]) -> bool {
    bytes.starts_with(b"fig-")
        || (bytes.starts_with(b"PK\x03\x04")
            && ZipArchive::new(bytes)
                .map(|zip| zip.find("canvas.fig").is_some())
                .unwrap_or(false))
}

impl Container {
    /// Splits a `.fig` file into its parts.
    pub fn open(bytes: &[u8]) -> Result<Container> {
        if bytes.starts_with(b"PK") {
            return Self::open_zip(bytes);
        }
        Self::open_document(bytes, HashMap::new(), None, None)
    }

    fn open_zip(bytes: &[u8]) -> Result<Container> {
        let zip = ZipArchive::new(bytes)?;
        let canvas = zip
            .find("canvas.fig")
            .ok_or(FigError::NotFigma)
            .and_then(|entry| zip.read(entry))?;
        let mut images = HashMap::new();
        let mut thumbnail = None;
        let mut meta = None;
        for entry in zip.entries() {
            if let Some(hash) = entry.name.strip_prefix("images/") {
                if hash.is_empty() {
                    continue;
                }
                images.insert(hash.to_ascii_lowercase(), zip.read(entry)?);
            } else if entry.name == "thumbnail.png" {
                thumbnail = Some(zip.read(entry)?);
            } else if entry.name == "meta.json" {
                meta = serde_json::from_slice(&zip.read(entry)?).ok();
            }
        }
        Self::open_document(&canvas, images, thumbnail, meta)
    }

    fn open_document(
        bytes: &[u8],
        images: HashMap<String, Vec<u8>>,
        thumbnail: Option<Vec<u8>>,
        meta: Option<serde_json::Value>,
    ) -> Result<Container> {
        if bytes.len() < 12 || !bytes.starts_with(b"fig-") {
            return Err(FigError::NotFigma);
        }
        let version = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
        let mut chunks = Vec::new();
        let mut at = 12;
        while at + 4 <= bytes.len() {
            let len = u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
                as usize;
            let start = at + 4;
            let Some(end) = start.checked_add(len).filter(|&end| end <= bytes.len()) else {
                // Trailing chunks (the thumbnail) are optional; a damaged one
                // is dropped rather than failing the whole file.
                if chunks.len() >= 2 {
                    break;
                }
                return Err(corrupt("chunk runs past the end of the file"));
            };
            chunks.push(&bytes[start..end]);
            at = end;
        }
        if chunks.len() < 2 {
            return Err(corrupt("missing schema or message chunk"));
        }
        let schema = decompress(chunks[0])?;
        let message = decompress(chunks[1])?;
        let thumbnail = thumbnail.or_else(|| {
            chunks
                .get(2)
                .filter(|chunk| chunk.starts_with(b"\x89PNG"))
                .map(|chunk| chunk.to_vec())
        });
        Ok(Container {
            version,
            schema,
            message,
            images,
            thumbnail,
            meta,
        })
    }
}

/// Inflates a chunk: zstd (current files), raw deflate (older files), or
/// zlib-wrapped deflate.
pub(crate) fn decompress(chunk: &[u8]) -> Result<Vec<u8>> {
    if chunk.starts_with(&ZSTD_MAGIC) {
        let mut out = Vec::new();
        let mut cursor = chunk;
        let mut decoder = ruzstd::decoding::StreamingDecoder::new(&mut cursor)
            .map_err(|e| corrupt(format!("zstd: {e}")))?;
        decoder
            .read_to_end(&mut out)
            .map_err(|e| corrupt(format!("zstd: {e}")))?;
        return Ok(out);
    }
    if let Ok(out) = miniz_oxide::inflate::decompress_to_vec(chunk) {
        return Ok(out);
    }
    miniz_oxide::inflate::decompress_to_vec_zlib(chunk)
        .map_err(|e| corrupt(format!("deflate: {e:?}")))
}
