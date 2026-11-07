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
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::Read;
use std::ops::{Deref, Range};
use std::sync::Arc;

/// An encoded image file: a range of the `.fig` file it was stored in
/// (shared rather than copied), or bytes of its own.
#[derive(Clone)]
pub enum Encoded {
    Shared(Arc<Vec<u8>>, Range<usize>),
    Owned(Vec<u8>),
}

impl Deref for Encoded {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match self {
            Encoded::Shared(file, range) => &file[range.clone()],
            Encoded::Owned(bytes) => bytes,
        }
    }
}

/// What to do with the image files of a ZIP-layout file.
enum Images<'a> {
    Copy,
    /// Refer to stored ones in place (the archive's bytes, shared).
    Share(&'a Arc<Vec<u8>>),
    Skip,
}

/// A document's message still compressed, to inflate as it is read
/// ([`Container::open_streaming`]).
pub(crate) struct MessageStream<'a> {
    chunk: Cow<'a, [u8]>,
}

impl MessageStream<'_> {
    /// The message from its start, inflated as it is read (zstd; older
    /// files' deflate is inflated whole).
    pub fn reader(&self) -> Result<Box<dyn Read + '_>> {
        if self.chunk.starts_with(&ZSTD_MAGIC) {
            let decoder = ruzstd::decoding::StreamingDecoder::new(&self.chunk[..])
                .map_err(|e| corrupt(format!("zstd: {e}")))?;
            return Ok(Box::new(decoder.take(MAX_CHUNK as u64 + 1)));
        }
        Ok(Box::new(std::io::Cursor::new(decompress(&self.chunk)?)))
    }

    /// The message's size when its frame says (else a guess).
    pub fn size_hint(&self) -> usize {
        if self.chunk.starts_with(&ZSTD_MAGIC)
            && let Ok(decoder) = ruzstd::decoding::StreamingDecoder::new(&self.chunk[..])
            && decoder.decoder.content_size() > 0
        {
            return decoder.decoder.content_size().min(MAX_CHUNK as u64) as usize;
        }
        self.chunk.len() * 4
    }
}

