//! Open Packaging Conventions: parts, content types, and relationships.
//!
//! A [`Package`] keeps the original archive bytes. Parts the caller never
//! replaces are written back with their original compressed bytes, so saving
//! only changes what was edited.

mod content_types;
mod rels;

pub use content_types::ContentTypes;
pub use rels::{Relationship, Relationships, TargetMode};

use crate::error::{Error, Result};
use crate::zip::{self, Archive, Entry, WriteData};
use std::borrow::Cow;
use std::collections::HashMap;

/// Name of the content-types part.
pub const CONTENT_TYPES_PART: &str = "/[Content_Types].xml";
/// Name of the package-level relationships part.
pub const PACKAGE_RELS_PART: &str = "/_rels/.rels";

/// Well-known relationship types.
pub mod rel_type {
    /// Package → main presentation part.
    pub const OFFICE_DOCUMENT: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
    /// ISO 29500 strict spelling of [`OFFICE_DOCUMENT`].
    pub const OFFICE_DOCUMENT_STRICT: &str =
        "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument";
    /// Presentation → slide.
    pub const SLIDE: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
    /// Presentation → slide master; slide layout → slide master.
    pub const SLIDE_MASTER: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
    /// Slide → slide layout; slide master → slide layouts.
    pub const SLIDE_LAYOUT: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
    /// Master/presentation → theme.
    pub const THEME: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
    /// Slide → notes slide.
    pub const NOTES_SLIDE: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
    /// Presentation → notes master.
    pub const NOTES_MASTER: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
    /// Any part → image.
    pub const IMAGE: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
    /// Graphic frame → chart.
    pub const CHART: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
    /// Any part → hyperlink target.
    pub const HYPERLINK: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
    /// Presentation → table styles.
    pub const TABLE_STYLES: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles";
    /// SmartArt pre-rendered drawing.
    pub const DIAGRAM_DRAWING: &str =
        "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing";
    /// Slide → comments.
    pub const COMMENTS: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
    /// Package → core properties.
    pub const CORE_PROPERTIES: &str =
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
}

/// Well-known content types.
pub mod content_type {
    /// Slide part.
    pub const SLIDE: &str =
        "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
    /// Notes slide part.
    pub const NOTES_SLIDE: &str =
        "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
    /// Relationships part.
    pub const RELATIONSHIPS: &str = "application/vnd.openxmlformats-package.relationships+xml";
}

#[derive(Clone, Debug)]
enum PartData {
    /// Still the bytes from the source archive.
    Original(Entry),
    /// Replaced or newly created, with the package generation of the write.
    Modified(std::sync::Arc<Vec<u8>>, u64),
}

#[derive(Clone, Debug)]
struct Part {
    /// Normalized part name with a leading slash.
    name: String,
    /// Name inside the zip (original spelling, no leading slash).
    zip_name: String,
    data: PartData,
}

/// Pseudo-random numbers for naming new parts and ids.
///
/// Peers editing one presentation concurrently must not mint the same part
/// name, relationship id, slide id, or shape id, or their merged edits would
/// collide. Sequential allocation ("the next free number") collides almost
/// surely; random allocation from a wide range practically never does.
#[derive(Debug)]
pub struct IdSource(std::sync::atomic::AtomicU64);

impl IdSource {
    /// A source seeded with `seed` (use a value unique to the editing peer).
    pub fn new(seed: u64) -> Self {
        Self(std::sync::atomic::AtomicU64::new(seed))
    }

    /// The next number in `range` (splitmix64).
    pub fn next_in(&self, range: std::ops::Range<u64>) -> u64 {
        let state = self
            .0
            .fetch_add(0x9E37_79B9_7F4A_7C15, std::sync::atomic::Ordering::Relaxed)
            .wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        range.start + z % (range.end - range.start).max(1)
    }
}

/// An OPC package (a `.pptx` file).
#[derive(Clone)]
pub struct Package {
    source: std::sync::Arc<Vec<u8>>,
    parts: Vec<Part>,
    /// Lower-cased part name → index into `parts`.
    index: HashMap<String, usize>,
    content_types: ContentTypes,
    /// Bumped on every write, so part identities never repeat.
    generation: u64,
    /// Random naming for new parts and ids (collaborative editing).
    ids: Option<std::sync::Arc<IdSource>>,
}

/// Normalizes a part name: leading slash, `/` separators, no `.`/`..` segments.
pub fn normalize_part_name(name: &str) -> String {
    let mut segments: Vec<&str> = Vec::new();
    for seg in name.split(['/', '\\']) {
        match seg {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            s => segments.push(s),
        }
    }
    format!("/{}", segments.join("/"))
}

/// Directory of a part name (`/ppt/slides/slide1.xml` → `/ppt/slides`).
pub fn part_dir(name: &str) -> &str {
    name.rfind('/').map_or("", |i| &name[..i])
}

/// The relationships part that belongs to `part`.
pub fn rels_part_name(part: &str) -> String {
    let dir = part_dir(part);
    let file = &part[dir.len() + 1..];
    format!("{dir}/_rels/{file}.rels")
}

/// Decodes `%XX` escapes in a relationship target.
pub fn percent_decode(s: &str) -> String {
    if !s.contains('%') {
        return s.to_owned();
    }
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && i + 2 < b.len()
            && let (Some(hi), Some(lo)) = (hex(b[i + 1]), hex(b[i + 2]))
        {
            out.push(hi << 4 | lo);
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolves a relationship target relative to its source part.
pub fn resolve_target(source_part: &str, target: &str) -> String {
    let target = percent_decode(target);
    let target = target.split('#').next().unwrap_or("");
    if target.starts_with('/') {
        normalize_part_name(target)
    } else {
        normalize_part_name(&format!("{}/{}", part_dir(source_part), target))
    }
}

/// Computes a relative reference from `source_part`'s directory to `target_part`.
pub fn relative_target(source_part: &str, target_part: &str) -> String {
    let from: Vec<&str> = part_dir(source_part)
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let to: Vec<&str> = target_part.split('/').filter(|s| !s.is_empty()).collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = std::iter::repeat_n("..", from.len() - common).collect();
    parts.extend(&to[common..]);
    parts.join("/")
}

impl Package {
    /// Opens a package from the bytes of a `.pptx` file.
    pub fn open(bytes: Vec<u8>) -> Result<Self> {
        let source = std::sync::Arc::new(bytes);
        let archive = Archive::parse(&source)?;
        let mut parts = Vec::with_capacity(archive.entries().len());
        let mut index = HashMap::new();
        for entry in archive.entries() {
            let name = normalize_part_name(&entry.name);
            let key = name.to_ascii_lowercase();
            if index.contains_key(&key) {
                // Duplicate names are invalid OPC; keep the first occurrence.
                continue;
            }
            index.insert(key, parts.len());
            parts.push(Part {
                name,
                zip_name: entry.name.clone(),
                data: PartData::Original(entry.clone()),
            });
        }
        drop(archive);
        let mut pkg = Self {
            source,
            parts,
            index,
            content_types: ContentTypes::default(),
            generation: 0,
            ids: None,
        };
        let ct_bytes = pkg
            .read(CONTENT_TYPES_PART)
            .map_err(|_| Error::MissingPart("[Content_Types].xml (not an Office package)".into()))?
            .into_owned();
        pkg.content_types = ContentTypes::parse(&ct_bytes)?;
        Ok(pkg)
    }

    /// Whether a part exists (case-insensitive, as OPC requires).
    pub fn has_part(&self, name: &str) -> bool {
        self.index
            .contains_key(&normalize_part_name(name).to_ascii_lowercase())
    }

    fn part(&self, name: &str) -> Option<&Part> {
        self.index
            .get(&normalize_part_name(name).to_ascii_lowercase())
            .map(|&i| &self.parts[i])
    }

    /// The canonical spelling of a part name as stored in the package.
    pub fn canonical_name(&self, name: &str) -> Option<&str> {
        self.part(name).map(|p| p.name.as_str())
    }

    /// Part names in package order.
    pub fn part_names(&self) -> impl Iterator<Item = &str> {
        self.parts.iter().map(|p| p.name.as_str())
    }

    /// Reads (inflating if needed) the bytes of a part.
    pub fn read(&self, name: &str) -> Result<Cow<'_, [u8]>> {
        let part = self
            .part(name)
            .ok_or_else(|| Error::MissingPart(name.to_owned()))?;
        match &part.data {
            PartData::Original(entry) => {
                let raw = &self.source
                    [entry.data_start..entry.data_start + entry.compressed_size as usize];
                Ok(Cow::Owned(zip::inflate_entry(entry, raw)?))
            }
            PartData::Modified(bytes, _) => Ok(Cow::Borrowed(bytes.as_slice())),
        }
    }

    /// Reads at most the first `max` bytes of a part (inflating only those),
    /// for file headers.
    pub fn read_prefix(&self, name: &str, max: usize) -> Result<Cow<'_, [u8]>> {
        let part = self
            .part(name)
            .ok_or_else(|| Error::MissingPart(name.to_owned()))?;
        match &part.data {
            PartData::Original(entry) => {
                let raw = &self.source
                    [entry.data_start..entry.data_start + entry.compressed_size as usize];
                Ok(Cow::Owned(zip::inflate_prefix(entry, raw, max)?))
            }
            PartData::Modified(bytes, _) => Ok(Cow::Borrowed(&bytes[..max.min(bytes.len())])),
        }
    }

    /// Uncompressed size of a part, without inflating it.
    pub fn part_size(&self, name: &str) -> Option<u64> {
        self.part(name).map(|p| match &p.data {
            PartData::Original(e) => e.uncompressed_size,
            PartData::Modified(b, _) => b.len() as u64,
        })
    }

    /// A token identifying a part's current bytes. Two states of the same
    /// package hold identical bytes for a part when their tokens are equal.
    pub fn part_identity(&self, name: &str) -> Option<(bool, usize)> {
        self.part(name).map(|p| match &p.data {
            PartData::Original(e) => (false, e.data_start),
            PartData::Modified(_, generation) => (true, *generation as usize),
        })
    }

    /// Whether a part was replaced or created since opening.
    pub fn is_modified(&self, name: &str) -> bool {
        self.part(name)
            .is_some_and(|p| matches!(p.data, PartData::Modified(..)))
    }

    /// Replaces (or creates) a part. New parts need a content type, either an
    /// override registered here or a default for their extension.
    pub fn write(&mut self, name: &str, bytes: Vec<u8>, content_type: Option<&str>) {
        let name = normalize_part_name(name);
        let key = name.to_ascii_lowercase();
        self.generation += 1;
        let data = PartData::Modified(std::sync::Arc::new(bytes), self.generation);
        match self.index.get(&key) {
            Some(&i) => self.parts[i].data = data,
            None => {
                self.index.insert(key, self.parts.len());
                self.parts.push(Part {
                    zip_name: name[1..].to_owned(),
                    name: name.clone(),
                    data,
                });
            }
        }
        if let Some(ct) = content_type {
            self.content_types.set_override(&name, ct);
        }
    }

    /// Removes a part (and its content-type override).
    pub fn delete(&mut self, name: &str) {
        let key = normalize_part_name(name).to_ascii_lowercase();
        if let Some(i) = self.index.remove(&key) {
            let removed = self.parts.remove(i);
            self.content_types.remove_override(&removed.name);
            for v in self.index.values_mut() {
                if *v > i {
                    *v -= 1;
                }
            }
        }
    }

    /// The package's content types.
    pub fn content_types(&self) -> &ContentTypes {
        &self.content_types
    }

    /// Replaces the content types (written out on the next save).
    pub fn set_content_types(&mut self, mut content_types: ContentTypes) {
        content_types.mark_dirty();
        self.content_types = content_types;
    }

    /// Mutable access to content types.
    pub fn content_types_mut(&mut self) -> &mut ContentTypes {
        &mut self.content_types
    }

    /// Content type of a part.
    pub fn content_type(&self, name: &str) -> Option<&str> {
        self.content_types.lookup(&normalize_part_name(name))
    }

    /// Parses the relationships of `source_part` (empty if it has none).
    pub fn rels(&self, source_part: &str) -> Result<Relationships> {
        let rels_name = if source_part == "/" {
            PACKAGE_RELS_PART.to_owned()
        } else {
            rels_part_name(source_part)
        };
        let rels = if self.has_part(&rels_name) {
            Relationships::parse(source_part, &self.read(&rels_name)?)?
        } else {
            Relationships::empty(source_part)
        };
        Ok(rels.with_ids(self.ids.clone()))
    }

    /// Writes the relationships of a part back to the package.
    pub fn write_rels(&mut self, rels: &Relationships) {
        let name = if rels.source() == "/" {
            PACKAGE_RELS_PART.to_owned()
        } else {
            rels_part_name(rels.source())
        };
        self.write(&name, rels.to_bytes(), None);
        self.content_types
            .ensure_default("rels", content_type::RELATIONSHIPS);
    }

    /// Picks an unused part name `"{prefix}{n}{suffix}"`: the smallest n ≥ 1,
    /// or a random one when [`Package::use_random_ids`] is on.
    pub fn unique_part_name(&self, prefix: &str, suffix: &str) -> String {
        if let Some(ids) = &self.ids {
            loop {
                let name = format!("{prefix}{}{suffix}", ids.next_in(1_000_000..1_000_000_000));
                if !self.has_part(&name) {
                    return name;
                }
            }
        }
        (1..)
            .map(|n| format!("{prefix}{n}{suffix}"))
            .find(|n| !self.has_part(n))
            .expect("unbounded search")
    }

    /// Names new parts and relationships, and new slides and shapes number
    /// their ids, from `ids` instead of the next free number.
    pub fn use_random_ids(&mut self, ids: std::sync::Arc<IdSource>) {
        self.ids = Some(ids);
    }

    /// The random id source, when [`Package::use_random_ids`] is on.
    pub fn ids(&self) -> Option<&std::sync::Arc<IdSource>> {
        self.ids.as_ref()
    }

    /// The main presentation part (target of the package's officeDocument relationship).
    pub fn main_part(&self) -> Result<String> {
        let rels = self.rels("/")?;
        rels.iter()
            .find(|r| {
                r.rel_type == rel_type::OFFICE_DOCUMENT
                    || r.rel_type == rel_type::OFFICE_DOCUMENT_STRICT
            })
            .map(|r| rels.resolve(r))
            .or_else(|| {
                self.has_part("/ppt/presentation.xml")
                    .then(|| "/ppt/presentation.xml".to_owned())
            })
            .ok_or_else(|| Error::MissingPart("officeDocument relationship".into()))
    }

    /// Serializes the package. Untouched parts keep their original bytes.
    pub fn save(&self) -> Result<Vec<u8>> {
        let mut writer = zip::Writer::new();
        let ct_original = self.part(CONTENT_TYPES_PART).and_then(|p| match &p.data {
            PartData::Original(entry) if !self.content_types.is_dirty() => Some((p, entry)),
            _ => None,
        });
        match ct_original {
            Some((part, entry)) => {
                let raw = &self.source
                    [entry.data_start..entry.data_start + entry.compressed_size as usize];
                writer.add(&part.zip_name, WriteData::Raw { entry, raw })?;
            }
            None => {
                let ct_bytes = self.content_types.to_bytes();
                writer.add(
                    "[Content_Types].xml",
                    WriteData::Fresh {
                        data: &ct_bytes,
                        compress: true,
                    },
                )?;
            }
        }
        for part in &self.parts {
            if part.name.eq_ignore_ascii_case(CONTENT_TYPES_PART) {
                continue;
            }
            match &part.data {
                PartData::Original(entry) => {
                    let raw = &self.source
                        [entry.data_start..entry.data_start + entry.compressed_size as usize];
                    writer.add(&part.zip_name, WriteData::Raw { entry, raw })?;
                }
                PartData::Modified(bytes, _) => {
                    writer.add(
                        &part.zip_name,
                        WriteData::Fresh {
                            data: bytes,
                            compress: should_compress(&part.name),
                        },
                    )?;
                }
            }
        }
        writer.finish()
    }
}

/// Already-compressed media gains nothing from DEFLATE.
fn should_compress(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    !matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "mp4"
            | "m4a"
            | "mp3"
            | "zip"
            | "xlsx"
            | "docx"
            | "pptx"
            | "wdp"
    )
}

#[cfg(test)]
mod test;