/// The pieces of a `.fig` file, decompressed.
pub struct Container {
    /// Format version from the document header.
    pub version: u32,
    /// The decompressed kiwi schema.
    pub schema: Vec<u8>,
    /// The decompressed kiwi message.
    pub message: Vec<u8>,
    /// Image fills by lowercase hex SHA-1, still encoded (PNG, JPEG, …).
    pub images: HashMap<String, Encoded>,
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
        Self::open_with(bytes, Images::Copy)
    }

    /// Splits a `.fig` file into its parts; stored image files stay in
    /// `bytes`, which they share, rather than being copied out.
    pub fn open_shared(bytes: &Arc<Vec<u8>>) -> Result<Container> {
        Self::open_with(bytes, Images::Share(bytes))
    }

    /// The document alone, without the image files.
    pub fn open_without_images(bytes: &[u8]) -> Result<Container> {
        Self::open_with(bytes, Images::Skip)
    }

    /// The document without the image files, its message left compressed
    /// (`message` is empty) to be read as a stream: a large file's message
    /// is hundreds of megabytes inflated.
    pub(crate) fn open_streaming(bytes: &[u8]) -> Result<(Container, MessageStream<'_>)> {
        let (container, chunk) = Self::open_parts(bytes, Images::Skip, false)?;
        Ok((container, MessageStream { chunk }))
    }

    fn open_with(bytes: &[u8], images: Images) -> Result<Container> {
        Ok(Self::open_parts(bytes, images, true)?.0)
    }

    /// The container, with the message inflated (`inflate`) or returned
    /// still compressed.
    fn open_parts<'a>(
        bytes: &'a [u8],
        images: Images,
        inflate: bool,
    ) -> Result<(Container, Cow<'a, [u8]>)> {
        if bytes.starts_with(b"PK") {
            return Self::open_zip(bytes, images, inflate);
        }
        let (container, chunk) = Self::open_document(bytes, HashMap::new(), None, None, inflate)?;
        Ok((container, Cow::Borrowed(chunk)))
    }

    fn open_zip<'a>(
        bytes: &'a [u8],
        mode: Images,
        inflate: bool,
    ) -> Result<(Container, Cow<'a, [u8]>)> {
        let zip = ZipArchive::new(bytes)?;
        let canvas_entry = zip.find("canvas.fig").ok_or(FigError::NotFigma)?;
        let canvas_copy;
        let canvas = match zip.stored_range(canvas_entry) {
            Some(range) => Cow::Borrowed(&bytes[range]),
            None => {
                canvas_copy = zip.read(canvas_entry)?;
                Cow::Owned(canvas_copy)
            }
        };
        let mut images = HashMap::new();
        let mut thumbnail = None;
        let mut meta = None;
        for entry in zip.entries() {
            if let Some(hash) = entry.name.strip_prefix("images/") {
                if hash.is_empty() {
                    continue;
                }
                let image = match (&mode, zip.stored_range(entry)) {
                    (Images::Skip, _) => continue,
                    (Images::Share(file), Some(range)) => Encoded::Shared(Arc::clone(file), range),
                    _ => Encoded::Owned(zip.read(entry)?),
                };
                images.insert(hash.to_ascii_lowercase(), image);
            } else if entry.name == "thumbnail.png" {
                thumbnail = Some(zip.read(entry)?);
            } else if entry.name == "meta.json" {
                meta = serde_json::from_slice(&zip.read(entry)?).ok();
            }
        }
        match canvas {
            Cow::Borrowed(canvas) => {
                let (container, chunk) =
                    Self::open_document(canvas, images, thumbnail, meta, inflate)?;
                Ok((container, Cow::Borrowed(chunk)))
            }
            Cow::Owned(canvas) => {
                let (container, chunk) =
                    Self::open_document(&canvas, images, thumbnail, meta, inflate)?;
                let chunk = chunk.to_vec();
                Ok((container, Cow::Owned(chunk)))
            }
        }
    }

    /// The document's parts, and its message chunk as stored.
    fn open_document(
        bytes: &[u8],
        images: HashMap<String, Encoded>,
        thumbnail: Option<Vec<u8>>,
        meta: Option<serde_json::Value>,
        inflate: bool,
    ) -> Result<(Container, &[u8])> {
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
        let message = if inflate {
            decompress(chunks[1])?
        } else {
            Vec::new()
        };
        let thumbnail = thumbnail.or_else(|| {
            chunks
                .get(2)
                .filter(|chunk| chunk.starts_with(b"\x89PNG"))
                .map(|chunk| chunk.to_vec())
        });
        Ok((
            Container {
                version,
                schema,
                message,
                images,
                thumbnail,
                meta,
            },
            chunks[1],
        ))
    }
}

/// The largest a decompressed schema or message may be, so a small crafted
/// chunk cannot exhaust memory.
const MAX_CHUNK: usize = 1 << 30;

/// Inflates a chunk: zstd (current files), raw deflate (older files), or
/// zlib-wrapped deflate.
pub(crate) fn decompress(chunk: &[u8]) -> Result<Vec<u8>> {
    if chunk.starts_with(&ZSTD_MAGIC) {
        let mut out = Vec::new();
        let mut cursor = chunk;
        let decoder = ruzstd::decoding::StreamingDecoder::new(&mut cursor)
            .map_err(|e| corrupt(format!("zstd: {e}")))?;
        // Frames say how large they inflate to (0 when they do not): read
        // into one allocation of that size rather than doubling into it,
        // which would briefly hold half as much again and copy it all.
        let size = decoder.decoder.content_size().min(MAX_CHUNK as u64);
        out.reserve_exact(size as usize);
        decoder
            .take(MAX_CHUNK as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|e| corrupt(format!("zstd: {e}")))?;
        if out.len() > MAX_CHUNK {
            return Err(corrupt("zstd: chunk too large".to_owned()));
        }
        return Ok(out);
    }
    if let Ok(out) = miniz_oxide::inflate::decompress_to_vec_with_limit(chunk, MAX_CHUNK) {
        return Ok(out);
    }
    miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(chunk, MAX_CHUNK)
        .map_err(|e| corrupt(format!("deflate: {e:?}")))
}
